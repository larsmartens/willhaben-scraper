import { Miniflare, Response } from 'miniflare';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const runtimeRoot = await mkdtemp(join(tmpdir(), 'marktplatz-provider-review-'));
const outboundCalls = [];
let denyNext = false;

function listing(id, detailed = false) {
  return {
    id: String(id), verticalId: 5, description: 'Synthetic lamp ' + id,
    advertStatus: { id: 'active' },
    attributes: { attribute: [
      { name: 'PRICE', values: ['25'] },
      { name: 'SEO_URL', values: ['kaufen-und-verkaufen/d/synthetic-lamp-' + id] },
      ...(detailed ? [{ name: 'DESCRIPTION', values: ['Synthetic public description ' + id] }] : []),
    ] },
    advertImageList: { advertImage: [
      { mainImageUrl: 'https://cache.willhaben.at/mmo/synthetic-' + id + '.jpg',
        thumbnailImageUrl: 'https://cache.willhaben.at/mmo/synthetic-' + id + '_thumb.jpg' },
    ] },
  };
}

function html(props) {
  return new Response('<html><script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify({ props: { pageProps: props } }) + '</script></html>',
  { headers: { 'content-type': 'text/html' } });
}

const entry = `import { getProvider } from './providers.mjs';
export { OriginGate } from './origin-gate.mjs';
export default { async fetch(request, env) {
  const { action, args } = await request.json();
  try {
    const provider = getProvider('live', {
      ...env, LIVE_ACCESS: 'personal_test', REQUIRE_ORIGIN_GATE: true,
      REQUEST_DEADLINE: Date.now() + 35000,
    });
    const result = action === 'detail' || action === 'summary'
      ? await provider[action](args.id, args.options ?? {})
      : await provider[action](args);
    return Response.json({ result });
  } catch (error) {
    return Response.json({ error: {
      code: error.code, message: error.message, recoverable: error.recoverable,
      retryAt: error.retryAt, retryAfterSeconds: error.retryAfterSeconds,
    } }, { status: 400 });
  }
} };`;

const modules = [{ type: 'ESModule', path: runtimeRoot + '/entry.mjs', contents: entry }];
for (const name of ['providers.mjs', 'origin-gate.mjs', 'traffic.mjs']) {
  modules.push({ type: 'ESModule', path: runtimeRoot + '/' + name,
    contents: await readFile(sourceRoot + '/' + name, 'utf8') });
}

const mf = new Miniflare({
  name: 'marktplatz-provider-integration-review',
  modulesRoot: runtimeRoot, modules, compatibilityDate: '2026-06-01',
  durableObjects: { ORIGIN_GATE: { className: 'OriginGate', useSQLite: true } },
  durableObjectsPersist: runtimeRoot + '/state',
  outboundService: async request => {
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://www.willhaben.at', 'Unexpected outbound target');
    assert.equal(request.headers.get('cookie'), null);
    assert.equal(request.headers.get('authorization'), null);
    outboundCalls.push({ pathname: url.pathname, at: Date.now(), query: url.searchParams.get('keyword') });
    if (denyNext) {
      denyNext = false;
      return new Response('synthetic cooldown', { status: 429, headers: { 'retry-after': '1800' } });
    }
    if (url.pathname.includes('/marktplatz')) {
      const page = Number(url.searchParams.get('page'));
      const records = page === 1 ? [listing(41), listing(42)] : [];
      return html({ searchResult: {
        verticalId: 5, pageRequested: page, rowsRequested: Number(url.searchParams.get('rows')),
        rowsReturned: records.length, rowsFound: 2,
        advertSummaryList: { advertSummary: records },
        navigatorGroups: [{ navigatorList: [{ id: 'material', label: 'Material', possibleValues: [
          { label: 'Glas', hits: 2, urlParamRepresentationForValue: [{ urlParameterName: 'treeAttributes', value: '1234' }] },
        ] }] }],
      } });
    }
    const id = url.pathname === '/iad/object' ? url.searchParams.get('adId') : url.pathname.split('-').at(-1);
    if (id === '999') return new Response('synthetic deleted listing', { status: 404 });
    assert.equal(id, '41', 'Unexpected detail target');
    return html({ advertDetails: listing(id, true) });
  },
});

async function call(action, args) {
  const response = await mf.dispatchFetch('https://provider-test.invalid/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args }),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error.message), data.error);
  return data.result;
}

try {
  const first = await call('search', { query: 'Synthetic lamp' });
  assert.deepEqual(first.items.map(item => item.id), ['41', '42']);
  assert.equal(first.requestedPageSize, 50);
  assert.equal(first.cacheHit, false);
  assert.equal(outboundCalls.length, 1);
  const cached = await call('search', { query: 'Synthetic lamp' });
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.observedAt, first.observedAt);
  assert.equal(outboundCalls.length, 1);
  console.log('PASS search uses the real SQLite cache across independent requests');

  const summary = await call('summary', { id: '41' });
  assert.equal(summary.id, '41');
  assert.equal(summary.imageCount, 1);
  assert.equal(summary.observedAt, first.observedAt);
  const facets = await call('facets', { query: 'Synthetic lamp' });
  assert.equal(facets.dimensions[0].values[0].value, 1234);
  assert.equal(outboundCalls.length, 1);
  console.log('PASS summary covers and facets share the stored search observation');

  const detail = await call('detail', { id: '41' });
  assert.equal(detail.description, 'Synthetic public description 41');
  assert.equal(outboundCalls.length, 2);
  assert.equal(outboundCalls[1].pathname, '/iad/kaufen-und-verkaufen/d/synthetic-lamp-41');
  const cachedDetail = await call('detail', { id: '41' });
  assert.equal(cachedDetail.cacheHit, true);
  assert.equal(cachedDetail.observedAt, detail.observedAt);
  assert.equal(outboundCalls.length, 2);
  console.log('PASS detail uses the cached canonical hint and preserves its observation on a cache hit');

  const refreshed = await call('search', { query: 'Synthetic lamp', fresh: true });
  assert.equal(refreshed.cacheHit, false);
  assert.notEqual(refreshed.observedAt, first.observedAt);
  assert.equal(outboundCalls.length, 3);
  console.log('PASS fresh bypasses search cache while retaining shared pacing');

  const missing = await call('detail', { id: '999' });
  assert.equal(missing, null);
  assert.equal(outboundCalls.length, 4);
  assert.equal(await call('detail', { id: '999' }), null);
  assert.equal(outboundCalls.length, 4);
  console.log('PASS 404 tombstones round-trip as null without violating the object-only cache contract');

  const larger = await call('search', { query: 'Synthetic lamp', pageSize: 100 });
  assert.equal(larger.requestedPageSize, 100);
  assert.equal(larger.cacheHit, false);
  assert.equal(larger.end, false);
  assert.equal(outboundCalls.length, 5);
  const end = await call('search', { query: 'Synthetic lamp', cursor: larger.nextCursor, pageSize: 100 });
  assert.equal(end.end, true);
  assert.equal(end.nextCursor, null);
  assert.equal(outboundCalls.length, 6);
  console.log('PASS page size and position have independent cache identities and exhaustion is verified');

  denyNext = true;
  await assert.rejects(call('search', { query: 'Synthetic lamp', fresh: true }), error =>
    error.code === 'upstream_rate_limited' && error.retryAfterSeconds === 1800);
  const beforeCooldownHits = outboundCalls.length;
  const stillCached = await call('search', { query: 'Synthetic lamp' });
  assert.equal(stillCached.cacheHit, true);
  await assert.rejects(call('search', { query: 'Different synthetic query' }), { code: 'upstream_rate_limited' });
  assert.equal(outboundCalls.length, beforeCooldownHits);
  console.log('PASS shared 1800-second cooldown blocks new traffic while cached observations remain available');

  for (let index = 1; index < outboundCalls.length; index++) {
    assert.ok(outboundCalls[index].at - outboundCalls[index - 1].at >= 1900, 'Actual request spacing fell below the 2-second policy');
  }
  console.log('PASS every synthetic outbound request respects real shared origin pacing');
  console.log('All provider/OriginGate Workers-runtime integration checks passed');
} finally {
  await mf.dispose();
  await rm(runtimeRoot, { recursive: true, force: true });
}
