/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ItemObservation, SearchPlan, SellpyProvider, VisualAssessment } from '../src/domain.js';
import { SearchStore } from '../src/search-store.js';

const observed = '2026-11-06T21:00:00.000Z';

function item(id: string): ItemObservation {
  return {
    id, market: 'AT', language: 'de', url: `https://www.sellpy.at/item/${id}`, title: `Dress ${id}`, brand: null,
    price: { amount_minor: 2300, currency: 'EUR' }, original_price: null, size: 'M', size_system: null,
    condition: 'Gut', categories: ['Kleider'], colors: ['Grün'], materials: ['Baumwolle'], measurements: {},
    description: null, defects: [], images: [{ id: `${id}-front`, index: 0, url: `https://prod.images.sellpy.net/${id}.jpg` }],
    availability: 'available', observed_at: observed, source: 'catalog', attributes: {},
  };
}

function plan(arms: SearchPlan['arms'] = []): SearchPlan {
  return { market: 'AT', language: 'de', intent: { query: 'floral dress' }, arms, page_size: 2 };
}

// Await the RPC thenable directly: matcher introspection of RPC promises can
// otherwise create a second, unhandled rejection in the Workers test wrapper.
async function rejectionMessage(operation: () => Promise<unknown>): Promise<string | null> {
  try { await operation(); return null; }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}

describe('SearchRun in the actual Workers runtime', () => {
  it('preserves corrective error fields across the Durable Object RPC boundary', async () => {
    const stub = env.SEARCH_RUNS.getByName(`error-probe:${crypto.randomUUID()}`);
    let caught: unknown = null;
    try { await stub.status(); }
    catch (error) { caught = error; }
    expect(caught).toMatchObject({
      code: 'search_not_found', retryable: false,
      next_action: 'Start a new search or use an existing run_id.',
    });
  });

  it('persists chunked reference bytes and model-visible image evidence through actor eviction', async () => {
    const runId = `reference-${crypto.randomUUID()}`;
    const stub = env.SEARCH_RUNS.getByName(`alice:${runId}`);
    const bytes = Uint8Array.from({ length: 600_017 }, (_, index) => index % 251);
    await stub.storeReference('reference-file', bytes, 'image/jpeg', 'reference.jpg');
    const first = await stub.start(plan(), runId);
    expect(first.status).toBe('ended');
    expect(first.coverage.unique_items).toBe(0);
    await stub.updateItems([item('dress-1')]);
    const assessment: VisualAssessment = {
      item_id: 'dress-1', checked_image_ids: ['dress-1-front'], observed_type: 'dress',
      matching_features: ['floral pattern'], mismatches: [], uncertainties: [],
      requirement_results: [{ requirement: 'floral pattern', verdict: 'confirmed', evidence: 'dress-1-front' }],
      assessed_at: observed, author: 'assistant',
    };
    expect(await rejectionMessage(() => stub.recordAssessment(assessment))).toContain('actual model-visible images');
    await stub.markImagesDelivered('dress-1', ['dress-1-front']);
    await stub.recordAssessment(assessment);
    const stored = await runInDurableObject(stub, async (_instance, state) => ({
      chunks: state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM reference_chunks').one().count,
      assessed: state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM candidates WHERE assessment_json IS NOT NULL').one().count,
    }));
    expect(stored).toEqual({ chunks: 3, assessed: 1 });

    await evictDurableObject(stub);
    const recovered = await stub.getReference('reference-file');
    expect(recovered?.mime_type).toBe('image/jpeg');
    expect(recovered?.file_name).toBe('reference.jpg');
    expect(recovered?.bytes).toEqual(bytes);
    expect((await stub.getCandidates(['dress-1']))[0]?.assessment).toEqual(assessment);
    expect((await stub.status()).coverage.visually_assessed_items).toBe(1);
    expect(await stub.start(plan(), runId)).toEqual(first);
    const otherPrincipal = env.SEARCH_RUNS.getByName(`bob:${runId}`);
    expect(await otherPrincipal.getReference('reference-file')).toBeNull();
    expect(await otherPrincipal.getCandidates(['dress-1'])).toEqual([]);
  });

  it('commits an oversized provider page once and drains every item via immutable RPC continuations', async () => {
    const runId = `drain-${crypto.randomUUID()}`;
    const stub = env.SEARCH_RUNS.getByName(`alice:${runId}`);
    const searchPlan = plan([{ id: 'catalog', route: 'catalog', query: 'floral dress' }]);
    const seeded = await runInDurableObject(stub, async (_instance, state) => {
      const store = new SearchStore(state.storage.sql, operation => state.storage.transactionSync(operation));
      store.initialize(searchPlan, runId);
      let calls = 0;
      const provider: SellpyProvider = {
        async search() {
          calls++;
          return { items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(item), next_offset: null,
            total: 7, window: null, end_reason: 'source_exhausted', applied_filters: {}, warnings: [], observed_at: observed };
        },
        async capabilities() { throw new Error('Not used in this runtime fixture.'); },
        async details() { throw new Error('Not used in this runtime fixture.'); },
        async facets() { throw new Error('Not used in this runtime fixture.'); },
      };
      const page = await store.advance(0, provider, { deadline: Date.now() + 30_000, fetch });
      return { page, calls };
    });
    expect(seeded.calls).toBe(1);
    expect(seeded.page.items.map(candidate => candidate.item.id)).toEqual(['a', 'b']);
    expect(seeded.page.coverage.unique_items).toBe(7);
    expect(seeded.page.coverage.returned_items).toBe(2);
    await evictDurableObject(stub);
    expect(await stub.start(searchPlan, runId, Date.now() - 1)).toEqual(seeded.page);
    const seen = seeded.page.items.map(candidate => candidate.item.id);
    let cursor = seeded.page.next_cursor;
    let last = seeded.page;
    while (cursor) {
      const page = await stub.continue(cursor, Date.now() - 1);
      expect(await stub.continue(cursor, Date.now() - 1)).toEqual(page);
      seen.push(...page.items.map(candidate => candidate.item.id));
      last = page;
      cursor = page.next_cursor;
    }
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(last.status).toBe('ended');
    expect(last.coverage.pages_read).toBe(1);
    expect(last.coverage.returned_items).toBe(7);
  });

  it('honors a caller deadline and keeps paused receipt replay stable', async () => {
    const runId = `deadline-${crypto.randomUUID()}`;
    const stub = env.SEARCH_RUNS.getByName(`alice:${runId}`);
    const searchPlan = plan([{ id: 'catalog', route: 'catalog', query: 'dress' }]);
    const first = await stub.start(searchPlan, runId, Date.now() - 1);
    expect(first.status).toBe('paused');
    expect(first.end_reason).toBe('time_budget');
    expect(first.coverage.pages_read).toBe(0);
    expect(first.next_cursor).not.toBeNull();
    const second = await stub.continue(first.next_cursor!, Date.now() - 1);
    expect(second.status).toBe('paused');
    expect(second.next_cursor).not.toBe(first.next_cursor);
    expect(second.coverage.pages_read).toBe(0);
    expect(await stub.continue(first.next_cursor!, Date.now() - 1)).toEqual(second);
    expect(await stub.start(searchPlan, runId, Date.now() - 1)).toEqual(first);
  });

  it('keeps private bookmarks and presentations durable before a search is initialized', async () => {
    const owner = `owner-${crypto.randomUUID()}`;
    const stub = env.SEARCH_RUNS.getByName(`${owner}:library`);
    const bookmark = { run_id: 'saved-run', label: 'Cottagecore', note: 'Floral dresses', saved_at: observed };
    const presentation = { title: 'Shortlist', selection: [{ item_id: 'dress-1', reason: 'Floral pattern' }], page_size: 6 };
    await stub.saveBookmark(bookmark);
    await stub.storePresentation('selection-1', presentation);
    await evictDurableObject(stub);
    expect(await stub.listBookmarks(0, 1)).toEqual({ items: [bookmark], next_offset: null });
    expect(await stub.getPresentation('selection-1')).toEqual(presentation);
    const other = env.SEARCH_RUNS.getByName(`${owner}-other:library`);
    expect(await other.listBookmarks(0, 10)).toEqual({ items: [], next_offset: null });
    expect(await other.getPresentation('selection-1')).toBeNull();
    expect(await rejectionMessage(() => stub.storePresentation('selection-1', { ...presentation, title: 'Changed' }))).toContain('different selection');
  });
});
