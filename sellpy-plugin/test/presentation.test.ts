import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Candidate, ItemObservation, VisualAssessment } from '../src/domain.js';
import { buildGallery, galleryResult, PRESENTATION_HTML, PRESENTATION_MIME, PRESENTATION_RESOURCE_META, PRESENTATION_URI } from '../src/presentation.js';
import { feedbackFromResult, formatMoney, galleryFromResult, hydrationFromResult, mergeAppendedCard, parseFeedback, parseItem, safeImageData, safeImageUrl, safeItemUrl } from '../ui/data.js';
import { comparisonRows, filterCards, selectedCards } from '../ui/comparison.js';
import { evaluateCandidate } from '../src/refinement.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLF8AAAAASUVORK5CYII=';
function item(id: string, price: number | null = 1299): ItemObservation {
  return { id, market: 'AT', language: 'de', url: `https://www.sellpy.at/item/${id}`,
    title: `Kleid ${id}`, brand: 'Beispiel', price: price === null ? null : { amount_minor: price, currency: 'EUR' },
    original_price: null, size: 'M', size_system: 'EU', condition: 'Sehr gut', categories: ['Unterhosen'], colors: ['Weiß'],
    materials: ['Baumwolle'], measurements: { Länge: '110 cm' }, description: 'Angaben des Shops', defects: [],
    images: Array.from({ length: 14 }, (_, index) => ({ id: `${id}-photo-${index}`, index,
      url: `https://prod.images.sellpy.net/fit-in/400x4096/${id}-${index}.jpg` })),
    availability: 'available', observed_at: '2026-11-06T10:00:00.000Z', source: 'detail', attributes: {} };
}
function candidate(id: string): Candidate {
  return { item: item(id), paths: [{ arm_id: 'broad', route: 'semantic', rank: 1, observed_at: '2026-11-06T09:59:00.000Z' }], fusion_score: 0.1, assessment: null };
}
function assessment(value: ItemObservation): VisualAssessment {
  return { item_id: value.id, checked_image_ids: [value.images[0]!.id], observed_type: 'Kleid',
    matching_features: ['Rüschenbesatz'], mismatches: ['Shop-Kategorie ist Unterhosen'], uncertainties: ['Material nicht visuell verifizierbar'],
    requirement_results: [{ requirement: 'Cottagecore', verdict: 'confirmed', evidence: 'Rüschen und florales Muster in Foto 1' }],
    assessed_at: '2026-11-06T10:01:00.000Z', author: 'assistant' };
}

test('selection preserves canonical identity, cents, all photo references and separate visual evidence', () => {
  const first = candidate('first'), second = candidate('second');
  first.assessment = assessment(first.item);
  const gallery = buildGallery({ run_id: 'run', language: 'de', title: 'Cottagecore', candidates: [first, second],
    selection: [{ item_id: 'second', reason: 'Zweite Option' }, { item_id: 'first', reason: 'Rüschen', cautions: ['Maße prüfen'] }] });
  assert.deepEqual(gallery.cards.map(card => card.item.id), ['second', 'first']);
  assert.equal(gallery.cards[1]!.item.price!.amount_minor, 1299);
  assert.equal(gallery.cards[1]!.item.images.length, 14);
  assert.equal(gallery.cards[1]!.item.categories[0], 'Unterhosen');
  assert.equal(gallery.cards[1]!.assessment!.observed_type, 'Kleid');
  assert.deepEqual(gallery.cards[1]!.cautions, ['Maße prüfen']);
  assert.equal(gallery.cards[0]!.assessment, null);
  assert.match(formatMoney(first.item.price), /12,99/);
});

test('presentation has no arbitrary total item cap and retains its independent continuation', () => {
  const candidates = Array.from({ length: 137 }, (_, index) => candidate(`item-${index}`));
  const gallery = buildGallery({ run_id: 'run', language: 'de', title: 'Large selection', candidates,
    selection: candidates.map(value => ({ item_id: value.item.id, reason: 'Requested selection' })), next_cursor: 'presentation-cursor' });
  assert.equal(gallery.cards.length, 137);
  assert.equal(gallery.next_cursor, 'presentation-cursor');
  assert.equal(gallery.cards.at(-1)!.item.id, 'item-136');
});

test('missing observations are explicit, repeated ids do not silently create duplicate garments', () => {
  const gallery = buildGallery({ run_id: 'run', language: 'de', title: 'Test', candidates: [candidate('known')],
    selection: [{ item_id: 'known', reason: 'First' }, { item_id: 'missing', reason: 'Unavailable' }, { item_id: 'known', reason: 'Duplicate' }] });
  assert.equal(gallery.cards.length, 1);
  assert.equal(gallery.cards[0]!.reason, 'First');
  assert.match(gallery.warnings[0]!, /missing/);
});

test('widget pixels stay outside model context and hydration cannot cross item/image identities', () => {
  const first = candidate('a'), second = candidate('b');
  second.item.images[1]!.id = first.item.images[1]!.id;
  const gallery = buildGallery({ run_id: 'run', language: 'de', title: 'Test', candidates: [first, second],
    selection: [{ item_id: 'a', reason: 'A' }, { item_id: 'b', reason: 'B' }] });
  const result = galleryResult(gallery, { [first.item.images[0]!.id]: PNG, [first.item.images[1]!.id]: PNG,
    unknown: PNG, [second.item.images[0]!.id]: 'data:image/svg+xml;base64,PHN2Zz4=' });
  assert(!JSON.stringify(result.content).includes('base64'));
  assert(!JSON.stringify(result.structuredContent).includes('base64'));
  assert.equal(Object.keys(result._meta!.images as object).length, 1);
  assert.equal(hydrationFromResult(result, gallery.cards).get(first.item.images[0]!.id), PNG);
  assert.equal(hydrationFromResult(result, gallery.cards).has(first.item.images[1]!.id), false);
  assert.equal(galleryFromResult(result)!.cards[0]!.item.images.length, 14);
  assert.equal((result.structuredContent as { cards: { visually_assessed: boolean }[] }).cards[0]!.visually_assessed, false);
});

test('only assessments tied to this observed item and its existing photos are retained', () => {
  for (const bad of ['other-item', 'missing-image', 'no-images']) {
    const value = candidate('a');
    value.assessment = assessment(value.item);
    if (bad === 'other-item') value.assessment.item_id = 'other';
    if (bad === 'missing-image') value.assessment.checked_image_ids = ['missing'];
    if (bad === 'no-images') value.assessment.checked_image_ids = [];
    const gallery = buildGallery({ run_id: 'run', language: 'de', title: 'Test', candidates: [value], selection: [{ item_id: 'a', reason: 'A' }] });
    assert.equal(gallery.cards[0]!.assessment, null, bad);
  }
});

test('unsafe destinations and active image data are rejected without sanitizing away source facts', () => {
  for (const url of ['javascript:alert(1)', 'https://sellpy.at.evil.example/item/1', 'https://user@www.sellpy.at/item/1',
    'https://www.sellpy.at:8443/item/1', 'https://www.sellpy.at/account', 'http://www.sellpy.at/item/1']) assert.equal(safeItemUrl(url), null);
  for (const url of ['https://prod.images.sellpy.net.evil.example/a.jpg', 'https://example.com/a.jpg', 'data:image/png;base64,eA==']) assert.equal(safeImageUrl(url), null);
  assert.equal(safeImageData('data:image/svg+xml;base64,PHN2Zz4='), null);
  const value = candidate('a');
  value.item.url = 'javascript:alert(1)';
  assert.throws(() => buildGallery({ run_id: 'run', language: 'de', title: 'Test', candidates: [value], selection: [{ item_id: 'a', reason: 'A' }] }), /invalid/);
  const parsed = parseItem({ ...item('x', null), title: '<img src=x onerror=alert(1)>', availability: 'probably',
    images: [{ id: 'bad', index: 0, url: 'https://evil.example/photo.jpg' }] })!;
  assert.equal(parsed.title, '<img src=x onerror=alert(1)>');
  assert.equal(parsed.images.length, 0);
  assert.equal(parsed.availability, 'unknown');
  assert.equal(parsed.price, null);
  assert.equal(formatMoney(null, 'de'), 'Preis offen');
});

test('resource is self-contained, declares only exact photo CDNs and uses the MCP Apps MIME', () => {
  assert.equal(PRESENTATION_URI, 'ui://sellpy/gallery-v2.html');
  assert.equal(PRESENTATION_MIME, 'text/html;profile=mcp-app');
  assert.deepEqual(PRESENTATION_RESOURCE_META.ui.csp.connectDomains, []);
  assert.deepEqual(PRESENTATION_RESOURCE_META.ui.csp.resourceDomains, ['https://prod.images.sellpy.net', 'https://images.sellpy.net',
    'https://sellpy-parse-prod-files.s3.amazonaws.com', 'https://sellpy-parse-prod-files.s3.eu-west-1.amazonaws.com']);
  assert.match(PRESENTATION_HTML, /ui\/initialize/);
  assert.doesNotMatch(PRESENTATION_HTML, /<script[^>]+src=/);
  assert.match(PRESENTATION_HTML, /object-fit:contain/);
});

test('feedback stays tied to the exact item and cannot manufacture visual evidence', () => {
  const feedback = { item_id: 'a', decision: 'shortlist' as const, reason: '<img src=x onerror=alert(1)>', updated_at: '2026-11-07T00:00:00Z' };
  const gallery = buildGallery({ run_id: 'run', language: 'de', title: 'Shortlist', candidates: [candidate('a'), candidate('b')],
    selection: [{ item_id: 'a', reason: 'A' }, { item_id: 'b', reason: 'B' }], feedback: { a: feedback, b: feedback } });
  assert.deepEqual(gallery.cards[0]!.feedback, feedback);
  assert.equal(gallery.cards[1]!.feedback, undefined, 'a map key is insufficient to establish item identity');
  const roundtrip = galleryFromResult(galleryResult(gallery))!;
  assert.deepEqual(roundtrip.cards[0]!.feedback, feedback);
  assert.equal(roundtrip.cards[0]!.assessment, null);
  assert.equal((galleryResult(gallery).structuredContent as {cards:{visually_assessed:boolean}[]}).cards[0]!.visually_assessed, false);
  assert.equal(parseFeedback({ ...feedback, decision: 'approve purchase' }, 'a'), null);
  assert.equal(parseFeedback({ ...feedback, updated_at: 'not a date' }, 'a'), null);
});

test('a mixed visual selection identifies unsaved assessments without promoting free-text reasons or feedback to evidence', () => {
  const reviewed = candidate('reviewed'), pending = candidate('pending');
  reviewed.assessment = assessment(reviewed.item);
  const gallery = buildGallery({ run_id: 'run', language: 'en', title: 'Visual selection', candidates: [reviewed, pending],
    selection: [{ item_id: 'pending', reason: 'The photo shows a dress with long sleeves.' }, { item_id: 'reviewed', reason: 'Recorded photo evidence' }],
    feedback: { pending: { item_id: 'pending', decision: 'shortlist', updated_at: '2026-11-07T00:00:00Z' } } });
  const result = galleryResult(gallery, { [pending.item.images[0]!.id]: PNG });
  const handoff = (result.structuredContent as { visual_review?: { unassessed_item_ids: string[]; next_action: string } }).visual_review;
  assert.ok(handoff, 'The visual selection needs an explicit handoff for unsaved assessments.');
  assert.deepEqual(handoff.unassessed_item_ids, ['pending']);
  assert.match(handoff.next_action, /record_visual_assessment/);
  assert.match(handoff.next_action, /visual/i);
  assert.match(handoff.next_action, /catalog|price/i);
  const cards = (result.structuredContent as { cards: { item_id: string; visually_assessed: boolean; checked_image_ids: string[] }[] }).cards;
  assert.deepEqual(cards.map(value => [value.item_id, value.visually_assessed]), [['pending', false], ['reviewed', true]]);
  assert.deepEqual(cards[0]!.checked_image_ids, []);
  assert.equal(galleryFromResult(result)!.cards[0]!.assessment, null);
});

test('a catalog-only selection remains usable without a visual assessment', () => {
  const value = candidate('catalog');
  const gallery = buildGallery({ run_id: 'run', language: 'de', title: 'Günstige Kleider', candidates: [value],
    selection: [{ item_id: value.item.id, reason: 'Lowest observed price among these candidates' }] });
  const result = galleryResult(gallery);
  assert.notEqual(result.isError, true);
  assert.equal(galleryFromResult(result)!.cards[0]!.reason, 'Lowest observed price among these candidates');
  assert.equal(galleryFromResult(result)!.cards[0]!.assessment, null);
  const handoff = (result.structuredContent as { visual_review?: { unassessed_item_ids: string[]; next_action: string } }).visual_review;
  assert.ok(handoff);
  assert.deepEqual(handoff.unassessed_item_ids, ['catalog']);
  assert.match(handoff.next_action, /catalog|price/i);
  assert.deepEqual(gallery.warnings, [], 'An ordinary catalog selection is not an error or failed visual check.');
});

test('a fully assessed selection has no outstanding recording handoff', () => {
  const value = candidate('reviewed');
  value.assessment = assessment(value.item);
  const gallery = buildGallery({ run_id: 'run', language: 'en', title: 'Reviewed', candidates: [value],
    selection: [{ item_id: value.item.id, reason: 'Recorded original-photo observations' }] });
  const result = galleryResult(gallery);
  assert.deepEqual((result.structuredContent as { visual_review: unknown }).visual_review, { unassessed_item_ids: [], next_action: null });
  assert.equal((result.structuredContent as { cards: { visually_assessed: boolean }[] }).cards[0]!.visually_assessed, true);
});

test('feedback acknowledgments must match run, item and a successful response', () => {
  const feedback = { item_id: 'a', decision: 'reject', updated_at: '2026-11-07T00:00:00Z' };
  const result = { structuredContent: { run_id: 'run', item_id: 'a', feedback } };
  assert.deepEqual(feedbackFromResult(result, 'run', 'a'), feedback);
  assert.equal(feedbackFromResult(result, 'new-run', 'a'), null);
  assert.equal(feedbackFromResult(result, 'run', 'b'), null);
  assert.equal(feedbackFromResult({ ...result, isError: true }, 'run', 'a'), null);
  assert.equal(feedbackFromResult({ structuredContent: { ...result.structuredContent, feedback: { ...feedback, item_id: 'b' } } }, 'run', 'a'), null);
});

test('overlapping presentation pages merge feedback and source facts by their independent timestamps', () => {
  const value = candidate('a');
  value.assessment = assessment(value.item);
  const gallery = buildGallery({ run_id: 'run', language: 'de', title: 'Compare', candidates: [value],
    selection: [{ item_id: 'a', reason: 'A' }] });
  const old = gallery.cards[0]!;
  const current = { ...old, item: { ...old.item, materials: ['Polyester'], observed_at: '2026-11-06T12:00:00Z' },
    assessment: null, feedback: { item_id: 'a', decision: 'shortlist' as const, updated_at: '2026-11-07T00:00:00Z' } };
  for (const feedback of [undefined,
    { item_id: 'a', decision: 'neutral' as const, updated_at: '2026-11-06T00:00:00Z' },
    { item_id: 'a', decision: 'neutral' as const, updated_at: current.feedback.updated_at }]) {
    const merged = mergeAppendedCard(current, { ...old, ...(feedback ? { feedback } : {}) });
    assert.deepEqual(merged.feedback, current.feedback, 'a missing, older or tied feedback snapshot cannot undo an acknowledged decision');
    assert.deepEqual(merged.item.materials, ['Polyester']);
    assert.equal(merged.assessment, null, 'older assessment snapshots cannot cross a changed-material observation');
  }
  const next = { ...old, item: { ...old.item, materials: ['Linen'], observed_at: '2026-11-06T13:00:00Z' },
    assessment: null, feedback: { item_id: 'a', decision: 'reject' as const, updated_at: '2026-11-07T01:00:00Z' } };
  const merged = mergeAppendedCard(current, next);
  assert.deepEqual(merged.item, next.item, 'a genuinely newer observation is still adopted');
  assert.deepEqual(merged.feedback, next.feedback, 'a genuinely newer decision is still adopted');
  const sameFacts = mergeAppendedCard(old, { ...old, item: { ...old.item, observed_at: '2026-11-06T13:00:00Z' }, assessment: null });
  assert.deepEqual(sameFacts.assessment, old.assessment, 'identical source facts retain applicable original-photo evidence');
  assert.deepEqual(old.item.materials, ['Baumwolle'], 'merging must not mutate the presentation snapshot');
});

test('comparison preserves source labels and explicit unknowns without asserting fit or material from images', () => {
  const a = candidate('a'), b = candidate('b');
  a.assessment = assessment(a.item);
  b.item.materials = [];
  b.item.measurements = {};
  b.item.price = null;
  const gallery = buildGallery({ run_id: 'run', language: 'de', title: 'Compare', candidates: [a,b],
    selection: [{ item_id: 'a', reason: 'A' }, { item_id: 'b', reason: 'B' }] });
  const rows = comparisonRows(gallery.cards, 'de');
  const cells = (label: string) => rows.find(row => row.label === label)!.cells.map(cell => cell.text);
  assert.deepEqual(cells('Material laut Shop'), ['Baumwolle', 'Keine Angabe']);
  assert.deepEqual(cells('Kategorie laut Shop'), ['Unterhosen', 'Unterhosen']);
  assert.deepEqual(cells('Visuell erkannter Artikeltyp'), ['Kleid', 'Keine Angabe']);
  assert.deepEqual(cells('Maß laut Shop: Länge'), ['110 cm', 'Keine Angabe']);
  assert.equal(cells('Preis')[1], 'Preis offen');
  assert.deepEqual(cells('Geprüfte Fotos'), ['1 / 14', 'Keine aktuelle Bildbewertung gespeichert']);
  assert.match(cells('Cottagecore')[0]!, /^Bestätigt: Rüschen/);
  assert.equal(cells('Cottagecore')[1], 'Offen');
});

test('comparison and ranking agree on conflicting, uncertain and normalized exact requirements', () => {
  const cases: { label: string; verdicts: VisualAssessment['requirement_results']; expected: 'confirmed' | 'unknown' }[] = [
    { label: 'conflict', expected: 'unknown', verdicts: [
      { requirement: 'Long sleeves', verdict: 'confirmed', evidence: 'First record says long sleeves' },
      { requirement: 'Long sleeves', verdict: 'contradicted', evidence: 'Second record says short sleeves' },
    ] },
    { label: 'normalized conflict', expected: 'unknown', verdicts: [
      { requirement: 'Long sleeves', verdict: 'contradicted', evidence: 'Short sleeves are visible' },
      { requirement: '  ＬＯＮＧ   ＳＬＥＥＶＥＳ  ', verdict: 'confirmed', evidence: 'Another record claims long sleeves' },
    ] },
    { label: 'explicit uncertainty', expected: 'unknown', verdicts: [
      { requirement: 'Long sleeves', verdict: 'confirmed', evidence: 'First view appears long' },
      { requirement: 'long\tsleeves', verdict: 'unknown', evidence: 'Sleeve ends are hidden' },
    ] },
    { label: 'consistent normalized records', expected: 'confirmed', verdicts: [
      { requirement: 'Long sleeves', verdict: 'confirmed', evidence: 'Sleeves in photo 1' },
      { requirement: 'LONG SLEEVES', verdict: 'confirmed', evidence: 'Sleeves in photo 2' },
    ] },
  ];
  for (const scenario of cases) {
    const value = candidate('a');
    value.assessment = assessment(value.item);
    value.assessment.requirement_results = scenario.verdicts;
    const gallery = buildGallery({ run_id: 'run', language: 'en', title: 'Compare', candidates: [value],
      selection: [{ item_id: 'a', reason: 'A' }] });
    const ranking = evaluateCandidate(value, { requirements: [{ requirement: 'long sleeves', priority: 'require' }] });
    const rows = comparisonRows(gallery.cards, 'en');
    const row = rows.find(row => row.label === 'Long sleeves')!;
    assert.equal(ranking.evidence.find(entry => entry.criterion === 'long sleeves')!.verdict, scenario.expected, scenario.label);
    assert.equal(row.cells[0]!.tone, scenario.expected === 'confirmed' ? 'positive' : 'muted', scenario.label);
    assert.match(row.cells[0]!.text, scenario.expected === 'confirmed' ? /^Confirmed:/ : /^Unknown:/, scenario.label);
    assert.equal(rows.filter(row => scenario.verdicts.some(entry => entry.requirement === row.label)).length, 1,
      `${scenario.label}: equivalent labels must not create contradictory rows`);
  }
});

test('local filters and comparison retain exact IDs, evidence requirements and all requested selections', () => {
  const candidates = Array.from({length:137}, (_,i) => candidate(`item-${i}`));
  candidates[2]!.assessment = assessment(candidates[2]!.item);
  const gallery = buildGallery({run_id:'run',language:'en',title:'All',candidates,
    selection:candidates.map(value=>({item_id:value.item.id,reason:'Fixture'})),
    feedback:{'item-1':{item_id:'item-1',decision:'shortlist',updated_at:'2026-11-07T00:00:00Z'},
      'item-2':{item_id:'item-2',decision:'reject',updated_at:'2026-11-07T00:00:00Z'}}});
  assert.deepEqual(filterCards(gallery.cards,'shortlist').map(card=>card.item.id),['item-1']);
  assert.deepEqual(filterCards(gallery.cards,'reviewed').map(card=>card.item.id),['item-2']);
  assert.deepEqual(filterCards(gallery.cards,'rejected').map(card=>card.item.id),['item-2']);
  assert.equal(filterCards(gallery.cards,'all').length,137);
  const selected = selectedCards(gallery.cards,new Set(gallery.cards.map(card=>card.item.id)));
  assert.equal(selected.length,137);
  assert.equal(selected.at(-1)!.item.id,'item-136');
  assert.equal(comparisonRows(selected,'en').every(row=>row.cells.length===137),true);
});
