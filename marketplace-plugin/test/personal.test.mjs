import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { publicMcpEnvironment, handlePersonalMcp } from "../src/personal.mjs";

const token="a1".repeat(32);
const digest = createHash("sha256").update(token,"utf8").digest("hex");
const env={ PERSONAL_TEST_TOKEN_SHA256:digest, MCP_BEARER_TOKEN:"separate", STUDIES:{}, REQUEST_LIMITER:{} };
const origin="https://example.test";
const endpoint=origin+"/p/"+token+"/mcp";
const unreachable=()=>assert.fail("Private RPC was called without a valid capability");

test("private route forwards payload and strips secrets before RPC",async()=>{
  const inbound=new Request(endpoint,{method:"POST",headers:{referer:endpoint,authorization:"Bearer other","cf-connecting-ip":"192.0.2.1"},body:"hello"});
  const r=await handlePersonalMcp(inbound,env,async(request,view)=>{
    assert.equal(request.url,origin+"/mcp");
    assert.equal(await request.text(),"hello");
    assert.equal(request.headers.get("cf-connecting-ip"),"192.0.2.1");
    assert.equal(request.headers.has("referer"),false);
    assert.equal(request.headers.has("authorization"),false);
    assert.deepEqual(view,{STUDIES:env.STUDIES,REQUEST_LIMITER:env.REQUEST_LIMITER,ORIGIN_GATE:undefined,
      REQUIRE_ORIGIN_GATE:false,REQUEST_LIMIT_KEY:"personal-access",LIVE_ACCESS:"personal_test",IMAGE_ACCESS:"personal_test"});
    assert.ok(Object.isFrozen(view));
    return new Response("ok",{headers:{"content-type":"text/plain"}});
  });
  assert.equal(r.status,200);
  assert.equal(await r.text(),"ok");
  assert.equal(r.headers.get("referrer-policy"),"no-referrer");
  assert.match(r.headers.get("cache-control"),/no-store/);
  assert.equal(env.LIVE_ACCESS,undefined);
});

test("personal access without an expiry remains valid in the future", async (t) => {
  t.mock.method(Date, "now", () => Date.UTC(2100, 0, 1));
  const response = await handlePersonalMcp(new Request(endpoint), env, () =>
    new Response(null, { status: 202 }));
  assert.equal(response.status, 202);
});

test("invalid, absent, malformed, expired and query-string capabilities all receive the same 404",async()=>{
  for (const [url,bindings] of [
    [origin+"/mcp",env], [origin+"/p/"+token.slice(2)+"/mcp",env],
    [origin+"/p/"+token.slice(0,-1)+"b/mcp",env], [endpoint.toUpperCase(),env],
    [endpoint,{}], [endpoint,{PERSONAL_TEST_TOKEN_SHA256:"short"}], [endpoint,{PERSONAL_TEST_TOKEN:token}], [origin+"/p/"+digest+"/mcp",env], [endpoint+"?token="+token,env],
    [endpoint.replace("https:","http:"),env], [endpoint+"/",env],
    [endpoint,{...env,PERSONAL_TEST_EXPIRES_AT:"2040-02-31T10:00:00Z"}],
    [endpoint,{...env,PERSONAL_TEST_EXPIRES_AT:"broken"}], [endpoint,{...env,PERSONAL_TEST_EXPIRES_AT:""}],
    [endpoint,{...env,PERSONAL_TEST_EXPIRES_AT:"2000-01-01T00:00:00Z"}]
  ]) {
    const r=await handlePersonalMcp(new Request(url),bindings,unreachable);
    assert.equal(r.status,404);
    assert.deepEqual(await r.json(),{error:"Unknown endpoint"});
    assert.equal(r.headers.get("referrer-policy"),"no-referrer");
  }
  const future=new Date(Date.now()+60_000).toISOString();
  const r=await handlePersonalMcp(new Request(endpoint),{...env,PERSONAL_TEST_EXPIRES_AT:future},()=>new Response(null,{status:202}));
  assert.equal(r.status,202);
});

test("personal capability flags and secrets never appear in the public view",()=>{
  for (const flags of [{},{LIVE_ACCESS:"authorized",IMAGE_ACCESS:"authorized"},{LIVE_ACCESS:"personal_test"}]) {
    const view=publicMcpEnvironment({...env,...flags});
    assert.equal(view.LIVE_ACCESS,undefined);
    assert.equal(view.IMAGE_ACCESS,undefined);
    assert.equal(view.PERSONAL_TEST_TOKEN_SHA256,undefined);
    assert.ok(Object.isFrozen(view));
  }
  assert.equal(publicMcpEnvironment({LIVE_ACCESS:"personal_test"}).LIVE_ACCESS,undefined);
  assert.equal(publicMcpEnvironment({LIVE_ACCESS:"authorized",MCP_BEARER_TOKEN:"protected"}).LIVE_ACCESS,"authorized");
});
