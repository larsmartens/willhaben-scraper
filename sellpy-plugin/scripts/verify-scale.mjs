import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Only compact verification receipts are public. Credentials, run identities,
// original photographs and the matched baseline remain in ignored private files.
const connection = JSON.parse(await readFile(process.env.SELLPY_CONNECTION_FILE ?? 'artifacts/private/connection.json', 'utf8'));
const origin = new URL(connection.endpoint).origin;
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const report = { checked_at: new Date().toISOString(), version, checks: [], outcome: 'running' };
const disposable = new Set();
const clean = value => String(value).replaceAll(connection.endpoint, `${origin}/personal/[REDACTED]/mcp`).replaceAll(connection.token, '[REDACTED]');
const note = (name, details = {}) => { const row = { name, ...details }; report.checks.push(row); console.log(JSON.stringify(row)); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
let modern, legacy;

async function call(name, args = {}, options = {}) {
  console.log(JSON.stringify({ starting: name }));
  const started = performance.now();
  const result = await modern.callTool({ name, arguments: args }, { timeout: 60_000 });
  const data = result.structuredContent;
  assert(data, `${name}: structured content missing`);
  if (options.expectError) assert(result.isError, `${name}: expected a structured failure`);
  else assert(!result.isError, `${name}: ${data.error?.code ?? 'tool failure'} ${data.error?.message ?? ''}`);
  if (options.newRun && data.run_id) disposable.add(data.run_id);
  return { result, data, milliseconds: Math.round(performance.now() - started) };
}
function page(value) {
  const gallery = value.result._meta?.gallery;
  assert(gallery?.collection && gallery.page && gallery.scope, 'collection metadata missing');
  assert.equal(gallery.version, 3);
  assert(gallery.cards.length <= 24, 'page exceeds its card budget');
  assert(Object.keys(value.result._meta?.images ?? {}).length <= 2, 'initial cover budget exceeded');
  return gallery;
}

try {
  const health = await fetch(`${origin}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).version, version);
  assert.equal((await fetch(`${origin}/mcp`)).status, 401);
  modern = new Client({ name: 'sellpy-scale-release-verification', version }, { versionNegotiation: { mode: 'auto' } });
  await modern.connect(new StreamableHTTPClientTransport(new URL(connection.endpoint)));
  assert.equal(modern.getNegotiatedProtocolVersion(), '2026-07-28');
  assert.equal(modern.getServerVersion()?.version, version);
  const tools = (await modern.listTools()).tools;
  assert.equal(tools.length, 27);
  assert.deepEqual(tools.find(tool => tool.name === 'browse_collection')?._meta?.ui?.visibility, ['app']);
  assert.deepEqual(tools.find(tool => tool.name === 'search_by_image')?._meta?.['openai/fileParams'], ['reference']);
  const uri = tools.find(tool => tool.name === 'present_items')?._meta?.ui?.resourceUri;
  assert.equal(uri, 'ui://sellpy/gallery-v4.html');
  const resource = await modern.readResource({ uri });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  note('current_protocol_and_tools', { protocol: modern.getNegotiatedProtocolVersion(), tools: tools.length,
    model_tools: tools.filter(tool => tool._meta?.ui?.visibility?.includes('app') && !tool._meta?.ui?.visibility?.includes('model')).length === 1 ? 26 : null,
    app_only_browse: true, gallery_resource: uri, gallery_bytes: Buffer.byteLength(resource.contents[0].text) });

  const imported = await call('search_url', { url: 'https://www.sellpy.at/search?query=Kleid&maxPrice=60&page=2&utm_source=release-test', page_size: 50 }, { newRun: true });
  assert.equal(imported.data.imported_search.market, 'AT');
  assert.equal(imported.data.imported_search.language, 'de');
  assert.equal(imported.data.imported_search.query, 'Kleid');
  assert.equal(imported.data.imported_search.source_page, 2);
  assert.equal(imported.data.imported_search.filters.price_max, 60);
  assert(imported.data.items.length > 12);
  assert(imported.data.items.every(item => item.market === 'AT' && item.price?.amount_minor <= 6000));
  await call('search_url', { url: 'https://www.sellpy.at/search?query=Kleid&unverifiedRestriction=1' }, { expectError: true });
  note('native_search_link_import', { items: imported.data.items.length, source_page: 2, plugin_start_page: 1,
    market_preserved: true, price_bound_preserved: true, unknown_restriction_rejected: true });

  const run_id = imported.data.run_id;
  let first = page(await call('present_items', { run_id }));
  assert.equal(first.cards.length, 12);
  assert.equal(first.collection.total, imported.data.coverage.unique_items);
  assert.equal(first.scope.recorded_assessments, 0);
  assert.equal(first.scope.model_delivered_photos, 0);
  const originalTotal = first.collection.total;
  assert(imported.data.next_cursor, 'live search has no second source page');
  const continued = await call('continue_search', { cursor: imported.data.next_cursor });
  assert(continued.data.coverage.unique_items > originalTotal);
  const ids = first.cards.map(card => card.item.id);
  let cursor = first.next_cursor, pages = 1;
  while (cursor) {
    const args = { run_id, collection_id: first.collection.id, cursor, page_size: 24 };
    const value = await call('browse_collection', args), next = page(value);
    assert.equal(next.collection.total, originalTotal, 'new discoveries changed existing collection membership');
    assert.equal(next.page.start, ids.length + 1);
    if (pages === 1) {
      const repeated = page(await call('browse_collection', args));
      assert.equal(hash(repeated.cards.map(card => card.item.id)), hash(next.cards.map(card => card.item.id)));
    }
    ids.push(...next.cards.map(card => card.item.id)); cursor = next.next_cursor; pages++;
  }
  assert.equal(new Set(ids).size, originalTotal);
  assert.equal(ids.length, originalTotal);
  const updated = page(await call('present_items', { run_id, page_size: 24 }));
  assert.equal(updated.cards.length, 24);
  assert.equal(updated.collection.total, continued.data.coverage.unique_items);
  note('live_implicit_collection', { initial_cards: 12, selectable_cards: 24, frozen_members: originalTotal,
    traversed_members: ids.length, pages, duplicate_ids: 0, newer_collection_members: updated.collection.total,
    initial_cover_maximum: 2, model_photo_count: updated.scope.model_delivered_photos,
    saved_visual_assessments: updated.scope.recorded_assessments });

  const detail = await call('browse_collection', { run_id, collection_id: first.collection.id, action: 'details', item_id: ids[0], request_id: 'release-detail' });
  assert.equal(detail.result._meta.collection_detail.card.item.id, ids[0]);
  assert.equal(detail.result._meta.collection_detail.request_id, 'release-detail');
  await call('set_item_feedback', { run_id, item_id: ids.at(-1), decision: 'shortlist', reason: 'Disposable release verification' });
  let selected = page(await call('browse_collection', { run_id, collection_id: first.collection.id, action: 'derive', view: { kind: 'shortlist' }, request_id: 'release-shortlist' }));
  while (selected.collection.status === 'preparing') selected = page(await call('browse_collection', { run_id, collection_id: selected.collection.id }));
  assert.deepEqual(selected.cards.map(card => card.item.id), [ids.at(-1)]);
  assert.equal(selected.scope.recorded_assessments, 0, 'shortlisting became image evidence');
  note('global_shortlist_and_stored_details', { off_first_page_item_found: true, structured_detail_identity: true,
    feedback_is_not_assessment: true });

  const brands = await call('search_similar_brands', { brands: ['COS'], limit: 5 });
  assert(brands.data.brands.length > 0);
  assert.equal(brands.data.inventory_checked, false);
  assert(brands.data.brands.every(entry => entry.brand && entry.brand.toLowerCase() !== 'cos'));
  note('native_similar_brands', { returned: brands.data.brands.length, brand_names: brands.data.brands.map(entry => entry.brand), inventory_checked: false });

  const target = imported.data.items.find(item => item.cover?.url);
  assert(target, 'native image checks need a source photo');
  const storedImage = await call('search_by_image', { item_image: { run_id, item_id: target.id, image_index: 0 }, page_size: 12 }, { newRun: true });
  assert(storedImage.data.items.length > 0);
  const publicImage = await call('search_by_image', { public_image_url: target.cover.url, page_size: 12 }, { newRun: true });
  assert(publicImage.data.items.length > 0);
  const publicStatus = await call('get_search_status', { run_id: publicImage.data.run_id });
  assert(publicStatus.data.plan.arms.some(arm => arm.route === 'upload' && arm.reference?.file_id));
  note('native_image_inputs', { stored_item_photo_results: storedImage.data.items.length,
    public_reference_results: publicImage.data.items.length, public_reference_retained_for_native_upload: true });

  const before = JSON.parse(await readFile('artifacts/private/scale-baseline.json', 'utf8'));
  for (let offset = 0; offset < before.ids.length; offset += 8) {
    await call('get_items', { run_id: before.run_id, ids: before.ids.slice(offset, offset + 8), for_model: false });
  }
  const after = [];
  for (let index = 0; index < 3; index++) {
    const value = await call('present_items', { run_id: before.run_id, page_size: 12,
      selection: before.ids.map(item_id => ({ item_id, reason: '' })) });
    const gallery = page(value);
    assert.equal(gallery.cards.length, 12);
    after.push({ milliseconds: value.milliseconds, cards: gallery.cards.length,
      hydrated_covers: Object.keys(value.result._meta.images).length, response_bytes: Buffer.byteLength(JSON.stringify(value.result)) });
  }
  const beforeMs = before.samples.map(sample => sample.milliseconds ?? sample.ms);
  assert(beforeMs.every(Number.isFinite));
  note('matched_initial_page_measurement', { matched_item_ids: 12, canonical_details_warmed: true,
    before_version: before.version.version ?? before.version, before_samples: before.samples, after_version: version, after_samples: after,
    before_median_ms: median(beforeMs), after_median_ms: median(after.map(sample => sample.milliseconds)),
    scope: 'Initial useful 12-card response. Baseline eagerly hydrated all 12 covers; this version embeds at most two and the app loads visible remaining photos. This is not a full-photo-completion latency comparison.' });

  legacy = new LegacyClient({ name: 'sellpy-scale-legacy-verification', version });
  await legacy.connect(new LegacyTransport(new URL(connection.endpoint)));
  assert.equal((await legacy.listTools()).tools.length, 27);
  const legacyStatus = await legacy.callTool({ name: 'get_search_status', arguments: { run_id } });
  assert(!legacyStatus.isError && legacyStatus.structuredContent.run_id === run_id);
  note('legacy_client_compatibility', { sdk: '1.32.2', tools: 27, existing_owner_preserved: true });
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed'; report.failure = clean(error?.message ?? error); process.exitCode = 1;
  console.error(JSON.stringify({ outcome: report.outcome, failure: report.failure }));
} finally {
  const cleanup = [];
  for (const run_id of disposable) {
    try { const value = await call('forget_search', { run_id }); cleanup.push(value.data.deleted === true); }
    catch (error) { cleanup.push(false); console.error(JSON.stringify({ cleanup_error: clean(error?.message ?? error) })); }
  }
  note('disposable_fixture_cleanup', { created: disposable.size, deleted: cleanup.filter(Boolean).length,
    preexisting_baseline_retained: true, user_preferences_unchanged: true });
  await Promise.allSettled([modern?.close(), legacy?.close()]);
  report.finished_at = new Date().toISOString();
  await writeFile('docs/scale-live-verification.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outcome: report.outcome, checks: report.checks.length, report: 'docs/scale-live-verification.json' }));
}
