import { env } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ItemObservation, SearchPlan } from '../src/domain.js';
import { invokeTool } from '../src/tools.js';

function context(principal: string) { return { env: env as Env, principal, deadline: Date.now() + 30_000 }; }
const observed = '2026-11-07T00:00:00Z';
function item(id: string, extra: Partial<ItemObservation> = {}): ItemObservation {
  return { id, market: 'AT', language: 'de', url: `https://www.sellpy.at/item/${id}`, title: `Dress ${id}`, brand: 'Example',
    price: { amount_minor: 2500, currency: 'EUR' }, original_price: null, size: 'WMN-INT-M', size_system: 'WMN-INT',
    condition: 'Gut', categories: ['Kleider'], colors: ['Grün'], materials: ['Cotton'], measurements: { waistInCm: 38 },
    description: null, defects: [], images: [{ id: `${id}-front`, index: 0, url: `https://prod.images.sellpy.net/${id}.jpg` },
      { id: `${id}-back`, index: 1, url: `https://prod.images.sellpy.net/${id}-back.jpg` }],
    availability: 'available', observed_at: observed, source: 'detail', attributes: {}, ...extra };
}
const plan: SearchPlan = { market: 'AT', language: 'de', page_size: 2, intent: { query: 'dress' }, arms: [] };

describe('research tools through actual Workers RPC', () => {
  it('inherits the market currency even when the first candidate has no source price', async () => {
    const principal = `currency-${crypto.randomUUID()}`;
    const run_id = crypto.randomUUID();
    const stub = env.SEARCH_RUNS.getByName(`${principal}:${run_id}`);
    await stub.start({ ...plan, arms: [{ id: 'catalog', route: 'catalog', filters: { price_max: 30 } }] }, run_id, Date.now() - 1);
    await stub.updateItems([item('missing-price', { price: null, availability: 'unknown' }), item('known-price')]);
    const result = await invokeTool('refine_search', { run_id, use_profile: false }, context(principal));
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ preferences: { currency: 'EUR', price_max: 30 }, coverage: { eligible: 2 } });
    const data = result.structuredContent as { items: { id: string; evaluation: { eligibility: string } }[] };
    expect(data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'known-price', evaluation: expect.objectContaining({ eligibility: 'pass' }) }),
      expect.objectContaining({ id: 'missing-price', evaluation: expect.objectContaining({ eligibility: 'unknown' }) }),
    ]));
  });

  it('retains native hard facets after canonical size and material changes', async () => {
    const principal = `facets-${crypto.randomUUID()}`;
    const run_id = crypto.randomUUID();
    const stub = env.SEARCH_RUNS.getByName(`${principal}:${run_id}`);
    const facets = { 'metadata.size': ['WMN-INT-M'], 'metadata.material': ['Cotton'], 'metadata.pattern': ['Floral'] };
    await stub.start({ ...plan, arms: [{ id: 'catalog', route: 'catalog', filters: { facets } }] }, run_id, Date.now() - 1);
    await stub.updateItems([item('changed', { attributes: { pattern: 'Floral' } }), item('matching', { attributes: { pattern: 'Floral' } })]);
    await stub.updateItems([item('changed', { size: 'WMN-INT-L', materials: ['Polyester'], attributes: { pattern: 'Floral' }, observed_at: '2026-11-07T01:00:00Z' })]);
    const result = await invokeTool('refine_search', { run_id, use_profile: false }, context(principal));
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ preferences: { source_facets: facets },
      items: [{ id: 'matching', evaluation: { eligibility: 'pass' } }], coverage: { excluded: 1 } });
    const cleared = await invokeTool('refine_search', { run_id, use_profile: false, preferences: { source_facets: {} } }, context(principal));
    expect(cleared.structuredContent).toMatchObject({ coverage: { eligible: 2 } });
  });

  it('keeps the intended garment type as an explicit unresolved criterion until photo evidence answers it', async () => {
    const principal = `garment-${crypto.randomUUID()}`;
    const run_id = crypto.randomUUID();
    const stub = env.SEARCH_RUNS.getByName(`${principal}:${run_id}`);
    await stub.start({ ...plan, intent: { query: 'cottagecore', desired_type: 'dress', style: 'Cottagecore' } }, run_id);
    await stub.updateItems([item('blouse')]);
    await stub.markImagesDelivered('blouse', ['blouse-front']);
    const assessment = { item_id: 'blouse', author: 'assistant' as const, assessed_at: observed, checked_image_ids: ['blouse-front'],
      observed_type: 'blouse', matching_features: [], mismatches: [], uncertainties: [], requirement_results: [] };
    await stub.recordAssessment(assessment);
    const unknown = await invokeTool('refine_search', { run_id }, context(principal));
    expect(unknown.structuredContent).toMatchObject({ preferences: { requirements: [{ requirement: 'Garment type: dress', priority: 'require' }, { requirement: 'Style: Cottagecore', priority: 'require' }] },
      items: [{ id: 'blouse', evaluation: { eligibility: 'unknown' } }] });
    await stub.recordAssessment({ ...assessment, requirement_results: [{ requirement: 'Garment type: dress', verdict: 'contradicted', evidence: 'Controlled blouse fixture.' }] });
    const excluded = await invokeTool('refine_search', { run_id }, context(principal));
    expect(excluded.structuredContent).toMatchObject({ items: [], coverage: { excluded: 1 } });
  });

  it('persists named preferences and item feedback with owner isolation and real constraint refinement', async () => {
    const principal = `research-${crypto.randomUUID()}`;
    const run_id = crypto.randomUUID();
    const stub = env.SEARCH_RUNS.getByName(`${principal}:${run_id}`);
    await stub.start(plan, run_id);
    await stub.updateItems([item('yes'), item('unknown'), item('no')]);
    for (const [id, verdict] of [['yes', 'confirmed'], ['no', 'contradicted']] as const) {
      await stub.markImagesDelivered(id, [`${id}-back`]);
      await stub.recordAssessment({ item_id: id, author: 'assistant', assessed_at: observed, checked_image_ids: [`${id}-back`],
        observed_type: 'dress', matching_features: [], mismatches: [], uncertainties: [],
        requirement_results: [{ requirement: 'long sleeves', verdict, evidence: 'Controlled original-photo fixture.' }] });
    }
    const saved = await invokeTool('set_preferences', { profile: 'test', preferences: {
      currency: 'EUR', price_max: 30, sizes: ['WMN-INT-M'], unknown_policy: 'exclude', requirements: [{ requirement: 'long sleeves', priority: 'require' }],
    } }, context(principal));
    expect(saved.isError).not.toBe(true);
    const other = await invokeTool('get_preferences', { profile: 'test' }, context(`${principal}-other`));
    expect(other.structuredContent).toEqual({ profile: null });
    const first = await invokeTool('refine_search', { run_id, profile: 'test' }, context(principal));
    expect(first.isError).not.toBe(true);
    expect((first.structuredContent as { items: { id: string; image_count: number }[] }).items).toMatchObject([{ id: 'yes', image_count: 2 }]);
    const feedback = await invokeTool('set_item_feedback', { run_id, item_id: 'yes', decision: 'reject' }, context(principal));
    expect(feedback.structuredContent).toMatchObject({ run_id, item_id: 'yes', feedback: { item_id: 'yes', decision: 'reject' } });
    expect(await stub.getFeedback(['yes'])).toMatchObject({ yes: { item_id: 'yes', decision: 'reject' } });
    expect(await stub.getFeedback([])).toEqual({});
    await evictDurableObject(stub);
    const second = await invokeTool('refine_search', { run_id, profile: 'test' }, context(principal));
    expect(second.structuredContent).toMatchObject({ items: [], coverage: { excluded: 3 } });
    const listed = await invokeTool('list_item_feedback', { run_id, decision: 'reject' }, context(principal));
    expect(listed.structuredContent).toMatchObject({ items: [{ item_id: 'yes', decision: 'reject' }] });
    const isolated = await invokeTool('list_item_feedback', { run_id }, context(`${principal}-other`));
    expect(isolated.isError).toBe(true);
    expect(isolated.structuredContent).toMatchObject({ error: { code: 'search_not_found' } });
  });

  it('uses explicit preference overrides and preserves refinement replay after feedback changes', async () => {
    const principal = `override-${crypto.randomUUID()}`;
    const run_id = crypto.randomUUID();
    const stub = env.SEARCH_RUNS.getByName(`${principal}:${run_id}`);
    await stub.start(plan, run_id);
    await stub.updateItems([item('low', { price: { amount_minor: 1000, currency: 'EUR' } }), item('high', { price: { amount_minor: 2000, currency: 'EUR' } }), item('last')]);
    await invokeTool('set_preferences', { preferences: { currency: 'EUR', price_max: 15 } }, context(principal));
    const first = await invokeTool('refine_search', { run_id, preferences: { price_max: 30, mode: 'price_low' }, page_size: 1 }, context(principal));
    const firstData = first.structuredContent as { items: { id: string }[]; next_cursor: string };
    expect(firstData.items.map(value => value.id)).toEqual(['low']);
    const second = await invokeTool('refine_search', { run_id, cursor: firstData.next_cursor }, context(principal));
    expect((second.structuredContent as { items: { id: string }[] }).items.map(value => value.id)).toEqual(['high']);
    await invokeTool('set_item_feedback', { run_id, item_id: 'high', decision: 'reject' }, context(principal));
    const replay = await invokeTool('refine_search', { run_id, cursor: firstData.next_cursor }, context(principal));
    expect(replay.structuredContent).toEqual(second.structuredContent);
    const changed = await invokeTool('refine_search', { run_id, cursor: firstData.next_cursor, preferences: { price_max: 100 } }, context(principal));
    expect(changed.isError).toBe(true);
    expect(changed.structuredContent).toMatchObject({ error: { code: 'immutable_refinement' } });
  });

  it('reports observed price/status history and deletes references with a durable tombstone', async () => {
    const principal = `delete-${crypto.randomUUID()}`;
    const run_id = crypto.randomUUID();
    const stub = env.SEARCH_RUNS.getByName(`${principal}:${run_id}`);
    await stub.storeReference('test-file', new Uint8Array([255, 216, 255, 217]), 'image/jpeg', 'test.jpg');
    await stub.start(plan, run_id);
    await stub.updateItems([item('tracked')]);
    const changed = await stub.updateItems([item('tracked', { price: { amount_minor: 1900, currency: 'EUR' }, availability: 'reserved', observed_at: '2026-11-07T01:00:00Z' })]);
    expect(changed).toMatchObject([{ item_id: 'tracked', changes: [
      { field: 'price', previous: { amount_minor: 2500, currency: 'EUR' }, current: { amount_minor: 1900, currency: 'EUR' } },
      { field: 'availability', previous: 'available', current: 'reserved' },
    ] }]);
    const history = await invokeTool('get_item_history', { run_id, item_id: 'tracked', page_size: 1 }, context(principal));
    const historyData = history.structuredContent as { observations: unknown[]; next_after: number };
    expect(historyData.observations).toHaveLength(1);
    const next = await invokeTool('get_item_history', { run_id, item_id: 'tracked', after: historyData.next_after }, context(principal));
    expect(next.structuredContent).toMatchObject({ observations: [{ availability: 'reserved', price: { amount_minor: 1900 } }], next_after: null });
    await invokeTool('save_search', { run_id, label: 'Disposable runtime fixture' }, context(principal));
    await invokeTool('set_preferences', { preferences: { currency: 'EUR' } }, context(principal));
    const deleted = await invokeTool('forget_search', { run_id }, context(principal));
    expect(deleted.structuredContent).toEqual({ run_id, deleted: true });
    expect((await invokeTool('forget_search', { run_id }, context(principal))).isError).not.toBe(true);
    await evictDurableObject(stub);
    const forgotten = await invokeTool('get_search_status', { run_id }, context(principal));
    expect(forgotten.structuredContent).toMatchObject({ error: { code: 'search_forgotten' } });
    const counts = await runInDurableObject(stub, async (_instance, state) => ({
      references: state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM reference_chunks').one().n,
      history: state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM item_observations').one().n,
      candidates: state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM candidates').one().n,
    }));
    expect(counts).toEqual({ references: 0, history: 0, candidates: 0 });
    expect((await invokeTool('list_saved_searches', {}, context(principal))).structuredContent).toMatchObject({ items: [] });
    expect((await invokeTool('get_preferences', {}, context(principal))).structuredContent).toMatchObject({ profile: { preferences: { currency: 'EUR' } } });
  });

  it('restarts an image search from retained bytes even after the original download URL expires', async () => {
    const principal = `refresh-${crypto.randomUUID()}`;
    const run_id = crypto.randomUUID();
    const stub = env.SEARCH_RUNS.getByName(`${principal}:${run_id}`);
    const bytes = new Uint8Array([255, 216, 255, 217]);
    await stub.storeReference('private-reference', bytes, 'image/jpeg', 'reference.jpg');
    const imagePlan: SearchPlan = { ...plan, arms: [{ id: 'upload', route: 'upload', reference: { file_id: 'private-reference', download_url: 'https://example.invalid/expired' } }] };
    await stub.start(imagePlan, run_id, Date.now() - 1);
    const inherited = await invokeTool('refresh_search', { run_id }, { ...context(principal), deadline: Date.now() - 1 });
    expect(inherited.isError).not.toBe(true);
    const inheritedRun = env.SEARCH_RUNS.getByName(`${principal}:${(inherited.structuredContent as { run_id: string }).run_id}`);
    expect((await inheritedRun.status()).plan).toMatchObject({ page_size: imagePlan.page_size, refresh_of: run_id });
    const refreshed = await invokeTool('refresh_search', { run_id, page_size: 7 }, { ...context(principal), deadline: Date.now() - 1 });
    expect(refreshed.isError).not.toBe(true);
    expect(refreshed.structuredContent).toMatchObject({ refresh_comparison: { previous_run_id: run_id, newly_encountered_ids: [], previously_seen_ids: [] } });
    const data = refreshed.structuredContent as { run_id: string };
    expect(data.run_id).not.toBe(run_id);
    const fresh = env.SEARCH_RUNS.getByName(`${principal}:${data.run_id}`);
    expect((await fresh.getReference('private-reference'))?.bytes).toEqual(bytes);
    expect((await fresh.status()).plan).toMatchObject({ refresh_of: run_id, page_size: 7 });
    expect((await stub.getReference('private-reference'))?.bytes).toEqual(bytes);
  });
});
