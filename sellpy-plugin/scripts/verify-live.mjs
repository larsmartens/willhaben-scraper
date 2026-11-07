import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Credentials stay in a git-ignored, mode-0600 file. This script never emits them.
const connection = JSON.parse(await readFile(process.env.SELLPY_CONNECTION_FILE ?? 'artifacts/private/connection.json', 'utf8'));
const origin = new URL(connection.endpoint).origin;
const report = { checked_at: new Date().toISOString(), endpoint: `${origin}/mcp`, checks: [], outcome: 'running' };
const privateDirectory = 'artifacts/private/live';
await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
const sanitize = value => String(value).replaceAll(connection.endpoint, `${origin}/personal/[REDACTED]/mcp`).replaceAll(connection.token, '[REDACTED]');
const note = (name, details = {}) => {
  const entry = { name, ...details };
  report.checks.push(entry);
  console.log(JSON.stringify(entry));
};
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let modern, legacy;

async function call(name, args = {}, options = {}) {
  const started = Date.now();
  console.log(JSON.stringify({ starting: name }));
  const result = await modern.callTool({ name, arguments: args }, { timeout: 60000 });
  const data = result.structuredContent;
  assert(data, `${name}: missing structured content`);
  note(name, { milliseconds: Date.now() - started, is_error: !!result.isError,
    ...(Array.isArray(data.items) ? { items: data.items.length } : {}),
    ...(data.coverage ? { coverage: data.coverage } : {}),
    ...(data.error ? { error: data.error } : {}),
    ...(options.summarize ? options.summarize(result) : {}) });
  if (!options.expectError) assert(!result.isError, `${name}: ${data.error?.code ?? 'tool error'}`);
  else assert(result.isError, `${name}: expected a structured error`);
  return result;
}

try {
  const health = await fetch(`${origin}/health`);
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.equal(healthData.service, 'sellpy-studio');
  assert.equal((await fetch(`${origin}/mcp`)).status, 401);
  assert.equal((await fetch(connection.endpoint, { headers: { origin: 'https://untrusted.example' } })).status, 403);
  note('health_and_access_control', { status: health.status, service: healthData.service, unauthenticated: 401, hostile_origin: 403 });

  modern = new Client({ name: 'sellpy-release-verification', version: '1.2.0' }, { versionNegotiation: { mode: 'auto' } });
  await modern.connect(new StreamableHTTPClientTransport(new URL(connection.endpoint)));
  assert.equal(modern.getNegotiatedProtocolVersion(), '2026-07-28');
  assert.equal(modern.getServerVersion()?.name, 'sellpy-studio');
  note('modern_sdk_handshake', { sdk_version: '2.4.0', protocol: modern.getNegotiatedProtocolVersion(), server: modern.getServerVersion() });
  const listed = await modern.listTools();
  assert.equal(listed.tools.length, 27);
  assert.deepEqual(listed.tools.find(tool => tool.name === 'search_by_image')._meta['openai/fileParams'], ['reference']);
  const resource = await modern.readResource({ uri: 'ui://sellpy/gallery-v3.html' });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert(resource.contents[0].text.includes('Sellpy'));
  note('tools_and_gallery_resource', { tools: listed.tools.length, tool_names: listed.tools.map(tool => tool.name), reference_file_parameter: true, gallery_bytes: Buffer.byteLength(resource.contents[0].text) });

  const capabilities = await call('get_capabilities');
  assert.equal(capabilities.structuredContent.cumulative_limits.items, null);
  await call('discover_filters', { query: 'Kleid' }, { summarize: result => ({ response_keys: Object.keys(result.structuredContent) }) });
  const search = await call('search_items', { query: 'Kleid', filters: { price_max: 60 } });
  const page = search.structuredContent;
  assert(page.items.length >= 2, 'catalog smoke needs at least two current candidates');
  assert(page.items.every(item => item.market === 'AT' && item.price && item.price.amount_minor <= 6000));
  assert(page.next_cursor, 'catalog continuation must be available');
  const next = await call('continue_search', { cursor: page.next_cursor });
  const replay = await call('continue_search', { cursor: page.next_cursor });
  assert.equal(digest(next.structuredContent), digest(replay.structuredContent), 'same cursor must replay the exact page');
  assert(!page.items.some(item => next.structuredContent.items.some(other => other.id === item.id)), 'continuation must not repeat first-page items');
  note('immutable_continuation', { first_page: page.items.length, second_page: next.structuredContent.items.length, exact_replay: true, duplicate_ids: 0 });
  await call('get_search_status', { run_id: page.run_id });
  await call('list_search_items', { run_id: page.run_id, offset: 0, page_size: 3 });

  const item = page.items.find(candidate => candidate.cover?.url);
  assert(item, 'an actual source image is required');
  // This starts from a catalog observation; the tool must enrich canonical photos itself.
  const widgetImages = await call('get_item_images', { run_id: page.run_id, item_id: item.id, batch_size: 1, for_model: false },
    { summarize: result => ({ total_images: result.structuredContent.total_images, model_image_blocks: result.content.filter(block => block.type === 'image').length, hydrated_images: Object.keys(result._meta?.images ?? {}).length }) });
  assert(!widgetImages.content.some(block => block.type === 'image'));
  assert(Object.keys(widgetImages._meta?.images ?? {}).length > 0, 'widget hydration must include real bytes');
  const imageId = widgetImages.structuredContent.images.find(image => image.status === 'ready')?.id;
  assert(imageId);
  await call('record_visual_assessment', { run_id: page.run_id, item_id: item.id, checked_image_ids: [imageId], observed_type: null,
    matching_features: [], mismatches: [], uncertainties: [], requirement_results: [] }, { expectError: true });
  const modelImages = await call('get_item_images', { run_id: page.run_id, item_id: item.id, batch_size: 2, for_model: true },
    { summarize: result => ({ total_images: result.structuredContent.total_images, next_index: result.structuredContent.next_index, model_image_blocks: result.content.filter(block => block.type === 'image').length }) });
  const original = modelImages.content.find(block => block.type === 'image');
  assert(original?.data, 'model path must include actual image pixels');
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[original.mimeType];
  assert(extension);
  await writeFile(`${privateDirectory}/observed-item.${extension}`, Buffer.from(original.data, 'base64'), { mode: 0o600 });
  await writeFile(`${privateDirectory}/observation.json`, JSON.stringify({ run_id: page.run_id, item_id: item.id, images: modelImages.structuredContent.images, item }, null, 2), { mode: 0o600 });
  note('image_evidence_separation', { widget_pixels_do_not_authorize_assessment: true, actual_model_image_bytes: Buffer.from(original.data, 'base64').length });

  const detail = await call('get_items', { run_id: page.run_id, ids: [page.items[0].id, page.items[0].id, page.items[1].id], batch_size: 1 });
  assert.equal(detail.structuredContent.next_index, 1);
  const detailNext = await call('get_items', { run_id: page.run_id, ids: [page.items[0].id, page.items[0].id, page.items[1].id], start_index: 1, batch_size: 1 });
  assert.equal(detailNext.structuredContent.next_index, null);
  assert.equal(detailNext.structuredContent.items[0].id, page.items[1].id);
  const gallery = await call('present_items', { run_id: page.run_id, title: 'Release verification: exact original photos', page_size: 1,
    selection: page.items.slice(0, 2).map(candidate => ({ item_id: candidate.id, reason: 'Technical verification of canonical facts and the item’s own photograph.', cautions: ['Not a style recommendation.'] })) },
    { summarize: result => ({ cards: result.structuredContent.cards.length, hydrated_images: Object.keys(result._meta?.images ?? {}).length }) });
  assert.equal(gallery.structuredContent.cards[0].item_id, page.items[0].id);
  assert(gallery.structuredContent.cards[0].image.url);
  assert(gallery.structuredContent.next_cursor);
  const galleryNext = await call('present_items', { run_id: page.run_id, cursor: gallery.structuredContent.next_cursor });
  assert.equal(galleryNext.structuredContent.cards[0].item_id, page.items[1].id);
  await call('list_saved_searches');

  // Omit page_size deliberately: default-size native calls are release gates.
  const similar = await call('find_similar', { seed_ids: ['va0uL6CUOK'] });
  assert(similar.structuredContent.items.length > 0, 'default native similar-items search must return candidates');
  const sourceImage = await call('search_by_image', { image_url: item.cover.url });
  assert(sourceImage.structuredContent.items.length > 0, 'default source-image search must return candidates');
  const uploaded = await call('search_by_image', { reference: { download_url: item.cover.url, file_id: `release-public-reference-${Date.now()}`, mime_type: original.mimeType, file_name: `public-sellpy-reference.${extension}` } });
  assert(uploaded.structuredContent.items.length > 0, 'default multipart upload search must return candidates');
  if (uploaded.structuredContent.next_cursor) await call('continue_search', { cursor: uploaded.structuredContent.next_cursor });
  const outfit = await call('find_outfit', { item_id: 'va0uL6CUOK' });
  assert(outfit.structuredContent.items.length > 0, 'default native outfit search must return candidates');
  if (outfit.structuredContent.next_cursor) await call('continue_search', { cursor: outfit.structuredContent.next_cursor });
  const style = await call('search_style', { query: 'cottagecore dress', style: 'cottagecore', desired_type: 'dress', page_size: 12,
    attribute_queries: ['romantic floral midi dress with puff sleeves and lace'],
    relaxed_queries: ['small floral print, puff sleeves, smocked waist, romantic rural style'], filters: { price_max: 80 } });
  assert(style.structuredContent.items.length > 0, 'style search must return candidates');
  const styleStatus = await call('get_search_status', { run_id: style.structuredContent.run_id });
  assert(styleStatus.structuredContent.plan.arms.some(arm => arm.relax_categories || arm.id.includes('relaxed')), 'style recovery route must be retained');

  let legacyProtocol;
  const tracedFetch = async (input, init) => {
    const response = await fetch(input, init);
    if (typeof init?.body === 'string') {
      const request = JSON.parse(init.body);
      if (request.method === 'initialize') {
        const text = await response.clone().text();
        const json = response.headers.get('content-type')?.includes('text/event-stream') ? text.split('\n').find(line => line.startsWith('data:'))?.slice(5) : text;
        legacyProtocol = JSON.parse(json ?? '{}').result?.protocolVersion;
      }
    }
    return response;
  };
  legacy = new LegacyClient({ name: 'sellpy-legacy-release-verification', version: '1.2.0' });
  // Exercise the alternate Bearer path, sharing the same private search owner.
  await legacy.connect(new LegacyTransport(new URL(`${origin}/mcp`), { fetch: tracedFetch, requestInit: { headers: { authorization: `Bearer ${connection.token}` } } }));
  const legacyTools = await legacy.listTools();
  assert.equal(legacyTools.tools.length, 27);
  const legacyStatus = await legacy.callTool({ name: 'get_search_status', arguments: { run_id: page.run_id } });
  assert(!legacyStatus.isError);
  assert.equal(legacyStatus.structuredContent.run_id, page.run_id);
  note('legacy_sdk_handshake_and_shared_owner', { sdk_version: '1.32.2', protocol: legacyProtocol, tools: legacyTools.tools.length, bearer_path: true, resumed_modern_search: true });
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed';
  report.failure = sanitize(error?.message ?? error);
  console.error(JSON.stringify({ outcome: report.outcome, failure: report.failure }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([modern?.close(), legacy?.close()]);
  report.finished_at = new Date().toISOString();
  await writeFile('docs/live-verification.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outcome: report.outcome, checks: report.checks.length, report: 'docs/live-verification.json' }));
}
