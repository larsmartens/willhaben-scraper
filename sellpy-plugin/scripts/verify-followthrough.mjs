import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const connection = JSON.parse(await readFile(process.env.SELLPY_CONNECTION_FILE ?? 'artifacts/private/connection.json', 'utf8'));
const expectedVersion = process.env.SELLPY_EXPECTED_VERSION ?? '1.1.1';
const reportPath = 'docs/followthrough-live-verification.json';
const report = { checked_at: new Date().toISOString(), expected_version: expectedVersion, outcome: 'running', checks: [], cleanup: {} };
const redact = value => String(value).replaceAll(connection.endpoint, '[PRIVATE_ENDPOINT]').replaceAll(connection.token, '[PRIVATE_TOKEN]');
const client = new Client({ name: 'sellpy-followthrough-verification', version: expectedVersion }, { versionNegotiation: { mode: 'auto' } });
let ownedRun;
const note = (name, details) => { report.checks.push({ name, ...details }); console.log(JSON.stringify({ name, ...details })); };
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, { timeout: 60000 });
  assert(!result.isError, `${name}: ${result.structuredContent?.error?.code ?? 'tool_error'}`);
  assert(result.structuredContent, `${name}: missing structured response`);
  return result;
}

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(connection.endpoint)));
  assert.equal(client.getServerVersion()?.version, expectedVersion);
  assert.equal((await client.listTools()).tools.length, 24);
  const resource = await client.readResource({ uri: 'ui://sellpy/gallery-v2.html' });
  const html = resource.contents[0].text;
  assert(html.includes('Bildbewertung offen'));
  note('version_and_gallery', { version: expectedVersion, tools: 24, gallery_sha256: createHash('sha256').update(html).digest('hex') });

  const found = (await call('search_style', {
    query: 'Cottagecore dress', style: 'cottagecore', desired_type: 'dress',
    attribute_queries: ['romantic floral dress with long sleeves'],
    relaxed_queries: ['small floral print, long sleeves, romantic rural style'],
    include: ['long sleeves'], exclude: ['transparent'], filters: { price_max: 80 }, page_size: 6,
  })).structuredContent;
  assert.match(found.run_id, /^[0-9a-f-]{36}$/i);
  ownedRun = found.run_id;
  const candidate = found.items.find(item => item.cover?.url);
  assert(candidate, 'Source must provide a real candidate photograph');
  const input = { run_id: ownedRun, item_id: candidate.id, batch_size: 1 };
  const widget = await call('get_item_images', { ...input, for_model: false });
  assert(!Object.hasOwn(widget.structuredContent, 'assessment_context'));
  assert.equal(widget.content.filter(block => block.type === 'image').length, 0);
  note('widget_separation', { assessment_context: false, model_image_blocks: 0 });

  const photos = await call('get_item_images', { ...input, for_model: true });
  const context = photos.structuredContent.assessment_context;
  assert.equal(context.run_id, ownedRun);
  assert.equal(context.item_id, candidate.id);
  assert.equal(context.requirements_scope, 'search_intent_only');
  assert.equal(context.next_tool, 'record_visual_assessment');
  assert.deepEqual(context.delivered_image_ids, photos.structuredContent.images.filter(image => image.status === 'ready').map(image => image.id));
  assert(context.delivered_image_ids.length > 0);
  assert.equal(context.delivered_image_ids.length, photos.content.filter(block => block.type === 'image').length);
  assert(!Object.hasOwn(context, 'checked_image_ids'));
  assert.deepEqual(context.requirements, [
    { requirement: 'Garment type: dress', priority: 'require' },
    { requirement: 'Style: cottagecore', priority: 'require' },
    { requirement: 'long sleeves', priority: 'require' },
    { requirement: 'transparent', priority: 'avoid' },
  ]);
  note('model_image_handoff', { delivered_images: context.delivered_image_ids.length, exact_intent_requirements: context.requirements.length, scope: context.requirements_scope });

  const gallery = (await call('present_items', { run_id: ownedRun, title: 'Technical evidence handoff check', selection: [
    { item_id: candidate.id, reason: 'Technical check of source price and identity; no visual property is asserted.' },
  ] })).structuredContent;
  assert.deepEqual(gallery.visual_review.unassessed_item_ids, [candidate.id]);
  assert.equal(gallery.cards[0].visually_assessed, false);
  assert.deepEqual(gallery.cards[0].checked_image_ids, []);
  assert(gallery.visual_review.next_action);
  const status = (await call('get_search_status', { run_id: ownedRun })).structuredContent;
  assert.equal(status.coverage.visually_assessed_items, 0);
  note('ordinary_presentation_without_invented_evidence', { cards: gallery.cards.length, missing_assessments: gallery.visual_review.unassessed_item_ids.length, recorded_assessments: 0 });

  const override = [{ requirement: 'Opaque fabric', priority: 'require' }];
  const refined = (await call('refine_search', { run_id: ownedRun, use_profile: false, preferences: { requirements: override }, page_size: 6 })).structuredContent;
  assert.deepEqual(refined.preferences.requirements, override);
  note('explicit_requirement_override', { unchanged_override_semantics: true, profile_used: false });
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed';
  report.failure = redact(error?.message ?? error);
  process.exitCode = 1;
} finally {
  if (ownedRun) {
    try {
      await call('forget_search', { run_id: ownedRun });
      report.cleanup = { owned_runs_deleted: 1, profiles_written: 0, visual_assessments_written: 0 };
    } catch (error) {
      report.cleanup = { failed: true, error: redact(error?.message ?? error) };
      report.outcome = 'failed';
      process.exitCode = 1;
    }
  }
  await client.close();
  report.finished_at = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outcome: report.outcome, checks: report.checks.length, cleanup: report.cleanup, report: reportPath, ...(report.failure ? { failure: report.failure } : {}) }));
}
