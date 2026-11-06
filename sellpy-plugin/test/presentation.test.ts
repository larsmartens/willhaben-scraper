import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Candidate, ItemObservation, VisualAssessment } from '../src/domain.js';
import { buildGallery, galleryResult, PRESENTATION_HTML, PRESENTATION_MIME, PRESENTATION_RESOURCE_META, PRESENTATION_URI } from '../src/presentation.js';
import { formatMoney, galleryFromResult, hydrationFromResult, parseItem, safeImageData, safeImageUrl, safeItemUrl } from '../ui/data.js';

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
  assert.equal(PRESENTATION_URI, 'ui://sellpy/gallery-v1.html');
  assert.equal(PRESENTATION_MIME, 'text/html;profile=mcp-app');
  assert.deepEqual(PRESENTATION_RESOURCE_META.ui.csp.connectDomains, []);
  assert.deepEqual(PRESENTATION_RESOURCE_META.ui.csp.resourceDomains, ['https://prod.images.sellpy.net', 'https://images.sellpy.net',
    'https://sellpy-parse-prod-files.s3.amazonaws.com', 'https://sellpy-parse-prod-files.s3.eu-west-1.amazonaws.com']);
  assert.match(PRESENTATION_HTML, /ui\/initialize/);
  assert.doesNotMatch(PRESENTATION_HTML, /<script[^>]+src=/);
  assert.match(PRESENTATION_HTML, /object-fit:contain/);
});
