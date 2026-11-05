import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/worker.mjs";

const protocol = "2026-07-28";
const endpoint = "https://market.example/mcp";
const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };

const message = (method, params = {}) => ({ jsonrpc: "2.0", id: 7, method, params });
function post(body, overrides = {}, env = {}) {
  return worker.fetch(new Request(endpoint, {
    method: "POST", headers: { ...headers, ...overrides }, body: JSON.stringify(body),
  }), env);
}
function stateless(method, params = {}) {
  const meta = { "io.modelcontextprotocol/protocolVersion": protocol,
    "io.modelcontextprotocol/clientInfo": { name: "protocol-test", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {} };
  return message(method, { ...params, _meta: meta });
}
const modernHeaders = (method, name) => ({ "MCP-Protocol-Version": protocol, "Mcp-Method": method,
  ...(name ? { "Mcp-Name": name } : {}) });

test("health, human setup and route boundaries", async () => {
  for (const [path, status] of [["/", 200], ["/health", 200], ["/mcp", 405], ["/other", 404]]) {
    const res = await worker.fetch(new Request(new URL(path, endpoint)));
    assert.equal(res.status, status);
    if (path === "/") assert.match(await res.text(), /https:\/\/market\.example\/mcp/);
    if (path === "/health") assert.equal((await res.json()).liveEnabled, false);
    if (path === "/mcp") assert.equal(res.headers.get("allow"), "POST");
  }
});

test("legacy ChatGPT-style HTTP handshake, list, call and notification over a loopback socket", async () => {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const result = await worker.fetch(new Request(new URL(req.url, endpoint), {
      method: req.method, headers: req.headers, body: Buffer.concat(chunks),
    }));
    res.writeHead(result.status, Object.fromEntries(result.headers));
    res.end(Buffer.from(await result.arrayBuffer()));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const rpc = (msg) => fetch("http://127.0.0.1:" + server.address().port + "/mcp", {
      method: "POST", headers, body: JSON.stringify(msg),
    });
    const init = await (await rpc(message("initialize", { protocolVersion: "2025-11-25",
      clientInfo: { name: "integration-test", version: "1" }, capabilities: {} }))).json();
    assert.deepEqual(init.result.capabilities, { tools: {} });
    assert.equal(init.result.protocolVersion, "2025-11-25");
    assert.equal(init.result.serverInfo.name, "marktplatz-studie");
    const notification = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(notification.status, 202);
    assert.equal(await notification.text(), "");
    const list = await (await rpc(message("tools/list"))).json();
    const defs = list.result.tools;
    for (const tool of ["discover_filters", "search_listings", "inspect_listings", "study_market"])
      assert.ok(defs.some((def) => def.name === tool && def.inputSchema.type === "object"), tool);
    const detail = await (await rpc(message("tools/call", { name: "discover_filters",
      arguments: { source: "demo", query: "BANKAMP" } }))).json();
    assert.ok(!detail.result.isError, JSON.stringify(detail));
    assert.deepEqual(JSON.parse(detail.result.content[0].text), detail.result.structuredContent);
    assert.equal((await (await rpc(message("ping"))).json()).id, 7);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("modern discovery, cached shared tool definitions, private per-call data and routing headers", async () => {
  const discovery = await post(stateless("server/discover"), modernHeaders("server/discover"));
  const found = (await discovery.json()).result;
  assert.equal(found.resultType, "complete");
  assert.ok(found.supportedVersions.includes(protocol));
  assert.equal(found._meta["io.modelcontextprotocol/serverInfo"].name, "marktplatz-studie");
  const list = await post(stateless("tools/list"), modernHeaders("tools/list"));
  assert.equal((await list.json()).result.cacheScope, "public");
  const call = stateless("tools/call", { name: "discover_filters", arguments: { source: "demo", query: "BANKAMP" } });
  const valid = await post(call, modernHeaders("tools/call", "discover_filters"));
  assert.equal(valid.headers.get("cache-control"), "no-store");
  const result = (await valid.json()).result;
  assert.equal(result.resultType, "complete");
  assert.ok(!result.isError);
  const encoded = await post(call, modernHeaders("tools/call", "=?base64?" + btoa("discover_filters") + "?="));
  assert.equal(encoded.status, 200);
  for (const badHeaders of [modernHeaders("tools/call"), modernHeaders("ping", "discover_filters"),
    modernHeaders("tools/call", "wrong_tool"), { "Mcp-Method": "tools/call", "Mcp-Name": "discover_filters" }]) {
    const mismatch = await post(call, badHeaders);
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json()).error.code, -32020);
  }
  const invalid = stateless("tools/list");
  delete invalid.params._meta["io.modelcontextprotocol/clientInfo"];
  assert.equal((await (await post(invalid, modernHeaders("tools/list"))).json()).error.code, -32602);
  const badVersion = await post(message("ping"), { "MCP-Protocol-Version": "1900-01-01" });
  assert.equal((await badVersion.json()).error.code, -32022);
  const unknown = await post(stateless("unregistered/method"), modernHeaders("unregistered/method"));
  assert.equal(unknown.status, 404);
});

test("MCP access stays closed for hostile origins and unprotected live configuration", async () => {
  const ping = message("ping");
  assert.equal((await post(ping, { origin: "https://chatgpt.com.evil.test" })).status, 403);
  assert.equal((await post(ping, { origin: "null" })).status, 403);
  assert.equal((await post(ping, { origin: "https://chatgpt.com" })).status, 200);
  assert.equal((await post(ping, {}, { LIVE_ACCESS: "authorized" })).status, 503);
  const env = { LIVE_ACCESS: "authorized", MCP_BEARER_TOKEN: "unit-test-secret" };
  assert.equal((await post(ping, {}, env)).status, 401);
  assert.equal((await post(ping, { authorization: "Bearer unrelated" }, env)).status, 401);
  assert.equal((await post(ping, { authorization: "Bearer unit-test-secret" }, env)).status, 200);
  assert.equal((await post(ping, {}, { MCP_BEARER_TOKEN: "unit-test-secret" })).status, 401);
});

test("malformed, oversized, batch and invalid tool requests have explicit errors", async () => {
  assert.equal((await post(message("ping"), { "content-type": "text/plain" })).status, 415);
  assert.equal((await post(message("ping"), { accept: "text/event-stream" })).status, 406);
  const badJson = await worker.fetch(new Request(endpoint, { method: "POST", headers, body: "{" }));
  assert.equal((await badJson.json()).error.code, -32700);
  const huge = message("ping", { data: "a".repeat(2 * 1024 * 1024) });
  assert.equal((await post(huge)).status, 413);
  assert.equal((await (await post([message("ping")])).json()).error.code, -32600);
  assert.equal((await (await post(message("tools/call", { name: "missing" }))).json()).error.code, -32602);
  assert.equal((await (await post(message("tools/call", { name: "search_listings", arguments: [] }))).json()).error.code, -32602);
});

test("rate-limit binding returns a retry time and scopes requests to the Cloudflare client IP", async () => {
  const seen = [];
  const REQUEST_LIMITER = { async limit({ key }) { seen.push(key); return { success: seen.length === 1 }; } };
  const client = { "cf-connecting-ip": "192.0.2.1" };
  assert.equal((await post(message("ping"), client, { REQUEST_LIMITER })).status, 200);
  const deny = await post(message("ping"), client, { REQUEST_LIMITER });
  assert.equal(deny.status, 429);
  assert.equal(deny.headers.get("Retry-After"), "60");
  assert.deepEqual(seen, ["192.0.2.1", "192.0.2.1"]);
});

test("real MCP study walks four pages per variant and never prices unknown or contradicted specifications", async () => {
  const listings = Array.from({length:120}, (_, i) => ({
    id: String(i+1), title: "BANKAMP Lampenglas " + i, model: "Kugel 60", category: "Glas", condition: "used",
    quantity: 1, price: 30 + i, attributes: i < 118 ? { diameterMm:60 } : i === 118 ? {} : { diameterMm:50 },
  }));
  const response = await post(message("tools/call", { name: "study_market", arguments: {
    source: "provided", queries: ["BANKAMP", "Lampenglas"], criteria: [{key:"diameterMm",value:60}],
    listings, maxPages: 12, maxDetails: 1,
  } }));
  const rpc = await response.json();
  assert.ok(!rpc.result.isError, JSON.stringify(rpc.result.content));
  const report = rpc.result.structuredContent;
  assert.equal(report.source, "provided");
  assert.equal(report.coverage.searchExhausted, true);
  assert.equal(report.coverage.detailsComplete, false);
  assert.deepEqual(report.coverage.queries.map(q=>q.pages), [4,4]);
  assert.equal(report.counts.raw, 240);
  assert.equal(report.counts.unique, 120);
  assert.equal(report.counts.confirmed, 118);
  assert.equal(report.counts.unknown, 1);
  assert.equal(report.counts.contradicted, 1);
  assert.equal(report.cohorts[0].askingEUR.n, 118);
  assert.equal(report.cohorts[0].askingEUR.median, 88.5);
});

test("snapshot differences reflect observed cohort prices and missing capabilities fail closed", async () => {
  const kv = new Map();
  const STUDIES = {
    async put(key, value, cfg) { assert.equal(cfg.expirationTtl, 86400); kv.set(key, value); },
    async get(key, mode) { assert.equal(mode, "json"); return kv.has(key) ? JSON.parse(kv.get(key)) : null; },
  };
  async function call(name, args) {
    return (await (await post(message("tools/call", { name, arguments: args }), {}, {STUDIES})).json()).result;
  }
  function catalog(delta) {
    return Array.from({length:6}, (_,i)=>({ id:String(301+i), title:"Lens cap",model:"EF",
      category:"Lid",condition:"used",quantity:1,price:10+i+delta }));
  }
  const read = await call("study_market", {source:"provided", queries:["lens"], listings:catalog(0)});
  assert.equal(read.structuredContent.cohorts[0].askingEUR.median, 12.5);
  assert.equal(kv.size, 0);
  const a = (await call("save_study",{source:"provided", queries:["lens"], listings:catalog(0)})).structuredContent;
  const b = (await call("save_study",{source:"provided", queries:["lens"], listings:catalog(5)})).structuredContent;
  assert.notEqual(a.study_id, b.study_id);
  assert.equal(kv.size, 2);
  const changed = (await call("compare_studies", {before:a.study_id,after:b.study_id})).structuredContent;
  assert.equal(changed.sameDefinition, true);
  assert.equal(changed.cohorts[0].medianChangeEUR, 5);
  assert.equal((await call("get_study", {study_id:"ms_"+"0".repeat(32)})).isError, true);
});

test("photo tools return real MCP image blocks only for the configured live image scope", async (t) => {
  const calls = [];
  const photo = "https://cache.willhaben.at/mmo/fixtures/photo.png";
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    if (String(url) === photo) return new Response(Buffer.from(png, "base64"), {headers:{ "content-type":"image/png" }});
    assert.equal(String(url), "https://www.willhaben.at/iad/object?adId=12345");
    const advertDetails = {id:"12345",verticalId:5,description:"Ersatzglas",attributes:{attribute:[]},
      advertImageList:{advertImage:[{mainImageUrl:photo}]}};
    return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({props:{pageProps:{advertDetails}}}) + '</script>');
  });
  const request = message("tools/call",{name:"inspect_listing_image",arguments:{id:"12345",index:0}});
  const auth = {authorization:"Bearer test-token"};
  const env = { LIVE_ACCESS:"authorized", MCP_BEARER_TOKEN:"test-token" };
  let result = (await (await post(request,auth,env)).json()).result;
  assert.equal(result.isError, true);
  assert.deepEqual(calls, []);
  result = (await (await post(request,auth,{...env, IMAGE_ACCESS:"authorized"})).json()).result;
  assert.ok(!result.isError, JSON.stringify(result.content[0]));
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].mimeType, "image/png");
  assert.equal(result.content[1].data, png);
  assert.equal(result.structuredContent.id, "12345");
  assert.ok(!result.content[0].text.includes(png));
  assert.ok(!JSON.stringify(result.structuredContent).includes(png));
});
