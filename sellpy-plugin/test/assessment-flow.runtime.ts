import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemObservation, SearchIntent } from '../src/domain.js';
import type { RankingRequirement } from '../src/refinement.js';

const source = vi.hoisted(() => ({ ready: new Set<string>() }));
vi.mock('../src/traffic.js', () => ({
  createProviderContext: (_env: unknown, deadline: number, signal?: AbortSignal) => ({
    deadline, signal,
    fetch: async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!source.ready.has(url)) return new Response('Controlled unavailable photograph', { status: 503 });
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLF8AAAAASUVORK5CYII=';
      return new Response(Uint8Array.from(atob(png), value => value.charCodeAt(0)), { headers: { 'content-type': 'image/png' } });
    },
  }),
}));
import { invokeTool } from '../src/tools.js';

const intent: SearchIntent = { query: 'cottagecore', desired_type: 'dress', style: 'Cottagecore',
  include: ['Long sleeves'], exclude: ['Transparent panels'] };
const requirements: RankingRequirement[] = [
  { requirement: 'Garment type: dress', priority: 'require' },
  { requirement: 'Style: Cottagecore', priority: 'require' },
  { requirement: 'Long sleeves', priority: 'require' },
  { requirement: 'Transparent panels', priority: 'avoid' },
];
type AssessmentContext = {
  run_id: string; item_id: string; delivered_image_ids: string[];
  requirements_scope: string; requirements: RankingRequirement[]; next_tool: string; next_action: string;
};

async function fixture(searchIntent = intent) {
  const principal = `assessment-handoff-${crypto.randomUUID()}`, run_id = crypto.randomUUID();
  const stub = env.SEARCH_RUNS.getByName(`${principal}:${run_id}`);
  await stub.start({ market: 'AT', language: 'de', page_size: 10, intent: searchIntent, arms: [] }, run_id);
  const item: ItemObservation = { id: 'visual-item', market: 'AT', language: 'de', url: 'https://www.sellpy.at/item/visual-item',
    title: 'Controlled garment', brand: null, price: { amount_minor: 1500, currency: 'EUR' }, original_price: null,
    size: 'M', size_system: 'INT', condition: 'Good', categories: ['Underwear'], colors: [], materials: [],
    measurements: {}, description: null, defects: [], availability: 'available', source: 'detail',
    observed_at: new Date().toISOString(), attributes: {},
    images: ['front', 'back', 'detail'].map((name, index) => ({ id: `visual-${name}`, index,
      url: `https://prod.images.sellpy.net/visual-${name}.png` })) };
  await stub.updateItems([item]);
  const context = { env: env as Env, principal, deadline: Date.now() + 30_000 };
  return { stub, item, run_id, context };
}

beforeEach(() => { source.ready.clear(); });

describe('visual assessment handoff through actual Workers RPC', () => {
  it('returns exact intent criteria and only this batch’s successful model images without manufacturing a judgment', async () => {
    const { stub, item, run_id, context } = await fixture();
    await stub.markImagesDelivered(item.id, [item.images[0]!.id]);
    source.ready.add(item.images[1]!.url);
    const result = await invokeTool('get_item_images', { run_id, item_id: item.id, start_index: 1, batch_size: 2 }, context);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ item_id: item.id, failed_indices: [2],
      images: [{ id: 'visual-back', status: 'ready' }, { id: 'visual-detail', status: 'failed' }] });
    expect(result.content.filter(value => value.type === 'image')).toHaveLength(1);
    expect(result._meta?.images).toEqual({});
    expect(result.structuredContent?.assessment_context).toMatchObject({ run_id, item_id: item.id,
      delivered_image_ids: ['visual-back'], requirements_scope: 'search_intent_only', requirements,
      next_tool: 'record_visual_assessment' });
    const handoff = result.structuredContent!.assessment_context as AssessmentContext;
    expect(handoff).not.toHaveProperty('checked_image_ids');
    expect(handoff).not.toHaveProperty('requirement_results');
    expect(handoff.next_action).toMatch(/inspect/i);
    expect((await stub.getCandidates([item.id]))[0]!.assessment).toBeNull();
    const refined = await invokeTool('refine_search', { run_id, use_profile: false, preferences: { unknown_policy: 'exclude' } }, context);
    expect(refined.structuredContent).toMatchObject({ preferences: { requirements: handoff.requirements },
      items: [], coverage: { unknown: 1 } });
  });

  it('widget-only image loading cannot create a model handoff or authorize an assessment', async () => {
    const { stub, item, run_id, context } = await fixture();
    source.ready.add(item.images[0]!.url);
    const result = await invokeTool('get_item_images', { run_id, item_id: item.id, batch_size: 1, for_model: false }, context);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).not.toHaveProperty('assessment_context');
    expect(result.content.filter(value => value.type === 'image')).toHaveLength(0);
    expect(Object.keys(result._meta?.images as object)).toEqual(['visual-front']);
    const record = await invokeTool('record_visual_assessment', { run_id, item_id: item.id, checked_image_ids: ['visual-front'],
      observed_type: 'dress', matching_features: [], mismatches: [], uncertainties: [], requirement_results: [] }, context);
    expect(record.isError).toBe(true);
    expect(record.structuredContent).toMatchObject({ error: { code: 'visual_evidence_missing' } });
    expect((await stub.getCandidates([item.id]))[0]!.assessment).toBeNull();
  });

  it('failed-only model batches request inspection or retry instead of recording empty or invented evidence', async () => {
    const { stub, item, run_id, context } = await fixture();
    const result = await invokeTool('get_item_images', { run_id, item_id: item.id, batch_size: 2 }, context);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ failed_indices: [0, 1], next_index: 2,
      assessment_context: { run_id, item_id: item.id, delivered_image_ids: [], requirements_scope: 'search_intent_only',
        requirements, next_tool: 'get_item_images' } });
    expect(result.content.filter(value => value.type === 'image')).toHaveLength(0);
    expect((result.structuredContent!.assessment_context as AssessmentContext).next_action).toMatch(/retry|another|remaining/i);
    expect((await stub.getCandidates([item.id]))[0]!.assessment).toBeNull();
  });

  it('labels image criteria as search intent without replacing explicit refinement overrides or claiming profile completeness', async () => {
    const { item, run_id, context } = await fixture();
    const profileRequirements: RankingRequirement[] = [{ requirement: 'Lace collar', priority: 'prefer' }];
    await invokeTool('set_preferences', { profile: 'technical-test', preferences: { requirements: profileRequirements } }, context);
    const inherited = await invokeTool('refine_search', { run_id, profile: 'technical-test' }, context);
    expect(inherited.structuredContent).toMatchObject({ preferences: { requirements: [...profileRequirements, ...requirements] } });
    const overridden = [{ requirement: 'Long hem', priority: 'require' }];
    const refined = await invokeTool('refine_search', { run_id, profile: 'technical-test', preferences: { requirements: overridden } }, context);
    expect(refined.structuredContent).toMatchObject({ preferences: { requirements: overridden } });
    source.ready.add(item.images[0]!.url);
    const images = await invokeTool('get_item_images', { run_id, item_id: item.id, batch_size: 1 }, context);
    expect(images.structuredContent).toMatchObject({ assessment_context: { requirements_scope: 'search_intent_only', requirements } });
    const action = (images.structuredContent!.assessment_context as AssessmentContext).next_action;
    expect(action).toMatch(/refinement|profile/i);
  });
});
