import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { toolDefinitions } from "../src/tools.mjs";
import { PRESENTATION_URI } from "../src/presentation-ui.mjs";
import { readMcpResponse } from "./mcp-response.mjs";

const versions = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];
const token = "ab".repeat(32);
const runtime = new Miniflare({
  name: "willhaben-mcp-runtime-test", modules: true,
  scriptPath: fileURLToPath(new URL("../dist/index.mjs", import.meta.url)),
  compatibilityDate: "2026-06-01",
  bindings: { PERSONAL_TEST_TOKEN_SHA256: createHash("sha256").update(token).digest("hex") },
});

async function request(method, params = {}, { version = versions[0], path = "/mcp", headers = {} } = {}) {
  const modern = version === versions[0];
  const routing = modern ? { "Mcp-Method": method,
    ...(params.name || params.uri ? { "Mcp-Name": params.name ?? params.uri } : {}) } : {};
  const body = { jsonrpc: "2.0", id: 1, method, params: { ...params, ...(modern ? { _meta: {
    "io.modelcontextprotocol/protocolVersion": version,
    "io.modelcontextprotocol/clientCapabilities": {},
  } } : {}) } };
  return runtime.dispatchFetch("https://market.example" + path, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": version, ...routing, ...headers }, body: JSON.stringify(body),
  });
}

try {
  for (const version of versions) {
    const modern = version === versions[0];
    const handshake = modern
      ? await readMcpResponse(await request("server/discover", {}, { version }))
      : await readMcpResponse(await request("initialize", { protocolVersion: version,
        clientInfo: { name: "runtime-test", version: "1" }, capabilities: {} }, { version }));
    if (modern) {
      assert.deepEqual(handshake.result.supportedVersions, [version]);
      assert.equal(handshake.result._meta["io.modelcontextprotocol/serverInfo"].name, "willhaben");
    } else {
      assert.equal(handshake.result.protocolVersion, version);
      assert.equal(handshake.result.serverInfo.name, "willhaben");
    }
    const listed = await readMcpResponse(await request("tools/list", {}, { version }));
    assert.deepEqual(listed.result.tools.map(tool => tool.name), toolDefinitions.map(tool => tool.name));
    for (const method of ["resources/list", "resources/templates/list", "resources/read"]) {
      const params = method === "resources/read" ? { uri: PRESENTATION_URI } : {};
      const response = await request(method, params, { version });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const { result } = await readMcpResponse(response);
      assert.equal(result.resultType, modern ? "complete" : undefined);
      assert.equal(result.ttlMs, modern ? 60000 : undefined);
      assert.equal(result.cacheScope, modern ? "public" : undefined);
      if (method === "resources/read") assert.match(result.contents[0].text, /<!doctype html>/i);
    }
    const { result: searched } = await readMcpResponse(await request("tools/call", {
      name: "search_listings", arguments: { source: "demo", query: "BANKAMP", pageSize: 50 },
    }, { version }));
    assert.ok(!searched.isError, JSON.stringify(searched));
    assert.equal(searched.structuredContent.source, "demo");
    const malformed = await readMcpResponse(await request("tools/call", {
      name: "search_listings", arguments: ["private-input-value"],
    }, { version }));
    assert.equal(malformed.error.code, -32602);
    assert.ok(!JSON.stringify(malformed).includes("private-input-value"));
    console.log("PASS workerd MCP " + version + " handshake, catalog, UI resource, search and validation");
  }

  for (const uri of ["ui://marktplatz/listings-v1.html", "ui://marktplatz/listings-v2.html"]) {
    const { result } = await readMcpResponse(await request("resources/read", { uri }));
    assert.equal(result.contents[0].uri, uri);
  }

  const scopes = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const path = index % 2 ? "/p/" + token + "/mcp" : "/mcp";
    const response = await request("tools/call", { name: "plan_search", arguments: { queries: ["Bankerlampe"] } }, { path });
    const { result } = await readMcpResponse(response);
    assert.equal(result.structuredContent.liveAvailable, Boolean(index % 2));
    assert.equal(result.structuredContent.imageAvailable, Boolean(index % 2));
    assert.ok(!JSON.stringify(result).includes(token));
    if (index % 2) assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    return result;
  }));
  assert.equal(scopes.length, 8);
  console.log("PASS concurrent public and personal requests retain isolated access scope");

  assert.equal((await request("tools/list", {}, { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await request("tools/list", {}, { path: "/p/" + "cd".repeat(32) + "/mcp" })).status, 404);
  const oversized = await runtime.dispatchFetch("https://market.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { padding: "x".repeat(2 * 1024 * 1024) } }),
  });
  assert.equal(oversized.status, 413);
  console.log("PASS origin, access and 2 MiB input boundaries in workerd");
} finally {
  await runtime.dispose();
}
