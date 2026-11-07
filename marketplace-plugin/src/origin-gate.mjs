import { DurableObject } from "cloudflare:workers";
import { originPolicy, reservation, responseCooldown, mergeCooldown } from "./traffic.mjs";

const cacheKey = /^(?:search:[a-f0-9]{64}|(?:detail|summary):\d{1,20})$/;
const encoder = new TextEncoder();

function leaseIdentity(key, owner) {
  if (typeof key !== "string" || !cacheKey.test(key) || typeof owner !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(owner))
    throw new TypeError("Invalid observation lease identity");
}

export class OriginGate extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS traffic (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1), origin TEXT NOT NULL,
        next_allowed_at INTEGER NOT NULL DEFAULT 0, cooldown_until INTEGER NOT NULL DEFAULT 0,
        cooldown_code TEXT NOT NULL DEFAULT 'upstream_busy'
      )`);
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS observations (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, observed_at TEXT NOT NULL,
        observed_ms INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )`);
      ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS observations_expiry ON observations (expires_at)");
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS observation_leases (
        key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL
      )`);
    });
  }

  #state(origin) {
    originPolicy(origin);
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO traffic (singleton, origin) VALUES (1, ?)", origin);
    const row = this.ctx.storage.sql.exec("SELECT * FROM traffic WHERE singleton = 1").one();
    if (row.origin !== origin) throw new TypeError("Use a separate coordinator for each origin");
    return { nextAllowedAt: row.next_allowed_at, cooldownUntil: row.cooldown_until, cooldownCode: row.cooldown_code };
  }

  acquire(origin) {
    const state = this.#state(origin);
    const result = reservation(state, origin, Date.now());
    if (result.granted)
      this.ctx.storage.sql.exec("UPDATE traffic SET next_allowed_at = ? WHERE singleton = 1", result.nextAllowedAt);
    return result;
  }

  report(origin, report) {
    if (!report || !Number.isInteger(report.status) || report.status < 0 || report.status > 599 ||
        !Number.isInteger(report.attempt ?? 0) || (report.attempt ?? 0) < 0 || (report.attempt ?? 0) > 2 ||
        (report.retryAfter != null && (typeof report.retryAfter !== "string" || report.retryAfter.length > 256)) ||
        (report.challenge !== undefined && typeof report.challenge !== "boolean"))
      throw new TypeError("Invalid upstream response metadata");
    const state = this.#state(origin);
    const now = Date.now();
    const next = mergeCooldown(state, responseCooldown(report, now), now);
    if (next && (next.until !== state.cooldownUntil || next.code !== state.cooldownCode)) {
      this.ctx.storage.sql.exec("UPDATE traffic SET cooldown_until = ?, cooldown_code = ? WHERE singleton = 1", next.until, next.code);
      return next;
    }
    return next;
  }

  getCached(key) {
    if (typeof key !== "string" || !cacheKey.test(key)) throw new TypeError("Invalid observation key");
    const rows = this.ctx.storage.sql.exec("SELECT * FROM observations WHERE key = ?", key).toArray();
    const row = rows[0];
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      this.ctx.storage.sql.exec("DELETE FROM observations WHERE key = ?", key);
      return null;
    }
    return { value: JSON.parse(row.value), observedAt: row.observed_at, expiresAt: new Date(row.expires_at).toISOString() };
  }

  claimObservation(key, owner, { leaseMs = 15000, minObservedAt = 0 } = {}) {
    leaseIdentity(key, owner);
    const now = Date.now();
    if (!Number.isInteger(leaseMs) || leaseMs < 100 || leaseMs > 30000 ||
        !Number.isSafeInteger(minObservedAt) || minObservedAt < 0 || minObservedAt > now + 5000)
      throw new TypeError("Invalid observation lease policy");
    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM observation_leases WHERE expires_at <= ?", now);
      const entry = this.getCached(key);
      if (entry && Date.parse(entry.observedAt) >= minObservedAt) return {state:"cached",entry};
      const lease = this.ctx.storage.sql.exec("SELECT owner, expires_at FROM observation_leases WHERE key = ?",key).toArray()[0];
      if (lease) return {state:lease.owner === owner ? "owner" : "waiting",expiresAt:lease.expires_at};
      const expiresAt = now + leaseMs;
      this.ctx.storage.sql.exec("INSERT INTO observation_leases (key, owner, expires_at) VALUES (?, ?, ?)",key,owner,expiresAt);
      return {state:"owner",expiresAt};
    });
  }

  commitObservation(key, owner, entries) {
    leaseIdentity(key,owner);
    const records = this.#cacheRecords(entries,202);
    if (!records.some(record => record.key === key)) throw new TypeError("A lease commit must include its observation");
    return this.ctx.storage.transactionSync(() => {
      const lease = this.ctx.storage.sql.exec("SELECT owner, expires_at FROM observation_leases WHERE key = ?",key).toArray()[0];
      if (!lease || lease.owner !== owner || lease.expires_at <= Date.now()) return {committed:false,stored:0};
      const result = this.#storeRecords(records);
      this.ctx.storage.sql.exec("DELETE FROM observation_leases WHERE key = ? AND owner = ?",key,owner);
      return {committed:true,...result};
    });
  }

  releaseObservation(key, owner) {
    leaseIdentity(key,owner);
    const result = this.ctx.storage.sql.exec("DELETE FROM observation_leases WHERE key = ? AND owner = ? RETURNING key",key,owner);
    return {released:result.toArray().length === 1};
  }

  putCached(entries) {
    const records = this.#cacheRecords(entries,101);
    return this.ctx.storage.transactionSync(() => this.#storeRecords(records));
  }

  #cacheRecords(entries, maximum) {
    if (!Array.isArray(entries) || !entries.length || entries.length > maximum)
      throw new TypeError("Supply 1–"+maximum+" observations");
    let bytes = 1;
    return entries.map(entry => {
      if (!entry || typeof entry.key !== "string" || !cacheKey.test(entry.key) ||
          !entry.value || typeof entry.value !== "object" || Array.isArray(entry.value) ||
          typeof entry.observedAt !== "string" || !Number.isInteger(entry.ttlSeconds) || entry.ttlSeconds < 1 || entry.ttlSeconds > 3600)
        throw new TypeError("Invalid observation");
      const observedMs = Date.parse(entry.observedAt);
      if (!Number.isFinite(observedMs) || observedMs > Date.now() + 5000)
        throw new TypeError("Invalid observation time");
      const value = JSON.stringify(entry.value);
      const size = encoder.encode(JSON.stringify(entry)).length;
      bytes += size + 1;
      if (size > 2 * 1024 * 1024 || bytes > 8 * 1024 * 1024)
        throw new RangeError("Observation cache payload exceeds its size budget");
      return { ...entry, value, observedMs, expiresAt: observedMs + entry.ttlSeconds * 1000 };
    });
  }

  #storeRecords(records) {
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM observations WHERE expires_at <= ?", now);
    let stored = 0;
    for (const row of records) {
      if (row.expiresAt <= now) continue;
      const result = this.ctx.storage.sql.exec(`INSERT INTO observations (key, value, observed_at, observed_ms, expires_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET
          value = excluded.value, observed_at = excluded.observed_at,
          observed_ms = excluded.observed_ms, expires_at = excluded.expires_at
        WHERE excluded.observed_ms >= observations.observed_ms RETURNING key`,
      row.key, row.value, row.observedAt, row.observedMs, row.expiresAt);
      stored += result.toArray().length;
    }
    return { stored };
  }
}
