import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublic, CLIENT_AGENT, reservation, responseCooldown, retryAfterTime, mergeCooldown } from "../src/traffic.mjs";

const origin = "https://www.willhaben.at";
const url = origin + "/iad/kaufen-und-verkaufen/marktplatz?keyword=Lampe";
const emptyState = () => ({ nextAllowedAt: 0, cooldownUntil: 0, cooldownCode: "upstream_busy" });

function fakeGate() {
  const state = emptyState();
  const reports = [];
  const stub = {
    async acquire(requestOrigin) {
      const slot = reservation(state, requestOrigin, Date.now(), 0);
      if (slot.granted) state.nextAllowedAt = slot.nextAllowedAt;
      return slot;
    },
    async report(requestOrigin, report) {
      assert.equal(requestOrigin, origin);
      reports.push(report);
      const next = mergeCooldown(state, responseCooldown(report, Date.now(), 0), Date.now());
      if (next) { state.cooldownUntil = next.until; state.cooldownCode = next.code; }
      return next;
    },
  };
  return { reports, state, env: { ORIGIN_GATE: { getByName: name => { assert.equal(name, origin); return stub; } } } };
}

test("origin reservations enforce minimum spacing and positive bounded jitter", () => {
  const now = 1800000000000;
  assert.deepEqual(reservation(emptyState(), origin, now, 0), { granted: true, nextAllowedAt: now + 2000 });
  const latest = reservation(emptyState(), origin, now, 0.999999);
  assert.equal(latest.nextAllowedAt, now + 2500);
  assert.equal(reservation(emptyState(), "https://cache.willhaben.at", now, 0).nextAllowedAt, now + 500);
  const busy = reservation({ ...emptyState(), nextAllowedAt: now + 2000 }, origin, now + 20);
  assert.equal(busy.granted, false);
  assert.equal(busy.retryAfterMs, 1980);
  assert.equal(busy.code, "upstream_busy");
  assert.throws(() => reservation(emptyState(), "https://example.com", now), /Unsupported/);
});

test("Retry-After preserves long seconds and HTTP dates and rejects decimal pseudo-dates", () => {
  const now = Date.UTC(2026, 10, 6, 18);
  const then = now + 1800000;
  assert.equal(retryAfterTime("1800", now), then);
  assert.equal(retryAfterTime(new Date(then).toUTCString(), now), then);
  assert.equal(retryAfterTime("0", now), now);
  assert.equal(retryAfterTime(new Date(now - 60000).toUTCString(), now), now);
  for (const value of [undefined, null, "", "1.5", "-1", "soon"])
    assert.equal(retryAfterTime(value, now), null);
  assert.equal(responseCooldown({ status: 429 }, now).until, now + 1800000);
  assert.equal(responseCooldown({ status: 503, retryAfter: "1800" }, now).until, then);
});

test("cooldowns preserve stronger denials and survive late successes and shorter retries", () => {
  const now = 1800000000000;
  const state = { ...emptyState(), cooldownUntil: now + 7200000, cooldownCode: "upstream_rate_limited" };
  const blocked = mergeCooldown(state, responseCooldown({ status: 403 }, now), now);
  assert.deepEqual(blocked, { until: now + 7200000, code: "upstream_forbidden" });
  const active = { ...state, cooldownCode: blocked.code };
  assert.deepEqual(mergeCooldown(active, responseCooldown({ status: 200 }, now), now), blocked);
  assert.deepEqual(mergeCooldown(active, responseCooldown({ status: 503 }, now), now), blocked);
  assert.equal(mergeCooldown(active, null, now + 7200001), null);
});

test("public fetch permits only supported anonymous targets and uses manual redirects", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (target, options) => {
    calls.push({ target: String(target), options });
    return new Response("redirect", { status: 302, headers: { Location: "/iad/kaufen-und-verkaufen/d/123" } });
  });
  const response = await fetchPublic(url);
  assert.equal(response.status, 302);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, "manual");
  assert.deepEqual(calls[0].options.headers, { Accept: "text/html", "User-Agent": CLIENT_AGENT });
  for (const target of ["http://www.willhaben.at/iad/object", "https://example.com/iad/object",
    "https://user:pass@www.willhaben.at/iad/object", "https://www.willhaben.at:8080/iad/object",
    "https://www.willhaben.at/login", "https://cache.willhaben.at/private/photo.webp"])
    await assert.rejects(fetchPublic(target), TypeError);
  assert.equal(calls.length, 1);
});

test("configured live deployments fail closed when the coordinator is absent or unavailable", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Upstream fetch must stay closed"));
  await assert.rejects(fetchPublic(url, { REQUIRE_ORIGIN_GATE: true }), { code: "traffic_not_configured", recoverable: false });
  const broken = { ORIGIN_GATE: { getByName: () => ({ acquire: async () => { throw new Error("connection lost"); } }) } };
  await assert.rejects(fetchPublic(url, broken), { code: "traffic_unavailable", recoverable: true });
  const malformed = { ORIGIN_GATE: { getByName: () => ({ acquire: async () => ({ granted: "yes" }) }) } };
  await assert.rejects(fetchPublic(url, malformed), { code: "traffic_unavailable" });
});

test("an origin 429 is returned once and shared cooldown prevents the next call from fetching", async t => {
  const gate = fakeGate();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return new Response("busy", { status: 429, headers: { "Retry-After": "1800" } }); });
  let first;
  await assert.rejects(fetchPublic(url, gate.env), e => {
    first = e;
    return e.code === "upstream_rate_limited" && e.recoverable && e.retryAfterSeconds === 1800;
  });
  await assert.rejects(fetchPublic(url, gate.env), e => e.code === first.code && e.retryAt === first.retryAt);
  assert.equal(requests, 1);
  assert.equal(gate.reports.length, 1);
});

test("forbidden responses and browser challenges stop immediately without retries", async t => {
  for (const [status, headers, code] of [
    [401, {}, "upstream_forbidden"], [403, {}, "upstream_forbidden"],
    [200, { "cf-mitigated": "challenge" }, "upstream_blocked"],
  ]) {
    let requests = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => { requests++; return new Response("denied", { status, headers }); });
    await assert.rejects(fetchPublic(url, fakeGate().env), { code, recoverable: false });
    assert.equal(requests, 1);
    mock.mock.restore();
  }
});

test("transient HTTP failures receive at most two paced retries", async t => {
  t.mock.method(Math, "random", () => 0);
  const starts = [];
  const gate = fakeGate();
  t.mock.method(globalThis, "fetch", async () => {
    starts.push(Date.now());
    return new Response("test", { status: starts.length === 3 ? 200 : 503 });
  });
  const response = await fetchPublic(url, gate.env);
  assert.equal(response.status, 200);
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 1990);
  assert.ok(starts[2] - starts[1] >= 3990);
  assert.deepEqual(gate.reports.map(r => r.attempt), [0, 1]);
});

test("a long transient Retry-After returns its full continuation time", async t => {
  const gate = fakeGate();
  const until = new Date(Math.ceil(Date.now() / 1000) * 1000 + 1800000);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response("unavailable", { status: 503, headers: { "Retry-After": until.toUTCString() } });
  });
  await assert.rejects(fetchPublic(url, gate.env), e => e.code === "upstream_unavailable" && Date.parse(e.retryAt) === until.getTime());
  assert.equal(requests, 1);
});

test("network retries stop after three attempts and expose a safe resumable error", async t => {
  let requests = 0;
  const gate = { acquire: async () => ({ granted: true }), report: async () => ({ until: Date.now(), code: "upstream_unavailable" }) };
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("test-only credential in transport diagnostics"); });
  await assert.rejects(fetchPublic(url, { ORIGIN_GATE: { getByName: () => gate } }), e =>
    e.code === "upstream_unavailable" && e.recoverable && !e.message.includes("credential"));
  assert.equal(requests, 3);
});

test("waiting callers recheck a newly reported shared cooldown before touching the origin", async t => {
  let acquisitions = 0;
  const until = Date.now() + 1800000;
  const env = { ORIGIN_GATE: { getByName: () => ({ async acquire() {
    acquisitions++;
    return acquisitions === 1
      ? { granted: false, retryAtMs: Date.now() + 10, code: "upstream_busy" }
      : { granted: false, retryAtMs: until, code: "upstream_rate_limited" };
  } }) } };
  t.mock.method(globalThis, "fetch", () => assert.fail("Cooldown must be rechecked before fetch"));
  await assert.rejects(fetchPublic(url, env), { code: "upstream_rate_limited" });
  assert.equal(acquisitions, 2);
});

test("tool deadlines prevent queue waits and abort active network work with time_budget", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", (_target, { signal }) => {
    requests++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response("late")), 200);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  });
  await assert.rejects(fetchPublic(url, { REQUEST_DEADLINE: Date.now() - 1 }), { code: "time_budget", recoverable: true });
  const busy = { REQUEST_DEADLINE: Date.now() + 50, ORIGIN_GATE: { getByName: () => ({ acquire: async () => ({ granted: false, retryAtMs: Date.now() + 2000, code: "upstream_busy" }) }) } };
  await assert.rejects(fetchPublic(url, busy), { code: "time_budget" });
  assert.equal(requests, 0);
  await assert.rejects(fetchPublic(url, { REQUEST_DEADLINE: Date.now() + 50 }), { code: "time_budget" });
  assert.equal(requests, 1);
});
