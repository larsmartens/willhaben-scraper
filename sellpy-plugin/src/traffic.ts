import { DurableObject } from 'cloudflare:workers';
import { pacedFetch, type OriginPermit } from './http.js';
import { PublicObservationStore, observationShardName, type ObservationCacheContext, type ObservationCachePort, type ObservationClaim } from './provider-cache.js';

export class OriginGate extends DurableObject<Env> {
  private readonly observations: PublicObservationStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS gate (id INTEGER PRIMARY KEY CHECK(id=1), next_at REAL NOT NULL, retry_until REAL NOT NULL)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO gate VALUES (1,0,0)');
    this.observations = new PublicObservationStore(ctx.storage.sql, operation => ctx.storage.transactionSync(operation));
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

  private async scheduleObservationCleanup(): Promise<void> {
    const alarm = await this.ctx.storage.getAlarm();
    const next = this.observations.nextExpiry();
    if (next !== null && (alarm === null || next < alarm)) await this.ctx.storage.setAlarm(next);
  }

  async claimObservation(key: string, owner: string, lease_ms: number): Promise<ObservationClaim> {
    const result = this.observations.claim(key, owner, lease_ms);
    await this.scheduleObservationCleanup();
    return result;
  }

  async commitObservation(key: string, owner: string, value_json: string, expires_at: number): Promise<boolean> {
    const committed = this.observations.commit(key, owner, value_json, expires_at);
    await this.scheduleObservationCleanup();
    return committed;
  }

  async releaseObservation(key: string, owner: string): Promise<void> {
    this.observations.release(key, owner);
  }

  async alarm(): Promise<void> {
    this.observations.cleanup();
    const next = this.observations.nextExpiry();
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }
}

export function createObservationCachePort(env: Pick<Env, 'ORIGIN_GATE'>): ObservationCachePort {
  const gate = (key: string) => env.ORIGIN_GATE.getByName(observationShardName(key));
  return {
    claim: (key, owner, lease_ms) => gate(key).claimObservation(key, owner, lease_ms),
    commit: (key, owner, value_json, expires_at) => gate(key).commitObservation(key, owner, value_json, expires_at),
    release: (key, owner) => gate(key).releaseObservation(key, owner),
  };
}

export function createProviderContext(env: Env, deadline: number, signal?: AbortSignal): ObservationCacheContext {
  return {
    deadline,
    ...(signal ? { signal } : {}),
    observation_cache: createObservationCachePort(env),
    fetch: pacedFetch({ deadline, ...(signal ? { signal } : {}), fetch: globalThis.fetch.bind(globalThis),
      gate: host => env.ORIGIN_GATE.getByName(host) })
  };
}
