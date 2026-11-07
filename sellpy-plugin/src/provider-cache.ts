import { ToolError, type RequestContext } from './domain.js';
import { pause } from './http.js';

export const OBSERVATION_TTL_MS = { search: 15_000, details: 5_000, facets: 60_000, brands: 60_000 } as const;
export type ObservationKind = keyof typeof OBSERVATION_TTL_MS;
export const OBSERVATION_CACHE_LIMITS = {
  entry_bytes: 512 * 1024, total_bytes: 8 * 1024 * 1024, entries: 128, leases: 256, lease_ms: 45_000,
} as const;

export type ObservationClaim =
  | { state: 'cached'; value_json: string; expires_at: number }
  | { state: 'owner'; expires_at: number }
  | { state: 'waiting'; expires_at: number }
  | { state: 'bypass' };

/** Public catalog data only. RPC messages contain completed JSON, never live I/O. */
export interface ObservationCachePort {
  claim(key: string, owner: string, lease_ms: number): Promise<ObservationClaim>;
  commit(key: string, owner: string, value_json: string, expires_at: number): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
}

export type ObservationCacheContext = RequestContext & { observation_cache?: ObservationCachePort };

/** Preserve the request's transport, cancellation and retained reference reader. */
export function withoutObservationCache(context: RequestContext): ObservationCacheContext {
  return { ...context, observation_cache: undefined };
}

function checkContext(context: RequestContext): void {
  if (context.signal?.aborted) throw new ToolError('cancelled', 'The request was cancelled.', { retryable: true });
  if (Date.now() >= context.deadline) throw new ToolError('time_budget', 'The request deadline was reached.', { retryable: true });
}

function withinContext<T>(operation: Promise<T>, context: RequestContext): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); context.signal?.removeEventListener('abort', aborted); };
    const aborted = () => { cleanup(); reject(new ToolError('cancelled', 'The request was cancelled.', { retryable: true })); };
    operation.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (context.signal?.aborted) { aborted(); return; }
    timer = setTimeout(() => { cleanup(); reject(new ToolError('time_budget', 'The request deadline was reached.', { retryable: true })); }, Math.max(0, context.deadline - Date.now()));
    context.signal?.addEventListener('abort', aborted, { once: true });
  });
}

export async function publicObservationKey(kind: ObservationKind, input: unknown): Promise<string> {
  // Sort object keys, while retaining array order and every semantic value.
  // Callers remove only nonsemantic arm identity before passing the input.
  const serialized = JSON.stringify(input, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
  if (serialized === undefined || serialized.length > 128 * 1024) throw new ToolError('invalid_cache_input', 'The public catalog request is too large to coordinate safely.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return `observation:v1:${kind}:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function observationShardName(key: string): string {
  validateKey(key);
  // Sixteen coordination objects distribute independent catalog requests.
  return `public-observations:v1:${key.slice(-64, -63)}`;
}

export interface ObservationPolicy<T> {
  kind: ObservationKind;
  input: unknown;
  observed_at(value: T): number;
  cacheable?(value: T): boolean;
  /** Remove echoed user criteria before persistence. */
  project?(value: T): unknown;
  /** Restore request-local criteria; return a new graph for each caller. */
  restore?(value: unknown): T;
}

/**
 * Claim/commit leases live in SQLite, not a global Promise map. A cache hit may
 * be served during an origin cooldown: it performs no source I/O and retains
 * the original observation time. Every miss still uses the paced transport.
 */
export async function withCachedObservation<T>(context: RequestContext, policy: ObservationPolicy<T>, load: () => Promise<T>): Promise<T> {
  checkContext(context);
  const port = (context as ObservationCacheContext).observation_cache;
  if (!port) return load();
  const key = await publicObservationKey(policy.kind, policy.input), owner = crypto.randomUUID();
  while (true) {
    checkContext(context);
    let claim: ObservationClaim;
    try {
      claim = await withinContext(port.claim(key, owner, Math.min(OBSERVATION_CACHE_LIMITS.lease_ms, Math.max(1, context.deadline - Date.now()))), context);
    } catch (error) {
      checkContext(context);
      if (error instanceof ToolError) throw error;
      // Coordination is an optimization; the ordinary origin gate still paces
      // the request when storage is temporarily unavailable.
      return load();
    }
    checkContext(context);
    if (claim.state === 'cached') {
      if (claim.expires_at <= Date.now()) continue;
      const value: unknown = JSON.parse(claim.value_json);
      return policy.restore ? policy.restore(value) : value as T;
    }
    if (claim.state === 'bypass') return load();
    if (claim.state === 'waiting') {
      await pause(Math.max(1, Math.min(150, claim.expires_at - Date.now())), context.deadline, context.signal);
      continue;
    }
    try {
      const value = await load();
      // Partial detail batches carry retryable failures and unprocessed IDs.
      // Preserve that useful contract even when their source deadline ended.
      if (!(policy.cacheable?.(value) ?? true)) return value;
      checkContext(context);
      const observed = policy.observed_at(value), expires = Math.min(Date.now(), observed) + OBSERVATION_TTL_MS[policy.kind];
      if (Number.isFinite(observed) && expires > Date.now()) {
        const json = JSON.stringify(policy.project ? policy.project(value) : value);
        if (new TextEncoder().encode(json).byteLength <= OBSERVATION_CACHE_LIMITS.entry_bytes) {
          // Cache failure must not turn a successful source observation into
          // failure. An expired or superseded owner cannot publish its result.
          try { await withinContext(port.commit(key, owner, json, expires), context); } catch { /* lease expiry recovers storage failure */ }
        }
      }
      checkContext(context);
      return value;
    } finally {
      // Release only this owner. In the failure path preserve the source error
      // (including Retry-After), rather than replacing it with a cache error.
      try { await withinContext(port.release(key, owner), { ...context, deadline: Math.min(context.deadline, Date.now() + 1_000) }); } catch { /* abandoned leases expire */ }
    }
  }
}

export interface ObservationSql {
  exec<T extends Record<string, string | number | ArrayBuffer | null>>(query: string, ...bindings: unknown[]): { toArray(): T[] };
}
export type ObservationAtomic = <T>(operation: () => T) => T;

function validateKey(key: string): ObservationKind {
  const match = /^observation:v1:(search|details|facets|brands):[a-f0-9]{64}$/.exec(key);
  if (!match) throw new TypeError('Invalid public observation key');
  return match[1] as ObservationKind;
}

function validateOwner(owner: string): void {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(owner)) throw new TypeError('Invalid observation lease owner');
}

/** SQLite implementation shared by the actual DO and behavioral unit tests. */
export class PublicObservationStore {
  constructor(private sql: ObservationSql, private atomic: ObservationAtomic, private now = Date.now) {
    sql.exec('CREATE TABLE IF NOT EXISTS public_observations (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, expires_at REAL NOT NULL, byte_count INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS public_observations_expiry ON public_observations(expires_at)');
    sql.exec('CREATE TABLE IF NOT EXISTS public_observation_leases (key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at REAL NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS public_observation_leases_expiry ON public_observation_leases(expires_at)');
  }

  cleanup(): void {
    const now = this.now();
    this.sql.exec('DELETE FROM public_observations WHERE expires_at<=?', now);
    this.sql.exec('DELETE FROM public_observation_leases WHERE expires_at<=?', now);
  }

  nextExpiry(): number | null {
    const row = this.sql.exec<{ expiry: number | null }>('SELECT MIN(expires_at) AS expiry FROM (SELECT MIN(expires_at) AS expires_at FROM public_observations UNION ALL SELECT MIN(expires_at) AS expires_at FROM public_observation_leases)').toArray()[0];
    return row?.expiry ?? null;
  }

  claim(key: string, owner: string, lease_ms: number): ObservationClaim {
    validateKey(key); validateOwner(owner);
    if (!Number.isFinite(lease_ms) || lease_ms <= 0) throw new TypeError('Invalid observation lease duration');
    return this.atomic(() => {
      this.cleanup();
      const cached = this.sql.exec<{value_json:string; expires_at:number}>('SELECT value_json,expires_at FROM public_observations WHERE key=?', key).toArray()[0];
      if (cached) return { state: 'cached', ...cached };
      const lease = this.sql.exec<{owner:string; expires_at:number}>('SELECT owner,expires_at FROM public_observation_leases WHERE key=?', key).toArray()[0];
      if (lease) return { state: lease.owner === owner ? 'owner' : 'waiting', expires_at: lease.expires_at };
      const count = this.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM public_observation_leases').toArray()[0]!.count;
      if (count >= OBSERVATION_CACHE_LIMITS.leases) return { state: 'bypass' };
      const expires_at = this.now() + Math.min(OBSERVATION_CACHE_LIMITS.lease_ms, lease_ms);
      this.sql.exec('INSERT INTO public_observation_leases(key,owner,expires_at) VALUES (?,?,?)', key, owner, expires_at);
      return { state: 'owner', expires_at };
    });
  }

  commit(key: string, owner: string, value_json: string, expires_at: number): boolean {
    const kind = validateKey(key); validateOwner(owner);
    const bytes = new TextEncoder().encode(value_json).byteLength;
    if (bytes > OBSERVATION_CACHE_LIMITS.entry_bytes || !Number.isFinite(expires_at) || expires_at <= this.now() || expires_at > this.now() + OBSERVATION_TTL_MS[kind]) return false;
    // This interface accepts JSON only. It cannot store a Response, stream,
    // request context or in-flight Promise across Worker request contexts.
    JSON.parse(value_json);
    return this.atomic(() => {
      this.cleanup();
      const lease = this.sql.exec<{owner:string; expires_at:number}>('SELECT owner,expires_at FROM public_observation_leases WHERE key=?', key).toArray()[0];
      if (!lease || lease.owner !== owner || lease.expires_at <= this.now()) return false;
      this.sql.exec('INSERT OR REPLACE INTO public_observations(key,value_json,expires_at,byte_count) VALUES (?,?,?,?)', key, value_json, expires_at, bytes);
      this.sql.exec('DELETE FROM public_observation_leases WHERE key=? AND owner=?', key, owner);
      let total = this.sql.exec<{count:number; bytes:number}>('SELECT COUNT(*) AS count,COALESCE(SUM(byte_count),0) AS bytes FROM public_observations').toArray()[0]!;
      while (total.count > OBSERVATION_CACHE_LIMITS.entries || total.bytes > OBSERVATION_CACHE_LIMITS.total_bytes) {
        const evicted = this.sql.exec<{byte_count:number}>('DELETE FROM public_observations WHERE key=(SELECT key FROM public_observations ORDER BY expires_at,key LIMIT 1) RETURNING byte_count').toArray()[0];
        if (!evicted) break;
        total = { count: total.count - 1, bytes: total.bytes - evicted.byte_count };
      }
      return true;
    });
  }

  release(key: string, owner: string): void {
    validateKey(key); validateOwner(owner);
    this.sql.exec('DELETE FROM public_observation_leases WHERE key=? AND owner=?', key, owner);
  }
}
