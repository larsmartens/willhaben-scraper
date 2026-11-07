import { env } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ProviderPageRequest, RequestContext } from '../src/domain.js';
import { createSellpyProvider } from '../src/sellpy/client.js';
import { SERVICE_PATHS, SIMILAR_BRANDS_URL } from '../src/sellpy/config.js';
import { createProviderContext } from '../src/traffic.js';
import { observationShardName, publicObservationKey, withoutObservationCache } from '../src/provider-cache.js';
import fixtureItem from './fixtures/provider/item.json';
import fixtureDetail from './fixtures/provider/detail.json';

const locale = (language: string) => ({ applicationId: 'TEST12345', searchKey: 'public-fixture-key',
  marketItemIndexRelevance: `${language}_relevance`, marketItemIndexSaleStartDescending: `${language}_newest`,
  marketItemIndexPriceAscending: `${language}_price_asc`, marketItemIndexPriceDescending: `${language}_price_desc` });
const names: Record<string, string> = { semantic: 'similarItemsByText', similar: 'similarItems', image: 'similarItemsFromImage', upload: 'similarItemsFromUserImage', outfit: 'complementaryItems' };
const config = { algolia: { locales: { de: locale('de'), en: locale('en') } },
  parse: { applicationId: 'public-fixture-app' }, apollo: { uri: 'https://sellpy-parse-prod.herokuapp.com/graphql' },
  ml: { ...Object.fromEntries(Object.entries(SERVICE_PATHS).map(([route, path]) => [names[route], { url: `https://services.sellpy.net${path}`, key: 'public-fixture-key' }])),
    similarBrands: { url: SIMILAR_BRANDS_URL, key: 'public-fixture-key' } } };
const configUrl = 'https://www.sellpy.com/market/config.prod.cache-fixture.bundle.js';
const configSource = `var config=${JSON.stringify(config).replace(/"([A-Za-z_][A-Za-z_0-9]*)":/g, '$1:')};export{config};`;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

function sourceContext(itemId = fixtureItem.objectID, graphFailure = false) {
  const calls = { config: 0, catalog: 0, objects: 0, graph: 0, brands: 0, facets: 0 };
  const context = { ...createProviderContext(env as Env, Date.now() + 20_000), fetch: (async (input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://www.sellpy.com/search') { calls.config++; return new Response(`<link href="${configUrl}">`); }
    if (url === configUrl) { calls.config++; return new Response(configSource); }
    if (url === SIMILAR_BRANDS_URL) { calls.brands++; return json([[{ brand: 'Arket', objectid: 'brand-1', score: 0.75 }]]); }
    const item = { ...fixtureItem, objectID: itemId, price_DE: fixtureItem.price_AT };
    if (url.endsWith('/objects')) { calls.objects++; return json({ results: [item] }); }
    if (url.includes('/graphql')) {
      calls.graph++;
      if (graphFailure) return json({ data: { item0: null }, errors: [{ path: ['item0'], message: 'controlled failure' }] });
      return json({ data: { item0: { ...fixtureDetail, objectId: itemId,
        photos: fixtureDetail.photos.map(photo => ({ value: photo })) } } });
    }
    const body = JSON.parse(String(init.body)) as { requests: { page: number; hitsPerPage: number }[] };
    const request = body.requests[0]!;
    if (request.hitsPerPage === 0) { calls.facets++; return json({ results: [{ facets: { 'metadata.brand': { Cellbes: 1 } }, nbHits: 1 }] }); }
    calls.catalog++;
    // Keep the lease active long enough for three other real request contexts
    // to reach the coordinating Durable Object while the source is in flight.
    await new Promise<void>(resolve => setTimeout(resolve, 80));
    return json({ results: [{ hits: [item], page: request.page, hitsPerPage: request.hitsPerPage, nbHits: 20, nbPages: 10 }] });
  }) as typeof fetch };
  return { context, calls };
}

function request(query: string, armId = 'catalog'): ProviderPageRequest {
  return { market: 'AT', language: 'de', arm: { id: armId, route: 'catalog', query, filters: { price_min: 1 } }, offset: 0, page_size: 2 };
}

describe('public observations through actual Workers RPC and separate request contexts', () => {
  it('four cold provider calls in four distinct DO requests make one catalog request and persist source time across eviction', async () => {
    const query = `private-query-${crypto.randomUUID()}`;
    const inputs = Array.from({ length: 4 }, (_, index) => request(query, `local-arm-${index}`));
    const results = await Promise.all(inputs.map(input => runInDurableObject(env.ORIGIN_GATE.getByName(`caller:${crypto.randomUUID()}`), async () => {
      const { context, calls } = sourceContext();
      return { page: await createSellpyProvider().search(input, context), calls };
    })));
    expect(results.reduce((sum, result) => sum + result.calls.catalog, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.calls.config, 0)).toBe(2);
    for (const result of results) expect(result.page).toEqual(results[0]!.page);
    expect(results[0]!.page.items).toHaveLength(1);
    const { id: _armId, ...arm } = inputs[0]!.arm;
    const key = await publicObservationKey('search', { ...inputs[0]!, arm });
    const gate = env.ORIGIN_GATE.getByName(observationShardName(key));
    const saved = await runInDurableObject(gate, async (_instance, state) => {
      const row = state.storage.sql.exec<{key:string;value_json:string;expires_at:number}>('SELECT key,value_json,expires_at FROM public_observations WHERE key=?', key).one();
      return { ...row, alarm: await state.storage.getAlarm() };
    });
    expect(saved.key).not.toContain(query);
    expect(saved.value_json).not.toContain(query);
    expect(JSON.parse(saved.value_json)).not.toHaveProperty('applied_filters');
    expect(saved.expires_at).toBe(Date.parse(results[0]!.page.observed_at) + 15_000);
    expect(saved.alarm).not.toBeNull();
    await evictDurableObject(gate);
    const recovered = await runInDurableObject(env.ORIGIN_GATE.getByName(`caller:${crypto.randomUUID()}`), async () => {
      const { context, calls } = sourceContext();
      return { page: await createSellpyProvider().search(request(query, 'new-arm'), context), calls };
    });
    expect(recovered.calls.catalog).toBe(0);
    expect(recovered.calls.config).toBe(0);
    expect(recovered.page).toEqual(results[0]!.page);
  });

  it('market, pagination and hard filters do not share observations; an explicit refresh invokes the source', async () => {
    const query = `isolation-${crypto.randomUUID()}`, base = request(query);
    const variants = [base, { ...base, market: 'DE' }, { ...base, offset: 2 },
      { ...base, arm: { ...base.arm, filters: { price_min: 2 } } }];
    const results = await Promise.all(variants.map(input => runInDurableObject(env.ORIGIN_GATE.getByName(`caller:${crypto.randomUUID()}`), async () => {
      const { context, calls } = sourceContext();
      const page = await createSellpyProvider().search(input, context);
      return { page, calls };
    })));
    expect(results.reduce((sum, result) => sum + result.calls.catalog, 0)).toBe(4);
    expect(results[1]!.page.items[0]!.market).toBe('DE');
    const refreshed = await runInDurableObject(env.ORIGIN_GATE.getByName(`caller:${crypto.randomUUID()}`), async () => {
      const { context, calls } = sourceContext();
      await createSellpyProvider().search(base, withoutObservationCache(context));
      return calls;
    });
    expect(refreshed.catalog).toBe(1);
  });

  it('details cache only a complete canonical result; failed partial batches remain fresh on retry', async () => {
    const itemId = `cache-${crypto.randomUUID()}`;
    const result = await runInDurableObject(env.ORIGIN_GATE.getByName(`caller:${crypto.randomUUID()}`), async () => {
      const failed = sourceContext(itemId, true), provider = createSellpyProvider();
      const one = await provider.details([itemId], 'AT', 'de', failed.context);
      const two = await provider.details([itemId], 'AT', 'de', failed.context);
      const complete = sourceContext(itemId);
      const three = await provider.details([itemId], 'AT', 'de', complete.context);
      const four = await provider.details([itemId], 'AT', 'de', complete.context);
      const five = await provider.details([itemId], 'AT', 'de', withoutObservationCache(complete.context));
      return { one, two, three, four, five, failed: failed.calls, complete: complete.calls };
    });
    expect(result.one.failures).toHaveLength(1);
    expect(result.two.failures).toHaveLength(1);
    expect(result.failed.graph).toBe(2);
    expect(result.failed.objects).toBe(2);
    expect(result.three.failures).toHaveLength(0);
    expect(result.four).toEqual(result.three);
    expect(result.complete.graph).toBe(2);
    expect(result.complete.objects).toBe(2);
    expect(result.five.failures).toHaveLength(0);
  });

  it('facets and native brand observations reuse complete results without retaining seed echoes', async () => {
    const query = `facets-${crypto.randomUUID()}`, seed = `seed-${crypto.randomUUID()}`;
    const result = await runInDurableObject(env.ORIGIN_GATE.getByName(`caller:${crypto.randomUUID()}`), async () => {
      const { context, calls } = sourceContext(), provider = createSellpyProvider();
      const facets = await provider.facets(query, {}, 'AT', 'de', context);
      const facetsAgain = await provider.facets(query, {}, 'AT', 'de', context);
      const input = { brands: [seed], limit: 10, market: 'AT', language: 'de' };
      const brands = await provider.similarBrands(input, context), brandsAgain = await provider.similarBrands(input, context);
      return { facets, facetsAgain, brands, brandsAgain, calls };
    });
    expect(result.facetsAgain).toEqual(result.facets);
    expect(result.brandsAgain).toEqual(result.brands);
    expect(result.calls.facets).toBe(1);
    expect(result.calls.brands).toBe(1);
    const key = await publicObservationKey('brands', { brands: [seed], limit: 10, market: 'AT', language: 'de' });
    const saved = await env.ORIGIN_GATE.getByName(observationShardName(key)).claimObservation(key, 'inspect', 1000);
    expect(saved.state).toBe('cached');
    if (saved.state === 'cached') { expect(saved.value_json).not.toContain(seed); expect(JSON.parse(saved.value_json)).not.toHaveProperty('seed_brands'); }
  });

  it('RPC leases recover after expiry, reject stale commits and preserve the existing cooldown/pacing gate', async () => {
    const key = await publicObservationKey('search', { nonce: crypto.randomUUID() });
    const gate = env.ORIGIN_GATE.getByName(observationShardName(key));
    expect((await gate.claimObservation(key, 'old-owner', 5000)).state).toBe('owner');
    expect((await gate.claimObservation(key, 'new-owner', 5000)).state).toBe('waiting');
    await runInDurableObject(gate, async (_instance, state) => {
      state.storage.sql.exec('UPDATE public_observation_leases SET expires_at=? WHERE key=?', Date.now() - 1, key);
    });
    expect((await gate.claimObservation(key, 'new-owner', 5000)).state).toBe('owner');
    const expiry = Date.now() + 10_000;
    expect(await gate.commitObservation(key, 'old-owner', '{"stale":true}', expiry)).toBe(false);
    await gate.releaseObservation(key, 'old-owner');
    expect(await gate.commitObservation(key, 'new-owner', '{"original":true}', expiry)).toBe(true);
    const pausedUntil = Date.now() + 8000;
    await gate.cooldown(pausedUntil);
    expect(await gate.cooldownUntil()).toBe(pausedUntil);
    expect((await gate.reserve(Date.now(), 350, Date.now() + 1000)).granted).toBe(false);
    // A completed, still-fresh observation can be read without source traffic
    // even while the same gate records an origin cooldown.
    expect((await gate.claimObservation(key, 'reader', 1000)).state).toBe('cached');
    await evictDurableObject(gate);
    expect(await gate.cooldownUntil()).toBe(pausedUntil);
    const cached = await gate.claimObservation(key, 'reader', 1000);
    expect(cached).toEqual({ state: 'cached', value_json: '{"original":true}', expires_at: expiry });
  });

  it('private upload references bypass the shared port before any key or lease is created', async () => {
    const result = await runInDurableObject(env.ORIGIN_GATE.getByName(`caller:${crypto.randomUUID()}`), async () => {
      let claims = 0;
      const { context } = sourceContext();
      const privateContext: RequestContext & { observation_cache: NonNullable<typeof context.observation_cache> } = {
        ...context,
        observation_cache: { claim: async () => { claims++; throw new Error('private reference reached cache'); },
          commit: async () => false, release: async () => {} },
        read_reference: async () => null,
      };
      try { await createSellpyProvider().search({ ...request(''), arm: { id: 'upload', route: 'upload', reference: { download_url: 'https://files.chatgpt.com/private', file_id: 'private' } } }, privateContext); }
      catch { /* A missing retained file is expected; it must not be cached. */ }
      return claims;
    });
    expect(result).toBe(0);
  });
});
