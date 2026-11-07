import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ToolError, type Candidate, type ItemFeedback, type ItemObservation, type VisualAssessment } from '../src/domain.js';
import { evaluateCandidate, metadataSimilarity, observedMeasurements, rankCandidates, validateRankingPreferences, type RankingPreferences } from '../src/refinement.js';

const TIME = '2026-11-06T23:00:00.000Z';

function candidate(id: string, overrides: Partial<ItemObservation> = {}, fusion = 1 / 61): Candidate {
  return { item: { id, market: 'AT', language: 'de', url: `https://www.sellpy.at/item/${id}`, title: `Dress ${id}`, brand: 'Example',
    price: { amount_minor: 2000, currency: 'EUR' }, original_price: null, size: 'WMN-INT-M', size_system: 'INT',
    condition: 'Gut', categories: ['Damen > Kleidung > Kleider'], colors: ['Grün'], materials: ['Baumwolle'], measurements: {},
    description: null, defects: [], images: [{ id: `${id}-front`, index: 0, url: `https://prod.images.sellpy.net/fixture/${id}.jpg` }],
    availability: 'available', observed_at: TIME, source: 'catalog', attributes: {}, ...overrides },
  paths: [{ arm_id: 'catalog', route: 'catalog', rank: 1, observed_at: TIME }], fusion_score: fusion, assessment: null };
}

function assess(value: Candidate, results: VisualAssessment['requirement_results']): Candidate {
  return { ...value, assessment: { item_id: value.item.id, checked_image_ids: [`${value.item.id}-front`], observed_type: 'dress',
    matching_features: ['floral pattern'], mismatches: [], uncertainties: [], requirement_results: results, assessed_at: TIME, author: 'assistant' } };
}

function feedback(id: string, decision: ItemFeedback['decision']): ItemFeedback {
  return { item_id: id, decision, updated_at: TIME };
}

test('a visually contradicted hard requirement cannot win through higher reciprocal-rank fusion', () => {
  const wrong = assess(candidate('wrong', {}, 0.9), [{ requirement: 'long sleeves', verdict: 'contradicted', evidence: 'Both visible sleeves end above the elbow.' }]);
  const right = assess(candidate('right', {}, 0.001), [{ requirement: 'long sleeves', verdict: 'confirmed', evidence: 'Sleeves reach the wrist on the front photo.' }]);
  const preferences: RankingPreferences = { requirements: [{ requirement: 'long sleeves', priority: 'require' }] };
  const result = rankCandidates([wrong, right], preferences);
  assert.deepEqual(result.items.map(entry => entry.candidate.item.id), ['right']);
  assert.equal(result.excluded[0]!.eligibility, 'fail');
  assert.equal(result.excluded[0]!.evidence.find(entry => entry.criterion === 'long sleeves')!.source, 'visual_assessment');
});

test('source labels cannot masquerade as visual requirement evidence and unknown is retained by default', () => {
  const item = candidate('unseen', { title: 'Long sleeves floral dress', attributes: { sleeveLength: 'Long sleeve' } });
  const preferences: RankingPreferences = { requirements: [{ requirement: 'long sleeves', priority: 'require' }] };
  const result = evaluateCandidate(item, preferences);
  assert.equal(result.eligibility, 'unknown');
  assert.equal(result.included, true);
  assert.equal(result.evidence.find(entry => entry.criterion === 'long sleeves')!.source, 'none');
  assert.equal(evaluateCandidate(item, { ...preferences, unknown_policy: 'exclude' }).included, false);
});

test('avoid requirements invert only exact recorded facts and do not conflate negated text', () => {
  const transparent = assess(candidate('transparent'), [{ requirement: 'transparent', verdict: 'confirmed', evidence: 'The hanger is visible through the fabric.' }]);
  const opaque = assess(candidate('opaque'), [{ requirement: 'transparent', verdict: 'contradicted', evidence: 'The layered fabric hides the backing.' }]);
  const negated = assess(candidate('negated'), [{ requirement: 'not transparent', verdict: 'confirmed', evidence: 'Lining covers the skirt.' }]);
  const preferences: RankingPreferences = { requirements: [{ requirement: 'transparent', priority: 'avoid' }] };
  assert.equal(evaluateCandidate(transparent, preferences).eligibility, 'fail');
  assert.equal(evaluateCandidate(opaque, preferences).eligibility, 'pass');
  assert.equal(evaluateCandidate(negated, preferences).eligibility, 'unknown');
});

test('conflicting or stale photo evidence stays unknown', () => {
  const item = assess(candidate('conflict'), [
    { requirement: 'long sleeves', verdict: 'confirmed', evidence: 'First view.' },
    { requirement: 'long sleeves', verdict: 'contradicted', evidence: 'Conflicting view.' },
  ]);
  const preferences: RankingPreferences = { requirements: [{ requirement: 'long sleeves', priority: 'require' }] };
  assert.equal(evaluateCandidate(item, preferences).eligibility, 'unknown');
  const stale = assess(candidate('stale'), [{ requirement: 'long sleeves', verdict: 'confirmed', evidence: 'Old photo.' }]);
  stale.assessment!.checked_image_ids = ['retired-photo'];
  assert.equal(evaluateCandidate(stale, preferences).eligibility, 'unknown');
  assert.equal(evaluateCandidate(stale, preferences).evidence.at(-1)!.source, 'none');
});

test('wrong source taxonomy does not exclude a visually confirmed true garment', () => {
  const item = assess(candidate('mislabel', { categories: ['Damen > Unterwäsche'], attributes: { type: 'Unterhose' } }),
    [{ requirement: 'dress', verdict: 'confirmed', evidence: 'One-piece garment with a bodice and full skirt.' }]);
  assert.equal(evaluateCandidate(item, { requirements: [{ requirement: 'dress', priority: 'require' }] }).eligibility, 'pass');
  assert.deepEqual(item.item.categories, ['Damen > Unterwäsche']);
});

test('explicit user rejection hides an item while shortlist does not override hard constraints', () => {
  const a = candidate('a');
  assert.equal(evaluateCandidate(a, {}, feedback('a', 'reject')).included, false);
  assert(evaluateCandidate(a, {}, feedback('a', 'shortlist')).base_score > evaluateCandidate(a).base_score);
  assert.equal(evaluateCandidate(a, { currency: 'EUR', price_max: 10 }, feedback('a', 'shortlist')).included, false);
  assert.deepEqual(evaluateCandidate(a, {}, feedback('a', 'neutral')), evaluateCandidate(a));
  assert.throws(() => evaluateCandidate(a, {}, feedback('someone-else', 'shortlist')), error => error instanceof ToolError && error.code === 'feedback_identity_mismatch');
});

test('price comparisons require an explicit matching currency and respect minor-unit boundaries', () => {
  assert.throws(() => evaluateCandidate(candidate('a'), { price_max: 20 }), error => error instanceof ToolError && error.code === 'currency_required');
  const preferences: RankingPreferences = { currency: 'EUR', price_min: 10.01, price_max: 20.01 };
  assert.equal(evaluateCandidate(candidate('at-edge', { price: { amount_minor: 2001, currency: 'EUR' } }), preferences).eligibility, 'pass');
  assert.equal(evaluateCandidate(candidate('over', { price: { amount_minor: 2002, currency: 'EUR' } }), preferences).eligibility, 'fail');
  assert.equal(evaluateCandidate(candidate('other', { price: { amount_minor: 100, currency: 'SEK' } }), preferences).eligibility, 'fail');
  assert.equal(evaluateCandidate(candidate('missing', { price: null }), preferences).eligibility, 'unknown');
});

test('size systems stay explicit and absent source material is unknown', () => {
  assert.equal(evaluateCandidate(candidate('size'), { sizes: ['WMN-INT-M'] }).eligibility, 'pass');
  assert.equal(evaluateCandidate(candidate('size'), { sizes: ['WMN-EU-38'] }).eligibility, 'fail');
  assert.equal(evaluateCandidate(candidate('missing', { materials: [] }), { required_materials: ['Baumwolle'] }).eligibility, 'unknown');
  assert.equal(evaluateCandidate(candidate('cotton'), { required_materials: ['Baumwolle', 'Leinen'] }).eligibility, 'pass');
  assert.equal(evaluateCandidate(candidate('cotton'), { excluded_materials: ['Baumwolle'] }).eligibility, 'fail');
});

test('fit constraints use exact numeric source measurements without unit or circumference inference', () => {
  const preferences: RankingPreferences = { measurements: { waistInCm: { min: 38, max: 42 }, lengthInCm: { min: 90 } } };
  const fitting = candidate('fit', { measurements: { waistInCm: '40,5', lengthInCm: 100 } });
  assert.equal(evaluateCandidate(fitting, preferences).eligibility, 'pass');
  assert.equal(evaluateCandidate(candidate('too-small', { measurements: { waistInCm: 30, lengthInCm: 100 } }), preferences).eligibility, 'fail');
  assert.equal(evaluateCandidate(candidate('ambiguous', { measurements: { waistInCm: '38-42 cm', lengthInCm: 100 } }), preferences).eligibility, 'unknown');
  assert.deepEqual(observedMeasurements(fitting.item), { waistInCm: 40.5, lengthInCm: 100 });
});

test('unavailable stock is excluded while unknown stock is honest and reservations are opt-in', () => {
  assert.equal(evaluateCandidate(candidate('sold', { availability: 'sold' })).included, false);
  assert.equal(evaluateCandidate(candidate('reserved', { availability: 'reserved' })).included, false);
  assert.equal(evaluateCandidate(candidate('reserved', { availability: 'reserved' }), { include_reserved: true }).included, true);
  assert.equal(evaluateCandidate(candidate('unknown', { availability: 'unknown' })).eligibility, 'unknown');
});

test('base scores are pool-independent and do not mutate source observations', () => {
  const a = candidate('a');
  const original = structuredClone(a);
  const solo = rankCandidates([a], { mode: 'relevance' }).items[0]!.evaluation;
  const expanded = rankCandidates([candidate('extreme', {}, 100), a, candidate('tiny', {}, 0.00001)], { mode: 'relevance' }).items.find(entry => entry.candidate.item.id === 'a')!.evaluation;
  assert.deepEqual(solo, expanded);
  assert.deepEqual(a, original);
  assert.equal(evaluateCandidate(candidate('nan', {}, NaN)).base_score, 0);
});

test('soft preferences and shortlist change order without removing alternatives', () => {
  const a = candidate('a', { brand: 'Less preferred' });
  const b = candidate('b', { brand: 'Preferred' });
  const result = rankCandidates([a, b], { mode: 'relevance', preferred_brands: ['Preferred'] });
  assert.deepEqual(result.items.map(entry => entry.candidate.item.id), ['b', 'a']);
  assert.equal(result.excluded.length, 0);
  const shortlisted = rankCandidates([a, b], { mode: 'relevance' }, new Map([['b', feedback('b', 'shortlist')]]));
  assert.deepEqual(shortlisted.items.map(entry => entry.candidate.item.id), ['b', 'a']);
});

test('confirmed constraints rank ahead of unknown ones in relevance modes', () => {
  const confirmed = assess(candidate('confirmed', {}, 0.001), [{ requirement: 'long sleeves', verdict: 'confirmed', evidence: 'Visible cuffs at wrist.' }]);
  const unknown = candidate('unknown', {}, 1);
  const result = rankCandidates([unknown, confirmed], { mode: 'relevance', requirements: [{ requirement: 'long sleeves', priority: 'require' }] });
  assert.deepEqual(result.items.map(entry => entry.candidate.item.id), ['confirmed', 'unknown']);
});

test('MMR-style diversity reduces redundant metadata selections and keeps alternatives reachable', () => {
  const a = candidate('a', {}, 0.03);
  const twin = candidate('b', {}, 0.029);
  const different = candidate('c', { brand: 'Different', colors: ['Blau'], materials: ['Leinen'] }, 0.028);
  assert.equal(metadataSimilarity(a, twin), 1);
  assert(metadataSimilarity(a, different) < 1);
  const diverse = rankCandidates([a, twin, different], { mode: 'diverse' }, new Map(), { limit: 2 });
  assert.deepEqual(diverse.items.map(entry => entry.candidate.item.id), ['a', 'c']);
  assert.equal(diverse.total_included, 3);
  assert.equal(diverse.excluded.length, 0);
  const relevance = rankCandidates([a, twin, different], { mode: 'relevance' });
  assert.deepEqual(relevance.items.map(entry => entry.candidate.item.id), ['a', 'b', 'c']);
});

test('diversity uses a stable explicit prior-page context without rescoring the whole ledger', () => {
  const previous = candidate('previous');
  const twin = candidate('twin', {}, 0.03);
  const different = candidate('different', { brand: 'Other', colors: ['Rot'], materials: ['Leinen'] }, 0.029);
  const result = rankCandidates([twin, different], { mode: 'diverse' }, new Map(), { limit: 1, diversity_context: [previous] });
  assert.equal(result.items[0]!.candidate.item.id, 'different');
});

test('price mode remains price-ascending despite shortlist, diversity and unknown visual criteria', () => {
  const cheap = candidate('cheap', { price: { amount_minor: 700, currency: 'EUR' } });
  const expensive = assess(candidate('expensive', { price: { amount_minor: 2800, currency: 'EUR' } }),
    [{ requirement: 'long sleeves', verdict: 'confirmed', evidence: 'Visible full-length sleeves.' }]);
  const result = rankCandidates([expensive, cheap], { mode: 'price_low', currency: 'EUR', diversity: 1,
    requirements: [{ requirement: 'long sleeves', priority: 'require' }] }, new Map([['expensive', feedback('expensive', 'shortlist')]]));
  assert.deepEqual(result.items.map(entry => entry.candidate.item.id), ['cheap', 'expensive']);
  assert.equal(result.items[1]!.evaluation.components.feedback, 0);
  assert.equal(result.items[0]!.diversity_penalty, 0);
});

test('ties are deterministic and duplicate IDs cannot occupy two result slots', () => {
  const a = candidate('a');
  const b = candidate('b');
  const first = rankCandidates([b, a, b], { mode: 'balanced' });
  const second = rankCandidates([a, b], { mode: 'balanced' });
  assert.deepEqual(first.items, second.items);
  assert.equal(first.total_candidates, 2);
});

test('invalid ranges and nonfinite scoring options fail explicitly', () => {
  const a = candidate('a');
  for (const preferences of [
    { diversity: NaN }, { diversity: 1.1 }, { currency: 'EUR', price_min: 10, price_max: 9 },
    { currency: 'EUR', price_max: Infinity }, { measurements: { waistInCm: { min: 40, max: 30 } } },
  ]) assert.throws(() => evaluateCandidate(a, preferences), error => error instanceof ToolError && error.code === 'invalid_ranking_preference');
});

test('empty cohorts still validate preferences and reject logically contradictory hard requirements', () => {
  assert.equal(rankCandidates([]).total_candidates, 0);
  assert.throws(() => rankCandidates([], { mode: 'price_low' }), error => error instanceof ToolError && error.code === 'currency_required');
  assert.throws(() => validateRankingPreferences({ requirements: [
    { requirement: ' Long   Sleeves ', priority: 'require' }, { requirement: 'long sleeves', priority: 'avoid' },
  ] }), error => error instanceof ToolError && error.code === 'contradictory_requirements');
});
