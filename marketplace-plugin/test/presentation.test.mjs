import assert from "node:assert/strict";
import { test } from "node:test";
import { invokeTool, toolDefinitions } from "../src/tools.mjs";
import { getProvider } from "../src/providers.mjs";
import { responseCooldown } from "../src/traffic.mjs";
import { PRESENTATION_URI } from "../src/presentation-ui.mjs";
import worker from "../src/worker.mjs";
import { readMcpResponse } from "./mcp-response.mjs";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const photo = (id, index = 0) => `https://cache.willhaben.at/mmo/fixtures/${id}-${index}.png`;
const listing = (id, extra = {}) => ({ id: String(id), title: "Lampe " + id, price: 40,
  url: `https://www.willhaben.at/iad/kaufen-und-verkaufen/d/lampe-${id}/`,
  location: "Wien", images: [photo(id)], ...extra });
const live = { LIVE_ACCESS: "personal_test", IMAGE_ACCESS: "personal_test" };

function observations() {
  const entries = new Map(), reads = [], slots = [];
  const gate = {
    async getCached(key) { reads.push(key); return structuredClone(entries.get(key) ?? null); },
    async acquire(origin) { slots.push(origin); return { granted: true }; },
    async report(_origin, report) { return responseCooldown(report, Date.now(), 0); },
  };
  return { entries, reads, slots, env: { ...live, ORIGIN_GATE: { getByName() { return gate; } } },
    set(key, row, age = 0) {
      entries.set(key, { value: row, observedAt: new Date(Date.now() - age * 1000).toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString() });
    },
  };
}

test("presentation selection exposes canonical facts, separate assessments and unknown original times", async t => {
  const fetcher = t.mock.method(globalThis, "fetch", () => assert.fail("Presentation must not research details"));
  const listings = [listing(1, { quantity: 2, shippingCost: 4.5, shipping: "both", attributes: { diameterMm: 60 } }),
    listing(2, { price: null, priceType: "on_request" })];
  const result = await invokeTool("present_listings", { source: "provided", listings,
    selections: [{ id: "2", reason: "Bauform näher prüfen", cautions: ["Maße offen"] }, { id: "1" }],
    title: "Zwei passende Kandidaten", criteria: [{ key: "diameterMm", value: 60 }] });
  assert.deepEqual(result.cards.map(card => [card.id, card.rank]), [["2", 1], ["1", 2]]);
  assert.equal(result.cards[0].assessment.evaluation.status, "unknown");
  assert.equal(result.cards[1].assessment.evaluation.status, "confirmed");
  assert.equal(result.cards[1].unitPrice, 20);
  assert.equal(result.cards[1].totalPrice, 44.5);
  assert.equal(result.cards[0].unitPrice, undefined);
  assert.equal(result.cards[0].sellerType, undefined);
  assert.equal(result.cards[0].price, null);
  assert.deepEqual(result.cards[0].assessment.cautions, ["Maße offen"]);
  assert.ok(result.cards.every(card => card.observedAt === null && card.cacheAgeSeconds === null));
  assert.ok(result.cards.every(card => card.image.status === "not_enabled"));
  assert.equal(result._meta.listingImages.length, 0);
  assert.equal(fetcher.mock.callCount(), 0);
  assert.equal(result.requestedCount, 2);
  assert.equal(result.shownCount, 2);
});

test("presentation without criteria preserves an unevaluated fit and marks real photo absence", async () => {
  const result = await invokeTool("present_listings", { source: "provided", listings: [listing(1, { images: [] })],
    selections: [{ id: "1" }, { id: "99" }] });
  assert.equal(result.cards[0].assessment.evaluation, null);
  assert.equal(result.cards[0].image.status, "missing");
  assert.equal(result.cards[0].image.url, null);
  assert.deepEqual(result.missingIds, ["99"]);
  assert.match(result.nextAction, /inspect_listings/);
  const demo = await invokeTool("present_listings", { source: "demo", selections: [{ id: "demo-glass-01" }] });
  assert.equal(demo.source, "demo");
  assert.equal(demo.cards[0].url, null);
  assert.equal(demo.cards[0].image.status, "missing");
});

test("presentation rejects malformed selections and external sources before I/O", async t => {
  const storage = observations();
  const fetcher = t.mock.method(globalThis, "fetch", () => assert.fail("Invalid arguments must not fetch"));
  const base = { source: "live", selections: [{ id: "1" }] };
  for (const args of [
    { ...base, selections: [] },
    { ...base, selections: Array.from({ length: 1001 }, (_, i) => ({ id: String(i + 1) })) },
    { ...base, selections: [{ id: "1" }, { id: "1" }] },
    { ...base, selections: [{ id: "foreign-id" }] },
    { ...base, selections: [{ id: "1", photoIndex: -1 }] },
    { ...base, selections: [{ id: "1", reason: "x".repeat(281) }] },
    { ...base, selections: [{ id: "1", fakePrice: 1 }] },
    { ...base, criteria: [{ key: "constructor", value: "x" }] },
    { ...base, extra: true },
    { source: "provided", listings: [listing(1, { url: "https://evil.test/offer" })], selections: [{ id: "1" }] },
    { source: "provided", listings: [listing(1, { images: ["https://evil.test/photo.png"] })], selections: [{ id: "1" }] },
  ]) await assert.rejects(invokeTool("present_listings", args, storage.env), { code: "invalid_input" });
  assert.deepEqual(storage.reads, []);
  assert.equal(fetcher.mock.callCount(), 0);
});

test("cached presentation uses the newest whole observation and honors newer tombstones", async t => {
  const storage = observations();
  t.mock.method(globalThis, "fetch", () => assert.fail("No image or detail fetch expected"));
  storage.set("summary:1", listing(1, { images: [], price: 50, condition: "used" }), 90);
  storage.set("detail:1", listing(1, { images: [], price: 45, condition: "as_new", quantity: 2 }), 30);
  const args = { source: "live", selections: [{ id: "1" }] };
  const newerDetail = await invokeTool("present_listings", args, storage.env);
  assert.equal(newerDetail.cards[0].price, 45);
  assert.equal(newerDetail.cards[0].condition, "as_new");
  assert.equal(newerDetail.cards[0].cacheAgeSeconds, 30);
  assert.equal(newerDetail.cards[0].observedAt, storage.entries.get("detail:1").observedAt);
  storage.set("summary:1", listing(1, { images: [], price: 42 }), 10);
  const newerSearch = await invokeTool("present_listings", args, storage.env);
  assert.equal(newerSearch.cards[0].price, 42);
  assert.equal(newerSearch.cards[0].condition, undefined);
  assert.equal(newerSearch.cards[0].quantity, undefined);
  assert.equal(newerSearch.cards[0].cacheAgeSeconds, 10);
  const tie = storage.entries.get("summary:1").observedAt;
  storage.entries.get("detail:1").observedAt = tie;
  assert.equal((await getProvider("live", storage.env).summary("1")).quantity, 2);
  storage.set("detail:1", { id: "1", gone: true });
  assert.equal(await getProvider("live", storage.env).summary("1"), null);
});

test("selected photos are hydrated privately with exact listing and photo identities", async t => {
  const storage = observations();
  storage.set("summary:1", listing(1), 20);
  storage.set("detail:2", listing(2, { images: [photo(2, 0), photo(2, 1)] }), 10);
  const seen = [];
  t.mock.method(globalThis, "fetch", async target => {
    const url = String(target);
    seen.push(url);
    assert.ok(url.startsWith("https://cache.willhaben.at/mmo/"));
    return new Response(Buffer.concat([Buffer.from(png, "base64"), Buffer.from(url.endsWith("2-1.png") ? "2" : "1")]),
      { headers: { "content-type": "image/png" } });
  });
  const result = await invokeTool("present_listings", { source: "live",
    selections: [{ id: "2", photoIndex: 1 }, { id: "1" }] }, storage.env);
  assert.deepEqual(seen, [photo(2, 1), photo(1)]);
  assert.deepEqual(result.cards.map(card => [card.id, card.image.index, card.image.status]), [["2", 1, "ready"], ["1", 0, "ready"]]);
  assert.deepEqual(result._meta.listingImages.map(image => [image.id, image.index]), [["2", 1], ["1", 0]]);
  assert.notEqual(result._meta.listingImages[0].data, result._meta.listingImages[1].data);
  const { _meta, ...modelData } = result;
  assert.ok(!JSON.stringify(modelData).includes(png.slice(0, 40)));
  assert.equal(result._images, undefined);
  assert.deepEqual(storage.slots, ["https://cache.willhaben.at", "https://cache.willhaben.at"]);
});

test("successful presentation separates a one-sentence display response from requested analysis", async t => {
  const storage = observations();
  storage.set("summary:1", listing(1));
  t.mock.method(globalThis, "fetch", async () => new Response(Buffer.from(png, "base64"), {
    headers: { "content-type": "image/png" },
  }));
  const result = await invokeTool("present_listings", { source: "live", selections: [{ id: "1" }] }, storage.env);
  assert.equal(result.cards[0].image.status, "ready");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.missingIds, []);
  assert.match(result.nextAction, /For a request to show offers, finish with one plain-text sentence pointing to the app cards/);
  assert.match(result.nextAction, /For requested advice or a study, add the requested decision analysis/);
  assert.match(result.nextAction, /Keep each offer's photos, facts and original links in the app cards/);
});

test("missing observations, unavailable indices and unsafe cached URLs retain explicit states", async t => {
  const storage = observations();
  const fetcher = t.mock.method(globalThis, "fetch", () => assert.fail("No speculative fetch"));
  storage.set("summary:1", listing(1, { url: "https://evil.test/offer", images: ["https://evil.test/photo.png"] }));
  storage.set("summary:2", listing(2));
  storage.set("summary:3", listing(999));
  const result = await invokeTool("present_listings", { source: "live", selections: [
    { id: "1" }, { id: "2", photoIndex: 9 }, { id: "3" }, { id: "4" },
  ] }, storage.env);
  assert.deepEqual(result.missingIds, ["3", "4"]);
  assert.match(result.nextAction, /Refresh the relevant search in the same researchId/);
  assert.equal(result.pageComplete, false);
  assert.equal(result.pageRequestedCount, 4);
  assert.equal(result.cards[0].url, null);
  assert.equal(result.cards[0].image.url, null);
  assert.equal(result.cards[1].image.status, "failed");
  assert.equal(result.cards[1].image.index, 9);
  assert.equal(result.cards[1].image.error.code, "photo_index_unavailable");
  assert.deepEqual(result.cards[1].image.error.availableIndices, [0]);
  assert.match(result.cards[1].image.error.nextAction, /photoIndex/);
  assert.ok(result.errors.some(error => error.code === "observation_mismatch"));
  assert.equal(fetcher.mock.callCount(), 0);
  const invalidPhoto = await invokeTool("present_listings", { source: "live", selections: [{ id: "2", photoIndex: 9 }] }, storage.env);
  assert.match(invalidPhoto.nextAction, /Correct photoIndex using image.error.availableIndices/);
});

test("one unavailable photo keeps the other selected cards and their image associations", async t => {
  const storage = observations();
  for (const id of [1, 2, 3]) storage.set("summary:" + id, listing(id));
  t.mock.method(globalThis, "fetch", async target => String(target) === photo(2)
    ? new Response("gone", { status: 404 })
    : new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } }));
  const result = await invokeTool("present_listings", { source: "live", selections: [1, 2, 3].map(id => ({ id: String(id) })) }, storage.env);
  assert.deepEqual(result.cards.map(card => card.image.status), ["ready", "failed", "ready"]);
  assert.deepEqual(result._meta.listingImages.map(image => image.id), ["1", "3"]);
  assert.equal(result.cards[1].image.error.code, "image_unavailable");
  assert.equal(result.errors[0].stage, "image");
  assert.match(result.nextAction, /retry the affected photos with inspect_listing_images/);
});

test("presentation preserves photo cooldown and remaining cards without extra image requests", async t => {
  const storage = observations(), seen = [];
  for (const id of [1, 2, 3]) storage.set("summary:" + id, listing(id));
  t.mock.method(globalThis, "fetch", async target => {
    seen.push(String(target));
    return String(target) === photo(2)
      ? new Response("wait", { status: 429, headers: { "retry-after": "1800" } })
      : new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
  });
  const result = await invokeTool("present_listings", { source: "live", selections: [1, 2, 3].map(id => ({ id: String(id) })) }, storage.env);
  assert.deepEqual(seen, [photo(1), photo(2)]);
  assert.deepEqual(result.cards.map(card => card.image.status), ["ready", "pending", "pending"]);
  assert.equal(result.cards[2].image.error.id, "3");
  assert.equal(result.cards[2].image.error.retryAt, result.retryAt);
  assert.ok(result.retryAfterSeconds >= 1799);
  assert.match(result.nextAction, /Respect retryAt/);
  assert.equal(result._meta.listingImages.length, 1);
});

test("app covers use observed main photos from search summaries and detail galleries", async t => {
  const storage = observations(), seen = [];
  storage.set("summary:1", listing(1, { gallery: [{ index: 0, url: photo(1), thumbnailUrl: photo(1, "thumb") }] }));
  storage.set("detail:2", listing(2, { gallery: [{ index: 0, url: photo(2), thumbnailUrl: photo(2, "thumb") }] }));
  t.mock.method(globalThis, "fetch", async target => {
    seen.push(String(target));
    return new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
  });
  const result = await invokeTool("present_listings", { source: "live", selections: [{ id: "1" }, { id: "2" }] }, storage.env);
  assert.deepEqual(seen, [photo(1), photo(2)]);
  assert.deepEqual(result.cards.map(card => card.image.size), ["full", "full"]);
  assert.equal(result._meta.listingImages.length, 2);
  const { _meta, ...modelData } = result;
  assert.equal(result._images, undefined);
  assert.equal(JSON.stringify(modelData).includes(png), false);
});

test("app covers fall back to observed thumbnails when main photos exceed the byte bound", async t => {
  const storage = observations(), seen = [];
  const thumb = photo(1, "thumb");
  storage.set("summary:1", listing(1, { gallery: [{ index: 0, url: photo(1), thumbnailUrl: thumb }] }));
  t.mock.method(globalThis, "fetch", async target => {
    seen.push(String(target));
    return String(target) === photo(1)
      ? new Response("oversize", { headers: { "content-type": "image/png", "content-length": String(5 * 1024 * 1024) } })
      : new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
  });
  const result = await invokeTool("present_listings", { source: "live", selections: [{ id: "1" }] }, storage.env);
  assert.deepEqual(seen, [photo(1), thumb]);
  assert.deepEqual(result.cards[0].image, { index: 0, url: thumb, status: "ready", size: "thumbnail" });
  assert.equal(result._meta.listingImages[0].data, png);
  assert.equal(storage.slots.length, 2);
});

test("app covers fall back to an observed thumbnail when the main photo returns 404", async t => {
  const storage = observations(), seen = [];
  const thumb = photo(1, "thumb");
  storage.set("summary:1", listing(1, { gallery: [{ index: 0, url: photo(1), thumbnailUrl: thumb }] }));
  t.mock.method(globalThis, "fetch", async target => {
    seen.push(String(target));
    return String(target) === photo(1) ? new Response("gone", { status: 404 })
      : new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
  });
  const result = await invokeTool("present_listings", { source: "live", selections: [{ id: "1" }] }, storage.env);
  assert.deepEqual(seen, [photo(1), thumb]);
  assert.deepEqual(result.cards[0].image, { index: 0, url: thumb, status: "ready", size: "thumbnail" });
  assert.deepEqual(result.errors, []);
  assert.equal(result._meta.listingImages.length, 1);
  assert.equal(result._meta.listingImages[0].data, png);
  assert.equal(result._images, undefined);
});

test("app thumbnail fallbacks respect forbidden and rate-limited photo responses", async t => {
  for (const [status, code] of [[403, "upstream_forbidden"], [429, "upstream_rate_limited"]]) {
    await t.test(String(status), async subtest => {
      const storage = observations(), seen = [];
      for (const id of [1, 2]) storage.set("summary:" + id, listing(id, {
        gallery: [{ index: 0, url: photo(id), thumbnailUrl: photo(id, "thumb") }],
      }));
      subtest.mock.method(globalThis, "fetch", async target => {
        seen.push(String(target));
        return String(target) === photo(1) ? new Response("wait", { status, headers: { "retry-after": "1800" } })
          : new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
      });
      const result = await invokeTool("present_listings", { source: "live", selections: [{ id: "1" }, { id: "2" }] }, storage.env);
      assert.deepEqual(seen, [photo(1)]);
      assert.deepEqual(result.cards.map(card => card.image.status), ["pending", "pending"]);
      assert.equal(result.errors[0].code, code);
      assert.ok(result.retryAt);
      assert.equal(result._meta.listingImages.length, 0);
    });
  }
});

test("private image hydration stays below the shared response budget and retains pending cards", async t => {
  const storage = observations();
  for (const id of [1, 2, 3]) storage.set("summary:" + id, listing(id));
  const bytes = new Uint8Array(3 * 1024 * 1024);
  bytes.set(Buffer.from(png, "base64"));
  t.mock.method(globalThis, "fetch", async () => new Response(bytes, { headers: {
    "content-type": "image/png", "content-length": String(bytes.length),
  } }));
  const result = await invokeTool("present_listings", { source: "live", selections: [1, 2, 3].map(id => ({ id: String(id) })) }, storage.env);
  assert.deepEqual(result.cards.map(card => card.image.status), ["ready", "pending", "pending"]);
  assert.ok(JSON.stringify(result).length < 8 * 1024 * 1024);
  assert.equal(result.errors[0].code, "response_budget");
  assert.equal(result._meta.listingImages.length, 1);
});

test("an expired presentation budget preserves every selected ID for a follow-up", async t => {
  const storage = observations();
  t.mock.method(globalThis, "fetch", () => assert.fail("No expired work"));
  const result = await invokeTool("present_listings", { source: "live", selections: [{ id: "1" }, { id: "2" }] },
    { ...storage.env, REQUEST_DEADLINE: Date.now() - 1 });
  assert.deepEqual(result.missingIds, ["1", "2"]);
  assert.equal(result.cards.length, 0);
  assert.equal(result.errors[0].code, "time_budget");
  assert.deepEqual(storage.reads, []);
});

const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
async function rpc(method, params = {}, env = {}, extraHeaders = {}) {
  const response = await worker.fetch(new Request("https://market.example/mcp", {
    method: "POST", headers: { ...headers, ...extraHeaders },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), env);
  return readMcpResponse(response);
}

test("only the presentation tool binds the UI resource and both MCP protocols discover and read it", async () => {
  const renderTools = toolDefinitions.filter(tool => tool._meta?.ui?.resourceUri);
  assert.deepEqual(renderTools.map(tool => tool.name), ["present_listings"]);
  assert.equal(renderTools[0]._meta["openai/outputTemplate"], PRESENTATION_URI);
  assert.equal(renderTools[0].inputSchema.properties.selections.maxItems, 1000);
  for (const tool of ["present_listings", "inspect_listings", "inspect_listing_images"]) {
    assert.ok(toolDefinitions.find(item => item.name === tool)._meta.ui.visibility.includes("app"));
  }
  const listed = (await rpc("resources/list")).result.resources;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].uri, PRESENTATION_URI);
  assert.equal(listed[0].mimeType, "text/html;profile=mcp-app");
  const read = (await rpc("resources/read", { uri: PRESENTATION_URI })).result.contents[0];
  assert.equal(read.uri, PRESENTATION_URI);
  assert.match(read.text, /<!doctype html>/i);
  assert.equal(read.mimeType, listed[0].mimeType);
  assert.deepEqual(read._meta.ui.csp.connectDomains, []);
  assert.match(read._meta["openai/widgetDescription"], /app cards/);
  assert.match(read._meta["openai/widgetDescription"], /photos, facts and original links/);
  assert.match(read._meta["openai/widgetDescription"], /For a request to show offers, finish with one plain-text sentence pointing to the app cards/);
  assert.match(read._meta["openai/widgetDescription"], /For advice or a study, add the requested decision analysis/);
  assert.deepEqual((await rpc("resources/templates/list")).result.resourceTemplates, []);
  assert.equal((await rpc("resources/read", { uri: "https://evil.test" })).error.code, -32602);
  assert.equal((await rpc("resources/list", { cursor: "next" })).error.code, -32602);
  const version = "2026-07-28";
  const modern = await rpc("resources/read", { uri: PRESENTATION_URI, _meta: {
    "io.modelcontextprotocol/protocolVersion": version,
    "io.modelcontextprotocol/clientInfo": { name: "ui-test", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  } }, {}, { "mcp-protocol-version": version, "mcp-method": "resources/read", "mcp-name": PRESENTATION_URI });
  assert.equal(modern.result.resultType, "complete");
  assert.equal(modern.result.contents[0].text, read.text);
});

test("current and previously advertised UI resource URIs remain readable", async () => {
  const uris = ["ui://marktplatz/listings-v1.html", "ui://marktplatz/listings-v2.html"];
  const current = (await rpc("resources/read", { uri: PRESENTATION_URI })).result.contents[0];
  for (const uri of uris) {
    for (const version of ["2025-11-25", "2026-07-28"]) {
      const modern = version === "2026-07-28";
      const params = { uri, ...(modern ? { _meta: {
        "io.modelcontextprotocol/protocolVersion": version,
        "io.modelcontextprotocol/clientCapabilities": {},
      } } : {}) };
      const response = await rpc("resources/read", params, {}, {
        "mcp-protocol-version": version,
        ...(modern ? { "mcp-method": "resources/read", "mcp-name": uri } : {}),
      });
      assert.ok(response.result, JSON.stringify(response.error));
      const resource = response.result.contents[0];
      assert.equal(resource.uri, uri);
      assert.equal(resource.text, current.text);
      assert.deepEqual(resource._meta, current._meta);
    }
  }
});

test("Worker keeps hydrated image bytes outside model text and structuredContent", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } }));
  const env = { LIVE_ACCESS: "authorized", IMAGE_ACCESS: "authorized", MCP_BEARER_TOKEN: "test-only-credential" };
  const result = (await rpc("tools/call", { name: "present_listings", arguments: {
    source: "provided", listings: [listing(1)], selections: [{ id: "1", reason: "Kandidat für die Sichtprüfung" }],
  } }, env, { authorization: "Bearer test-only-credential" })).result;
  assert.ok(!result.isError, JSON.stringify(result));
  assert.equal(result._meta.listingImages[0].data, png);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.ok(!result.content[0].text.includes(png));
  assert.ok(!JSON.stringify(result.structuredContent).includes(png));
  assert.equal(Object.hasOwn(result.structuredContent, "_meta"), false);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.structuredContent.cards[0].image.url, photo(1));
  const init = (await rpc("initialize", { protocolVersion: "2025-11-25", clientInfo: { name: "test", version: "1" }, capabilities: {} })).result;
  assert.equal(init.serverInfo.version, "1.5.1");
  assert.match(init.instructions, /present_listings/);
  assert.match(init.instructions, /twelve relevant offers/);
  assert.match(init.instructions, /immediately after the first useful search page/);
  assert.match(init.instructions, /For verification, purchase advice or a study, inspect a focused shortlist/);
  assert.match(init.instructions, /one plain-text sentence/);
  assert.match(init.instructions, /researchId/);
  assert.match(init.instructions, /actual photos before making visual claims/);
});
