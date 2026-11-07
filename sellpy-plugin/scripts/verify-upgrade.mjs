import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs/upgrade-live-verification.json');
const newTools = ['get_preferences', 'set_preferences', 'set_item_feedback', 'list_item_feedback',
  'refine_search', 'get_item_history', 'refresh_search', 'forget_search'];
const observedFields = ['price', 'availability', 'size', 'size_system', 'condition', 'materials', 'measurements', 'defects'];
const identifier = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
const profileName = `upgrade-verification-${identifier}`;
const privatePath = path.join(root, 'artifacts/private/upgrade-live', `${identifier}.json`);
const report = { checked_at: new Date().toISOString(), expected_version: process.env.SELLPY_EXPECTED_VERSION ?? '1.1.0',
  outcome: 'running', checks: [], calls: [], cleanup: { created_runs: 0, deleted_runs: 0, profile_cleared: false } };
const ownedRuns = new Map();
const deletedRuns = new Set();
const exercisedTools = new Set();
let client, connection, profileTouched = false, defaultProfileDigest, defaultRead = false;
const secrets = new Set();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const redact = value => {
  let text = String(value);
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[REDACTED]');
  return text.replace(/\/personal\/[^/\s"?]+\/mcp/g, '/personal/[REDACTED]/mcp');
};
const emit = value => console.log(redact(JSON.stringify(value)));
const note = (name, details = {}) => { const entry = { name, ...details }; report.checks.push(entry); emit(entry); };

async function checkpoint() {
  await mkdir(path.dirname(privatePath), { recursive: true, mode: 0o700 });
  await writeFile(privatePath, JSON.stringify({ started_at: report.checked_at, profile: profileName, profile_touched: profileTouched,
    profile_cleared: report.cleanup.profile_cleared,
    runs: [...ownedRuns].map(([run_id, label]) => ({ run_id, label, deleted: deletedRuns.has(run_id) })) }, null, 2), { mode: 0o600 });
}

async function call(name, args = {}, expectedError) {
  const started = Date.now();
  emit({ starting: name });
  const result = await client.callTool({ name, arguments: args }, { timeout: 60000 });
  const data = result.structuredContent;
  assert(data && typeof data === 'object', `${name}: missing structured content`);
  const entry = { tool: name, milliseconds: Date.now() - started, is_error: result.isError === true,
    ...(data.error?.code ? { error_code: data.error.code } : {}) };
  report.calls.push(entry);
  emit(entry);
  if (expectedError) {
    assert.equal(result.isError, true, `${name}: expected ${expectedError}`);
    assert.equal(data.error?.code, expectedError, `${name}: wrong structured error`);
  } else {
    assert(!result.isError, `${name}: ${data.error?.code ?? 'tool error'}`);
    exercisedTools.add(name);
  }
  return result;
}

async function own(data, label) {
  assert.match(data.run_id ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'creation must return a run UUID');
  assert(!ownedRuns.has(data.run_id), 'a fresh search must receive a new run identity');
  ownedRuns.set(data.run_id, label);
  await checkpoint();
  return data.run_id;
}

async function feedback(runId, itemId, decision) {
  assert(ownedRuns.has(runId), 'feedback is restricted to this invocation’s disposable runs');
  const data = (await call('set_item_feedback', { run_id: runId, item_id: itemId, decision,
    reason: 'Disposable upgrade verification fixture; not a shopping preference.' })).structuredContent;
  assert.equal(data.run_id, runId);
  assert.equal(data.item_id, itemId);
  assert.equal(data.feedback?.item_id, itemId);
  assert.equal(data.feedback?.decision, decision);
  assert(Number.isFinite(Date.parse(data.feedback.updated_at)));
  return data.feedback;
}

async function collect(runId, name, field, args = {}, pageSize = 1) {
  let after = 0;
  const all = [];
  const seen = new Set();
  while (true) {
    const data = (await call(name, { run_id: runId, ...args, after, page_size: pageSize })).structuredContent;
    assert.equal(data.run_id, runId);
    assert(Array.isArray(data[field]));
    for (const entry of data[field]) {
      assert(Number.isSafeInteger(entry.sequence) && entry.sequence > after, `${name}: invalid sequence`);
      assert(!seen.has(entry.sequence), `${name}: repeated record`);
      seen.add(entry.sequence);
      all.push(entry);
    }
    if (data.next_after === null) return all;
    assert(data[field].length > 0, `${name}: an empty page cannot claim more records`);
    assert(Number.isSafeInteger(data.next_after) && data.next_after > after, `${name}: continuation did not advance`);
    after = data.next_after;
  }
}

async function ledger(runId) {
  const items = new Map();
  let offset = 0;
  while (true) {
    const data = (await call('list_search_items', { run_id: runId, offset, page_size: 200 })).structuredContent;
    assert.equal(data.run_id, runId);
    for (const item of data.items) { assert(!items.has(item.id), 'stored candidates must not repeat'); items.set(item.id, item); }
    if (data.next_offset === null) return items;
    assert(data.items.length > 0, 'an empty stored-candidate page cannot claim more records');
    assert(data.next_offset > offset, 'stored-candidate pagination must advance');
    offset = data.next_offset;
  }
}

async function drainRefinement(first) {
  const pages = [first], seen = new Set();
  let page = first;
  while (page.next_cursor) {
    assert(!seen.has(page.next_cursor), 'refinement cursor must advance');
    seen.add(page.next_cursor);
    const next = (await call('refine_search', { run_id: first.run_id, cursor: page.next_cursor })).structuredContent;
    assert.equal(next.refinement_id, first.refinement_id);
    assert.equal(next.coverage.cohort_total, first.coverage.cohort_total);
    assert(next.coverage.evaluated >= page.coverage.evaluated && next.coverage.returned >= page.coverage.returned,
      'refinement coverage cannot go backwards');
    assert(next.status === 'ended' || next.coverage.evaluated > page.coverage.evaluated || next.coverage.returned > page.coverage.returned,
      'continuation must make observable progress');
    pages.push(next);
    page = next;
  }
  assert.equal(page.status, 'ended');
  assert.equal(page.coverage.evaluated, page.coverage.cohort_total);
  const items = pages.flatMap(value => value.items);
  assert.equal(new Set(items.map(item => item.id)).size, items.length, 'refinement must not repeat items');
  assert(pages.every(value => value.detail_only_items.length === 0), 'small live fixture unexpectedly omitted item details');
  assert.equal(items.length, page.coverage.eligible, 'every eligible fixture item must remain reachable');
  let lastPrice = -1, missingPrice = false;
  for (const item of items) {
    assert.equal(item.visual_checked, false, 'technical feedback must not manufacture image inspection');
    assert.equal(item.assessment, null);
    assert.equal(item.evaluation.included, true);
    assert.notEqual(item.evaluation.eligibility, 'fail');
    if (!item.price) { missingPrice = true; continue; }
    assert.equal(item.price.currency, 'EUR');
    assert(!missingPrice && item.price.amount_minor >= lastPrice, 'price mode must be globally ascending, with missing prices last');
    lastPrice = item.price.amount_minor;
  }
  return { pages, items, final: page };
}

function checkRefreshPage(page, previousRunId, oldItems) {
  const comparison = page.refresh_comparison;
  assert(comparison && !comparison.unavailable, 'refresh comparison must be available while the previous run exists');
  assert.equal(comparison.previous_run_id, previousRunId);
  const previous = page.items.filter(item => oldItems.has(item.id)).map(item => item.id).sort();
  const newlyEncountered = page.items.filter(item => !oldItems.has(item.id)).map(item => item.id).sort();
  assert.deepEqual([...comparison.previously_seen_ids].sort(), previous);
  assert.deepEqual([...comparison.newly_encountered_ids].sort(), newlyEncountered);
  assert.equal(new Set([...comparison.previously_seen_ids, ...comparison.newly_encountered_ids]).size, page.items.length);
  for (const change of comparison.observed_changes) {
    const before = oldItems.get(change.item_id), current = page.items.find(item => item.id === change.item_id);
    assert(before && current, 'an observed change must refer to the same actually discovered item');
    assert.equal(change.market, current.market);
    assert.equal(change.previous_observed_at, before.observed_at);
    assert.equal(change.observed_at, current.observed_at);
    assert(change.changes.length > 0);
    for (const value of change.changes) {
      assert(observedFields.includes(value.field), 'refresh must name a supported observed field');
      if (Object.hasOwn(before, value.field)) assert.deepEqual(value.previous, before[value.field]);
      if (Object.hasOwn(current, value.field)) assert.deepEqual(value.current, current[value.field]);
    }
  }
  return { returned: page.items.length, previously_seen: previous.length, newly_encountered: newlyEncountered.length,
    actual_changed_items: comparison.observed_changes.length };
}

async function forgetOwned(runId, itemId) {
  assert(ownedRuns.has(runId), 'refusing to delete a run not created by this invocation');
  const deleted = (await call('forget_search', { run_id: runId })).structuredContent;
  assert.equal(deleted.run_id, runId);
  assert.equal(deleted.deleted, true);
  deletedRuns.add(runId);
  await checkpoint();
  await call('get_search_status', { run_id: runId }, 'search_forgotten');
  if (itemId) await call('get_item_history', { run_id: runId, item_id: itemId }, 'search_forgotten');
}

async function verify() {
  // Never log the connection object, private capability URL or transport error stack.
  const rawConnection = await readFile(path.resolve(root, process.env.SELLPY_CONNECTION_FILE ?? 'artifacts/private/connection.json'), 'utf8');
  try { connection = JSON.parse(rawConnection); }
  catch { throw new Error('The private connection file is not valid JSON.'); }
  assert(connection && typeof connection === 'object', 'the private connection file must contain an object');
  if (typeof connection.endpoint === 'string') secrets.add(connection.endpoint);
  if (typeof connection.token === 'string') secrets.add(connection.token);
  const endpoint = new URL(connection.endpoint);
  assert.equal(endpoint.protocol, 'https:', 'live verification requires HTTPS');
  for (const part of endpoint.pathname.split('/')) if (part.length > 24) secrets.add(part);
  report.endpoint = `${endpoint.origin}/mcp`;
  report.script_sha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
  client = new Client({ name: 'sellpy-upgrade-verification', version: '1.1.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  assert.equal(client.getServerVersion()?.name, 'sellpy-studio');
  assert.equal(client.getServerVersion()?.version, report.expected_version, 'wrong deployment version');
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  for (const name of newTools) assert(tools.includes(name), `missing upgrade tool: ${name}`);
  note('upgrade_tool_contract', { server: client.getServerVersion(), protocol: client.getNegotiatedProtocolVersion(), tools: newTools });

  defaultProfileDigest = digest((await call('get_preferences', { profile: 'default' })).structuredContent);
  defaultRead = true;
  assert.equal((await call('get_preferences', { profile: profileName })).structuredContent.profile, null,
    'the unique technical profile must be absent before writing');
  const preferences = { mode: 'balanced', currency: 'EUR', price_max: 60, include_reserved: true, unknown_policy: 'keep' };
  profileTouched = true;
  await checkpoint();
  const saved = (await call('set_preferences', { profile: profileName, preferences })).structuredContent.profile;
  assert.equal(saved.name, profileName);
  assert.deepEqual(saved.preferences, preferences);
  assert.deepEqual((await call('get_preferences', { profile: profileName })).structuredContent.profile, saved);
  note('named_profile_round_trip', { unique_profile: true, default_profile_written: false, persisted_fields: Object.keys(preferences) });

  const initial = (await call('search_items', { query: 'Kleid', market: 'AT', language: 'de', page_size: 12,
    filters: { price_max: 60, include_reserved: true } })).structuredContent;
  const runId = await own(initial, 'original');
  let discovery = initial;
  const observed = new Map(initial.items.map(item => [item.id, [item]]));
  for (let step = 0; observed.size < 6 && discovery.next_cursor && step < 3; step++) {
    discovery = (await call('continue_search', { cursor: discovery.next_cursor })).structuredContent;
    assert.equal(discovery.run_id, runId);
    for (const item of discovery.items) observed.set(item.id, [...(observed.get(item.id) ?? []), item]);
  }
  assert(observed.size >= 6, 'the bounded live fixture needs at least six real catalog candidates');
  const originalStatus = (await call('get_search_status', { run_id: runId })).structuredContent;
  assert.equal(originalStatus.plan.market, 'AT');
  assert.equal(originalStatus.coverage.visually_assessed_items, 0);
  const historyId = initial.items[0]?.id ?? observed.keys().next().value;
  const initialHistory = await collect(runId, 'get_item_history', 'observations', { item_id: historyId });
  assert(initialHistory.length > 0, 'the actual catalog observation must be available in history');
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = (await call('get_items', { run_id: runId, ids: [historyId], batch_size: 1 })).structuredContent;
    assert.equal(data.run_id, runId);
    assert(data.items.some(item => item.id === historyId), 'live canonical detail fixture was unavailable');
    for (const item of data.items) observed.set(item.id, [...(observed.get(item.id) ?? []), item]);
  }
  const history = await collect(runId, 'get_item_history', 'observations', { item_id: historyId });
  let priorTime = -Infinity;
  for (const snapshot of history) {
    const source = observed.get(historyId).find(item => item.observed_at === snapshot.observed_at);
    assert(source, 'history contains a timestamp never returned by an actual catalog/detail observation');
    assert.equal(snapshot.id, historyId);
    assert.equal(snapshot.market, source.market);
    assert(Date.parse(snapshot.observed_at) >= priorTime);
    priorTime = Date.parse(snapshot.observed_at);
    for (const field of observedFields) if (Object.hasOwn(source, field)) assert.deepEqual(snapshot[field], source[field]);
  }
  const neverObserved = `upgrade-unobserved-${randomUUID()}`;
  assert.equal((await collect(runId, 'get_item_history', 'observations', { item_id: neverObserved })).length, 0);
  note('history_uses_actual_observations', { catalog_snapshots: initialHistory.length, snapshots: history.length,
    canonical_reads: 2, unknown_item_snapshots: 0, manufactured_price_changes: false });

  const marketDefault = (await call('refine_search', { run_id: runId, use_profile: false, preferences: { mode: 'price_low' }, page_size: 2 })).structuredContent;
  assert.equal(marketDefault.preferences.currency, 'EUR', 'price refinement must inherit the market currency');
  const first = (await call('refine_search', { run_id: runId, profile: profileName, preferences: { mode: 'price_low' }, page_size: 2 })).structuredContent;
  assert.equal(first.preferences.mode, 'price_low', 'explicit preference fields must override the named profile');
  for (const [key, value] of Object.entries(preferences)) if (key !== 'mode') assert.deepEqual(first.preferences[key], value);
  assert(first.items.length >= 2 && first.next_cursor, 'live refinement needs a real continuation for its replay test');
  const second = (await call('refine_search', { run_id: runId, cursor: first.next_cursor })).structuredContent;
  assert(second.items.length > 0, 'a second real refinement page is required');
  const shortlistId = first.items[0].id, rejectId = second.items[0].id;
  await feedback(runId, shortlistId, 'shortlist');
  await feedback(runId, rejectId, 'shortlist');
  const shortlist = await collect(runId, 'list_item_feedback', 'items', { decision: 'shortlist' });
  assert.deepEqual(shortlist.map(entry => entry.item_id).sort(), [shortlistId, rejectId].sort());
  assert(shortlist.every(entry => entry.candidate.id === entry.item_id && !entry.candidate.visual_checked && entry.candidate.assessment === null));
  await feedback(runId, rejectId, 'reject');
  assert.deepEqual((await collect(runId, 'list_item_feedback', 'items', { decision: 'reject' })).map(entry => entry.item_id), [rejectId]);
  const replay = (await call('refine_search', { run_id: runId, cursor: first.next_cursor })).structuredContent;
  assert.deepEqual(replay, second, 'later feedback must not alter an already published refinement page');
  const baseline = await drainRefinement(first);
  assert(baseline.items.some(item => item.id === rejectId), 'the original refinement snapshot must retain its originally eligible candidate');
  const rejected = await drainRefinement((await call('refine_search', { run_id: runId, profile: profileName,
    preferences: { mode: 'price_low' }, page_size: 4 })).structuredContent);
  assert(!rejected.items.some(item => item.id === rejectId), 'a new refinement must apply the explicit rejection');
  assert.equal(rejected.final.coverage.excluded, baseline.final.coverage.excluded + 1);
  await feedback(runId, rejectId, 'neutral');
  assert.deepEqual((await collect(runId, 'list_item_feedback', 'items', { decision: 'neutral' })).map(entry => entry.item_id), [rejectId]);
  const neutral = await drainRefinement((await call('refine_search', { run_id: runId, profile: profileName,
    preferences: { mode: 'price_low' }, page_size: 4 })).structuredContent);
  assert(neutral.items.some(item => item.id === rejectId), 'neutral feedback must restore an otherwise eligible candidate');
  assert.deepEqual(neutral.items.map(item => item.id), baseline.items.map(item => item.id), 'shortlist must not disturb exact price ordering');
  const afterRanking = (await call('get_search_status', { run_id: runId })).structuredContent;
  assert.equal(afterRanking.coverage.pages_read, originalStatus.coverage.pages_read, 'refinement must use the discovered cohort');
  note('refinement_and_feedback', { candidates: baseline.items.length, currency: 'EUR', ascending_across_pages: true,
    named_profile_applied: true, explicit_override_applied: true, feedback_pagination: true,
    reject_excluded_in_new_refinement: true, neutral_restored: true, immutable_page_sha256: digest(second), visual_assessments_written: 0 });

  await feedback(runId, rejectId, 'reject');
  const gallery = await call('present_items', { run_id: runId, title: 'Disposable upgrade verification', page_size: 2,
    selection: [shortlistId, rejectId].map(item_id => ({ item_id, reason: 'Technical verification of stored feedback.', cautions: ['Not a style recommendation.'] })) });
  assert.deepEqual(gallery.structuredContent.cards.map(card => card.item_id), [shortlistId, rejectId]);
  assert.deepEqual(gallery.structuredContent.cards.map(card => card.feedback?.decision), ['shortlist', 'reject']);
  assert(gallery.structuredContent.cards.every(card => !card.visually_assessed && card.checked_image_ids.length === 0));
  assert.deepEqual(gallery._meta.gallery.cards.map(card => card.assessment), [null, null]);
  note('gallery_feedback_is_separate_from_evidence', { cards: 2, decisions: ['shortlist', 'reject'], visual_confirmations: 0 });

  const oldItems = await ledger(runId);
  const fresh = (await call('refresh_search', { run_id: runId })).structuredContent;
  const freshId = await own(fresh, 'refreshed');
  const freshStatus = (await call('get_search_status', { run_id: freshId })).structuredContent;
  assert.deepEqual(freshStatus.plan, { ...originalStatus.plan, refresh_of: runId }, 'refresh must retain the exact search criteria');
  const comparison = [checkRefreshPage(fresh, runId, oldItems)];
  assert(fresh.next_cursor, 'a live refresh continuation is required for the immutable comparison check');
  const freshNext = (await call('continue_search', { cursor: fresh.next_cursor })).structuredContent;
  assert.equal(freshNext.run_id, freshId);
  comparison.push(checkRefreshPage(freshNext, runId, oldItems));
  const inherited = await collect(freshId, 'list_item_feedback', 'items', { decision: 'all' });
  const refreshedIds = new Set([...fresh.items, ...freshNext.items].map(item => item.id));
  const expectedInherited = [[shortlistId, 'shortlist'], [rejectId, 'reject']].filter(([id]) => refreshedIds.has(id));
  assert.deepEqual(inherited.map(entry => [entry.item_id, entry.decision]).sort(), expectedInherited.sort());
  assert.deepEqual((await call('get_search_status', { run_id: runId })).structuredContent.plan, originalStatus.plan);
  note('refresh_retains_criteria_and_partitions_observed_ids', { pages: comparison, old_run_retained: true,
    inherited_decisions_examined: inherited.length, newly_encountered_is_not_newly_listed: true });

  await forgetOwned(runId, historyId);
  await call('refine_search', { run_id: runId, cursor: first.next_cursor }, 'search_forgotten');
  assert.equal((await call('forget_search', { run_id: runId })).structuredContent.deleted, true, 'own-run deletion must be idempotent');
  const refreshReplay = (await call('continue_search', { cursor: fresh.next_cursor })).structuredContent;
  assert.deepEqual(refreshReplay, freshNext, 'published refresh comparison must survive deletion of its prior run');
  assert.equal((await call('get_search_status', { run_id: freshId })).structuredContent.run_id, freshId, 'deleting the prior run must preserve its fresh successor');
  assert.deepEqual((await call('get_preferences', { profile: profileName })).structuredContent.profile, saved, 'run deletion must not alter preference profiles');
  note('owned_run_deletion_and_durable_tombstone', { deleted_owned_run: true, idempotent: true, history_and_refinement_blocked: true,
    other_owned_run_retained: true, profile_retained: true, refresh_replay_after_prior_deletion: true });
}

async function cleanup() {
  const failures = [];
  if (client) {
    for (const runId of ownedRuns.keys()) if (!deletedRuns.has(runId)) {
      try { await forgetOwned(runId); } catch (error) { failures.push(`Own-run cleanup: ${redact(error?.message ?? error)}`); }
    }
    if (profileTouched) {
      try {
        const cleared = (await call('set_preferences', { profile: profileName, preferences: {} })).structuredContent.profile;
        assert.equal(cleared.name, profileName);
        assert.deepEqual(cleared.preferences, {});
        assert.deepEqual((await call('get_preferences', { profile: profileName })).structuredContent.profile.preferences, {});
        report.cleanup.profile_cleared = true;
        await checkpoint();
      } catch (error) { failures.push(`Own-profile cleanup: ${redact(error?.message ?? error)}`); }
    }
    if (defaultRead) {
      try {
        assert.equal(digest((await call('get_preferences', { profile: 'default' })).structuredContent), defaultProfileDigest,
          'the default profile changed during verification; this harness never writes it');
        report.cleanup.default_profile_unchanged = true;
      } catch (error) { failures.push(`Default-profile check: ${redact(error?.message ?? error)}`); }
    }
    await client.close().catch(error => failures.push(`Client close: ${redact(error?.message ?? error)}`));
  }
  report.cleanup.created_runs = ownedRuns.size;
  report.cleanup.deleted_runs = deletedRuns.size;
  if (failures.length) { report.cleanup.failures = failures; throw new Error(failures.join(' | ')); }
}

if (process.argv.includes('--help')) {
  console.log('Run: node scripts/verify-upgrade.mjs\nUses SELLPY_CONNECTION_FILE (default artifacts/private/connection.json) and optional SELLPY_EXPECTED_VERSION.\nCreates only disposable search runs and a unique technical profile; clears them in finally.\nWrites a sanitized docs/upgrade-live-verification.json and a private fixture manifest for interruption recovery.');
} else {
  try {
    assert.equal(process.argv.length, 2, 'use --help for invocation instructions');
    await verify();
    report.outcome = 'passed';
  } catch (error) {
    report.outcome = 'failed';
    report.failure = redact(error?.message ?? error);
    emit({ outcome: 'failed', failure: report.failure });
    process.exitCode = 1;
  } finally {
    try { await cleanup(); }
    catch (error) { report.outcome = 'failed'; report.cleanup_failure = redact(error?.message ?? error); process.exitCode = 1; }
    report.exercised_new_tools = newTools.filter(name => exercisedTools.has(name));
    if (report.outcome === 'passed' && report.exercised_new_tools.length !== newTools.length) {
      report.outcome = 'failed'; report.failure = 'Not all eight upgrade tools completed successfully.'; process.exitCode = 1;
    }
    report.finished_at = new Date().toISOString();
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${redact(JSON.stringify(report, null, 2))}\n`);
    emit({ outcome: report.outcome, checks: report.checks.length, report: 'docs/upgrade-live-verification.json', cleanup: report.cleanup });
  }
}
