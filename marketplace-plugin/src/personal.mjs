// A personal install URL is a 256-bit bearer capability. Keep it out of RPC calls and application logs.
const TOKEN = /^[0-9a-f]{64}$/;
const PATH = /^\/p\/([0-9a-f]{64})\/mcp$/;
const encoder = new TextEncoder();
let compareKey;

async function equalToken(actual, expected) {
  const a = encoder.encode(actual), b = encoder.encode(expected);
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(a, b);
  // Standards-only runtimes can use WebCrypto's native MAC verification for the fixed-length comparison.
  compareKey ??= crypto.subtle.importKey("raw", encoder.encode("marktplatz-install-url-comparison"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const key = await compareKey;
  return crypto.subtle.verify("HMAC", key, await crypto.subtle.sign("HMAC", key, b), a);
}

function testActive(expiry) {
  if (expiry === undefined) return true;
  if (typeof expiry !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(expiry)) return false;
  const time = Date.parse(expiry);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === expiry.slice(0, 19) && time > Date.now();
}

export function publicMcpEnvironment(env) {
  const { PERSONAL_TEST_TOKEN_SHA256, PERSONAL_TEST_EXPIRES_AT, ...publicEnv } = env;
  // Legacy deployments with a separately provisioned bearer credential retain their original auth check.
  if (PERSONAL_TEST_TOKEN_SHA256 !== undefined || publicEnv.LIVE_ACCESS === "personal_test" || publicEnv.IMAGE_ACCESS === "personal_test") {
    delete publicEnv.LIVE_ACCESS;
    delete publicEnv.IMAGE_ACCESS;
  }
  return Object.freeze(publicEnv);
}

const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const missingPath = () => Response.json({ error: "Unknown endpoint" }, { status: 404, headers: privateHeaders });

export async function handlePersonalMcp(request, env, rpc) {
  const url = new URL(request.url);
  const supplied = PATH.exec(url.pathname)?.[1], expected = env.PERSONAL_TEST_TOKEN_SHA256;
  if (url.protocol !== "https:" || url.search || !supplied || typeof expected !== "string" ||
      !TOKEN.test(expected) || !testActive(env.PERSONAL_TEST_EXPIRES_AT)) return missingPath();
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(supplied));
  const digest = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  if (!await equalToken(digest, expected)) return missingPath();

  const scopedEnv = Object.freeze({ REQUEST_LIMITER: env.PERSONAL_LIMITER ?? env.REQUEST_LIMITER, STUDIES: env.STUDIES,
    LIVE_ACCESS: "personal_test", IMAGE_ACCESS: "personal_test" });
  const clean = new Request(new URL("/mcp", url.origin), request);
  clean.headers.delete("referer");
  clean.headers.delete("authorization");
  const result = await rpc(clean, scopedEnv);
  const headers = new Headers(result.headers);
  for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
}
