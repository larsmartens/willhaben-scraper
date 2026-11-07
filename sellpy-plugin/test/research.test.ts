import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { test } from 'node:test';
import { ToolError, type ItemObservation, type ProviderPage, type SearchPlan, type SellpyProvider, type VisualAssessment } from '../src/domain.js';
import { SearchStore, type Atomic, type SqlPort } from '../src/search-store.js';
import { ResearchStore, type RefinementPage } from '../src/research-store.js';
import { itemSnapshot, observationChanges } from '../src/observations.js';
import { inputSchemas } from '../src/schemas.js';

const TIME = Date.parse('2026-11-07T01:00:00.000Z');
const RUN = 'bf363ade-9ea3-4ce2-b78d-42aad6597cb0';

function openResearch(path = ':memory:', now = () => TIME) {
  const database = new DatabaseSync(path);
  const sql: SqlPort = {
    exec<T extends Record<string, string | number | ArrayBuffer | null>>(query: string, ...bindings: unknown[]) {
      const values: SQLInputValue[] = bindings.map(value => {
        if (value === null || typeof value === 'number' || typeof value === 'string') return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        throw new TypeError('Unexpected SQL binding');
      });
      const rows = database.prepare(query).all(...values).map(row => Object.fromEntries(Object.entries(row)
        .map(([key, value]) => [key, value instanceof Uint8Array ? new Uint8Array(value).buffer : value])));
      return { toArray: () => rows as T[] };
    },
  };
  const atomic: Atomic = operation => {
    database.exec('BEGIN IMMEDIATE');
    try { const value = operation(); database.exec('COMMIT'); return value; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  const search = new SearchStore(sql, atomic, now);
  const research = new ResearchStore(sql, atomic, search, now);
  return { database, search, research, atomic, close: () => database.close() };
}

function plan(arms: SearchPlan['arms'] = []): SearchPlan {
  return { market: 'AT', language: 'de', intent: { query: 'floral dresses' }, arms, page_size: 20 };
}

function item(id: string, patch: Partial<ItemObservation> = {}): ItemObservation {
  return { id, market: 'AT', language: 'de', url: `https://www.sellpy.at/item/${id}`, title: `Dress ${id}`, brand: 'Example',
    price: { amount_minor: 2000, currency: 'EUR' }, original_price: null, size: 'WMN-INT-M', size_system: 'WMN-INT',
    condition: 'Good', categories: ['Clothing', 'Dresses'], colors: ['Green'], materials: ['Cotton'], measurements: { waistInCm: 42 },
    description: null, defects: [], availability: 'available', observed_at: new Date(TIME).toISOString(), source: 'catalog',
    images: [{ id: `${id}-front`, index: 0, url: `https://prod.images.sellpy.net/${id}-front.jpg` },
      { id: `${id}-back`, index: 1, url: `https://prod.images.sellpy.net/${id}-back.jpg` },
      { id: `${id}-label`, index: 2, url: `https://prod.images.sellpy.net/${id}-label.jpg` }], attributes: {}, ...patch };
}

function assessment(id: string, verdict: 'confirmed' | 'contradicted' | 'unknown', imageId = `${id}-back`): VisualAssessment {
  return { item_id: id, checked_image_ids: [imageId], observed_type: 'dress', matching_features: [], mismatches: [], uncertainties: [],
    requirement_results: [{ requirement: 'long sleeves', verdict, evidence: 'The inspected original photo shows the sleeve construction.' }],
    assessed_at: new Date(TIME).toISOString(), author: 'assistant' };
}

function record(search: SearchStore, value: VisualAssessment): void {
  search.markImagesDelivered(value.item_id, value.checked_image_ids);
  search.recordAssessment(value);
}

function cursorPage(research: ResearchStore, cursor: string): RefinementPage {
  const parsed = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/'))) as {
    v: number; kind: string; run_id: string; refinement_id: string; step: number;
  };
  assert.equal(parsed.v, 1);
  assert.equal(parsed.kind, 'refinement');
  assert.equal(parsed.run_id, RUN);
  return research.advanceRefinement(parsed.refinement_id, parsed.step);
}

function drain(research: ResearchStore, id: string, initial?: RefinementPage) {
  const pages: RefinementPage[] = [];
  let page = initial ?? research.advanceRefinement(id, 0);
  while (true) {
    pages.push(page);
    assert.ok(pages.length < 2000, 'Refinement must make observable progress');
    if (!page.next_cursor) break;
    const next = cursorPage(research, page.next_cursor);
    assert.deepEqual(cursorPage(research, page.next_cursor), next, 'Published continuation is immutable');
    page = next;
  }
  return { pages, items: pages.flatMap(value => value.items), last: page };
}

test('refinement scans beyond 600 candidates, preserves its cohort and drains every eligible item exactly once', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    const original = Array.from({ length: 650 }, (_, index) => item(`dress-${String(index).padStart(4, '0')}`,
      { price: { amount_minor: 1000 + 650 - index, currency: 'EUR' } }));
    h.search.updateItems(original);
    const id = h.research.createRefinement(RUN, { mode: 'price_low', currency: 'EUR' }, 37);
    const first = h.research.advanceRefinement(id, 0);
    assert.equal(first.status, 'scanning');
    assert.equal(first.coverage.evaluated, 256);
    assert.equal(first.items.length, 0);
    h.search.updateItems([item('newly-discovered', { price: { amount_minor: 1, currency: 'EUR' } })]);
    assert.deepEqual(h.research.advanceRefinement(id, 0), first);
    const result = drain(h.research, id, first);
    const ids = result.items.map(value => value.candidate.item.id);
    assert.equal(ids.length, 650);
    assert.equal(new Set(ids).size, 650);
    assert.deepEqual(new Set(ids), new Set(original.map(value => value.id)));
    assert.equal(ids.includes('newly-discovered'), false);
    const prices = result.items.map(value => value.candidate.item.price!.amount_minor);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
    assert.equal(result.last.status, 'ended');
    assert.deepEqual(result.last.coverage, { cohort_total: 650, snapshot_max_sequence: 650,
      evaluated: 650, eligible: 650, excluded: 0, unknown: 0, returned: 650 });
    const fresh = h.research.createRefinement(RUN, { mode: 'price_low', currency: 'EUR' }, 200);
    const current = drain(h.research, fresh);
    assert.equal(current.items[0]?.candidate.item.id, 'newly-discovered');
    assert.equal(current.items.length, 651);
  } finally { h.close(); }
});

test('refinement snapshots explicit feedback while a new refinement applies later decisions', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    h.search.updateItems(Array.from({ length: 605 }, (_, index) => item(`item-${String(index).padStart(4, '0')}`)));
    h.research.setFeedback('item-0604', 'reject', 'Excluded before the snapshot');
    const id = h.research.createRefinement(RUN, { mode: 'relevance' }, 200);
    const first = h.research.advanceRefinement(id, 0);
    h.research.setFeedback('item-0604', 'neutral');
    h.research.setFeedback('item-0000', 'reject', 'Excluded after the snapshot');
    const original = drain(h.research, id, first);
    const ids = new Set(original.items.map(value => value.candidate.item.id));
    assert.equal(ids.size, 604);
    assert.equal(ids.has('item-0604'), false);
    assert.equal(ids.has('item-0000'), true);
    assert.deepEqual(h.research.advanceRefinement(id, 0), first);
    const fresh = drain(h.research, h.research.createRefinement(RUN, { mode: 'relevance' }, 200));
    const changed = new Set(fresh.items.map(value => value.candidate.item.id));
    assert.equal(changed.has('item-0604'), true);
    assert.equal(changed.has('item-0000'), false);
  } finally { h.close(); }
});

test('refinement preserves second-photo evidence and all image identities while separating fail from unknown', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    h.search.updateItems(['confirmed', 'contradicted', 'unknown'].map(id => item(id,
      id === 'confirmed' ? { categories: ['Underwear'] } : {})));
    record(h.search, assessment('confirmed', 'confirmed'));
    record(h.search, assessment('contradicted', 'contradicted'));
    const preferences = { requirements: [{ requirement: 'long sleeves', priority: 'require' as const }], mode: 'relevance' as const };
    const ranked = drain(h.research, h.research.createRefinement(RUN, preferences, 20));
    assert.deepEqual(ranked.items.map(value => value.candidate.item.id), ['confirmed', 'unknown']);
    assert.deepEqual(ranked.items.map(value => value.evaluation.eligibility), ['pass', 'unknown']);
    const confirmed = ranked.items[0]!;
    assert.equal(confirmed.candidate.item.images.length, 3);
    assert.deepEqual(confirmed.candidate.assessment?.checked_image_ids, ['confirmed-back']);
    assert.equal(confirmed.evaluation.evidence.find(value => value.criterion === 'long sleeves')?.source, 'visual_assessment');
    assert.equal(ranked.last.coverage.excluded, 1);
    assert.equal(ranked.last.excluded_examples[0]?.item_id, 'contradicted');
    const strict = drain(h.research, h.research.createRefinement(RUN, { ...preferences, unknown_policy: 'exclude' }, 20));
    assert.deepEqual(strict.items.map(value => value.candidate.item.id), ['confirmed']);
    assert.equal(strict.last.coverage.unknown, 1);
  } finally { h.close(); }
});

test('a changed canonical image invalidates new visual eligibility without rewriting a published page', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    h.search.updateItems([item('selected')]);
    record(h.search, assessment('selected', 'confirmed'));
    const preferences = { requirements: [{ requirement: 'long sleeves', priority: 'require' as const }], unknown_policy: 'exclude' as const };
    const id = h.research.createRefinement(RUN, preferences, 10);
    const original = h.research.advanceRefinement(id, 0);
    assert.equal(original.items.length, 1);
    h.search.updateItems([item('selected', { source: 'detail', observed_at: new Date(TIME + 1000).toISOString(),
      images: [{ id: 'replacement-front', index: 0, url: 'https://prod.images.sellpy.net/replacement-front.jpg' }] })]);
    assert.deepEqual(h.research.advanceRefinement(id, 0), original);
    const fresh = h.research.advanceRefinement(h.research.createRefinement(RUN, preferences, 10), 0);
    assert.equal(fresh.items.length, 0);
    assert.equal(fresh.coverage.unknown, 1);
    assert.equal(h.search.getCandidates(['selected'])[0]?.assessment, null);
  } finally { h.close(); }
});

test('bounded MMR pages retain all deferred candidates and do not change original discovery pages', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    h.search.updateItems(Array.from({ length: 321 }, (_, index) => item(`variant-${String(index).padStart(4, '0')}`,
      { brand: `Brand ${index % 7}`, colors: [`Color ${index % 9}`], materials: [`Material ${index % 3}`] })));
    const before = h.search.listCandidates(0, 200);
    const ranked = drain(h.research, h.research.createRefinement(RUN, { mode: 'diverse' }, 11));
    const ids = ranked.items.map(value => value.candidate.item.id);
    assert.equal(ids.length, 321);
    assert.equal(new Set(ids).size, 321);
    assert.ok(ranked.pages.some(page => page.warnings.some(warning => warning.includes('not image embeddings'))));
    assert.deepEqual(h.search.listCandidates(0, 200), before);
    assert.equal(h.search.coverage().returned_items, 0);
  } finally { h.close(); }
});

test('the response byte budget reduces a page without losing later candidates or photos', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    const items = Array.from({ length: 25 }, (_, index) => {
      const id = `many-photos-${String(index).padStart(2, '0')}`;
      return item(id, { images: Array.from({ length: 120 }, (_, photo) => ({ id: `${id}-${photo}`, index: photo,
        url: `https://prod.images.sellpy.net/${'a'.repeat(900)}/${id}-${photo}.jpg` })) });
    });
    h.search.updateItems(items);
    const result = drain(h.research, h.research.createRefinement(RUN, { mode: 'relevance' }, 20));
    assert.equal(result.items.length, 25);
    assert.equal(new Set(result.items.map(value => value.candidate.item.id)).size, 25);
    assert.ok(result.items.every(value => value.candidate.item.images.length === 120));
    assert.ok(result.pages.some(value => value.warnings.some(warning => warning.includes('byte budget'))));
    assert.ok(result.pages.every(value => value.items.length < 20));
  } finally { h.close(); }
});

test('an individually oversized schema-valid assessment cannot block later refinement candidates', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    h.search.updateItems([item('a-large-evidence'), item('b-normal')]);
    const requirements = Array.from({ length: 180 }, (_, index) => ({
      requirement: `${String(index).padStart(3, '0')} ${'feature '.repeat(225)}`, priority: 'require' as const,
    }));
    const assessmentInput = inputSchemas.record_visual_assessment.parse({ run_id: RUN, item_id: 'a-large-evidence',
      checked_image_ids: ['a-large-evidence-back'], observed_type: 'dress', matching_features: [], mismatches: [], uncertainties: [],
      requirement_results: requirements.map(value => ({ requirement: value.requirement, verdict: 'confirmed', evidence: 'detail '.repeat(257) })) });
    const refinementInput = inputSchemas.refine_search.parse({ run_id: RUN, preferences: { mode: 'relevance', requirements } });
    const requestBytes = (name: string, args: unknown) => new TextEncoder().encode(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args },
    })).byteLength;
    assert.ok(requestBytes('record_visual_assessment', assessmentInput) < 1024 * 1024, 'Assessment fits the public MCP request budget');
    assert.ok(requestBytes('refine_search', refinementInput) < 1024 * 1024, 'Preferences fit the public MCP request budget');
    const { run_id: _runId, ...visual } = assessmentInput;
    record(h.search, { ...visual, assessed_at: new Date(TIME).toISOString(), author: 'assistant' });
    const canonical = JSON.stringify(h.search.getCandidates(['a-large-evidence'])[0]?.assessment);
    const result = drain(h.research, h.research.createRefinement(RUN, refinementInput.preferences!, 20));
    assert.deepEqual(result.items.map(value => value.candidate.item.id).sort(), ['a-large-evidence', 'b-normal']);
    assert.equal(result.last.coverage.returned, 2);
    assert.ok(result.items.every(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1_250_000));
    assert.ok(result.pages.every(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1_250_000),
      'The complete receipt, including repeated preferences and excluded examples, stays within the response budget');
    const compacted = result.items.find(value => value.candidate.item.id === 'a-large-evidence')!;
    assert.equal(compacted.evaluation.eligibility, 'pass');
    assert.equal(compacted.evaluation.evidence.length, 0);
    assert.ok(compacted.response_omissions?.some(value => value.field === 'evaluation.evidence'
      && value.omitted_entries >= requirements.length && value.retained_in.length > 0), 'Omitted duplicate evidence is explicitly identified');
    assert.ok(JSON.stringify(compacted.candidate.assessment) === canonical, 'The full source assessment survives first-tier compaction');
    assert.deepEqual(compacted.candidate.item.images, item('a-large-evidence').images);
    assert.ok(JSON.stringify(h.search.getCandidates(['a-large-evidence'])[0]?.assessment) === canonical,
      'The complete canonical assessment remains retained after receipt compaction');
  } finally { h.close(); }
});

test('an individually oversized source item stays explicitly reachable without blocking ordinary candidates', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    const large = item('a-detail-only', { images: Array.from({ length: 1000 }, (_, index) => ({
      id: `original-${index}`, index, url: `https://prod.images.sellpy.net/${'a'.repeat(1500)}/${index}.jpg`,
    })) });
    h.search.updateItems([large, item('b-ordinary')]);
    const result = drain(h.research, h.research.createRefinement(RUN, { mode: 'relevance' }, 20));
    const details = result.pages.flatMap(value => value.detail_only_items);
    assert.deepEqual(details.map(value => value.item_id), ['a-detail-only']);
    assert.equal(details[0]?.eligibility, 'pass');
    assert.ok(details[0]!.reason.length > 0 && details[0]!.details_tool.includes('get_item_images'));
    const ids = [...result.items.map(value => value.candidate.item.id), ...details.map(value => value.item_id)];
    assert.deepEqual(ids.sort(), ['a-detail-only', 'b-ordinary']);
    assert.equal(result.last.coverage.returned, 2);
    assert.equal(result.last.status, 'ended');
    assert.ok(result.pages.every(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1_250_000));
    assert.deepEqual(h.search.getCandidates(['a-detail-only'])[0]?.item.images, large.images);
  } finally { h.close(); }
});

test('oversized echoed preferences and excluded evidence are explicitly omitted after full evaluation', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    h.search.updateItems([item('contradicted-large'), item('unknown-ordinary')]);
    const requirements = Array.from({ length: 250 }, (_, index) => ({
      requirement: `${String(index).padStart(3, '0')} ${'feature '.repeat(225)}`, priority: 'require' as const,
    }));
    const assessmentInput = inputSchemas.record_visual_assessment.parse({ run_id: RUN, item_id: 'contradicted-large',
      checked_image_ids: ['contradicted-large-back'], observed_type: 'dress', matching_features: [], mismatches: [], uncertainties: [],
      requirement_results: requirements.map((value, index) => ({ requirement: value.requirement,
        verdict: index === 0 ? 'contradicted' : 'confirmed', evidence: 'detail '.repeat(257) })) });
    const refinementInput = inputSchemas.refine_search.parse({ run_id: RUN, preferences: { mode: 'relevance', requirements } });
    assert.ok(new TextEncoder().encode(JSON.stringify(assessmentInput)).byteLength < 1024 * 1024);
    assert.ok(new TextEncoder().encode(JSON.stringify(refinementInput)).byteLength < 1024 * 1024);
    const { run_id: _runId, ...visual } = assessmentInput;
    record(h.search, { ...visual, assessed_at: new Date(TIME).toISOString(), author: 'assistant' });
    const result = drain(h.research, h.research.createRefinement(RUN, refinementInput.preferences!, 20));
    assert.deepEqual(result.items.map(value => value.candidate.item.id), ['unknown-ordinary']);
    assert.equal(result.items[0]?.evaluation.eligibility, 'unknown');
    assert.equal(result.last.coverage.excluded, 1);
    assert.equal(result.last.coverage.unknown, 1);
    assert.equal(result.last.preferences, null);
    assert.ok(result.last.response_omissions.some(value => value.field === 'preferences'));
    assert.ok(result.last.response_omissions.some(value => value.field === 'excluded_examples[0].evidence'));
    assert.equal(result.last.excluded_examples[0]?.eligibility, 'fail');
    assert.equal(result.last.excluded_examples[0]?.evidence.length, 0);
    assert.ok(result.pages.every(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1_250_000));
    assert.equal(h.search.getCandidates(['contradicted-large'])[0]?.assessment?.requirement_results.length, 250);
  } finally { h.close(); }
});

test('profiles persist through reopening, idempotent saves retain their timestamp and separate stores stay separate', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sellpy-preferences-'));
  const path = join(directory, 'owner.sqlite');
  let clock = TIME;
  let h = openResearch(path, () => clock);
  const other = openResearch();
  try {
    assert.equal(h.research.getProfile('default'), null);
    const preferences = { currency: 'EUR', price_max: 75, sizes: ['WMN-INT-M'], excluded_materials: ['Polyester'] };
    const first = h.research.setProfile('default', preferences);
    clock += 5000;
    assert.deepEqual(h.research.setProfile('default', preferences), first);
    h.close();
    h = openResearch(path, () => clock);
    assert.deepEqual(h.research.getProfile('default'), first);
    assert.equal(other.research.getProfile('default'), null);
    h.research.setProfile('default', {});
    assert.deepEqual(h.research.getProfile('default')?.preferences, {});
    assert.equal(other.research.getProfile('default'), null);
  } finally { h.close(); other.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('feedback pagination reaches every decision and neutral changes only the selected item', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    h.search.updateItems(Array.from({ length: 230 }, (_, index) => item(`choice-${index}`)));
    for (let index = 0; index < 230; index++) h.research.setFeedback(`choice-${index}`, 'shortlist');
    h.research.setFeedback('choice-100', 'neutral');
    const found: string[] = [];
    let after = 0;
    while (true) {
      const page = h.research.listFeedback('shortlist', after, 37);
      found.push(...page.items.map(value => value.item_id));
      if (page.next_after === null) break;
      assert.ok(page.next_after > after);
      after = page.next_after;
    }
    assert.equal(found.length, 229);
    assert.equal(new Set(found).size, 229);
    assert.equal(found.includes('choice-100'), false);
    assert.equal(h.research.getFeedback(['choice-100'])['choice-100']?.decision, 'neutral');
    assert.throws(() => h.research.setFeedback('not-loaded', 'shortlist'), (error: unknown) => error instanceof ToolError && error.code === 'item_not_found');
  } finally { h.close(); }
});

test('history records only actual accepted observations, coalesces unchanged values and ignores stale updates', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    const first = item('price-item');
    h.search.updateItems([first]);
    assert.equal(h.search.itemHistory(first.id, 0, 20).observations.length, 1);
    assert.deepEqual(h.search.updateItems([{ ...first, observed_at: new Date(TIME + 100).toISOString() }]), []);
    assert.equal(h.search.itemHistory(first.id, 0, 20).observations.length, 1);
    const canonical = { ...first, source: 'detail' as const, observed_at: new Date(TIME + 200).toISOString() };
    h.search.updateItems([canonical]);
    const priceDrop = { ...canonical, price: { amount_minor: 1400, currency: 'EUR' }, observed_at: new Date(TIME + 300).toISOString() };
    const changes = h.search.updateItems([priceDrop]);
    assert.deepEqual(changes, [{ item_id: first.id, market: 'AT', previous_observed_at: canonical.observed_at,
      observed_at: priceDrop.observed_at, changes: [{ field: 'price', previous: first.price, current: priceDrop.price }] }]);
    assert.deepEqual(h.search.updateItems([{ ...first, price: { amount_minor: 9900, currency: 'EUR' }, observed_at: new Date(TIME + 250).toISOString() }]), []);
    const prices: number[] = [];
    const times: string[] = [];
    let after = 0;
    while (true) {
      const page = h.search.itemHistory(first.id, after, 1);
      prices.push(...page.observations.map(value => value.price!.amount_minor));
      times.push(...page.observations.map(value => value.observed_at));
      if (page.next_after === null) break;
      after = page.next_after;
    }
    assert.deepEqual(prices, [2000, 2000, 1400]);
    assert.deepEqual(times, [first.observed_at, canonical.observed_at, priceDrop.observed_at]);
    assert.equal(h.search.getCandidates([first.id])[0]?.item.price?.amount_minor, 1400);
    assert.deepEqual(h.search.itemHistory('never-observed', 0, 20), { observations: [], next_after: null });
    assert.equal(observationChanges(itemSnapshot(first), itemSnapshot({ ...first, id: 'different' })), null);
    assert.equal(observationChanges(itemSnapshot(first), itemSnapshot({ ...first, market: 'DE' })), null);
    assert.equal(observationChanges(itemSnapshot(priceDrop), itemSnapshot(first)), null);
  } finally { h.close(); }
});

test('invalid empty-cohort refinement fails before persisting a job or advancing its state', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    assert.throws(() => h.research.createRefinement(RUN, { requirements: [
      { requirement: 'lace', priority: 'require' }, { requirement: ' LACE ', priority: 'avoid' },
    ] }, 20), (error: unknown) => error instanceof ToolError && error.code === 'contradictory_requirements');
    assert.equal(h.database.prepare('SELECT COUNT(*) AS count FROM refinement_jobs').get()?.count, 0);
    const valid = h.research.createRefinement(RUN, {}, 20);
    assert.throws(() => h.research.advanceRefinement(valid, 1), (error: unknown) => error instanceof ToolError && error.code === 'invalid_cursor');
    const empty = h.research.advanceRefinement(valid, 0);
    assert.equal(empty.status, 'ended');
    assert.equal(empty.next_cursor, null);
    assert.equal(empty.coverage.cohort_total, 0);
  } finally { h.close(); }
});

test('inherited feedback never overwrites a newer explicit decision and response notes are first-write immutable', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    h.search.updateItems([item('existing-choice'), item('inherited-choice')]);
    h.research.setFeedback('existing-choice', 'reject', 'Explicit decision in the current search');
    h.research.inheritFeedback([
      { item_id: 'existing-choice', decision: 'shortlist', updated_at: new Date(TIME - 1000).toISOString() },
      { item_id: 'inherited-choice', decision: 'shortlist', updated_at: new Date(TIME - 1000).toISOString() },
      { item_id: 'not-in-this-run', decision: 'shortlist', updated_at: new Date(TIME - 1000).toISOString() },
    ]);
    const feedback = h.research.getFeedback(['existing-choice', 'inherited-choice', 'not-in-this-run']);
    assert.equal(feedback['existing-choice']?.decision, 'reject');
    assert.equal(feedback['inherited-choice']?.decision, 'shortlist');
    assert.equal(feedback['not-in-this-run'], undefined);
    const original = { refresh_comparison: { previous_run_id: 'previous', newly_encountered_ids: ['inherited-choice'] } };
    assert.deepEqual(h.research.saveResponseNotes(1, original), original);
    assert.deepEqual(h.research.saveResponseNotes(1, { refresh_comparison: { unavailable: true } }), original);
    assert.deepEqual(h.research.responseNotes(1), original);
    assert.equal(h.research.responseNotes(2), null);
  } finally { h.close(); }
});

test('the first refresh after upgrading a legacy run preserves its already observed baseline price', () => {
  const h = openResearch();
  try {
    h.search.initialize(plan(), RUN);
    const baseline = item('legacy-price');
    h.search.updateItems([baseline]);
    h.database.exec('DELETE FROM item_observations');
    const current = { ...baseline, price: { amount_minor: 1400, currency: 'EUR' },
      observed_at: new Date(TIME + 1000).toISOString(), source: 'detail' as const };
    const changes = h.search.updateItems([current]);
    assert.equal(changes[0]?.changes[0]?.field, 'price');
    const history = h.search.itemHistory(baseline.id, 0, 20).observations;
    assert.deepEqual(history.map(value => value.price?.amount_minor), [2000, 1400]);
    assert.deepEqual(history.map(value => value.observed_at), [baseline.observed_at, current.observed_at]);
  } finally { h.close(); }
});

test('deletion blocks a late provider result and pending reference write from resurrecting private data', async () => {
  const h = openResearch();
  try {
    const searchPlan = plan([{ id: 'native', route: 'catalog', query: 'dress' }]);
    h.search.initialize(searchPlan, RUN);
    h.search.updateItems([item('before-delete')]);
    h.research.setFeedback('before-delete', 'shortlist');
    h.research.createRefinement(RUN, {}, 20);
    await h.search.storeReference('already-retained', new Uint8Array([1, 2, 3]), 'image/jpeg', 'reference.jpg');
    let release!: (page: ProviderPage) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<ProviderPage>(resolve => { release = resolve; });
    const provider: SellpyProvider = {
      async search() { entered(); return pending; },
      async details() { throw new Error('Unused'); },
      async facets() { throw new Error('Unused'); },
      async capabilities() { throw new Error('Unused'); },
    };
    const advance = h.search.advance(0, provider, { deadline: TIME + 30000, fetch });
    await started;
    const writing = h.search.storeReference('in-flight-reference', new Uint8Array(600000), 'image/jpeg', 'pending.jpg');
    h.atomic(() => { h.research.erase(); h.search.erase(); });
    release({ items: [item('late-result')], next_offset: null, total: 1, window: null, end_reason: 'source_exhausted',
      applied_filters: {}, warnings: [], observed_at: new Date(TIME).toISOString() });
    await assert.rejects(advance, (error: unknown) => error instanceof ToolError && error.code === 'search_forgotten');
    await assert.rejects(writing, (error: unknown) => error instanceof ToolError && error.code === 'search_forgotten');
    for (const table of ['candidates', 'operations', 'reference_files', 'reference_chunks', 'research_feedback', 'refinement_jobs', 'item_observations']) {
      assert.equal(h.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0, table);
    }
    assert.equal(h.search.isForgotten(), true);
    assert.throws(() => h.search.initialize(searchPlan, RUN), (error: unknown) => error instanceof ToolError && error.code === 'search_forgotten');
    assert.throws(() => h.search.updateItems([item('resurrection')]), (error: unknown) => error instanceof ToolError && error.code === 'search_forgotten');
  } finally { h.close(); }
});
