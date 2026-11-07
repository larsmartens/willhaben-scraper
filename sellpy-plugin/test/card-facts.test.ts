import test from 'node:test';
import assert from 'node:assert/strict';
import type { GalleryCard } from '../src/domain.js';
import { projectCardFacts, priceSubtotal } from '../src/card-facts.js';
import { comparisonRows } from '../ui/comparison.js';

function card(id = 'a'): GalleryCard {
  return { item: { id, title: 'Aster Baumwollkleid', brand: 'Aster', market: 'AT', language: 'de', url: `https://www.sellpy.at/item/${id}`,
    price: { amount_minor: 2400, currency: 'EUR' }, original_price: null, size: 'M', size_system: 'EU', condition: 'Sehr gut',
    categories: ['Kleider'], colors: ['Creme'], materials: ['Baumwolle', 'Baumwolle'], measurements: { Länge: '110 cm' },
    description: 'Unveränderte Shop-Beschreibung.', defects: [], availability: 'available', observed_at: '2026-11-07T10:00:00Z', source: 'detail', attributes: {},
    images: [{ id: `${id}-image`, index: 0, url: `https://prod.images.sellpy.net/${id}.jpg` }] }, reason: 'Persönliche Auswahlnotiz',
    cautions: ['Persönliche Auswahlnotiz', 'Maße prüfen', '  Maße  prüfen '], assessment: null, paths: [] };
}

test('compact projection assigns source facts once without repeating a title brand or selection prose', () => {
  const value = card(), projection = projectCardFacts(value, 'de');
  assert.equal(projection.summary.filter(row => row.key === 'brand').length, 0);
  assert.equal(projection.summary.filter(row => row.key === 'size').length, 1);
  assert.equal(projection.details.some(row => row.key === 'size' || row.key === 'price'), false);
  assert.equal(projection.details.find(row => row.key === 'material')!.value, 'Baumwolle');
  assert.deepEqual(projection.selection_note, { reason: 'Persönliche Auswahlnotiz', cautions: ['Maße prüfen'] });
  assert.deepEqual(projection.evidence, []);
  assert.equal(projection.assessment.recorded, false);
  assert.equal(value.cautions.length, 3, 'projection does not rewrite the stored note');
  value.item.title = 'Faster Baumwollkleid';
  assert.equal(projectCardFacts(value).summary.find(row => row.key === 'brand')!.value, 'Aster', 'substring overlap cannot erase a different brand fact');
});

test('display title removes only exact size tokens and category facts retain independent leaf paths', () => {
  const value = card(); value.item.title = 'By Malene Birger · Kleid · WMN-EU-36'; value.item.brand = 'By Malene Birger';
  value.item.size = 'WMN-EU-36'; value.item.size_system = 'EU';
  value.item.categories = ['Damen', 'Damen > Kleidung', 'Damen > Kleidung > Kleider', 'Damen > Kleidung > Kleider > Kleider', 'Vintage > Festlich'];
  const facts = projectCardFacts(value, 'de');
  assert.equal(facts.title, 'By Malene Birger · Kleid');
  assert.equal(facts.summary.find(row => row.key === 'size')!.value, 'WMN-EU-36 (EU)');
  assert.equal(facts.details.find(row => row.key === 'category')!.value, 'Damen > Kleidung > Kleider · Vintage > Festlich');
  assert.equal(value.item.title, 'By Malene Birger · Kleid · WMN-EU-36', 'source title remains intact');
  value.item.title = 'Kleid in WMN-EU-36 mit Gürtel';
  assert.equal(projectCardFacts(value).title, value.item.title, 'size mentioned inside prose is not rewritten');
});

test('omitted large assessments keep their recorded status and exact photo count until details are loaded', () => {
  const value = card(); value.summary = { omitted_fields: ['assessment', 'item.images'], image_count: 14, assessment_recorded: true, checked_image_count: 3 };
  const facts = projectCardFacts(value, 'de');
  assert.deepEqual(facts.assessment, { recorded: true, checked: 3, available: 14, details_available: true });
  assert.deepEqual(facts.evidence, [], 'metadata does not invent the omitted findings');
});

test('requirement fragments preserve conflict, uncertainty and exact legacy evidence without manufacturing findings', () => {
  const value = card();
  value.assessment = { item_id: value.item.id, author: 'assistant', checked_image_ids: ['a-image'], assessed_at: '2026-11-07T10:05:00Z', observed_type: 'Kleid',
    matching_features: ['Ärmel reichen bis zum Handgelenk', 'Zusätzliche unstrukturierte Notiz'], mismatches: ['Kurzer Ärmel im zweiten Bild'], uncertainties: ['Saum verdeckt'],
    requirement_results: [
      { requirement: 'Lange Ärmel', verdict: 'confirmed', evidence: 'Ärmel reichen bis zum Handgelenk' },
      { requirement: '  ＬＡＮＧＥ   ÄＲＭＥＬ  ', verdict: 'confirmed', evidence: 'Ärmel reichen bis zum Handgelenk' },
      { requirement: 'Lange Ärmel', verdict: 'contradicted', evidence: 'Kurzer Ärmel im zweiten Bild' },
      { requirement: 'Kein Muster', verdict: 'unknown', evidence: 'Saum verdeckt' },
    ] };
  const projection = projectCardFacts(value, 'de');
  assert.equal(projection.evidence.length, 2);
  assert.equal(projection.evidence[0]!.status, 'conflicting');
  assert.equal(projection.evidence[0]!.verdict, 'unknown');
  assert.equal(projection.evidence[0]!.evidence, 'Ärmel reichen bis zum Handgelenk | Kurzer Ärmel im zweiten Bild');
  assert.deepEqual(projection.evidence[0]!.checked_image_ids, ['a-image']);
  assert.equal(projection.evidence[1]!.requirement, 'Kein Muster', 'negation is retained');
  assert.equal(projection.legacy_evidence.find(row => row.key === 'matching')!.value, 'Zusätzliche unstrukturierte Notiz');
  assert.equal(projection.legacy_evidence.some(row => row.key === 'mismatches' || row.key === 'uncertain'), false, 'same saved finding is not repeated in a second section');
  const rows = comparisonRows([value], 'de');
  assert.equal(rows.filter(row => row.label === 'Lange Ärmel').length, 1);
  assert.match(rows.find(row => row.label === 'Lange Ärmel')!.cells[0]!.text, /^Offen: Widersprüchliche/);
  value.assessment.checked_image_ids = ['an-image-not-in-this-observation'];
  const invalid = projectCardFacts(value, 'de');
  assert.deepEqual(invalid.evidence, []); assert.deepEqual(invalid.legacy_evidence, []); assert.equal(invalid.assessment.recorded, false);
});

test('free text, shortlist decisions and source facts do not establish photo assessment', () => {
  const value = card();
  value.reason = 'Visually perfect long sleeves';
  value.feedback = { item_id: 'a', decision: 'shortlist', updated_at: '2026-11-07T10:05:00Z' };
  const facts = projectCardFacts(value, 'en');
  assert.equal(facts.selection_note!.reason, value.reason); assert.equal(facts.assessment.checked, 0);
  assert.deepEqual(facts.evidence, []); assert.deepEqual(facts.legacy_evidence, []);
});

test('price subtotal keeps missing values and currencies explicit, including a real zero price', () => {
  const a = card('a'), b = card('b'), c = card('c'), d = card('d');
  b.item.price = null; c.item.price = { amount_minor: 700, currency: 'USD' }; d.item.price = { amount_minor: 0, currency: 'EUR' };
  assert.deepEqual(priceSubtotal([a, b, c, d]), { amounts: [{ amount_minor: 2400, currency: 'EUR' }, { amount_minor: 700, currency: 'USD' }],
    priced_items: 3, missing_items: 1, mixed_currencies: true });
  assert.deepEqual(priceSubtotal([a, d]), { amounts: [{ amount_minor: 2400, currency: 'EUR' }], priced_items: 2, missing_items: 0, mixed_currencies: false });
});

test('comparison distinguishes unavailable refreshed assessment state from an unassessed item', () => {
  const a = card('a'), b = card('b');
  const row = comparisonRows([a, b], 'de', new Set(['a'])).find(value => value.label === 'Geprüfte Fotos')!;
  assert.deepEqual(row.cells.map(cell => cell.text), ['Bewertungsstatus offen', 'Keine Bildbewertung']);
});
