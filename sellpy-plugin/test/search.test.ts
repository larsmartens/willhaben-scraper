import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { test } from 'node:test';
import { ToolError, type ItemObservation, type ProviderPage, type ProviderPageRequest, type RequestContext, type SearchPlan, type SellpyProvider, type VisualAssessment } from '../src/domain.js';
import { SearchStore, encodeSearchCursor, parseSearchCursor, type Atomic, type SqlPort } from '../src/search-store.js';
import { reciprocalRankScore } from '../src/ranking.js';

const TIME = Date.parse('2026-11-06T21:00:00Z');
const RUN = 'test-run-0123456789';

function sqlInput(value: unknown): SQLInputValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('Unexpected SQL input');
}

function openStore(path = ':memory:', now = () => TIME) {
  const database = new DatabaseSync(path);
  const sql: SqlPort = {
    exec<T extends Record<string, string | number | ArrayBuffer | null>>(query: string, ...bindings: unknown[]) {
      const values = database.prepare(query).all(...bindings.map(sqlInput)).map(row => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? new Uint8Array(value).buffer : value])));
      return { toArray: () => values as T[] };
    },
  };
  const atomic: Atomic = operation => {
    database.exec('BEGIN IMMEDIATE');
    try { const value = operation(); database.exec('COMMIT'); return value; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  return { store: new SearchStore(sql, atomic, now), database, close: () => database.close() };
}

function plan(pageSize = 2, arms: SearchPlan['arms'] = [{ id: 'catalog', route: 'catalog', query: 'dress' }]): SearchPlan {
  return { market: 'AT', language: 'de', page_size: pageSize, intent: { query: 'dress' }, arms };
}

function item(id: string, overrides: Partial<ItemObservation> = {}): ItemObservation {
  return {
    id, market: 'AT', language: 'de', url: `https://www.sellpy.at/item/${id}`, title: `Dress ${id}`, brand: 'Example',
    price: { amount_minor: 2000, currency: 'EUR' }, original_price: null, size: 'M', size_system: null,
    condition: 'Gut', categories: ['Kleidung', 'Kleider'], colors: ['Grün'], materials: ['Baumwolle'],
    measurements: {}, description: null, defects: [], images: [{ id: `${id}-front`, index: 0, url: `https://prod.images.sellpy.net/fixture/${id}.jpg` }],
    availability: 'available', observed_at: new Date(TIME).toISOString(), source: 'catalog', attributes: {}, ...overrides,
  };
}

function page(items: ItemObservation[], nextOffset: number | null = null, options: Partial<ProviderPage> = {}): ProviderPage {
  return { items, next_offset: nextOffset, total: items.length, window: null,
    end_reason: nextOffset === null ? 'source_exhausted' : null, applied_filters: {}, warnings: [],
    observed_at: new Date(TIME).toISOString(), ...options };
}

function provider(search: (request: ProviderPageRequest, context: RequestContext) => Promise<ProviderPage>): SellpyProvider {
  return { search,
    async capabilities() { throw new Error('unused'); },
    async details() { throw new Error('unused'); },
    async facets() { throw new Error('unused'); },
  };
}

function context(now = TIME): RequestContext { return { deadline: now + 30_000, fetch: globalThis.fetch }; }
function assessment(id: string): VisualAssessment {
  return { item_id: id, checked_image_ids: [`${id}-front`], observed_type: 'dress', matching_features: ['floral pattern'], mismatches: [], uncertainties: [],
    requirement_results: [{ requirement: 'floral pattern', verdict: 'confirmed', evidence: `${id}-front` }],
    assessed_at: new Date(TIME).toISOString(), author: 'assistant' };
}

test('oversized source pages drain without loss and receipts survive a database reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sellpy-run-'));
  const path = join(directory, 'run.sqlite');
  let current = openStore(path);
  let calls = 0;
  const source = provider(async () => { calls++; return page(['a', 'b', 'c', 'd', 'e', 'f'].map(id => item(id))); });
  try {
    current.store.initialize(plan(), RUN);
    const first = await current.store.advance(0, source, context());
    assert.deepEqual(first.items.map(value => value.item.id), ['a', 'b']);
    assert.equal(first.coverage.unique_items, 6);
    assert.equal(first.coverage.returned_items, 2);
    assert.equal(first.status, 'ready');
    current.store.updateItems([item('a', { price: { amount_minor: 3100, currency: 'EUR' }, observed_at: new Date(TIME + 1).toISOString() })]);
    assert.equal(current.store.getCandidates(['a'])[0]!.item.price!.amount_minor, 3100);
    assert.deepEqual(await current.store.advance(0, source, context()), first);
    current.close();
    current = openStore(path);
    current.store.initialize(plan(), RUN);
    assert.deepEqual(await current.store.advance(0, source, context()), first);
    const second = await current.store.advance(parseSearchCursor(first.next_cursor!).step, source, context());
    const third = await current.store.advance(parseSearchCursor(second.next_cursor!).step, source, context());
    assert.deepEqual([...first.items, ...second.items, ...third.items].map(value => value.item.id), ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.equal(third.next_cursor, null);
    assert.equal(third.status, 'ended');
    assert.equal(third.coverage.returned_items, 6);
    assert.equal(calls, 1);
  } finally { current.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('fusion preserves independent retrieval paths and makes room for a category-relaxed candidate', async () => {
  const current = openStore();
  const searchPlan = plan(3, [
    { id: 'catalog', route: 'catalog', query: 'dress' },
    { id: 'style', route: 'semantic', query: 'romantic floral dress' },
    { id: 'relaxed', route: 'semantic', query: 'romantic floral puff sleeves', category_relaxed: true },
  ]);
  current.store.initialize(searchPlan, RUN);
  const source = provider(async request => {
    if (request.arm.id === 'catalog') return page([item('shared'), item('keyword')], null, { scores: { shared: 100000 } });
    if (request.arm.id === 'style') return page([item('shared'), item('semantic')], null, { scores: { shared: 0.001 } });
    return page([item('misclassified', { categories: ['Unterwäsche'] }), item('shared')]);
  });
  try {
    const result = await current.store.advance(0, source, context());
    assert.equal(result.coverage.unique_items, 4);
    assert.equal(result.coverage.pages_read, 3);
    assert(result.items.some(value => value.item.id === 'misclassified'));
    const shared = current.store.getCandidates(['shared'])[0]!;
    assert.equal(shared.paths.length, 3);
    assert.equal(shared.paths.find(path => path.arm_id === 'catalog')!.score, 100000);
    assert(shared.fusion_score < 1);
    assert(shared.fusion_score > current.store.getCandidates(['keyword'])[0]!.fusion_score);
    assert.deepEqual(current.store.getCandidates(['misclassified'])[0]!.item.categories, ['Unterwäsche']);
    assert.equal(current.store.getCandidates(['misclassified'])[0]!.assessment, null);
  } finally { current.close(); }
});

test('an empty filtered provider page can advance to a later matching item', async () => {
  const current = openStore();
  current.store.initialize(plan(1), RUN);
  const offsets: number[] = [];
  const source = provider(async request => {
    offsets.push(request.offset);
    return request.offset === 0 ? page([], 50) : page([item('late-match')]);
  });
  try {
    const result = await current.store.advance(0, source, context());
    assert.deepEqual(offsets, [0, 50]);
    assert.equal(result.items[0]!.item.id, 'late-match');
    assert.equal(result.coverage.pages_read, 2);
    assert.equal(result.status, 'ended');
  } finally { current.close(); }
});

test('a nonadvancing provider cursor is a recoverable source error, not exhaustion', async () => {
  const current = openStore();
  current.store.initialize(plan(1), RUN);
  let repaired = false;
  const source = provider(async () => repaired ? page([item('fixed')]) : page([item('discarded')], 0));
  try {
    const failed = await current.store.advance(0, source, context());
    assert.equal(failed.status, 'paused');
    assert.equal(failed.end_reason, 'source_error');
    assert.equal(failed.coverage.unique_items, 0);
    assert.equal(failed.coverage.arms[0]!.offset, 0);
    assert.equal(failed.coverage.arms[0]!.error!.code, 'provider_nonadvancing_page');
    repaired = true;
    const success = await current.store.advance(parseSearchCursor(failed.next_cursor!).step, source, context());
    assert.equal(success.items[0]!.item.id, 'fixed');
    assert.equal(success.status, 'ended');
    assert.deepEqual(await current.store.advance(0, source, context()), failed);
  } finally { current.close(); }
});

test('full Retry-After is persisted while each paused response gets a fresh continuation', async () => {
  let clock = TIME;
  const current = openStore(':memory:', () => clock);
  current.store.initialize(plan(1), RUN);
  let calls = 0;
  const source = provider(async () => {
    calls++;
    if (calls === 1) throw new ToolError('rate_limited', 'Wait for the provider cooldown.', { retryable: true, retry_at: new Date(TIME + 60_000).toISOString() });
    return page([item('after-cooldown')]);
  });
  try {
    const first = await current.store.advance(0, source, context(clock));
    assert.equal(first.end_reason, 'rate_limited');
    clock += 59_000;
    const paused = await current.store.advance(parseSearchCursor(first.next_cursor!).step, source, context(clock));
    assert.equal(calls, 1);
    assert.notEqual(first.next_cursor, paused.next_cursor);
    assert.equal(paused.coverage.arms[0]!.offset, 0);
    clock += 1_001;
    const result = await current.store.advance(parseSearchCursor(paused.next_cursor!).step, source, context(clock));
    assert.equal(calls, 2);
    assert.equal(result.items[0]!.item.id, 'after-cooldown');
    assert.deepEqual(await current.store.advance(0, source, context(clock)), first);
  } finally { current.close(); }
});

test('concurrent duplicate continuation does not duplicate the upstream request', async () => {
  const current = openStore();
  current.store.initialize(plan(1), RUN);
  let release!: (value: ProviderPage) => void;
  let calls = 0;
  const source = provider(async () => { calls++; return new Promise<ProviderPage>(resolve => { release = resolve; }); });
  try {
    const pending = current.store.advance(0, source, context());
    await assert.rejects(current.store.advance(0, source, context()), error => error instanceof ToolError && error.code === 'search_busy');
    assert.equal(calls, 1);
    release(page([item('one')]));
    const result = await pending;
    assert.deepEqual(await current.store.advance(0, source, context()), result);
    assert.equal(calls, 1);
  } finally { current.close(); }
});

test('a recovered lease excludes late responses from the abandoned generation', async () => {
  let clock = TIME;
  const current = openStore(':memory:', () => clock);
  current.store.initialize(plan(1), RUN);
  let release!: (value: ProviderPage) => void;
  let calls = 0;
  const source = provider(async () => {
    calls++;
    return calls === 1 ? new Promise<ProviderPage>(resolve => { release = resolve; }) : page([item('new-generation')]);
  });
  try {
    const old = current.store.advance(0, source, context(clock));
    const observedOld = old.then(() => null, error => error);
    clock += 46_000;
    const recovered = await current.store.advance(0, source, context(clock));
    release(page([item('late-old-generation')]));
    const error = await observedOld;
    assert(error instanceof ToolError && error.code === 'search_lease_lost');
    assert.equal(recovered.items[0]!.item.id, 'new-generation');
    assert.equal(current.store.getCandidates(['late-old-generation']).length, 0);
    assert.equal(current.store.coverage().unique_items, 1);
  } finally { current.close(); }
});

test('a failed arm remains visible when another arm reaches its source window', async () => {
  const current = openStore();
  current.store.initialize(plan(3, [{ id: 'finite', route: 'outfit', seed_ids: ['a'] }, { id: 'broken', route: 'semantic', query: 'dress' }]), RUN);
  const source = provider(async request => {
    if (request.arm.id === 'broken') throw new ToolError('unsupported_filter', 'This route does not support that filter.');
    return page([item('outfit')], null, { end_reason: 'upstream_window', window: 1 });
  });
  try {
    const result = await current.store.advance(0, source, context());
    assert.equal(result.items[0]!.item.id, 'outfit');
    assert.equal(result.status, 'paused');
    assert.equal(result.end_reason, 'source_error');
    assert.equal(result.coverage.arms.find(arm => arm.id === 'finite')!.status, 'window');
    assert.equal(result.coverage.arms.find(arm => arm.id === 'broken')!.status, 'failed');
    assert(result.next_cursor);
  } finally { current.close(); }
});

test('visual assessments require the exact delivered item images and become stale when facts change', async () => {
  const current = openStore();
  current.store.initialize(plan(1, []), RUN);
  current.store.updateItems([item('a'), item('b')]);
  try {
    assert.throws(() => current.store.recordAssessment(assessment('a')), error => error instanceof ToolError && error.code === 'visual_evidence_missing');
    assert.throws(() => current.store.markImagesDelivered('a', ['b-front']), error => error instanceof ToolError && error.code === 'image_identity_mismatch');
    current.store.markImagesDelivered('a', ['a-front']);
    current.store.recordAssessment(assessment('a'));
    assert.equal(current.store.coverage().visually_assessed_items, 1);
    current.store.updateItems([item('a', { price: { amount_minor: 9900, currency: 'EUR' }, observed_at: new Date(TIME + 1).toISOString() })]);
    assert.equal(current.store.coverage().visually_assessed_items, 0);
    assert.equal(current.store.getCandidates(['a'])[0]!.assessment, null);
  } finally { current.close(); }
});

test('reference bytes are chunked, immutable, and recover after reopening before search initialization', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sellpy-reference-'));
  const path = join(directory, 'reference.sqlite');
  let current = openStore(path);
  const bytes = Uint8Array.from({ length: 600_017 }, (_, index) => index % 251);
  try {
    await current.store.storeReference('file-one', bytes, 'image/jpeg', 'dress.jpg');
    await current.store.storeReference('file-one', bytes, 'image/jpeg', 'dress.jpg');
    assert.equal(current.database.prepare('SELECT COUNT(*) AS n FROM reference_chunks').get()!.n, 3);
    current.close();
    current = openStore(path);
    const reference = current.store.getReference('file-one');
    assert(reference);
    assert.deepEqual(reference.bytes, bytes);
    assert.equal(reference.file_name, 'dress.jpg');
    await assert.rejects(current.store.storeReference('file-one', new Uint8Array([1, 2]), 'image/jpeg', 'other.jpg'), error => error instanceof ToolError && error.code === 'reference_conflict');
    assert.equal(current.store.getReference('missing'), null);
  } finally { current.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('bookmarks and immutable presentation selections work without a search in the library actor', () => {
  const current = openStore();
  try {
    for (const runId of ['a', 'b', 'c']) current.store.saveBookmark({ run_id: runId, label: runId, note: '', saved_at: new Date(TIME).toISOString() });
    current.store.saveBookmark({ run_id: 'a', label: 'renamed', note: '', saved_at: new Date(TIME + 1).toISOString() });
    const first = current.store.listBookmarks(0, 2);
    assert.equal(first.items[0]!.label, 'renamed');
    assert.equal(first.next_offset, 2);
    assert.deepEqual(current.store.listBookmarks(first.next_offset!, 2).items.map(value => value.run_id), ['c']);
    const presentation = { title: 'Selection', selection: [{ item_id: 'a', reason: 'pattern' }], page_size: 6 };
    current.store.storePresentation('selection-one', presentation);
    current.store.storePresentation('selection-one', presentation);
    assert.deepEqual(current.store.getPresentation('selection-one'), presentation);
    assert.throws(() => current.store.storePresentation('selection-one', { ...presentation, title: 'changed' }), error => error instanceof ToolError && error.code === 'presentation_conflict');
  } finally { current.close(); }
});

test('future, malformed and cross-run cursors cannot skip the durable frontier', async () => {
  const current = openStore();
  current.store.initialize(plan(), RUN);
  const source = provider(async () => page([]));
  try {
    assert.deepEqual(parseSearchCursor(encodeSearchCursor(RUN, 3)), { v: 1, run_id: RUN, step: 3 });
    assert.throws(() => parseSearchCursor('not.a.cursor'), ToolError);
    assert.throws(() => parseSearchCursor(btoa(JSON.stringify({ v: 1, run_id: RUN, step: -1 })).replace(/=+$/, '')), ToolError);
    await assert.rejects(current.store.advance(10, source, context()), error => error instanceof ToolError && error.code === 'invalid_cursor');
    assert.throws(() => current.store.initialize(plan(), 'different-run'), error => error instanceof ToolError && error.code === 'search_conflict');
  } finally { current.close(); }
});

test('more than two hundred successive source pages remain reachable', async () => {
  const current = openStore();
  current.store.initialize(plan(1), RUN);
  let calls = 0;
  const source = provider(async request => {
    calls++;
    return page([item(`article-${request.offset}`)], request.offset < 204 ? request.offset + 1 : null);
  });
  try {
    let result = await current.store.advance(0, source, context());
    const ids = result.items.map(candidate => candidate.item.id);
    while (result.next_cursor) {
      result = await current.store.advance(parseSearchCursor(result.next_cursor).step, source, context());
      ids.push(...result.items.map(candidate => candidate.item.id));
    }
    assert.equal(ids.length, 205);
    assert.equal(new Set(ids).size, 205);
    assert.equal(calls, 205);
    assert.equal(result.coverage.pages_read, 205);
    assert.equal(result.coverage.returned_items, 205);
  } finally { current.close(); }
});

test('response byte budget preserves every unreturned observation for later pages', async () => {
  const current = openStore();
  current.store.initialize(plan(20), RUN);
  let calls = 0;
  const sourceItems = Array.from({ length: 20 }, (_, index) => item(`large-${index}`, { description: 'x'.repeat(150_000) }));
  const source = provider(async () => { calls++; return page(sourceItems); });
  try {
    let result = await current.store.advance(0, source, context());
    assert(result.items.length < 20);
    assert(result.warnings.some(value => value.includes('byte budget')));
    const ids = result.items.map(candidate => candidate.item.id);
    while (result.next_cursor) {
      result = await current.store.advance(parseSearchCursor(result.next_cursor).step, source, context());
      ids.push(...result.items.map(candidate => candidate.item.id));
    }
    assert.equal(new Set(ids).size, 20);
    assert.equal(calls, 1);
    assert.equal(current.store.getCandidates(['large-0'])[0]!.item.description!.length, 150_000);
  } finally { current.close(); }
});

test('the latest canonical observation wins, with details winning equal timestamps', () => {
  const current = openStore();
  current.store.initialize(plan(1, []), RUN);
  try {
    current.store.updateItems([item('a'), item('a', { source: 'detail', description: 'A complete description.' })]);
    assert.equal(current.store.getCandidates(['a'])[0]!.item.source, 'detail');
    current.store.updateItems([item('a', { observed_at: new Date(TIME - 1).toISOString(), price: { amount_minor: 1, currency: 'EUR' } })]);
    assert.equal(current.store.getCandidates(['a'])[0]!.item.price!.amount_minor, 2000);
    current.store.updateItems([item('a', { observed_at: new Date(TIME + 1).toISOString(), availability: 'sold' })]);
    assert.equal(current.store.getCandidates(['a'])[0]!.item.availability, 'sold');
  } finally { current.close(); }
});

test('reciprocal-rank fusion ignores score scales and repeated evidence within the same arm', () => {
  const paths = [
    { arm_id: 'a', route: 'catalog' as const, rank: 1, score: 100000, observed_at: '' },
    { arm_id: 'a', route: 'catalog' as const, rank: 10, score: 999999, observed_at: '' },
    { arm_id: 'b', route: 'semantic' as const, rank: 2, score: 0.001, observed_at: '' },
  ];
  assert.equal(reciprocalRankScore(paths, [{ id: 'a', route: 'catalog' }, { id: 'b', route: 'semantic' }]), 1 / 61 + 1 / 62);
});
