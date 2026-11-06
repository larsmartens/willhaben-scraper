import assert from "node:assert/strict";
import { test } from "node:test";
import { invokeTool, toolDefinitions } from "../src/tools.mjs";
import { imageBatch, readGallery } from "../src/images.mjs";

const live = { LIVE_ACCESS: "personal_test", IMAGE_ACCESS: "personal_test" };
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const photo = index => `https://cache.willhaben.at/mmo/fixtures/${index}.png`;
const thumbnail = index => `https://cache.willhaben.at/mmo/fixtures/${index}_thumb.png`;
const embedded = props => new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: props } }) + '</script>');
const raw = (id, pictures = 0, description = "Detailed description") => ({
  id: String(id), verticalId: 5, description: "Lampenglas " + id,
  attributes: { attribute: [{ name: "PRICE", values: ["25"] }, { name: "DESCRIPTION", values: [description] },
    { name: "MATERIAL", values: ["Glas"] }, { name: "SEO_URL", values: ["kaufen-und-verkaufen/d/lampenglas-" + id] }] },
  advertImageList: { advertImage: Array.from({ length: pictures }, (_, index) => ({
    id: 1, mainImageUrl: photo(index), thumbnailImageUrl: thumbnail(index), referenceImageUrl: photo(index),
  })) },
});
const page = (rows, number = 1, total = 200, navigatorGroups) => ({ searchResult: {
  verticalId: 5, pageRequested: number, rowsFound: total, rowsReturned: rows.length,
  advertSummaryList: { advertSummary: rows }, ...(navigatorGroups ? { navigatorGroups } : {}),
} });
const catalog = count => Array.from({ length: count }, (_, index) => ({
  id: String(index + 1), title: "Lampenglas " + index, price: 20 + index,
  description: "Details ".repeat(400), attributes: { diameterMm: 60, openingMm: 24 },
  categoryId: index + 1, category: "Category " + index, location: "Wien", condition: "used",
  images: [photo(0), photo(1)],
}));

test("tool schemas advertise expanded bounded batches and new focused tools", () => {
  const schema = name => toolDefinitions.find(tool => tool.name === name).inputSchema.properties;
  assert.equal(schema("search_listings").pageSize.default, 50);
  assert.equal(schema("search_listings").pageSize.maximum, 100);
  assert.equal(schema("inspect_listings").ids.maxItems, 100);
  assert.equal(schema("inspect_listings").limit.maximum, 10);
  assert.equal(schema("inspect_listing_images").count.maximum, 8);
  assert.ok(schema("inspect_listing_image").index.maximum > 1000);
  assert.ok(schema("parse_search_url").url);
  assert.equal(schema("study_market").maxDetails.maximum, 100);
});

test("search defaults to 50 compact rows, permits 100, and keeps raw details out of projections", async () => {
  const args = { source: "provided", query: "Lampenglas", listings: catalog(120) };
  const result = await invokeTool("search_listings", args);
  assert.equal(result.returnedCount, 50);
  assert.equal(result.requestedPageSize, 50);
  assert.equal(result.total, 120);
  assert.equal(result.items[0].imageCount, 2);
  assert.equal(result.items[0].hasPhotos, undefined);
  assert.equal(result.items[0].condition, undefined);
  for (const key of ["description", "attributes", "images", "gallery", "thumbnailUrl"]) assert.equal(key in result.items[0], false, key);
  assert.ok(!JSON.stringify(result).includes("Details "));
  assert.ok(!JSON.stringify(result).includes("cache.willhaben.at"));
  const hundred = await invokeTool("search_listings", { ...args, pageSize: 100, fields: ["price"] });
  assert.equal(hundred.returnedCount, 100);
  assert.deepEqual(hundred.items[0], { id: "1", price: 20 });
  const links = await invokeTool("search_listings", { ...args, fields: ["title"], images: "links" });
  assert.equal(links.items[0].coverImage.url, photo(0));
  assert.equal(links._images, undefined);
});

test("search cursors can continue beyond 32 calls and bind the full search identity", async () => {
  const args = { source: "provided", query: "Lampenglas", listings: catalog(40), pageSize: 1 };
  let cursor;
  const seen = [];
  for (let index = 0; index < 40; index++) {
    const result = await invokeTool("search_listings", { ...args, ...(cursor ? { cursor } : {}) });
    seen.push(result.items[0].id);
    cursor = result.nextCursor;
  }
  assert.equal(new Set(seen).size, 40);
  assert.equal(cursor, null);
  const first = await invokeTool("search_listings", args);
  assert.match(first.nextCursor, /^mc1\./);
  for (const changed of [{ query: "Glas" }, { filters: { priceMax: 99 } }, { pageSize: 2 },
    { listings: catalog(39) }, { source: "demo", listings: undefined }]) {
    const nextArgs = Object.fromEntries(Object.entries({ ...args, ...changed, cursor: first.nextCursor }).filter(([, value]) => value !== undefined));
    await assert.rejects(invokeTool("search_listings", nextArgs), { code: "invalid_cursor" });
  }
});

test("invalid cursors, criteria and unknown arguments are rejected before upstream I/O", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Unexpected request"); });
  for (const [name, args] of [
    ["search_listings", { source: "live", query: "", cursor: "2" }],
    ["search_listings", { source: "live", query: "", pageSize: 101 }],
    ["search_listings", { source: "live", query: "", fields: ["description"] }],
    ["discover_filters", { source: "live", query: "", cursor: "malformed" }],
    ["inspect_listings", { source: "live", ids: ["1"], criteria: [{ key: "constructor", value: 1 }] }],
    ["inspect_listings", { source: "live", ids: ["1", "invalid"] }],
    ["inspect_listing_images", { id: "1", indices: [0], start: 0 }],
    ["inspect_listing_images", { id: "1", indices: [0, 0] }],
    ["search_listings", { source: "live", query: "", extra: true }],
  ]) await assert.rejects(invokeTool(name, args, live));
  assert.equal(calls, 0);
});

test("search thumbnail mode reads returned covers without any detail request", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async target => {
    const url = new URL(target);
    calls.push(url.href);
    if (url.hostname === "cache.willhaben.at") return new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
    assert.equal(url.searchParams.get("rows"), "50");
    return embedded(page([raw(100, 2), raw(200, 2)]));
  });
  const result = await invokeTool("search_listings", { source: "live", query: "Lampe", images: "thumbnails", imageLimit: 2 }, live);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(url => !url.includes("/iad/object") && !url.includes("/d/")));
  assert.equal(result._images.length, 2);
  assert.deepEqual(result.coverImages.results.map(item => [item.id, item.imageContentIndex]), [["100", 1], ["200", 2]]);
  const { _images, ...metadata } = result;
  assert.ok(!JSON.stringify(metadata).includes(png));
  assert.ok(!JSON.stringify(metadata).includes('"data":'));
  assert.ok(_images.every(image => image.type === "image" && image.data === png));
});

test("precise cover selection reaches the twelfth result and rejects IDs from another page", async t => {
  const calls = [];
  const rows = Array.from({ length: 20 }, (_, index) => ({ ...raw(index + 1),
    advertImageList: { advertImage: [{ mainImageUrl: photo(index), thumbnailImageUrl: thumbnail(index) }] } }));
  t.mock.method(globalThis, "fetch", async target => {
    const url = String(target);
    calls.push(url);
    if (url.startsWith("https://cache.willhaben.at")) return new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
    return embedded(page(rows));
  });
  const args = { source: "live", query: "Lampe", images: "thumbnails", imageIds: ["12"] };
  const result = await invokeTool("search_listings", args, live);
  assert.equal(result.coverImages.results.length, 1);
  assert.equal(result.coverImages.results[0].id, "12");
  assert.equal(result.coverImages.results[0].url, thumbnail(11));
  assert.equal(calls.length, 2);
  await assert.rejects(invokeTool("search_listings", { ...args, imageIds: ["999"] }, live), { code: "invalid_input" });
  assert.equal(calls.filter(url => url.startsWith("https://cache.willhaben.at")).length, 1);
  await assert.rejects(invokeTool("search_listings", { ...args, imageLimit: 2 }, live), { code: "invalid_input" });
});

test("100 requested details remain reachable in repeatable batches with projected fields", async () => {
  const listings = catalog(100), ids = listings.map(listing => listing.id);
  const args = { source: "provided", ids, listings, fields: ["description", "attributes"], attributeKeys: ["diameterMm"] };
  let cursor;
  const seen = [];
  do {
    const result = await invokeTool("inspect_listings", { ...args, ...(cursor ? { cursor } : {}) });
    assert.ok(result.results.length <= 5);
    for (const { listing } of result.results) {
      assert.equal(listing.description.length, 1500);
      assert.equal(listing.descriptionLength, listings[0].description.length);
      assert.equal(listing.descriptionTruncated, true);
      assert.deepEqual(listing.attributes, { diameterMm: 60 });
      assert.equal("gallery" in listing, false);
      seen.push(listing.id);
    }
    cursor = result.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, 100);
  const precise = await invokeTool("inspect_listings", { source: "provided", listings, ids: ["1"], fields: ["price"] });
  assert.deepEqual(precise.results[0].listing, { id: "1", price: 20 });
});

test("live details have no former two-detail quota and preserve description truncation metadata", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async target => {
    const id = new URL(target).searchParams.get("adId");
    calls.push(id);
    return embedded({ advertDetails: raw(id, 20, "a".repeat(9000)) });
  });
  const args = { source: "live", ids: ["1", "2", "3", "4", "5", "6"] };
  const result = await invokeTool("inspect_listings", args, live);
  assert.equal(result.results.length, 5);
  assert.equal(result.remainingCount, 1);
  assert.equal(result.results[0].listing.descriptionLength, 9000);
  assert.equal(result.results[0].listing.descriptionTruncated, true);
  assert.equal(result.results[0].listing.imageCount, 20);
  assert.equal("gallery" in result.results[0].listing, false);
  assert.ok(!JSON.stringify(result.results).includes("cache.willhaben.at"));
  const final = await invokeTool("inspect_listings", { ...args, cursor: result.nextCursor, fields: ["description", "gallery"], descriptionLimit: 6000 }, live);
  assert.deepEqual(calls, ["1", "2", "3", "4", "5", "6"]);
  assert.equal(final.results[0].listing.description.length, 6000);
  assert.equal(final.results[0].listing.descriptionLength, 9000);
  assert.equal(final.results[0].listing.gallery.items.length, 8);
  assert.equal(final.results[0].listing.gallery.nextIndex, 8);
  assert.equal(final.nextCursor, null);
});

test("detail cooldown preserves earlier results and resumes at the denied ID", async t => {
  let denied = true;
  const calls = [];
  t.mock.method(globalThis, "fetch", async target => {
    const id = new URL(target).searchParams.get("adId");
    calls.push(id);
    if (id === "2" && denied) return new Response("slow down", { status: 429, headers: { "retry-after": "120" } });
    return embedded({ advertDetails: raw(id) });
  });
  const args = { source: "live", ids: ["1", "2", "3"] };
  const result = await invokeTool("inspect_listings", args, live);
  assert.deepEqual(result.results.map(item => item.id), ["1"]);
  assert.equal(result.remainingCount, 2);
  assert.deepEqual(result.failedIds, ["2"]);
  assert.equal(result.stopReason, "upstream_rate_limited");
  assert.ok(result.retryAt);
  assert.ok(result.retryAfterSeconds >= 119);
  denied = false;
  const next = await invokeTool("inspect_listings", { ...args, cursor: result.nextCursor }, live);
  assert.deepEqual(next.results.map(item => item.id), ["2", "3"]);
  assert.deepEqual(calls, ["1", "2", "2", "3"]);
  assert.equal(next.nextCursor, null);
});

test("an expired detail-call budget retains every requested ID in its continuation", async () => {
  const args = { source: "provided", ids: ["1", "2", "3"], listings: catalog(3) };
  const result = await invokeTool("inspect_listings", args, { REQUEST_DEADLINE: Date.now() - 1 });
  assert.equal(result.stopReason, "time_budget");
  assert.equal(result.results.length, 0);
  assert.equal(result.remainingCount, 3);
  const next = await invokeTool("inspect_listings", { ...args, cursor: result.nextCursor });
  assert.equal(next.results.length, 3);
  await assert.rejects(invokeTool("inspect_listings", { ...args, ids: ["1", "2"], cursor: result.nextCursor }), { code: "invalid_cursor" });
});

test("gallery batching reaches every index beyond eleven and links mode avoids binary requests", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async target => {
    const url = String(target);
    calls.push(url);
    if (url.startsWith("https://cache.willhaben.at")) return new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
    return embedded({ advertDetails: raw(123, 17) });
  });
  const result = await invokeTool("inspect_listing_images", { id: "123", start: 12 }, live);
  assert.equal(result.galleryTotal, 17);
  assert.equal(result.galleryComplete, true);
  assert.deepEqual(result.results.map(image => image.index), [12, 13, 14, 15]);
  assert.equal(result.nextIndex, 16);
  assert.equal(result._images.length, 4);
  assert.equal(result.status, "partial");
  const last = await invokeTool("inspect_listing_images", { id: "123", start: result.nextIndex, mode: "links" }, live);
  assert.deepEqual(last.results.map(image => image.index), [16]);
  assert.equal(last.nextIndex, null);
  assert.equal(last.status, "complete");
  assert.equal(last._images.length, 0);
  assert.equal(calls.filter(url => url.startsWith("https://cache.willhaben.at")).length, 4);
  const selected = await invokeTool("inspect_listing_images", { id: "123", indices: [16, 0], size: "thumbnail", mode: "links" }, live);
  assert.deepEqual(selected.results.map(image => image.url), [thumbnail(16), thumbnail(0)]);
  assert.deepEqual(selected.remainingIndices, []);
  const legacy = await invokeTool("inspect_listing_image", { id: "123", index: 16 }, live);
  assert.equal(legacy.index, 16);
  assert.equal(legacy._images[0].data, png);
});

test("photo permission is checked before fetching listing details", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Unexpected request"); });
  await assert.rejects(invokeTool("inspect_listing_images", { id: "1" }, { LIVE_ACCESS: "personal_test" }), { code: "image_access_not_configured" });
  await assert.rejects(invokeTool("inspect_listing_image", { id: "1", index: 0 }, { LIVE_ACCESS: "personal_test" }), { code: "image_access_not_configured" });
  assert.equal(calls, 0);
});

test("photo cooldown preserves already-read images and the first unprocessed gallery index", async t => {
  t.mock.method(globalThis, "fetch", async target => {
    const url = String(target);
    if (url === photo(13)) return new Response("wait", { status: 429, headers: { "retry-after": "120" } });
    if (url.startsWith("https://cache.willhaben.at")) return new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
    return embedded({ advertDetails: raw(123, 17) });
  });
  const result = await invokeTool("inspect_listing_images", { id: "123", start: 12 }, live);
  assert.deepEqual(result.results.map(image => image.index), [12]);
  assert.equal(result.errors[0].index, 13);
  assert.equal(result.errors[0].code, "upstream_rate_limited");
  assert.ok(result.errors[0].retryAt);
  assert.equal(result.nextIndex, 13);
  assert.equal(result._images.length, 1);
  const { _images, ...metadata } = result;
  assert.ok(!JSON.stringify(metadata).includes(png));
});

test("combined image output stops below 8 MiB and keeps the next image addressable", async t => {
  const bytes = new Uint8Array(3 * 1024 * 1024);
  bytes.set(Buffer.from(png, "base64"));
  t.mock.method(globalThis, "fetch", async () => new Response(bytes, {
    headers: { "content-type": "image/png", "content-length": String(bytes.length) },
  }));
  const result = await imageBatch([0, 1].map(index => ({ id: "123", index, url: photo(index), size: "full" })), live);
  assert.equal(result.results.length, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.stopReason, "response_budget");
  assert.equal(result.errors[0].index, 1);
  assert.ok(JSON.stringify(result).length < 8 * 1024 * 1024);
});

test("interrupted photo bodies preserve the failed index for timeout and network errors", async t => {
  let bodyError = new DOMException("The stream timed out", "TimeoutError");
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(255, 216, 255, 0));
      setTimeout(() => controller.error(bodyError), 5);
    },
  }), { headers: { "content-type": "image/jpeg" } }));
  const requests = [0, 1].map(index => ({ id: "123", index, url: photo(index), size: "full" }));
  const timedOut = await imageBatch(requests, live);
  assert.equal(timedOut.stopReason, "upstream_timeout");
  assert.equal(timedOut.processed, 0);
  assert.equal(timedOut.errors[0].recoverable, true);
  bodyError = new TypeError("terminated");
  const interrupted = await imageBatch(requests, live);
  assert.equal(interrupted.stopReason, "upstream_unavailable");
  assert.equal(interrupted.processed, 0);
  assert.equal(interrupted.errors[0].index, 0);
  bodyError = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
  const reset = await imageBatch(requests, live);
  assert.equal(reset.stopReason, "upstream_unavailable");
  assert.equal(reset.processed, 0);
  assert.equal(reset.errors[0].recoverable, true);
});

test("photo body deadline applies through the entire gallery call", async t => {
  t.mock.method(globalThis, "fetch", async (_target, { signal }) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(255, 216, 255, 0));
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
  }), { headers: { "content-type": "image/jpeg" } }));
  const keepAlive = setTimeout(() => {}, 500);
  try {
    const deadline = Date.now() + 160;
    const result = await imageBatch([{ id: "123", index: 14, url: photo(14), size: "full" }], { ...live, REQUEST_DEADLINE: deadline });
    assert.equal(result.processed, 0);
    assert.equal(result.stopReason, "time_budget");
    assert.equal(result.errors[0].index, 14);
  } finally { clearTimeout(keepAlive); }
});

test("gallery completeness and original observation time remain explicit", async () => {
  const observedAt = "2026-11-01T01:00:00.000Z";
  const provider = { async detail() { return { id: "123", images: [photo(0)], galleryComplete: false, observedAt, cacheAgeSeconds: 150 }; } };
  const result = await readGallery({ id: "123", mode: "links" }, live, provider);
  assert.equal(result.galleryComplete, false);
  assert.equal(result.status, "partial");
  assert.equal(result.listingObservedAt, observedAt);
  assert.equal(result.cacheAgeSeconds, 150);
});

test("cover and gallery responses identify a full-size fallback when native thumbnails are absent", async t => {
  const row = { ...raw(123), advertImageList: { advertImage: [{ mainImageUrl: photo(0) }] } };
  t.mock.method(globalThis, "fetch", async target => {
    const url = new URL(target);
    if (url.hostname === "cache.willhaben.at") return new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
    return embedded(url.pathname === "/iad/object" ? { advertDetails: row } : page([row]));
  });
  const gallery = await invokeTool("inspect_listing_images", { id: "123", size: "thumbnail" }, live);
  assert.equal(gallery.results[0].size, "full");
  const search = await invokeTool("search_listings", { source: "live", query: "Lampe", images: "thumbnails" }, live);
  assert.equal(search.coverImages.results[0].size, "full");
});

test("facet overview and targeted values are compact and paginate beyond former value caps", async () => {
  const args = { source: "provided", query: "Lampenglas", listings: catalog(100) };
  const overview = await invokeTool("discover_filters", args);
  const category = overview.dimensions.find(dimension => dimension.id === "categoryId");
  assert.equal(category.valueCount, 100);
  assert.equal(category.examples.length, 3);
  assert.equal(category.upstreamTruncated, false);
  const selected = { ...args, dimension: "categoryId", limit: 50 };
  const first = await invokeTool("discover_filters", selected);
  assert.equal(first.values.length, 50);
  assert.equal(first.matchingValues, 100);
  const second = await invokeTool("discover_filters", { ...selected, cursor: first.nextCursor });
  assert.equal(second.values[0].value, 51);
  assert.equal(second.values.length, 50);
  assert.equal(second.nextCursor, null);
  const exact = await invokeTool("discover_filters", { ...args, filter: "categoryId", valueQuery: "Category 99" });
  assert.deepEqual(exact.values.map(value => value.value), [100]);
  await assert.rejects(invokeTool("discover_filters", { ...args, dimension: "areaId", cursor: first.nextCursor }), { code: "invalid_cursor" });
});

test("model discovery emits search text without suggesting an unsupported model filter", async () => {
  const result = await invokeTool("discover_filters", { source: "demo", query: "iPhone", dimension: "model" });
  assert.ok(result.values.length);
  for (const value of result.values) {
    assert.equal("filter" in value, false);
    assert.equal(value.searchText, value.value);
  }
  const overview = await invokeTool("discover_filters", { source: "demo", query: "iPhone" });
  assert.equal(overview.dimensions.find(dimension => dimension.id === "model").filterable, false);
});

test("live filter overview can paginate all upstream dimensions", async t => {
  const navigatorList = Array.from({ length: 35 }, (_, index) => ({ id: "facet-" + index, label: "Facet " + index,
    possibleValues: Array.from({ length: 60 }, (_, value) => ({ label: "Value " + value, hits: value,
      urlParamRepresentationForValue: [{ urlParameterName: "treeAttributes", value: value + 1 }] })),
  }));
  t.mock.method(globalThis, "fetch", async () => embedded(page([raw(1)], 1, 1, [{ navigatorList }])));
  const args = { source: "live", query: "Lampe" };
  const overview = await invokeTool("discover_filters", args, live);
  assert.equal(overview.dimensionCount, 35);
  assert.equal(overview.dimensions.length, 10);
  assert.equal(overview.dimensions[0].valueCount, 60);
  assert.equal(overview.dimensions[0].examples.length, 3);
  const next = await invokeTool("discover_filters", { ...args, cursor: overview.nextCursor }, live);
  assert.equal(next.dimensions[0].id, "facet-10");
  const selected = await invokeTool("discover_filters", { ...args, dimension: "facet-34", valueQuery: "Value 59" }, live);
  assert.equal(selected.values[0].value, 60);
});

test("native search URL import preserves implicit page size and flags unrepresented parameters", async t => {
  const parsed = await invokeTool("parse_search_url", { url: "https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?keyword=Glas&page=2" });
  assert.equal(parsed.pageSize, 30);
  assert.equal(parsed.page, 2);
  assert.equal(parsed.fullyRepresented, true);
  t.mock.method(globalThis, "fetch", async target => {
    const url = new URL(target);
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(url.searchParams.get("rows"), "30");
    return embedded(page([raw(101)], 2));
  });
  const result = await invokeTool("search_listings", parsed.searchArguments, live);
  assert.equal(result.page, 2);
  const unknown = await invokeTool("parse_search_url", { url: "https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?keyword=Glas&unsupported=1" });
  assert.equal(unknown.fullyRepresented, false);
  assert.deepEqual(unknown.unsupportedParameters, [{ name: "unsupported", values: ["1"] }]);
  assert.ok(unknown.nextStep);
});

test("study continuation is accepted by search_listings without a new aggregate claim", async () => {
  const listings = catalog(60);
  const report = await invokeTool("study_market", { source: "provided", listings, queries: ["Lampenglas"], maxPages: 1, maxDetails: 0 });
  const continuation = report.coverage.queries[0].continuation;
  assert.equal(continuation.tool, "search_listings");
  assert.equal(continuation.pageSize, 50);
  const next = await invokeTool("search_listings", { source: "provided", listings, query: "Lampenglas", pageSize: 50, cursor: continuation.cursor });
  assert.equal(next.items.length, 10);
  assert.equal(next.items[0].id, "51");
  assert.equal(report.counts.unique, 50);
});

test("refresh policy does not invalidate comparable saved search definitions", async () => {
  const snapshots = new Map();
  const STUDIES = {
    async put(id, value) { snapshots.set(id, value); },
    async get(id) { return JSON.parse(snapshots.get(id)); },
  };
  const listings = Array.from({ length: 6 }, (_, index) => ({ id: String(index + 1), title: "Lampenglas", price: 20 + index,
    category: "Glas", model: "Kugel", condition: "used", quantity: 1 }));
  const before = await invokeTool("save_study", { source: "provided", queries: ["Lampenglas"], listings, fresh: false }, { STUDIES });
  const after = await invokeTool("save_study", { source: "provided", queries: ["Lampenglas"],
    listings: listings.map(row => ({ ...row, price: row.price + 10 })), fresh: true }, { STUDIES });
  const result = await invokeTool("compare_studies", { before: before.study_id, after: after.study_id }, { STUDIES });
  assert.equal(result.sameDefinition, true);
  assert.equal(result.cohorts[0].medianChangeEUR, 10);
});
