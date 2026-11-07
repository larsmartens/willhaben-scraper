import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ToolError, type ProviderPageRequest, type RequestContext } from '../src/domain.js';
import { createSellpyProvider, sharedSellpyProvider } from '../src/sellpy/client.js';
import { createConfigLoader, parsePublicConfig, SERVICE_PATHS, VERIFIED_RELEASE } from '../src/sellpy/config.js';
import { algoliaFilterParams, effectiveFilters, imageIdentity, matchesFilters, nativeFilters, normalizeItem } from '../src/sellpy/normalize.js';

const item = JSON.parse(readFileSync(new URL('./fixtures/provider/item.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const detail = JSON.parse(readFileSync(new URL('./fixtures/provider/detail.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const itemId = item.objectID as string;
const sourceUrl = 'https://www.sellpy.com/market/config.prod.fixture.bundle.js';
const locale = (language: string) => ({ applicationId: 'TEST12345', searchKey: 'fixture-public-search-value',
  marketItemIndexRelevance: `${language}_relevance`, marketItemIndexSaleStartDescending: `${language}_newest`,
  marketItemIndexPriceAscending: `${language}_price_asc`, marketItemIndexPriceDescending: `${language}_price_desc`,
});
const serviceNames: Record<string, string> = { semantic: 'similarItemsByText', similar: 'similarItems', image: 'similarItemsFromImage', upload: 'similarItemsFromUserImage', outfit: 'complementaryItems' };
const configObject = { algolia: { locales: { en: locale('en'), de: locale('de') } },
  parse: { applicationId: 'fixture-public-application' }, apollo: { uri: 'https://sellpy-parse-prod.herokuapp.com/graphql' },
  ml: Object.fromEntries(Object.entries(SERVICE_PATHS).map(([route, path]) => [serviceNames[route], { url: `https://services.sellpy.net${path}`, key: `fixture-${route}-public-value` }])),
};
const configSource = `globalThis.SENTRY_RELEASE={id:\`${VERIFIED_RELEASE}\`};var config=${JSON.stringify(configObject).replace(/"([A-Za-z_][A-Za-z_0-9]*)":/g, '$1:')};export{config};`;

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function mockContext(handler: Handler): { context: RequestContext; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const context: RequestContext = { deadline: Date.now() + 60_000, fetch: (async (input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    if (url === 'https://www.sellpy.com/search') return new Response(`<link rel="modulepreload" href="${sourceUrl}">`);
    if (url === sourceUrl) return new Response(configSource);
    return handler(url, init);
  }) as typeof fetch };
  return { context, calls };
}

const input = (arm: ProviderPageRequest['arm'], extras: Partial<ProviderPageRequest> = {}): ProviderPageRequest => ({
  market: 'AT', language: 'de', arm, offset: 0, page_size: 2, ...extras,
});
const queryResponse = (hits: unknown[], page = 0, total = 100, pages = 2) => json({ results: [{ hits, page, hitsPerPage: 2, nbHits: total, nbPages: pages, exhaustiveNbHits: true }] });

test('current static first-party configuration parses without evaluating code or accepting changed endpoints', () => {
  const parsed = parsePublicConfig(configSource, sourceUrl);
  assert.deepEqual(Object.keys(parsed.services), ['semantic', 'similar', 'image', 'upload', 'outfit']);
  assert.equal(parsed.source_version, VERIFIED_RELEASE);
  assert.equal(parsed.locales.de?.indices.price_asc, 'de_price_asc');
  assert.throws(() => parsePublicConfig(configSource.replace('https://services.sellpy.net/similar-items-app/get-similar-by-text', 'https://attacker.invalid/collect'), sourceUrl), /endpoint changed/);
  assert.throws(() => parsePublicConfig(configSource.replace('searchKey:"fixture-public-search-value"', 'searchKey:globalThis.secret'), sourceUrl), /format has changed/);
  assert.throws(() => parsePublicConfig(configSource.replace('locales:{', 'locales:{__proto__:{},'), sourceUrl), /format has changed/);
});

test('configuration discovery recovers a retired asset through current SPA HTML and caches only success', async () => {
  const stale = 'https://www.sellpy.com/market/config.prod.retired.bundle.js';
  const calls: string[] = [];
  const context: RequestContext = { deadline: Date.now() + 60000, fetch: (async input => {
    const url = String(input); calls.push(url);
    if (url === 'https://www.sellpy.com/search') return new Response(`<link href="${stale}">`);
    if (url === stale) return new Response(`<!DOCTYPE html><link href="${sourceUrl}">`, { headers: { 'content-type': 'text/html' } });
    assert.equal(url, sourceUrl); return new Response(configSource);
  }) as typeof fetch };
  const load = createConfigLoader();
  const config = await load(context);
  assert.equal(config.source_url, sourceUrl);
  assert.equal(config.source_version, VERIFIED_RELEASE);
  assert.equal(await load(context), config);
  assert.deepEqual(calls, ['https://www.sellpy.com/search', stale, sourceUrl]);
});

test('configuration discovery terminates repeated HTML paths and never fetches an external asset', async () => {
  const calls: string[] = [];
  const context: RequestContext = { deadline: Date.now() + 60000, fetch: (async input => {
    calls.push(String(input));
    return new Response(`<!DOCTYPE html><link href="https://attacker.invalid/market/config.prod.evil.bundle.js"><link href="${sourceUrl}">`);
  }) as typeof fetch };
  await assert.rejects(createConfigLoader()(context), /could not be discovered/);
  assert.deepEqual(calls, ['https://www.sellpy.com/search', sourceUrl]);
});

test('configuration discovery reports malformed JavaScript without treating it as an HTML fallback', async () => {
  const calls: string[] = [];
  const context: RequestContext = { deadline: Date.now() + 60000, fetch: (async input => {
    calls.push(String(input));
    return new Response(calls.length === 1 ? `<link href="${sourceUrl}">` : 'var changedConfiguration = {};');
  }) as typeof fetch };
  await assert.rejects(createConfigLoader()(context), /algolia configuration is missing/);
  assert.equal(calls.length, 2);
});

test('normalization uses explicit market minor units, preserves literal images and strips private fields', () => {
  const raw = { ...item, user: 'sensitive-user', photographedBy: 'sensitive-staff', pricing: { amount: 999, currency: 'SEK' },
    metadata: { ...(item.metadata as object), privateNote: 'sensitive-note' } };
  const catalog = normalizeItem(raw, 'AT', 'de', '2026-11-06T00:00:00Z');
  assert.ok(catalog);
  assert.deepEqual(catalog.price, { amount_minor: 2400, currency: 'EUR' });
  assert.equal(catalog.original_price, null);
  assert.equal(catalog.images[0]?.url, (item.images as string[])[0]);
  const expanded = normalizeItem(raw, 'AT', 'de', '2026-11-06T00:01:00Z', detail);
  assert.ok(expanded);
  assert.equal(expanded.images.length, 5);
  assert.deepEqual(expanded.images.slice(0, 4).map((image) => image.id), catalog.images.map((image) => image.id));
  assert.equal(expanded.images[2]?.role, 'brand');
  assert.equal(expanded.images[4]?.url, (detail.photos as { url: string }[])[4]?.url);
  assert.ok(!JSON.stringify(expanded).includes('sensitive'));
  assert.equal(normalizeItem({ ...item, price_AT: undefined, price_SE: { amount: 100, currency: 'SEK' } }, 'AT', 'de', '')?.price, null);
  assert.equal(normalizeItem({ ...item, price_AT: { amount: 2400, currency: 'SEK' } }, 'AT', 'de', '')?.price, null);
  assert.notEqual(imageIdentity('https://prod.images.sellpy.net/a.jpg'), imageIdentity('https://prod.images.sellpy.net/b.jpg'));
  assert.equal(imageIdentity('https://prod.images.sellpy.net/a.jpg'), imageIdentity('https://prod.images.sellpy.net/a.jpg'));
});

test('hard-filter contracts preserve OR/NOT, price conversion, ranges and category relaxation', () => {
  const filters = effectiveFilters({ facets: { 'metadata.brand': ['Cellbes', '-Other'], 'metadata.type': ['Wrong label'], style: ['bohemian'] },
    price_min: 12.5, price_max: 25.99, measurements: { lengthInCm: { min: 85, max: 120 } }, include_reserved: false,
  }, true);
  assert.equal(filters.facets?.['metadata.type'], undefined);
  const params = algoliaFilterParams(filters, 'AT');
  assert.deepEqual(params.numericFilters, ['price_AT.amount>=1250', 'price_AT.amount<=2599', 'metadata.measurement.lengthInCm>=85', 'metadata.measurement.lengthInCm<=120']);
  assert.deepEqual(params.facetFilters, [['metadata.brand:Cellbes'], 'metadata.brand:-Other', ['style:bohemian']]);
  assert.equal(params.filters, 'price_AT.amount > 0 AND isReserved:false');
  const native = nativeFilters(filters, 'AT', 'de');
  assert.deepEqual(native.filters['price.EUR'], [12.5, 25.99]);
  assert.ok(native.post_filtered.includes('style'));
  assert.throws(() => effectiveFilters({ facets: { storageSite: ['private'] } }), /not a supported shopper filter/);
  assert.throws(() => effectiveFilters({ price_min: 10, price_max: 1 }), /minimum price/);
  assert.equal(matchesFilters({ ...item, isReserved: undefined }, { include_reserved: false }, 'AT'), false);
});

test('catalog calls current Algolia contract, caches only config data and distinguishes upstream window', async () => {
  const { context, calls } = mockContext((url, init) => {
    assert.ok(url.endsWith('/queries'));
    const body = JSON.parse(String(init.body)) as { requests: { indexName: string; page: number; numericFilters: string[] }[] };
    assert.equal(body.requests[0]?.indexName, 'de_price_asc');
    assert.deepEqual(body.requests[0]?.numericFilters, ['price_AT.amount<=5000']);
    return queryResponse([item, { ...item, objectID: 'second' }], body.requests[0]?.page);
  });
  const provider = createSellpyProvider();
  const arm = { id: 'catalog', route: 'catalog' as const, query: 'Blumenkleid', sort: 'price_asc' as const, filters: { price_max: 50 } };
  const first = await provider.search(input(arm), context);
  assert.equal(first.next_offset, 2); assert.equal(first.window, 4); assert.equal(first.total, 100);
  assert.deepEqual(first.ranks, { [itemId]: 1, second: 2 });
  const second = await provider.search(input(arm, { offset: 2 }), context);
  assert.equal(second.next_offset, null); assert.equal(second.end_reason, 'upstream_window');
  assert.equal(second.ranks?.[itemId], 3);
  assert.equal(calls.filter((call) => call.url === sourceUrl).length, 1);
  assert.equal(calls.filter((call) => call.url === 'https://www.sellpy.com/search').length, 1);
});

test('semantic native offsets advance over an empty localized post-filter page', async () => {
  const { context, calls } = mockContext((url, init) => {
    if (url.endsWith('/get-similar-by-text')) {
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.texts, ['cottagecore']); assert.equal(body.offset, 6); assert.equal(body.nItems, 2);
      assert.equal(body.filters, undefined, 'localized style values are not sent as English service filters');
      return json({ results: [{ text: 'cottagecore', items: [{ objectid: itemId, score: 7.1 }, { objectid: 'second', score: 6.8 }] }] });
    }
    if (url.endsWith('/objects')) return json({ results: [item, { ...item, objectID: 'second' }] });
    throw new Error(`Unexpected request ${url}`);
  });
  const result = await createSellpyProvider().search(input({ id: 'style', route: 'semantic', query: 'cottagecore', filters: { facets: { 'metadata.type': ['Unterhose'] } } }, { offset: 6 }), context);
  assert.equal(result.items.length, 0); assert.equal(result.next_offset, 8); assert.equal(result.end_reason, null);
  assert.ok(result.warnings.some((warning) => warning.includes('hydrated de')));
  assert.equal(calls.filter((call) => call.url.endsWith('/objects')).length, 1);
});

test('similar and source-image routes preserve source scores and absolute native ranks', async () => {
  for (const route of ['similar', 'image'] as const) {
    const url = (item.images as string[])[0]!;
    const { context } = mockContext((endpoint, init) => {
      if (endpoint.includes('services.sellpy.net')) {
        const body = JSON.parse(String(init.body));
        assert.equal(body.offset, 4); assert.equal(body.nItems, 2);
        assert.deepEqual(route === 'image' ? body.images : body.objectids, [route === 'image' ? url : 'seed']);
        return json({ results: [{ objectid: route === 'image' ? url : 'seed', items: [{ objectid: itemId, score: 4.5 }] }] });
      }
      return json({ results: [item] });
    });
    const result = await createSellpyProvider().search(input({ id: route, route, seed_ids: ['seed'], image_url: url }, { offset: 4 }), context);
    assert.equal(result.ranks?.[itemId], 5); assert.equal(result.scores?.[itemId], 4.5);
    assert.equal(result.end_reason, 'upstream_window'); assert.equal(result.window, 5);
  }
});

test('upload uses the private stored reference, multipart image and offset, and expects the observed ID array', async () => {
  const { context, calls } = mockContext((url, init) => {
    if (url.endsWith('/get-similar-user-image')) {
      assert.ok(init.body instanceof FormData);
      assert.equal(init.body.get('nItems'), '2'); assert.equal(init.body.get('offset'), '4');
      const image = init.body.get('image');
      assert.ok(image instanceof Blob); assert.equal(image.type, 'image/jpeg');
      assert.ok(!new Headers(init.headers).has('content-type'), 'fetch sets the multipart boundary');
      return json([itemId]);
    }
    if (url.endsWith('/objects')) return json({ results: [item] });
    throw new Error(`Unexpected reference download ${url}`);
  });
  let resolved = 0;
  context.read_reference = async () => { resolved++; return { bytes: new Uint8Array([255, 216, 255, 224, 0]), mime_type: 'image/jpeg', file_name: 'stored.jpg' }; };
  const result = await createSellpyProvider().search(input({ id: 'upload', route: 'upload', reference: { download_url: 'https://expired.example/ref', file_id: 'file-reference' } }, { offset: 4 }), context);
  assert.equal(resolved, 1); assert.equal(result.items.length, 1); assert.equal(result.ranks?.[itemId], 5);
  assert.equal(result.end_reason, 'upstream_window');
  assert.ok(calls.every((call) => !call.url.includes('expired.example')));
});

test('outfit uses public English metadata and the distinct native auth header, with no invented cursor', async () => {
  const { context } = mockContext((url, init) => {
    if (url.includes('/graphql')) return json({ data: { item0: detail } });
    if (url.endsWith('/complementary-recommendations')) {
      assert.equal(new Headers(init.headers).get('COMPLEMENTARY-RECOMMENDATIONS-API-Key'), 'fixture-outfit-public-value');
      const body = JSON.parse(String(init.body));
      assert.equal(body.item_objectid, itemId); assert.equal(body.item_metadata_en.type, 'Maxi dress');
      assert.deepEqual(body.filters.demography, ['Women', 'Unisex (Adults)']);
      assert.equal(body.limit_per_part, 20); assert.equal(body.offset, undefined);
      return json({ success: true, data: { recommendations: [{ objectid: itemId }] } });
    }
    return json({ results: [item] });
  });
  const result = await createSellpyProvider().search(input({ id: 'outfit', route: 'outfit', seed_ids: [itemId] }), context);
  assert.equal(result.items.length, 1); assert.equal(result.next_offset, null); assert.equal(result.end_reason, 'upstream_window');
});

test('detail aliases merge catalog pricing and full photos, stripping raw employee fields', async () => {
  const { context } = mockContext((url, init) => {
    if (url.endsWith('/objects')) return json({ results: [item, null] });
    assert.ok(url.includes('/graphql'));
    const request = JSON.parse(String(init.body));
    assert.equal(request.variables.locale, 'de'); assert.equal(request.variables.id0, itemId); assert.equal(request.variables.id1, 'missing');
    assert.ok(request.query.includes('item0: getPdpItem(itemId: $id0)'));
    const photos = (detail.photos as Record<string, unknown>[]).map((photo) => ({ value: { ...photo, photographedBy: 'never-return-this', photographedIn: 'private-location' } }));
    return json({ data: { item0: { ...detail, photos }, item1: null } });
  });
  const result = await createSellpyProvider().details([itemId, 'missing', itemId], 'AT', 'de', context);
  assert.equal(result.items.length, 1); assert.equal(result.items[0]?.source, 'detail');
  assert.equal(result.items[0]?.images.length, 5); assert.equal(result.items[0]?.price?.amount_minor, 2400);
  assert.equal(result.failures[0]?.id, 'missing'); assert.equal(result.failures[0]?.error.code, 'item_not_found');
  assert.ok(!JSON.stringify(result).includes('never-return-this')); assert.ok(!JSON.stringify(result).includes('private-location'));
});

test('detail continuation preserves IDs not attempted when the deadline ends between batches', async () => {
  let context: RequestContext;
  ({ context } = mockContext((url, init) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith('/objects')) return json({ results: body.requests.map((entry: { objectID: string }) => ({ ...item, objectID: entry.objectID })) });
    context.deadline = 0;
    return json({ data: Object.fromEntries(Object.entries(body.variables).filter(([key]) => key.startsWith('id')).map(([key, id]) => [`item${key.slice(2)}`, { ...detail, objectId: id }])) });
  }));
  const result = await createSellpyProvider().details(Array.from({ length: 11 }, (_, index) => `id${index}`), 'AT', 'de', context);
  assert.equal(result.items.length, 10); assert.deepEqual(result.remaining_ids, ['id10']); assert.equal(result.failures.length, 0);
});

test('facets expose only shopper fields and explicitly convert the chosen market price range to base units', async () => {
  const { context } = mockContext(() => json({ results: [{ nbHits: 2, facets: {
    'metadata.type': { Maxikleid: 2 }, storageSite: { 'internal-site': 2 }, user: { 'internal-user': 1 },
  }, facets_stats: { 'price_AT.amount': { min: 2400, max: 4999 }, 'price_SE.amount': { min: 200, max: 300 },
    'metadata.measurement.lengthInCm': { min: 85, max: 120 }, internalNumeric: { min: 1, max: 9 },
  } }] }));
  const result = await createSellpyProvider().facets('', {}, 'AT', 'de', context);
  assert.deepEqual(result.facets, { 'metadata.type': { Maxikleid: 2 } });
  assert.deepEqual(result.numeric_facets, { 'price_AT.amount': { min: 24, max: 49.99 }, 'metadata.measurement.lengthInCm': { min: 85, max: 120 } });
});

test('HTTP rate limits stay retryable with a retry time and no raw response or public config keys', async () => {
  const { context } = mockContext(() => json({ secret: 'do-not-echo-this-body' }, 429, { 'retry-after': '30' }));
  await assert.rejects(createSellpyProvider().search(input({ id: 'catalog', route: 'catalog' }), context), (error: unknown) => {
    const failure = error as { code: string; retryable: boolean; retry_at: string; message: string };
    assert.equal(failure.code, 'rate_limited'); assert.equal(failure.retryable, true);
    assert.ok(Date.parse(failure.retry_at) > Date.now()); assert.ok(!failure.message.includes('do-not-echo'));
    return true;
  });
});

test('detail rate limits retain the source cooldown alongside unprocessed IDs', async () => {
  const { context } = mockContext(url => url.endsWith('/objects') ? json({results:[item]}) : json({},429,{'retry-after':'120'}));
  const started=Date.now();
  const result=await createSellpyProvider().details([itemId],'AT','de',context);
  assert.deepEqual(result.remaining_ids,[itemId]);
  assert.equal(result.failures[0]?.error.code,'rate_limited');
  assert.ok(Date.parse(result.failures[0]?.error.retry_at ?? '')>=started+120000);
  assert.equal(result.failures[0]?.error.retryable,true);
});

test('a still-indexed item missing from the canonical detail is not confirmed available', async () => {
  const { context } = mockContext(url => url.endsWith('/objects') ? json({results:[item]}) : json({data:{item0:null}}));
  const result=await createSellpyProvider().details([itemId],'AT','de',context);
  assert.equal(result.items[0]?.availability,'unknown');
  assert.equal(result.failures[0]?.error.code,'item_not_found');
});

test('default outfit pages use the verified native per-part window', async () => {
  const { context } = mockContext((url,init) => {
    if(url.includes('/graphql')) return json({data:{item0:detail}});
    if(url.endsWith('/complementary-recommendations')) {
      assert.equal(JSON.parse(String(init.body)).limit_per_part,20);
      return json({success:true,data:{recommendations:[{objectid:itemId}]}});
    }
    return json({results:[item]});
  });
  const result=await createSellpyProvider().search({...input({id:'outfit',route:'outfit',seed_ids:[itemId]}),page_size:50},context);
  assert.equal(result.end_reason,'upstream_window');
  assert.ok(result.warnings.some(warning=>warning.includes('20 recommendations')));
});

test('independent detail sources overlap and both complete before returning', async () => {
  const started = new Set<string>();
  let release!: () => void;
  const bothStarted = new Promise<void>(resolve => { release = resolve; });
  const completed: string[] = [];
  const { context } = mockContext(async url => {
    const route = url.endsWith('/objects') ? 'catalog' : 'graph';
    started.add(route);
    if (started.size === 2) release();
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([bothStarted, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('independent sources did not overlap')), 1000);
      })]);
    } finally { clearTimeout(timer!); }
    completed.push(route);
    return route === 'catalog' ? json({ results: [item] }) : json({ data: { item0: detail } });
  });
  const result = await createSellpyProvider().details([itemId], 'AT', 'de', context);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(new Set(completed), new Set(['catalog', 'graph']));
});

test('a failed canonical source retains the fresh catalog observation and explicit failure', async () => {
  const { context } = mockContext(url => url.endsWith('/objects')
    ? json({ results: [{ ...item, price_AT: { amount: 1900, currency: 'EUR' } }] })
    : json({ error: 'unavailable' }, 500));
  const result = await createSellpyProvider().details([itemId], 'AT', 'de', context);
  assert.equal(result.items[0]?.source, 'catalog');
  assert.equal(result.items[0]?.price?.amount_minor, 1900);
  assert.equal(result.failures[0]?.error.code, 'source_http_error');
  assert.equal(result.failures[0]?.error.retryable, true);
  assert.deepEqual(result.remaining_ids, []);
});

test('a catalog rate limit is preserved while the parallel canonical source is drained', async () => {
  let canonicalFinished = false;
  const start = Date.now();
  const { context } = mockContext(async url => {
    if (url.endsWith('/objects')) return json({}, 429, { 'retry-after': '60' });
    await new Promise(resolve => setTimeout(resolve, 10));
    canonicalFinished = true;
    return json({ data: { item0: detail } });
  });
  const result = await createSellpyProvider().details([itemId], 'AT', 'de', context);
  assert.equal(canonicalFinished, true);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.remaining_ids, [itemId]);
  assert.equal(result.failures[0]?.error.code, 'rate_limited');
  assert.ok(Date.parse(result.failures[0]?.error.retry_at ?? '') >= start + 60_000);
});

test('a single parallel-source timeout preserves every unprocessed detail ID', async () => {
  const ids = Array.from({ length: 11 }, (_, index) => `id${index}`);
  let objectsFinished = false;
  const { context } = mockContext((url, init) => {
    if (url.endsWith('/objects')) {
      objectsFinished = true;
      return json({ results: JSON.parse(String(init.body)).requests.map((entry: {objectID: string}) => ({ ...item, objectID: entry.objectID })) });
    }
    throw new ToolError('time_budget', 'Canonical detail budget ended', { retryable: true });
  });
  const result = await createSellpyProvider().details(ids, 'AT', 'de', context);
  assert.equal(objectsFinished, true);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.remaining_ids, ids);
  assert.ok(result.failures.every(failure => failure.error.code === 'time_budget' && failure.error.retryable));
});

test('simultaneous source failures retain the latest observed cooldown', async () => {
  const started = Date.now();
  const { context } = mockContext(url => url.endsWith('/objects')
    ? json({}, 429, { 'retry-after': '10' }) : json({}, 429, { 'retry-after': '120' }));
  const result = await createSellpyProvider().details([itemId], 'AT', 'de', context);
  assert.deepEqual(result.remaining_ids, [itemId]);
  assert.equal(result.failures[0]?.error.code, 'rate_limited');
  assert.ok(Date.parse(result.failures[0]?.error.retry_at ?? '') >= started + 120_000);
});

test('a canonical-source pause is not discarded when the parallel catalog source fails', async () => {
  const { context } = mockContext(url => url.endsWith('/objects') ? json({}, 500) : json({}, 429, { 'retry-after': '60' }));
  const result = await createSellpyProvider().details([itemId], 'AT', 'de', context);
  assert.deepEqual(result.remaining_ids, [itemId]);
  assert.equal(result.failures[0]?.error.code, 'rate_limited');
});

test('an in-flight cancellation retains all detail IDs for retry', async () => {
  const { context } = mockContext(url => {
    if (url.endsWith('/objects')) return json({ results: [item] });
    throw new ToolError('cancelled', 'Request cancelled', { retryable: true });
  });
  const result = await createSellpyProvider().details([itemId], 'AT', 'de', context);
  assert.deepEqual(result.remaining_ids, [itemId]);
  assert.equal(result.failures[0]?.error.code, 'cancelled');
});

test('object hydration limits returned fields without omitting any filter or normalized shopper field', async () => {
  const { context } = mockContext((url, init) => {
    if (url.endsWith('/get-similar-by-text')) return json({ results: [{ text: 'flowers', items: [{ objectid: itemId }] }] });
    const request = JSON.parse(String(init.body)).requests[0];
    assert.deepEqual(request.attributesToRetrieve, ['objectID', 'metadata', 'images', 'isReserved', 'isForSale', 'p2p', 'categories', 'sizes', 'materials',
      'keywords', 'style', 'brandGroups', 'segment', 'saleType', 'saleStartedAt', 'searchableExternalCategory', 'price_AT', 'firstOfferedAt_AT']);
    const full = { ...item, privateWarehouse: 'never-return', price_SE: { amount: 250, currency: 'SEK' },
      metadata: { ...(item.metadata as object), measurement: { lengthInCm: 95 } } };
    const selected = Object.fromEntries(Object.entries(full).filter(([key]) => request.attributesToRetrieve.includes(key)));
    assert.deepEqual(normalizeItem(selected, 'AT', 'de', 'fixed'), normalizeItem(full, 'AT', 'de', 'fixed'));
    assert.equal(matchesFilters(selected, { facets: { 'metadata.brand': ['Cellbes'] }, measurements: { lengthInCm: { min: 90, max: 100 } } }, 'AT'), true);
    return json({ results: [selected] });
  });
  const result = await createSellpyProvider().search(input({ id: 'semantic', route: 'semantic', query: 'flowers' }), context);
  assert.equal(result.items.length, 1);
  assert.ok(!JSON.stringify(result).includes('never-return'));
});

test('overlapping native arms reuse only completed raw objects inside the same request and preserve timestamps', async () => {
  let objectCalls = 0;
  const { context } = mockContext((url, init) => {
    if (url.endsWith('/get-similar-by-text')) return json({ results: [{ text: 'flowers', items: [{ objectid: itemId }, { objectid: 'missing' }] }] });
    objectCalls++;
    assert.equal(JSON.parse(String(init.body)).requests.length, 2);
    return json({ results: [item, null] });
  });
  const provider = createSellpyProvider();
  const first = await provider.search(input({ id: 'first', route: 'semantic', query: 'flowers' }), context);
  const second = await provider.search(input({ id: 'second', route: 'semantic', query: 'flowers', filters: { facets: { 'metadata.brand': ['Different'] } } }), context);
  const third = await provider.search(input({ id: 'third', route: 'semantic', query: 'flowers' }), context);
  assert.equal(objectCalls, 1);
  assert.equal(first.items.length, 1);
  assert.equal(second.items.length, 0, 'changed hard filters are reapplied to the raw memoized item');
  assert.equal(third.items[0]?.observed_at, first.items[0]?.observed_at);
  await provider.search(input({ id: 'next_request', route: 'semantic', query: 'flowers' }), { ...context });
  assert.equal(objectCalls, 2, 'a new request cannot reuse the previous request’s object observations');
});

test('native hydration memo is isolated by market and language', async () => {
  const lookups: { indexName: string; attributesToRetrieve: string[] }[] = [];
  const { context } = mockContext((url, init) => {
    if (url.endsWith('/get-similar-by-text')) return json({ results: [{ text: 'flowers', items: [{ objectid: itemId }] }] });
    const request = JSON.parse(String(init.body)).requests[0];
    lookups.push(request);
    return json({ results: [{ ...item, price_DE: { amount: 1700, currency: 'EUR' } }] });
  });
  const provider = createSellpyProvider();
  const arm = { id: 'semantic', route: 'semantic' as const, query: 'flowers' };
  const at = await provider.search(input(arm), context);
  const de = await provider.search(input(arm, { market: 'DE' }), context);
  await provider.search(input(arm, { language: 'en' }), context);
  assert.equal(at.items[0]?.price?.amount_minor, 2400);
  assert.equal(de.items[0]?.price?.amount_minor, 1700);
  assert.equal(lookups.length, 3);
  assert.ok(lookups[0]?.attributesToRetrieve.includes('price_AT'));
  assert.ok(lookups[1]?.attributesToRetrieve.includes('price_DE'));
  assert.equal(lookups[2]?.indexName, 'en_newest');
});

test('unexpected ordered object identities fail explicitly without memoizing a partial batch', async () => {
  let corrupt = true;
  let lookups = 0;
  const { context } = mockContext((url, init) => {
    if (url.endsWith('/get-similar-by-text')) return json({ results: [{ text: 'flowers', items: [{ objectid: itemId }, { objectid: 'second' }] }] });
    lookups++;
    assert.equal(JSON.parse(String(init.body)).requests.length, 2);
    return json({ results: [item, corrupt ? item : { ...item, objectID: 'second' }] });
  });
  const provider = createSellpyProvider();
  const request = input({ id: 'semantic', route: 'semantic', query: 'flowers' });
  await assert.rejects(provider.search(request, context), (error: unknown) => error instanceof ToolError && error.code === 'source_contract_changed');
  corrupt = false;
  const result = await provider.search(request, context);
  assert.equal(lookups, 2);
  assert.deepEqual(result.items.map(value => value.id), [itemId, 'second']);
});

test('canonical detail validation always bypasses a search hydration memo for fresh prices', async () => {
  let lookups = 0;
  const { context } = mockContext(url => {
    if (url.endsWith('/get-similar-by-text')) return json({ results: [{ text: 'flowers', items: [{ objectid: itemId }] }] });
    if (url.includes('/graphql')) return json({ data: { item0: detail } });
    lookups++;
    return json({ results: [{ ...item, price_AT: { amount: lookups === 1 ? 2400 : 1800, currency: 'EUR' } }] });
  });
  const provider = createSellpyProvider();
  const before = await provider.search(input({ id: 'semantic', route: 'semantic', query: 'flowers' }), context);
  const after = await provider.details([itemId], 'AT', 'de', context);
  assert.equal(lookups, 2);
  assert.equal(before.items[0]?.price?.amount_minor, 2400);
  assert.equal(after.items[0]?.price?.amount_minor, 1800);
  assert.equal(after.items[0]?.source, 'detail');
});

test('shared stateless provider caches parsed configuration but makes fresh detail requests in each context', async () => {
  const create = () => mockContext(url => url.endsWith('/objects') ? json({ results: [item] }) : json({ data: { item0: detail } }));
  const first = create(), second = create();
  await sharedSellpyProvider.details([itemId], 'AT', 'de', first.context);
  await sharedSellpyProvider.details([itemId], 'AT', 'de', second.context);
  assert.equal(first.calls.filter(call => call.url === sourceUrl).length, 1);
  assert.equal(second.calls.filter(call => call.url === sourceUrl).length, 0);
  assert.equal(first.calls.filter(call => call.url.endsWith('/objects')).length, 1);
  assert.equal(second.calls.filter(call => call.url.endsWith('/objects')).length, 1);
  assert.equal(second.calls.filter(call => call.url.includes('/graphql')).length, 1);
});
