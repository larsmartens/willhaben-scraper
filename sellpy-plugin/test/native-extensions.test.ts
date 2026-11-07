import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolError, type RequestContext } from '../src/domain.js';
import { createSellpyProvider } from '../src/sellpy/client.js';
import { parsePublicConfig, SERVICE_PATHS, SIMILAR_BRANDS_URL } from '../src/sellpy/config.js';
import { parseSearchUrl } from '../src/search-url.js';
import { createPublicReferenceFetch, isSellpyProductImageUrl, preparePublicReference,
  PUBLIC_REFERENCE_MAX_BYTES, validatePublicReferenceUrl } from '../src/public-reference.js';
import { allowedUpstreamURL } from '../src/http.js';

const configUrl = 'https://www.sellpy.com/market/config.prod.native-fixture.bundle.js';
const names: Record<string, string> = { semantic: 'similarItemsByText', similar: 'similarItems', image: 'similarItemsFromImage',
  upload: 'similarItemsFromUserImage', outfit: 'complementaryItems' };
function fixtureConfig(extra?: { url: string; key: string }): string {
  const locale = { applicationId: 'TEST12345', searchKey: 'fixture-key', marketItemIndexRelevance: 'relevance',
    marketItemIndexSaleStartDescending: 'newest', marketItemIndexPriceAscending: 'price_asc', marketItemIndexPriceDescending: 'price_desc' };
  const value = { algolia: { locales: { en: locale, de: locale } }, parse: { applicationId: 'fixture-parse' },
    apollo: { uri: 'https://sellpy-parse-prod.herokuapp.com/graphql' },
    ml: { ...Object.fromEntries(Object.entries(SERVICE_PATHS).map(([key, path]) => [names[key]!, { url: `https://services.sellpy.net${path}`, key: 'fixture-native' }])),
      ...(extra ? { similarBrands: extra } : {}) },
  };
  return `const config=${JSON.stringify(value).replace(/"([A-Za-z_][A-Za-z_0-9]*)":/g, '$1:')};`;
}
const fixtureBrandService = { url: SIMILAR_BRANDS_URL, key: 'fixture-brand-key' };
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function contextWith(handler: Handler, deadline = Date.now() + 30000, signal?: AbortSignal): RequestContext {
  return { deadline, signal, fetch: (async (input, init = {}) => handler(input instanceof Request ? input.url : String(input), init)) as typeof fetch };
}
function providerContext(handler: Handler, service: typeof fixtureBrandService | undefined = fixtureBrandService): RequestContext {
  return contextWith((url, init) => {
    if (url === 'https://www.sellpy.com/search') return new Response(`<link href="${configUrl}">`);
    if (url === configUrl) return new Response(fixtureConfig(service));
    return handler(url, init);
  });
}
const brandInput = { brands: ['COS'], limit: 3, market: 'AT', language: 'de' };
const errorCode = (code: string) => (error: unknown) => error instanceof ToolError && error.code === code;
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

test('similar brands is optional configuration and never becomes an item retrieval route', () => {
  assert.equal(parsePublicConfig(fixtureConfig(), configUrl).similar_brands, undefined);
  const parsed = parsePublicConfig(fixtureConfig(fixtureBrandService), configUrl);
  assert.deepEqual(parsed.similar_brands, fixtureBrandService);
  assert.deepEqual(Object.keys(parsed.services), ['semantic', 'similar', 'image', 'upload', 'outfit']);
  assert.throws(() => parsePublicConfig(fixtureConfig({ ...fixtureBrandService, url: 'https://untrusted.example.com/brands' }), configUrl), /endpoint changed/);
});

test('similar brands preserves source order, separates brand IDs and removes seeds and duplicate names', async () => {
  let calls = 0;
  const result = await createSellpyProvider().similarBrands({ ...brandInput, brands: [' COS ', 'cos'] }, providerContext((url, init) => {
    calls++;
    assert.equal(url, SIMILAR_BRANDS_URL);
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('x-similaritems-key'), 'fixture-brand-key');
    assert.deepEqual(JSON.parse(String(init.body)), { brand_groups: [['COS']], n_items: 3, request_source: 'sellpy-chatgpt-plugin' });
    return Response.json([[{ brand: 'COS', objectid: 'seed', score: 1 }, { brand: 'Arket', objectid: 'brand1', score: .78 },
      { brand: 'arket', objectid: 'duplicate', score: .77 }, { brand: '& Other Stories', objectid: 'brand2', score: .74 }, { brand: 'Jouur' }]]);
  }));
  assert.equal(calls, 1);
  assert.deepEqual(result.seed_brands, ['COS']);
  assert.deepEqual(result.brands, [{ brand: 'Arket', brand_object_id: 'brand1', native_score: .78 },
    { brand: '& Other Stories', brand_object_id: 'brand2', native_score: .74 }, { brand: 'Jouur', brand_object_id: null, native_score: null }]);
  assert.equal(result.inventory_checked, false);
  assert.equal('next_cursor' in result, false);
  assert.ok(result.warnings.some(warning => /not probabilities/.test(warning)));
});

test('missing native brand configuration fails specifically without breaking ordinary capabilities', async () => {
  const context = contextWith(url => {
    if (url === 'https://www.sellpy.com/search') return new Response(`<link href="${configUrl}">`);
    if (url === configUrl) return new Response(fixtureConfig());
    throw new Error(`Unexpected request ${url}`);
  });
  const provider = createSellpyProvider();
  assert.equal((await provider.capabilities(context)).routes.image.available, true);
  await assert.rejects(provider.similarBrands(brandInput, context), errorCode('unsupported_native_capability'));
});

test('similar brands validates request budgets before I/O and malformed response groups after I/O', async () => {
  const noIo = contextWith(() => { throw new Error('Unexpected I/O'); });
  for (const brands of [[], [''], ['COS\n'], Array.from({ length: 51 }, () => 'COS')]) {
    await assert.rejects(createSellpyProvider().similarBrands({ ...brandInput, brands }, noIo), errorCode('invalid_brand_seeds'));
  }
  for (const limit of [0, 101, 1.5, NaN]) await assert.rejects(createSellpyProvider().similarBrands({ ...brandInput, limit }, noIo), errorCode('invalid_brand_limit'));
  for (const response of [[], {}, [[], []], [[{ brand: 123 }]], [[{ brand: 'Arket', objectid: 'not/item' }]], [[{ brand: 'Arket', score: 'high' }]]]) {
    await assert.rejects(createSellpyProvider().similarBrands(brandInput, providerContext(() => Response.json(response))), errorCode('source_contract_changed'));
  }
  assert.deepEqual((await createSellpyProvider().similarBrands(brandInput, providerContext(() => Response.json([[]])))).brands, []);
});

test('similar brands carries source pause errors and bounds the native response', async () => {
  await assert.rejects(createSellpyProvider().similarBrands(brandInput, providerContext(() => new Response('', { status: 429, headers: { 'retry-after': '3' } }))),
    error => error instanceof ToolError && error.code === 'rate_limited' && !!error.retry_at);
  await assert.rejects(createSellpyProvider().similarBrands(brandInput, providerContext(() => new Response('x'.repeat(128 * 1024 + 1)))),
    errorCode('source_response_too_large'));
});

test('search URL faithfully imports categories, OR/exclusion facets, money, centimetres and sorting', () => {
  const parsed = parseSearchUrl('https://www.sellpy.at/search/Damen/Kleidung/T_Shirts?query=romantisch&brand=H%26M&brand=Arket&brand=-Zara&minPrice=12.5&maxPrice=50&minWaist=30&maxWaist=40&minInnerLegLength=70&sortBy=saleStartedAt_desc&page=4&utm_source=example#top');
  assert.equal(parsed.market, 'AT');
  assert.equal(parsed.language, 'de');
  assert.equal(parsed.sort, 'newest');
  assert.equal(parsed.query, 'romantisch');
  assert.equal(parsed.source_page, 4);
  assert.deepEqual(parsed.filters, { facets: { 'metadata.brand': ['H&M', 'Arket', '-Zara'], 'categories.lvl2': ['Damen > Kleidung > T-Shirts'] },
    measurements: { waistInCm: { min: 30, max: 40 }, innerLegLengthInCm: { min: 70 } }, price_min: 12.5, price_max: 50 });
  assert.deepEqual(parsed.ignored_parameters, ['utm_source', '#fragment']);
  assert.ok(parsed.warnings.some(warning => /first page/.test(warning)));
  assert.equal(new URL(parsed.source_url).searchParams.has('utm_source'), false);
  assert.equal(new URL(parsed.source_url).hash, '');
});

test('search URL keeps native space/hyphen/percent distinctions and supports exact regional hosts', () => {
  const parsed = parseSearchUrl('https://sellpy.se/search/Man/Kl%C3%A4der/Kavajer-%26-Kostymer?condition=Mycket+bra&sizes=SUIT-EU-50');
  assert.equal(parsed.market, 'SE');
  assert.equal(parsed.language, 'sv');
  assert.deepEqual(parsed.filters.facets, { 'metadata.condition': ['Mycket bra'], sizes: ['SUIT-EU-50'],
    'categories.lvl2': ['Man > Kläder > Kavajer & Kostymer'] });
  assert.equal(parseSearchUrl('https://www.sellpy.com/search').market, 'EU');
  assert.equal(parseSearchUrl('https://www.sellpy.be/search?brand=COS', { market: 'BE', language: 'fr' }).language, 'fr');
  assert.throws(() => parseSearchUrl('https://www.sellpy.se/search?maxPrice=100', { market: 'AT' }), /conflicts/);
  assert.throws(() => parseSearchUrl('https://www.sellpy.at/search', { language: 'sv' }), errorCode('unsupported_market_language'));
});

test('search URL rejects unknown restrictive parameters instead of silently broadening', () => {
  for (const parameter of ['storageSite', 'user', 'lastChance', 'isReserved', 'p2p', 'segment', 'metadata.brand', 'unknownFilter']) {
    assert.throws(() => parseSearchUrl(`https://www.sellpy.at/search?${parameter}=yes`), errorCode('unsupported_search_parameters'));
  }
  assert.deepEqual(parseSearchUrl('https://www.sellpy.at/search?utm_campaign=x&fbclid=y').ignored_parameters, ['utm_campaign', 'fbclid']);
});

test('search URL rejects malformed, conflicting or unsafe input without a network path', () => {
  const invalid = [
    'http://www.sellpy.at/search', 'https://name:pass@www.sellpy.at/search', 'https://www.sellpy.at:444/search',
    'https://www.sellpy.at.evil.example.com/search', 'https://www.sellpy.at/item/id', 'https://www.sellpy.at/../search',
    'https://www.sellpy.at/%2e%2e/search', 'https://www.sellpy.at/search/A/B/C/D/E', 'https://www.sellpy.at/search//Damen',
    'https://www.sellpy.at/search?brand=', 'https://www.sellpy.at/search?brand=COS&brand=-COS',
    'https://www.sellpy.at/search?brand=%5C-COS', 'https://www.sellpy.at/search?query=a&query=b',
    'https://www.sellpy.at/search?minPrice=50&maxPrice=10', 'https://www.sellpy.at/search?minPrice=10&minPrice=20',
    'https://www.sellpy.at/search?maxWaist=20&minWaist=30', 'https://www.sellpy.at/search?minPrice=-2',
    'https://www.sellpy.at/search?minPrice=Infinity', 'https://www.sellpy.at/search?page=0',
    'https://www.sellpy.at/search?page=1.5', 'https://www.sellpy.at/search?sortBy=newest',
    'https://www.sellpy.at/search?query=%E0%A4', 'https://www.sellpy.at/search?brand=%00', 'https://www.sellpy.at/search/%GG',
  ];
  for (const input of invalid) assert.throws(() => parseSearchUrl(input), ToolError, input);
  assert.equal(parseSearchUrl('https://www.sellpy.at/search?brand=COS&brand=COS').filters.facets?.['metadata.brand']?.length, 1);
});

test('public reference URL policy rejects literals, internal names, credentials and custom protocols', () => {
  const blocked = ['http://images.example.com/a.png', 'file:///etc/passwd', 'data:image/png;base64,abcd',
    'https://localhost/a', 'https://sub.localhost/a', 'https://server.internal/a', 'https://server.local/a',
    'https://metadata.google.internal/a', 'https://instance-data.example.com/a', 'https://one-label/a',
    'https://127.0.0.1/a', 'https://10.0.0.1/a', 'https://169.254.169.254/a', 'https://8.8.8.8/a',
    'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://2130706433/a', 'https://0x7f000001/a',
    'https://user:pass@images.example.com/a', 'https://images.example.com:8443/a', 'https://images.example.com./a',
    'https://images.example.com\\@localhost/a', 'https://images.example.com/a\n'];
  for (const url of blocked) assert.throws(() => validatePublicReferenceUrl(url), errorCode('unsafe_reference_url'), url);
  assert.equal(validatePublicReferenceUrl('https://images.example.com/a.png#x').href, 'https://images.example.com/a.png');
  assert.equal(isSellpyProductImageUrl('https://prod.images.sellpy.net/photo/a.jpg'), true);
  assert.equal(isSellpyProductImageUrl('https://images.example.com/a.png'), false);
  assert.throws(() => allowedUpstreamURL('https://images.example.com/a.png'), errorCode('unsupported_image_host'));
});

test('public reference transport strips inherited credentials, headers and request options', async () => {
  let calls = 0;
  const safeFetch = createPublicReferenceFetch((async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://images.example.com/a.png');
    assert.deepEqual([...new Headers(init?.headers).keys()], ['accept']);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'manual');
    assert.equal(init?.referrerPolicy, 'no-referrer');
    assert.equal(init?.body, undefined);
    assert.equal('cf' in (init ?? {}), false);
    return new Response(png);
  }) as typeof fetch);
  const request = new Request('https://images.example.com/a.png', { headers: { authorization: 'not-forwarded', cookie: 'not-forwarded', 'x-similaritems-key': 'not-forwarded' } });
  const unsafeOptions: RequestInit & { cf: { resolveOverride: string } } = { credentials: 'include', headers: { authorization: 'also-not-forwarded' }, cf: { resolveOverride: 'private.internal' } };
  await safeFetch(request, unsafeOptions);
  assert.equal(calls, 1);
  await assert.rejects(safeFetch('https://images.example.com/a.png', { method: 'POST', body: 'data' }), errorCode('unsafe_reference_request'));
});

test('public reference manually validates redirects and trusts bytes rather than extensions or headers', async () => {
  const calls: string[] = [];
  const result = await preparePublicReference('https://images.example.com/inspiration.jpg#fragment', contextWith((url, init) => {
    calls.push(url);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.credentials, 'omit');
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: '/final.bin' } })
      : new Response(png, { headers: { 'content-type': 'text/html' } });
  }));
  assert.deepEqual(calls, ['https://images.example.com/inspiration.jpg', 'https://images.example.com/final.bin']);
  assert.equal(result.mime_type, 'image/png');
  assert.equal(result.file_name, 'reference.png');
  assert.equal(result.source_url, 'https://images.example.com/final.bin');
  assert.deepEqual(result.bytes, png);
  await assert.rejects(preparePublicReference('https://images.example.com/a.png', contextWith(() => new Response('<html>not an image</html>', { headers: { 'content-type': 'image/png' } }))), errorCode('unsupported_reference'));
});

test('public reference never follows unsafe redirects and detects loops and excessive chains', async () => {
  for (const target of ['http://images.example.com/a', 'https://127.0.0.1/a', 'https://private.internal/a', 'https://user:pass@images.example.com/a']) {
    let calls = 0;
    await assert.rejects(preparePublicReference('https://images.example.com/a', contextWith(() => {
      calls++; return new Response(null, { status: 302, headers: { location: target } });
    })), errorCode('unsafe_reference_url'));
    assert.equal(calls, 1);
  }
  await assert.rejects(preparePublicReference('https://images.example.com/a', contextWith(() => new Response(null, { status: 302, headers: { location: '/a#fragment' } }))), errorCode('reference_redirect_loop'));
  let hops = 0;
  await assert.rejects(preparePublicReference('https://images.example.com/a', contextWith(() => new Response(null, { status: 302, headers: { location: `/hop-${++hops}` } }))), errorCode('reference_redirect_limit'));
  assert.equal(hops, 5);
  const accepted = await preparePublicReference('https://images.example.com/0', contextWith(url => {
    const n = Number(new URL(url).pathname.slice(1));
    return n < 4 ? new Response(null, { status: 307, headers: { location: `/${n + 1}` } }) : new Response(png);
  }));
  assert.equal(accepted.source_url, 'https://images.example.com/4');
});

test('public reference transfer cap works both with declared length and a streaming body', async () => {
  let cancelled = false;
  await assert.rejects(preparePublicReference('https://images.example.com/a', contextWith(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(png); }, cancel() { cancelled = true; },
  }), { headers: { 'content-length': String(PUBLIC_REFERENCE_MAX_BYTES + 1) } }))), errorCode('reference_too_large'));
  assert.equal(cancelled, true);
  cancelled = false;
  await assert.rejects(preparePublicReference('https://images.example.com/a', contextWith(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(PUBLIC_REFERENCE_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  })))), errorCode('reference_too_large'));
  assert.equal(cancelled, true);
});

test('public reference respects cancellation and deadline while waiting for body bytes', async () => {
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(preparePublicReference('https://images.example.com/a', contextWith(() => { throw new Error('Unexpected network'); }, Date.now() + 1000, alreadyAborted.signal)), errorCode('cancelled'));
  let cancelled = false;
  await assert.rejects(preparePublicReference('https://images.example.com/a', contextWith(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(png); }, cancel() { cancelled = true; },
  })), Date.now() + 30)), errorCode('time_budget'));
  assert.equal(cancelled, true);
  const controller = new AbortController();
  const pending = preparePublicReference('https://images.example.com/a', contextWith((_url, init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }), Date.now() + 1000, controller.signal));
  controller.abort();
  await assert.rejects(pending, errorCode('cancelled'));
});

test('public reference reports HTTP pauses and denied transport without reading error bodies', async () => {
  await assert.rejects(preparePublicReference('https://images.example.com/a', contextWith(() => new Response('private error body', { status: 429, headers: { 'retry-after': '2' } }))),
    error => error instanceof ToolError && error.code === 'rate_limited' && !!error.retry_at && !error.message.includes('private error body'));
  await assert.rejects(preparePublicReference('https://images.example.com/a', contextWith(() => { throw new Error('Platform egress rejected resolved private target'); })),
    error => error instanceof ToolError && error.code === 'reference_unavailable' && !error.message.includes('Platform'));
});
