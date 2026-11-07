import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedCache, detailFromResult, galleryFromResult, mergeAppendedCard, parseCard, parseCollection, parseGallery, parseScope } from '../ui/data.js';
import { projectCardFacts } from '../src/card-facts.js';

const collection = { id: 'collection-a', source: { kind: 'observed' }, created_at: '2026-11-07T10:00:00Z', membership_as_of: '2026-11-07T10:00:00Z', order: 'discovery', total: 10_137, status: 'ready' };
const card = { item: { id: 'item', title: 'Aster', observed_at: '2026-11-07T10:05:00Z', images: [] }, reason: '', cautions: [], assessment: null, paths: [] };
const page = { size: 12, start: 1, end: 1, cursor: 'first', previous_cursor: null, next_cursor: 'second' };
const gallery = { version: 3, run_id: 'run-a', title: 'All observed', language: 'en', cards: [card], next_cursor: 'second', warnings: [], collection, page, request_id: 'request-a' };

test('v3 page parsing retains collection and request identity while preserving old gallery results', () => {
  const parsed = parseGallery(gallery)!;
  assert.equal(parsed.version, 3); assert.equal(parsed.collection!.total, 10_137); assert.equal(parsed.request_id, 'request-a');
  assert.deepEqual(parsed.page, page); assert.equal(parsed.cards[0]!.item.observed_at, '2026-11-07T10:05:00Z');
  assert.equal(parsed.collection!.membership_as_of, '2026-11-07T10:00:00Z', 'collection time is not substituted for item observation time');
  const legacy = parseGallery({ run_id: 'old', cards: [card], next_cursor: 'legacy-offset' })!;
  assert.equal(legacy.next_cursor, 'legacy-offset'); assert.equal(legacy.collection, undefined); assert.equal(legacy.cards.length, 1);
  assert.equal(galleryFromResult({ _meta: { gallery } })!.collection!.id, 'collection-a');
  assert.equal(parseGallery({ ...gallery, page: { ...page, size: 25 } }), null);
  assert.equal(parseGallery({ ...gallery, collection: { ...collection, total: -1 } }), null);
  assert.equal(parseGallery({ ...gallery, cards: Array.from({ length: 25 }, (_, i) => ({ ...card, item: { ...card.item, id: String(i) } })), page: { ...page, size: 24 } }), null);
});

test('preparation has an unknown total and explicit progress, never an invented empty cohort', () => {
  const parsed = parseCollection({ ...collection, status: 'preparing', total: null, progress: { scanned: 256, cohort: 10_137 } })!;
  assert.equal(parsed.total, null); assert.deepEqual(parsed.progress, { scanned: 256, cohort: 10_137 });
  assert.equal(parseCollection({ ...collection, created_at: 'not a timestamp' }), null);
});

test('scope separates actual assessments, model delivery and widget delivery; legacy unknown counts stay unknown', () => {
  const scope = parseScope({ observed_at: '2026-11-07T10:05:00Z', candidates: 10_137, search_pages: 73, model_delivered_photos: 8, recorded_assessments: 1,
    arms: [{ arm_id: 'a', route: 'catalog', query: 'kleid', filters: { facets: { colors: ['creme'] }, include_reserved: false }, category_relaxed: false,
      pages: 4, candidates: 120, native_total: 2000, native_window: 1000, status: 'window', observed_at: '2026-11-07T10:00:00Z' }], notes: [] })!;
  assert.equal(scope.model_delivered_fact_items, null); assert.equal(scope.model_delivered_description_items, null);
  assert.equal(scope.widget_delivered_photos, null); assert.equal(scope.recorded_assessments, 1); assert.equal(scope.model_delivered_photos, 8);
  assert.deepEqual(scope.arms[0]!.filters, { facets: Object.assign(Object.create(null), { colors: ['creme'] }), include_reserved: false });
  assert.equal(scope.arms[0]!.native_total, 2000); assert.equal(scope.arms[0]!.native_window, 1000);
  assert.equal(parseScope({ ...scope, model_delivered_photos: -1 }), null);
});

test('details require a successful exact identity envelope and do not treat an error as usable data', () => {
  const result = { _meta: { collection_detail: { run_id: 'run-a', collection_id: 'collection-a', request_id: 'request-a', card } } };
  assert.equal(detailFromResult(result)!.request_id, 'request-a');
  assert.equal(detailFromResult({ ...result, isError: true }), null);
  assert.equal(detailFromResult({ _meta: { collection_detail: { card } } }), null);
});

test('complete stored details enrich a partial card at the same observation time', () => {
  const partial = parseCard({ ...card, summary: { omitted_fields: ['item.description'], image_count: 0, assessment_recorded: false, checked_image_count: 0 } })!;
  const full = parseCard({ ...card, item: { ...card.item, description: 'The complete source description.' } })!;
  const merged = mergeAppendedCard(partial, full);
  assert.equal(merged.item.description, 'The complete source description.'); assert.equal(merged.summary, undefined);
  assert.equal(partial.item.description, null);
  const reverse = mergeAppendedCard(full, partial);
  assert.equal(reverse.item.description, 'The complete source description.'); assert.equal(reverse.summary, undefined, 'a partial replay does not downgrade complete same-version details');
});

test('stale partial metadata cannot resurrect an assessment invalidated by a newer observation', () => {
  const images = [{ id: 'photo', index: 0, url: 'https://prod.images.sellpy.net/photo.jpg' }];
  const newer = parseCard({ ...card, item: { ...card.item, images, source: 'detail', observed_at: '2026-11-07T12:00:00Z', price: { amount_minor: 5000, currency: 'EUR' } } })!;
  const older = parseCard({ ...card, item: { ...card.item, images, source: 'detail', observed_at: '2026-11-07T10:00:00Z', price: { amount_minor: 4000, currency: 'EUR' } },
    summary: { omitted_fields: ['assessment'], image_count: 1, assessment_recorded: true, checked_image_count: 1 } })!;
  const merged = mergeAppendedCard(newer, older);
  assert.equal(merged.item.price!.amount_minor, 5000); assert.equal(merged.summary, undefined);
  assert.equal(projectCardFacts(merged).assessment.recorded, false); assert.equal(projectCardFacts(merged).assessment.checked, 0);
});

test('LRU bounds hold after thousands of pages and photo byte pressure, preserving recently used entries', () => {
  const pages = new BoundedCache<number, string>(3, 100, value => value.length);
  for (let i = 0; i < 10_137; i++) { pages.set(i, `page-${i}`); assert.ok(pages.size <= 3); assert.ok(pages.bytes <= 100); }
  assert.deepEqual([...pages.keys()], [10_134, 10_135, 10_136]);
  pages.get(10_134); pages.set(10_137, 'next'); assert.equal(pages.has(10_135), false); assert.equal(pages.has(10_134), true);
  const photos = new BoundedCache<string, string>(48, 1000, value => value.length * 2);
  photos.set('a', 'a'.repeat(250)); photos.set('b', 'b'.repeat(250)); photos.get('a'); photos.set('c', 'c'.repeat(100));
  assert.equal(photos.has('b'), false); assert.equal(photos.bytes, 700); assert.equal(photos.set('too-big', 'x'.repeat(501)), false);
  assert.equal(photos.size, 2); photos.clear(); assert.equal(photos.bytes, 0); assert.equal(photos.size, 0);
});
