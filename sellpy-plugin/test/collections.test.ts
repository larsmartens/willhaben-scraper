import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { test } from 'node:test';
import { CollectionStore, type StoredCollectionPage } from '../src/collection-store.js';
import { SearchStore, type Atomic, type SqlPort } from '../src/search-store.js';
import { ResearchStore } from '../src/research-store.js';
import type { ItemObservation, SearchPlan, SellpyProvider, VisualAssessment } from '../src/domain.js';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const RUN = 'b4271829-a08e-4c9a-9496-3e1718e8c740';
function item(id: string, extra: Partial<ItemObservation> = {}): ItemObservation {
  return { id, market: 'AT', language: 'de', title: `Kleid ${id}`, url: `https://www.sellpy.at/item/${id}`, brand: 'Example',
    price: { amount_minor: 2500, currency: 'EUR' }, original_price: null, size: 'M', size_system: null, condition: 'Gut',
    categories: ['Kleider'], colors: ['Grün'], materials: ['Cotton'], measurements: {}, defects: [], attributes: {},
    images: [{ id: `${id}-front`, index: 0, url: `https://prod.images.sellpy.net/${id}.jpg` }], description: null,
    availability: 'available', source: 'catalog', observed_at: new Date(NOW).toISOString(), ...extra };
}
function fixture() {
  const db = new DatabaseSync(':memory:');
  const queries: { query: string; rows: number }[] = [];
  const sql: SqlPort = { exec<T extends Record<string, string | number | ArrayBuffer | null>>(query: string, ...bindings: unknown[]) {
    const values = bindings.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value) as SQLInputValue[];
    const rows = db.prepare(query).all(...values).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? value.buffer : value])));
    queries.push({ query, rows: rows.length }); return { toArray: () => rows as T[] };
  } };
  const atomic: Atomic = operation => { db.exec('BEGIN IMMEDIATE'); try { const result = operation(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const store = new SearchStore(sql, atomic, () => NOW), research = new ResearchStore(sql, atomic, store, () => NOW);
  const collections = new CollectionStore(sql, atomic, store, research, () => NOW);
  const plan: SearchPlan = { market: 'AT', language: 'de', page_size: 200, intent: { query: 'Kleid' }, arms: [{ id: 'catalog', route: 'catalog', query: 'Kleid', filters: { price_max: 60 } }] };
  store.initialize(plan, RUN);
  return { db, sql, atomic, store, research, collections, plan, queries, close: () => db.close() };
}
async function ingest(f: ReturnType<typeof fixture>, count: number) {
  let calls = 0;
  const source: SellpyProvider = {
    async search(request) {
      calls++; const end = Math.min(count, request.offset + 100);
      return { items: Array.from({ length: end - request.offset }, (_, n) => item(`item-${String(request.offset + n).padStart(5, '0')}`)),
        next_offset: end < count ? end : null, total: count, window: null, end_reason: end < count ? null : 'source_exhausted', applied_filters: request.arm.filters ?? {}, warnings: [], observed_at: new Date(NOW).toISOString() };
    },
    async capabilities() { throw new Error('unused'); }, async details() { throw new Error('collection must not fetch details'); }, async facets() { throw new Error('unused'); },
  };
  let step = 0;
  for (;;) { const page = await f.store.advance(step++, source, { fetch, deadline: NOW + 30000 }); if (!page.next_cursor) break; }
  return calls;
}
function ready(f: ReturnType<typeof fixture>, first: StoredCollectionPage): StoredCollectionPage {
  let page = first, work = 0;
  while (page.collection.status === 'preparing') { assert(++work < 1000); page = f.collections.page(page.collection.id, { cursor: page.page.next_cursor! }); }
  return page;
}
function collect(f: ReturnType<typeof fixture>, first: StoredCollectionPage): string[] {
  let page = ready(f, first); const ids = page.selection.map(value => value.item_id);
  while (page.page.next_cursor) { page = f.collections.page(page.collection.id, { cursor: page.page.next_cursor, page_size: 24 }); ids.push(...page.selection.map(value => value.item_id)); }
  return ids;
}

test('10,001 genuine provider observations remain reachable through indexed12/24 pages and a reconstructed owner', async () => {
  const f = fixture();
  try {
    assert.equal(await ingest(f, 10001), 101);
    const first = f.collections.open({ request_id: 'initial' });
    assert.equal(first.candidates.length, 12); assert.equal(first.collection.total, 10001);
    assert.equal(first.scope.search_pages, 101); assert.equal(first.scope.arms[0]!.candidates, 10001);
    assert.equal(first.scope.arms[0]!.native_total, 10001);
    assert.equal(first.scope.recorded_assessments, 0);
    f.store.updateItems([item('later')]);
    const replacement = new CollectionStore(f.sql, f.atomic, new SearchStore(f.sql, f.atomic, () => NOW), new ResearchStore(f.sql, f.atomic, f.store, () => NOW), () => NOW);
    f.queries.length = 0;
    const second = replacement.page(first.collection.id, { cursor: first.page.next_cursor!, page_size: 24 });
    assert.equal(second.page.start, 13); assert.equal(second.page.end, 36);
    assert(second.page.previous_cursor);
    const previous = replacement.page(first.collection.id, { cursor: second.page.previous_cursor!, page_size: 12 });
    assert.deepEqual(previous.selection, first.selection);
    assert(f.queries.every(value => !/\bOFFSET\b|COUNT\(\*\).*candidates/i.test(value.query)));
    assert(Math.max(...f.queries.map(value => value.rows)) <= 25);
    assert(JSON.stringify(second).length < 100000);
    const ids = collect(f, first);
    assert.equal(ids.length, 10001); assert.equal(new Set(ids).size, 10001); assert(!ids.includes('later'));
    assert.equal(f.collections.open({}).collection.total, 10002);
    assert.equal(f.collections.open({ request_id: 'initial' }).collection.id, first.collection.id);
    const plans = f.db.prepare('EXPLAIN QUERY PLAN SELECT sequence,item_id FROM candidates WHERE sequence>? AND sequence<=? ORDER BY sequence LIMIT ?').all(9000, 10001, 25);
    assert(plans.some(row => String(row.detail).includes('INTEGER PRIMARY KEY')));
  } finally { f.close(); }
});

test('arm collections freeze first membership, including a later path for an already known candidate', async () => {
  const f = fixture();
  try {
    await ingest(f, 10);
    const first = f.collections.open({ source: { kind: 'arm', arm_id: 'catalog' } });
    f.store.updateItems([item('old-other-arm')]);
    f.sql.exec('INSERT INTO arm_memberships(arm_id,item_id,observed_at) VALUES(?,?,?)', 'catalog', 'old-other-arm', new Date(NOW + 1).toISOString());
    assert.equal(collect(f, first).length, 10);
    const updated = f.collections.open({ source: { kind: 'arm', arm_id: 'catalog' } });
    assert.equal(collect(f, updated).at(-1), 'old-other-arm');
    assert.throws(() => f.collections.open({ source: { kind: 'arm', arm_id: 'foreign' } }), /arm/);
  } finally { f.close(); }
});

test('shortlist snapshots feedback across concurrent changes and resumable sorting keeps fixed values', async () => {
  const f = fixture();
  try {
    await ingest(f, 401);
    f.research.setFeedback('item-00010', 'shortlist'); f.research.setFeedback('item-00399', 'shortlist');
    const first = f.collections.open({ source: { kind: 'shortlist' } });
    assert.equal(first.collection.status, 'preparing');
    f.research.setFeedback('item-00399', 'reject'); f.research.setFeedback('item-00398', 'shortlist');
    assert.deepEqual(collect(f, first), ['item-00010', 'item-00399']);
    const latest = f.collections.open({ source: { kind: 'shortlist' } });
    assert.deepEqual(collect(f, latest), ['item-00010', 'item-00398']);
    const base = f.collections.open({});
    f.store.updateItems([item('item-00000', { price: { amount_minor: 9000, currency: 'EUR' }, observed_at: new Date(NOW + 1).toISOString() })]);
    const sorted = ready(f, f.collections.derive(base.collection.id, { kind: 'price_desc' }));
    assert.equal(sorted.selection[0]!.item_id, 'item-00000');
    f.store.updateItems([item('item-00000', { price: { amount_minor: 1, currency: 'EUR' }, observed_at: new Date(NOW + 2).toISOString() })]);
    const revisit = f.collections.page(sorted.collection.id);
    assert.equal(revisit.selection[0]!.item_id, 'item-00000'); assert.equal(revisit.candidates[0]!.item.price!.amount_minor, 1);
    assert.equal(f.collections.derive(sorted.collection.id, { kind: 'source_order' }).collection.id, base.collection.id);
    assert(sorted.collection.evaluation?.completed_at);
  } finally { f.close(); }
});

test('refinement browsing prepares the same canonical suffix without consuming model steps or changing receipts', async () => {
  const f = fixture();
  try {
    await ingest(f, 319);
    const id = f.research.createRefinement(RUN, { mode: 'diverse', diversity: 0.4 }, 7);
    const first = f.research.advanceRefinement(id, 0);
    const receipt = f.db.prepare('SELECT response_json FROM refinement_receipts WHERE refinement_id=? AND step=0').get(id)!.response_json;
    const initialStep = f.db.prepare('SELECT next_step FROM refinement_jobs WHERE id=?').get(id)!.next_step;
    const collection = ready(f, f.collections.open({ source: { kind: 'refinement', refinement_id: id } }));
    const all = collect(f, collection);
    assert.equal(all.length, 319); assert.equal(new Set(all).size, 319);
    assert.equal(f.db.prepare('SELECT next_step FROM refinement_jobs WHERE id=?').get(id)!.next_step, initialStep);
    assert.equal(f.db.prepare('SELECT response_json FROM refinement_receipts WHERE refinement_id=? AND step=0').get(id)!.response_json, receipt);
    assert.deepEqual(f.research.advanceRefinement(id, 0), first);
    const modelIds: string[] = [...first.items.map(entry => entry.candidate.item.id), ...first.detail_only_items.map(entry => entry.item_id)];
    let page = first, step = 1;
    while (page.next_cursor) { page = f.research.advanceRefinement(id, step++); modelIds.push(...page.items.map(entry => entry.candidate.item.id), ...page.detail_only_items.map(entry => entry.item_id)); }
    assert.deepEqual(modelIds, all);
  } finally { f.close(); }
});

test('large legacy selections convert in bounded UTF-8 chunks and retain old offsets, page sizes and reasons', async () => {
  const f = fixture();
  try {
    await ingest(f, 1001);
    const selection = Array.from({ length: 1001 }, (_, index) => ({ item_id: `item-${String(index).padStart(5, '0')}`, reason: `Größe 🧵 ${index}`, cautions: ['Material laut Shop'] }));
    f.store.storePresentation('old', { title: 'Gespeicherte 🧵 Auswahl', selection, page_size: 6 });
    f.queries.length = 0;
    let page = f.collections.legacy('old', 900), calls = 1;
    assert.equal(page.collection.status, 'preparing');
    while (page.collection.status === 'preparing') { page = f.collections.page(page.collection.id, { cursor: page.page.next_cursor!, page_size: 6 }); calls++; assert(calls < 20); }
    assert(calls > 1); assert.equal(page.title, 'Gespeicherte 🧵 Auswahl'); assert.equal(page.page.size, 6);
    assert.deepEqual(page.selection, selection.slice(900, 906));
    assert(f.queries.every(value => !/SELECT value_json FROM presentations|\bOFFSET\b/.test(value.query)));
    assert.equal(f.collections.legacy('old', 900).collection.id, page.collection.id);
  } finally { f.close(); }
});

test('model and widget deliveries remain separate from recorded assessments and are idempotent by identity', async () => {
  const f = fixture();
  try {
    await ingest(f, 2);
    f.store.markWidgetImagesDelivered('item-00000', ['item-00000-front']);
    const assessment: VisualAssessment = { item_id: 'item-00000', checked_image_ids: ['item-00000-front'], observed_type: 'dress', matching_features: [], mismatches: [], uncertainties: [], requirement_results: [], assessed_at: new Date(NOW).toISOString(), author: 'assistant' };
    assert.throws(() => f.store.recordAssessment(assessment), /model-visible/);
    f.store.markImagesDelivered('item-00000', ['item-00000-front']); f.store.markImagesDelivered('item-00000', ['item-00000-front']);
    f.store.markModelItemsDelivered([{ item_id: 'item-00000', description: false }]);
    f.store.markModelItemsDelivered([{ item_id: 'item-00000', description: true }]);
    let scope = f.collections.open({}).scope;
    assert.equal(scope.model_delivered_photos, 1); assert.equal(scope.widget_delivered_photos, 1); assert.equal(scope.recorded_assessments, 0);
    assert.equal(scope.model_delivered_fact_items, 1); assert.equal(scope.model_delivered_description_items, 1);
    f.store.recordAssessment(assessment); scope = f.collections.open({}).scope; assert.equal(scope.recorded_assessments, 1);
  } finally { f.close(); }
});


test('oversized stored evidence and descriptions stay intact while each gallery page stays bounded', async () => {
  const f = fixture();
  try {
    await ingest(f, 24);
    const large = 'Observed source detail '.repeat(50000);
    for (let index = 0; index < 24; index++) {
      const id = `item-${String(index).padStart(5, '0')}`;
      f.store.updateItems([item(id, { description: large, source: 'detail', observed_at: new Date(NOW + 1).toISOString() })]);
      f.store.markImagesDelivered(id, [`${id}-front`]);
      f.store.recordAssessment({ item_id: id, checked_image_ids: [`${id}-front`], observed_type: 'dress',
        matching_features: Array.from({ length: 80 }, () => 'Visible original-photo feature '.repeat(120)), mismatches: [], uncertainties: [], requirement_results: [], author: 'assistant', assessed_at: new Date(NOW + 2).toISOString() });
    }
    const page = f.collections.open({ page_size: 24 });
    assert.equal(page.candidates.length, 24); assert(JSON.stringify(page).length < 100000);
    assert.equal(page.candidates[0]!.presentation_summary?.assessment_recorded, true);
    assert.equal(page.scope.recorded_assessments, 24);
    const details = f.collections.detail(page.collection.id, 'item-00000');
    assert.equal(details.candidate.item.description, large);
    assert.equal(details.candidate.assessment?.matching_features.length, 80);
  } finally { f.close(); }
});


test('legacy arm membership scope remains unknown until the bounded import is complete', async () => {
  const f = fixture();
  try {
    await ingest(f, 300);
    f.db.exec('UPDATE search_metrics SET legacy=1; DELETE FROM arm_memberships; DELETE FROM arm_scope;');
    let page = f.collections.open({ source: { kind: 'arm', arm_id: 'catalog' } });
    assert.equal(page.collection.status, 'preparing'); assert.equal(page.scope.arms[0]!.candidates, null);
    page = ready(f, page); assert.equal(page.scope.arms[0]!.candidates, 300); assert.equal(collect(f, page).length, 300);
  } finally { f.close(); }
});

test('derived preparation reads scalar properties even when the entire cohort has giant descriptions', async () => {
  const f = fixture();
  try {
    await ingest(f, 260);
    const large = 'Complete source description '.repeat(20000);
    f.store.updateItems(Array.from({ length: 260 }, (_, index) => item(`item-${String(index).padStart(5, '0')}`, { description: large, source: 'detail', observed_at: new Date(NOW + 1).toISOString() })));
    const base = f.collections.open({}); f.queries.length = 0;
    const derived = f.collections.derive(base.collection.id, { kind: 'price_asc' });
    assert.equal(derived.collection.status, 'preparing');
    assert(!f.queries.some(value => /SELECT \* FROM candidates|SELECT .*item_json.* FROM candidates/.test(value.query) && !value.query.includes('json_extract')));
    assert(Math.max(...f.queries.map(value => value.rows)) <= 128);
    assert.equal(collect(f, derived).length, 260);
  } finally { f.close(); }
});


test('opaque collection cursors reject forged ranks and survive owner reconstruction', async () => {
  const f = fixture();
  try {
    await ingest(f, 30); const first = f.collections.open({});
    const value = JSON.parse(atob(first.page.next_cursor!.replaceAll('-', '+').replaceAll('_', '/'))) as Record<string, unknown>;
    value.rank = 10000;
    const forged = btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    assert.throws(() => f.collections.page(first.collection.id, { cursor: forged }), /cursor/);
    const reopened = new CollectionStore(f.sql, f.atomic, f.store, f.research, () => NOW);
    assert.equal(reopened.page(first.collection.id, { cursor: first.page.next_cursor! }).page.start, 13);
  } finally { f.close(); }
});
