import { DurableObject } from 'cloudflare:workers';
import type { RequestContext } from './domain.js';
import { pacedFetch, type OriginPermit } from './http.js';

export class OriginGate extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS gate (id INTEGER PRIMARY KEY CHECK(id=1), next_at REAL NOT NULL, retry_until REAL NOT NULL)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO gate VALUES (1,0,0)');
  }

  async reserve(now: number, spacing: number, deadline: number): Promise<OriginPermit> {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec<{next_at:number;retry_until:number}>('SELECT next_at,retry_until FROM gate WHERE id=1').one();
      const waitUntil = Math.max(now, row.next_at, row.retry_until);
      if (waitUntil + 50 >= deadline) return { wait_until: waitUntil, retry_until: row.retry_until, granted: false };
      this.ctx.storage.sql.exec('UPDATE gate SET next_at=? WHERE id=1', waitUntil + Math.max(0, spacing));
      return { wait_until: waitUntil, retry_until: row.retry_until, granted: true };
    });
  }

  async cooldown(until: number): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE gate SET retry_until=MAX(retry_until,?) WHERE id=1', until);
  }

  async cooldownUntil(): Promise<number> {
    return this.ctx.storage.sql.exec<{retry_until:number}>('SELECT retry_until FROM gate WHERE id=1').one().retry_until;
  }
}

export function createProviderContext(env: Env, deadline: number, signal?: AbortSignal): RequestContext {
  return {
    deadline,
    ...(signal ? { signal } : {}),
    fetch: pacedFetch({ deadline, ...(signal ? { signal } : {}), fetch: globalThis.fetch.bind(globalThis),
      gate: host => env.ORIGIN_GATE.getByName(host) })
  };
}
