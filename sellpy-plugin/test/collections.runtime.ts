/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { GalleryData, ItemObservation, SearchPlan, SellpyProvider, VisualAssessment } from '../src/domain.js';
import { SearchStore } from '../src/search-store.js';
import { encodeCursor, invokeTool } from '../src/tools.js';

const observed = '2026-11-07T12:00:00.000Z';
function item(id: string): ItemObservation {
  return { id, market: 'AT', language: 'de', url: `https://www.sellpy.at/item/${id}`,
    title: `Kleid ${id}`, brand: 'Fixture', price: { amount_minor: 2400, currency: 'EUR' },
    original_price: null, size: 'M', size_system: 'EU', condition: 'Gut', categories: ['Kleider'],
    colors: ['Grün'], materials: ['Baumwolle'], measurements: {}, description: null, defects: [], images: [],
    availability: 'available', observed_at: observed, source: 'catalog', attributes: {} };
}
function context(principal: string) { return { env: env as Env, principal, deadline: Date.now() + 30_000 }; }
function gallery(result: Awaited<ReturnType<typeof invokeTool>>): GalleryData {
  expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
  const value = result._meta?.gallery as GalleryData | undefined;
  expect(value).toBeTruthy();
  return value!;
}
async function seed(total = 137) {
  const principal = `collection-test-${crypto.randomUUID()}`, run_id = crypto.randomUUID();
  const stub = env.SEARCH_RUNS.getByName(`${principal}:${run_id}`);
  const ids = Array.from({ length: total }, (_, index) => `collection-${String(index).padStart(5, '0')}`);
  const plan: SearchPlan = { market: 'AT', language: 'de', intent: { query: 'Kleid' },
    page_size: 50, arms: [{ id: 'catalog', route: 'catalog', query: 'Kleid', filters: { price_max: 60 } }] };
  await runInDurableObject(stub, async (_instance, state) => {
    const store = new SearchStore(state.storage.sql, operation => state.storage.transactionSync(operation));
    store.initialize(plan, run_id);
    const provider: SellpyProvider = {
      async search(request) {
        const batch = ids.slice(request.offset, request.offset + request.page_size);
        const next = request.offset + batch.length;
        return { items: batch.map(item), next_offset: next < ids.length ? next : null,
          total: ids.length, window: ids.length, end_reason: next < ids.length ? null : 'source_exhausted',
          applied_filters: { price_max: 60 }, warnings: [], observed_at: observed };
      },
      async capabilities() { throw new Error('Browse must not fetch capabilities.'); },
      async details() { throw new Error('Browse must not fetch item details.'); },
      async facets() { throw new Error('Browse must not fetch facets.'); },
    };
    let step = 0;
    for (;;) {
      const page = await store.advance(step++, provider, { deadline: Date.now() + 30_000, fetch });
      if (!page.next_cursor) break;
    }
  });
  return { principal, run_id, stub, ids, plan };
}

describe('scalable collections through actual Durable Object and tool boundaries', () => {
  it('shows twelve implicitly, pages all observed results after restart, and freezes membership while preserving newer facts', async () => {
    const { principal, run_id, stub, ids } = await seed();
    const result = await invokeTool('present_items', { run_id }, context(principal));
    const first = gallery(result);
    expect(first.version).toBe(3);
    expect(first.cards.map(card => card.item.id)).toEqual(ids.slice(0, 12));
    expect(first.collection).toMatchObject({ total: ids.length, status: 'ready' });
    expect(first.page).toMatchObject({ size: 12, start: 1, end: 12, previous_cursor: null });
    expect(Object.keys((result._meta?.images ?? {}) as object)).toHaveLength(0);
    expect(JSON.stringify(result.structuredContent).length).toBeLessThan(40_000);
    await stub.updateItems([item('discovered-later')]);
    const refreshed = { ...item(ids[0]!), price: { amount_minor: 1900, currency: 'EUR' }, observed_at: '2026-11-07T15:00:00.000Z' };
    await stub.updateItems([refreshed]);
    await evictDurableObject(stub);
    const seen = first.cards.map(card => card.item.id);
    let next = first.next_cursor;
    while (next) {
      const request = { run_id, collection_id: first.collection!.id, cursor: next, page_size: 24, action: 'page' as const };
      const page = gallery(await invokeTool('browse_collection', request, context(principal)));
      expect(page.cards.length).toBeLessThanOrEqual(24);
      expect(page.collection?.total).toBe(ids.length);
      expect(page.page?.start).toBe(seen.length + 1);
      const replay = gallery(await invokeTool('browse_collection', request, context(principal)));
      expect(replay.cards.map(card => card.item.id)).toEqual(page.cards.map(card => card.item.id));
      seen.push(...page.cards.map(card => card.item.id));
      next = page.next_cursor;
    }
    expect(seen).toEqual(ids);
    expect(new Set(seen).size).toBe(ids.length);
    const revisited = gallery(await invokeTool('browse_collection', { run_id, collection_id: first.collection!.id, page_size: 12 }, context(principal)));
    expect(revisited.cards[0]?.item.price?.amount_minor).toBe(1900);
    expect(revisited.cards[0]?.item.observed_at).toBe(refreshed.observed_at);
    const updated = gallery(await invokeTool('present_items', { run_id }, context(principal)));
    expect(updated.collection?.total).toBe(ids.length + 1);
  });

  it('keeps old explicit selection cursors and reasons usable with their six-card page size', async () => {
    const { principal, run_id, stub, ids } = await seed(40);
    const selection = ids.slice(0, 30).reverse().map(item_id => ({ item_id, reason: `Auswahl ${item_id}`, cautions: ['Material laut Shop'] }));
    await stub.storePresentation('legacy-selection', { title: 'Gespeicherte Auswahl', selection, page_size: 6 });
    const cursor = encodeCursor({ v: 1, kind: 'presentation', run_id, selection_id: 'legacy-selection', offset: 12 });
    await evictDurableObject(stub);
    const page = gallery(await invokeTool('present_items', { run_id, cursor }, context(principal)));
    expect(page.cards.map(card => card.item.id)).toEqual(selection.slice(12, 18).map(entry => entry.item_id));
    expect(page.cards.map(card => card.reason)).toEqual(selection.slice(12, 18).map(entry => entry.reason));
    expect(page.title).toBe('Gespeicherte Auswahl');
    expect(page.next_cursor).not.toBeNull();
  });

  it('separates delivered pixels from saved visual assessments and keeps them through eviction', async () => {
    const { principal, run_id, stub, ids } = await seed(30);
    const target = { ...item(ids[29]!), observed_at: '2026-11-07T12:01:00.000Z', images: [{ id: 'checked-front', index: 0, url: 'https://prod.images.sellpy.net/fixture-front.jpg' }] };
    await stub.updateItems([target]);
    await stub.markImagesDelivered(target.id, ['checked-front']);
    const before = gallery(await invokeTool('present_items', { run_id }, context(principal)));
    expect(before.scope?.model_delivered_photos).toBe(1);
    expect(before.scope?.recorded_assessments).toBe(0);
    const assessment: VisualAssessment = { item_id: target.id, checked_image_ids: ['checked-front'],
      observed_type: 'dress', matching_features: ['Lange Ärmel'], mismatches: [], uncertainties: [],
      requirement_results: [{ requirement: 'Lange Ärmel', verdict: 'confirmed', evidence: 'Beide Ärmel bis zum Handgelenk sichtbar' }],
      author: 'assistant', assessed_at: '2026-11-07T16:00:00.000Z' };
    await stub.recordAssessment(assessment);
    await evictDurableObject(stub);
    const after = gallery(await invokeTool('present_items', { run_id }, context(principal)));
    expect(after.scope?.model_delivered_photos).toBe(1);
    expect(after.scope?.recorded_assessments).toBe(1);
    expect(after.scope?.search_pages).toBe(1);
    expect(after.scope?.candidates).toBe(30);
    expect(after.scope?.arms[0]).toMatchObject({ query: 'Kleid', filters: { price_max: 60 }, native_total: 30 });
  });

  it('rejects foreign collection access and does not resurrect a forgotten run', async () => {
    const { principal, run_id, stub } = await seed(20);
    const first = gallery(await invokeTool('present_items', { run_id }, context(principal)));
    const request = { run_id, collection_id: first.collection!.id, cursor: first.next_cursor! };
    const foreign = await invokeTool('browse_collection', request, context(`${principal}-other`));
    expect(foreign.isError).toBe(true);
    const forgotten = await invokeTool('forget_search', { run_id }, context(principal));
    expect(forgotten.isError).not.toBe(true);
    await evictDurableObject(stub);
    const later = await invokeTool('browse_collection', request, context(principal));
    expect(later.isError).toBe(true);
    const reopened = await invokeTool('present_items', { run_id }, context(principal));
    expect(reopened.isError).toBe(true);
  });
});
