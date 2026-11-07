export const CLIENT_AGENT = "Marktplatz-Studie/1.0 (+https://github.com/larsmartens/willhaben-scraper)";

export const ORIGIN_POLICIES = Object.freeze({
  "https://www.willhaben.at": Object.freeze({ intervalMs: 2000, jitterMs: 500 }),
  "https://cache.willhaben.at": Object.freeze({ intervalMs: 500, jitterMs: 250 }),
});

const MAX_WAIT_MS = 10000;
const MAX_DATE_MS = 8640000000000000;
const transientStatuses = new Set([0, 502, 503, 504]);
const messages = {
  upstream_busy: "The upstream request queue is busy. Continue after retryAt.",
  upstream_rate_limited: "willhaben requested a cooldown. Continue after retryAt.",
  upstream_forbidden: "willhaben denied the request. Live fetching has stopped.",
  upstream_blocked: "willhaben requested a browser challenge. Live fetching has stopped.",
  upstream_unavailable: "willhaben is temporarily unavailable. Continue after retryAt.",
  upstream_timeout: "The upstream request exceeded its time budget.",
  traffic_unavailable: "The shared traffic coordinator is unavailable. Continue after retryAt.",
  traffic_not_configured: "The live deployment requires its shared traffic coordinator.",
  time_budget: "This tool call reached its time budget. Continue with the returned cursor or remaining IDs.",
};

function error(code, retryAtMs, recoverable = true) {
  const retry = Number.isFinite(retryAtMs) ? {
    retryAt: new Date(retryAtMs).toISOString(),
    retryAfterSeconds: Math.max(0, Math.ceil((retryAtMs - Date.now()) / 1000)),
  } : {};
  return Object.assign(new Error(messages[code]), { code, recoverable, ...retry });
}

export function originPolicy(origin) {
  if (!Object.hasOwn(ORIGIN_POLICIES, origin)) throw new TypeError("Unsupported upstream origin");
  return ORIGIN_POLICIES[origin];
}

export function retryAfterTime(header, now) {
  if (typeof header !== "string" || !header.trim()) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) {
    return Math.min(MAX_DATE_MS, now + Number(value) * 1000);
  }
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[,\s]/i.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(now, date) : null;
}

export function reservation(state, origin, now, random = Math.random()) {
  const policy = originPolicy(origin);
  const retryAtMs = Math.max(state.nextAllowedAt, state.cooldownUntil);
  if (retryAtMs > now) return {
    granted: false, retryAtMs, retryAfterMs: retryAtMs - now,
    code: state.cooldownUntil > now ? state.cooldownCode : "upstream_busy",
  };
  return { granted: true, nextAllowedAt: now + policy.intervalMs + Math.floor(random * (policy.jitterMs + 1)) };
}

export function responseCooldown({ status, retryAfter, challenge = false, attempt = 0 }, now, random = Math.random()) {
  const requested = retryAfterTime(retryAfter, now) ?? now;
  if (challenge || status === 401 || status === 403) return {
    until: Math.max(requested, now + 3600000), code: challenge ? "upstream_blocked" : "upstream_forbidden",
  };
  if (status === 429) return {
    until: Math.max(now + 2000, retryAfterTime(retryAfter, now) ?? now + 1800000),
    code: "upstream_rate_limited",
  };
  if (transientStatuses.has(status)) {
    const delay = 2000 * 2 ** attempt;
    return { until: Math.max(requested, now + delay + Math.floor(random * delay * 0.25)), code: "upstream_unavailable" };
  }
  return null;
}

export function mergeCooldown(state, next, now) {
  if (state.cooldownUntil <= now) return next;
  const active = { until: state.cooldownUntil, code: state.cooldownCode };
  if (!next) return active;
  const severity = { upstream_busy: 0, upstream_unavailable: 1, upstream_rate_limited: 2, upstream_forbidden: 3, upstream_blocked: 4 };
  return { until: Math.max(active.until, next.until), code: severity[next.code] > severity[active.code] ? next.code : active.code };
}

function targetUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("Expected a public willhaben URL"); }
  originPolicy(url.origin);
  const pagePath = url.pathname === "/iad/object" || url.pathname.startsWith("/iad/kaufen-und-verkaufen/d/") ||
    url.pathname === "/iad/kaufen-und-verkaufen/marktplatz" || url.pathname.startsWith("/iad/kaufen-und-verkaufen/marktplatz/") ||
    url.pathname === "/iad/kaufen-und-verkaufen/aehnlichkeitssuche";
  if (url.username || url.password || url.port || url.hash || (url.hostname === "www.willhaben.at" && !pagePath) ||
      (url.hostname === "cache.willhaben.at" && !url.pathname.startsWith("/mmo/")))
    throw new TypeError("Expected a public willhaben URL");
  return url;
}

async function gateCall(gate, method, taskDeadline, ...args) {
  if (Date.now() >= taskDeadline) throw error("time_budget", Date.now());
  let timer;
  try {
    return await Promise.race([
      gate[method](...args),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Coordinator timed out")), Math.min(2000, taskDeadline - Date.now())); }),
    ]);
  } catch {
    if (Date.now() >= taskDeadline) throw error("time_budget", Date.now());
    throw error("traffic_unavailable", Date.now() + 5000);
  } finally { clearTimeout(timer); }
}

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acquire(gate, origin, deadline, taskDeadline) {
  if (!gate) return;
  const waitingSince = Date.now();
  for (;;) {
    const slot = await gateCall(gate, "acquire", taskDeadline, origin);
    if (slot?.granted === true) return;
    if (slot?.granted !== false || !Number.isFinite(slot.retryAtMs) || !Object.hasOwn(messages, slot.code))
      throw error("traffic_unavailable", Date.now() + 5000);
    const wait = Math.max(1, slot.retryAtMs - Date.now());
    if (slot.code === "upstream_rate_limited" || slot.code === "upstream_forbidden" || slot.code === "upstream_blocked")
      throw error(slot.code, slot.retryAtMs, !["upstream_forbidden", "upstream_blocked"].includes(slot.code));
    if (slot.retryAtMs >= taskDeadline) throw error("time_budget", slot.retryAtMs);
    if (slot.retryAtMs >= deadline || Date.now() + wait - waitingSince > MAX_WAIT_MS)
      throw error(slot.code, slot.retryAtMs);
    await pause(wait);
  }
}

export async function fetchPublic(value, env = {}, { accept = "text/html", timeoutMs = 9000 } = {}) {
  const url = targetUrl(value);
  return fetchUpstream(url, env, { accept, timeoutMs });
}

export async function fetchVisualSearch(bytes, session, env = {}, { timeoutMs = 15000 } = {}) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 10 * 1024 * 1024 ||
      typeof session?.cookie !== "string" || !session.cookie || session.cookie.length > 16384 || /[\r\n]/.test(session.cookie) ||
      typeof session?.csrfToken !== "string" || !session.csrfToken || session.csrfToken.length > 1024 || /[\r\n]/.test(session.csrfToken))
    throw new TypeError("Invalid anonymous image-search request");
  return fetchUpstream(new URL("https://www.willhaben.at/webapi/ad-search/imagesearch/atz"), env, {
    accept: "application/json", timeoutMs, method: "PUT", body: bytes,
    headers: {
      "Content-Type": "image/jpeg", Cookie: session.cookie, "x-bbx-csrf-token": session.csrfToken,
      "X-WH-Client": "api@willhaben.at;responsive_web;server;1.0.0;desktop",
      Origin: "https://www.willhaben.at", Referer: "https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz",
    },
  });
}

async function fetchUpstream(url, env, { accept, timeoutMs, method = "GET", headers = {}, body }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000 ||
      typeof accept !== "string" || accept.length > 256 || /[\r\n]/.test(accept))
    throw new TypeError("Invalid upstream request options");
  if (!env.ORIGIN_GATE && [true, "true"].includes(env.REQUIRE_ORIGIN_GATE))
    throw error("traffic_not_configured", undefined, false);
  const taskDeadline = Number.isFinite(env.REQUEST_DEADLINE) ? env.REQUEST_DEADLINE : Infinity;
  if (Date.now() >= taskDeadline) throw error("time_budget", Date.now());

  let gate;
  try { gate = env.ORIGIN_GATE?.getByName(url.origin); }
  catch { throw error("traffic_unavailable", Date.now() + 5000); }
  const deadline = Math.min(Date.now() + timeoutMs, taskDeadline);
  const signal = AbortSignal.timeout(Math.max(1, Math.ceil(deadline - Date.now())));
  for (let attempt = 0; attempt <= 2; attempt++) {
    await acquire(gate, url.origin, deadline, taskDeadline);
    if (Date.now() >= taskDeadline) throw error("time_budget", Date.now());
    if (Date.now() >= deadline) throw error("upstream_timeout", Date.now() + 2000);
    let response;
    try {
      response = await fetch(url, { method, redirect: "manual", signal,
        headers: { Accept: accept, "User-Agent": CLIENT_AGENT, ...headers }, ...(body ? { body } : {}) });
    } catch {
      // The signal owns its selected deadline even if the wall clock is one tick behind.
      if (Date.now() >= taskDeadline || signal.aborted && deadline === taskDeadline) throw error("time_budget", taskDeadline);
      const report = { status: 0, attempt };
      const cooldown = gate ? await gateCall(gate, "report", taskDeadline, url.origin, report) : responseCooldown(report, Date.now());
      if (signal.aborted || Date.now() >= deadline) throw error("upstream_timeout", cooldown.until);
      if (attempt === 2 || cooldown.until >= deadline) throw error("upstream_unavailable", cooldown.until);
      await pause(Math.max(1, cooldown.until - Date.now()));
      continue;
    }

    const report = { status: response.status, retryAfter: response.headers.get("retry-after"),
      challenge: response.headers.get("cf-mitigated") === "challenge", attempt };
    const cooldown = responseCooldown(report, Date.now());
    if (!cooldown) return response;
    await response.body?.cancel();
    // Publishing an observed denial remains necessary when the caller's work budget has just elapsed.
    const shared = gate ? await gateCall(gate, "report", Infinity, url.origin, report) : cooldown;
    if (transientStatuses.has(report.status) && !report.challenge && shared.until >= taskDeadline)
      throw error("time_budget", shared.until);
    if (!transientStatuses.has(report.status) || report.challenge || attempt === 2 || shared.until >= deadline)
      throw error(shared.code, shared.until, !["upstream_forbidden", "upstream_blocked"].includes(shared.code));
    await pause(Math.max(1, shared.until - Date.now()));
  }
}
