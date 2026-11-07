import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';
import { ToolError } from '../src/domain.js';
import {
  OBSERVATION_CACHE_LIMITS, PublicObservationStore, publicObservationKey, observationShardName,
  withCachedObservation, withoutObservationCache,
  type ObservationAtomic, type ObservationCacheContext, type ObservationCachePort, type ObservationPolicy, type ObservationSql,
} from '../src/provider-cache.js';

function store(now = Date.now) {
  const database = new DatabaseSync(':memory:');
  const sql: ObservationSql = { exec<T extends Record<string, string | number | ArrayBuffer | null>>(query: string, ...bindings: unknown[]) {
    const values = database.prepare(query).all(...bindings as SQLInputValue[]);
    return { toArray: () => values as T[] };
  } };
  const atomic: ObservationAtomic = operation => {
    database.exec('BEGIN IMMEDIATE');
    try { const value = operation(); database.exec('COMMIT'); return value; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  const value = new PublicObservationStore(sql, atomic, now);
  const port: ObservationCachePort = {
    claim: async (...args) => value.claim(...args), commit: async (...args) => value.commit(...args),
    release: async (...args) => value.release(...args),
  };
  return { value, port, database };
}

const key = (number: number, kind = 'search') => `observation:v1:${kind}:${number.toString(16).padStart(64, '0')}`;
function context(port?: ObservationCachePort): ObservationCacheContext {
  return { deadline: Date.now() + 10_000, fetch, ...(port ? { observation_cache: port } : {}) };
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type Value = { observed_at: string; items: { id: string; observed_at: string }[] };
const policy: ObservationPolicy<Value> = { kind: 'search', input: { query: 'cottagecore', market: 'AT', language: 'de' },
  observed_at: value => Date.parse(value.observed_at) };
const observation = (): Value => { const observed_at = new Date().toISOString(); return { observed_at, items: [{ id: 'one', observed_at }] }; };

test('semantic keys are canonical hashes and separate locale, pagination, filters, sorting and seeds', async () => {
  const input = { market: 'AT', language: 'de', arm: { route: 'similar', seed_ids: ['a', 'b'], filters: { sizes: ['M'] }, sort: 'newest' }, offset: 0, page_size: 40 };
  const original = await publicObservationKey('search', input);
  assert.match(original, /^observation:v1:search:[a-f0-9]{64}$/);
  assert.equal(await publicObservationKey('search', { page_size: 40, arm: input.arm, offset: 0, language: 'de', market: 'AT' }), original);
  assert.notEqual(await publicObservationKey('details', input), original);
  for (const changed of [{ ...input, market: 'DE' }, { ...input, language: 'en' }, { ...input, offset: 40 },
    { ...input, page_size: 80 }, { ...input, arm: { ...input.arm, sort: 'relevance' } },
    { ...input, arm: { ...input.arm, filters: { sizes: ['S'] } } }, { ...input, arm: { ...input.arm, seed_ids: ['b', 'a'] } }]) {
    assert.notEqual(await publicObservationKey('search', changed), original);
  }
  assert.match(observationShardName(original), /^public-observations:v1:[a-f0-9]$/);
  assert.throws(() => observationShardName('query:secret'), /Invalid/);
});

test('SQLite leases are atomic; expired and superseded owners cannot publish or release a new lease', () => {
  let now = 1000;
  const fixture = store(() => now);
  try {
    assert.deepEqual(fixture.value.claim(key(1), 'old', 50), { state: 'owner', expires_at: 1050 });
    assert.deepEqual(fixture.value.claim(key(1), 'next', 50), { state: 'waiting', expires_at: 1050 });
    assert.equal(fixture.value.commit(key(1), 'next', '{"wrong":true}', 1500), false);
    now = 1050;
    assert.equal(fixture.value.claim(key(1), 'next', 100).state, 'owner');
    assert.equal(fixture.value.commit(key(1), 'old', '{"stale":true}', 1500), false);
    fixture.value.release(key(1), 'old');
    assert.equal(fixture.value.claim(key(1), 'third', 100).state, 'waiting');
    assert.equal(fixture.value.commit(key(1), 'next', '{"original":true}', 1500), true);
    assert.deepEqual(fixture.value.claim(key(1), 'third', 100), { state: 'cached', value_json: '{"original":true}', expires_at: 1500 });
    assert.equal(fixture.value.nextExpiry(), 1500);
    now = 1500; fixture.value.cleanup();
    assert.equal(fixture.value.nextExpiry(), null);
    assert.equal(fixture.value.claim(key(1), 'third', 100).state, 'owner');
  } finally { fixture.database.close(); }
});

test('entry bytes, aggregate bytes, row count and live leases have finite budgets', () => {
  const fixture = store(() => 1000);
  try {
    fixture.value.claim(key(0), 'owner', 1000);
    assert.equal(fixture.value.commit(key(0), 'owner', 'x'.repeat(OBSERVATION_CACHE_LIMITS.entry_bytes + 1), 2000), false);
    assert.throws(() => fixture.value.commit(key(0), 'owner', 'not-json', 2000), SyntaxError);
    assert.equal(fixture.value.commit(key(0), 'owner', '{}', 61_001), false);
    fixture.value.release(key(0), 'owner');
    for (let i = 0; i < OBSERVATION_CACHE_LIMITS.entries + 10; i++) {
      fixture.value.claim(key(i), 'owner', 1000);
      assert.equal(fixture.value.commit(key(i), 'owner', '{"ok":true}', 2000 + i), true);
    }
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM public_observations').get()!.count, OBSERVATION_CACHE_LIMITS.entries);
    const large = JSON.stringify('a'.repeat(OBSERVATION_CACHE_LIMITS.entry_bytes - 2));
    for (let i = 1000; i < 1020; i++) {
      fixture.value.claim(key(i), 'owner', 1000);
      fixture.value.commit(key(i), 'owner', large, 3000 + i);
    }
    assert.ok(Number(fixture.database.prepare('SELECT SUM(byte_count) AS bytes FROM public_observations').get()!.bytes) <= OBSERVATION_CACHE_LIMITS.total_bytes);
    for (let i = 2000; i < 2000 + OBSERVATION_CACHE_LIMITS.leases; i++) assert.equal(fixture.value.claim(key(i), 'owner', 1000).state, 'owner');
    assert.equal(fixture.value.claim(key(9999), 'owner', 1000).state, 'bypass');
  } finally { fixture.database.close(); }
});

test('four local contexts share one completed load; cache hits are separate graphs with original timestamps', async () => {
  const fixture = store(); let calls = 0;
  try {
    const source = observation();
    const load = async () => { calls++; await delay(30); return source; };
    const values = await Promise.all(Array.from({ length: 4 }, () => withCachedObservation(context(fixture.port), policy, load)));
    assert.equal(calls, 1);
    for (const value of values) assert.deepEqual(value, source);
    values[1]!.items[0]!.id = 'mutated';
    const again = await withCachedObservation(context(fixture.port), policy, load);
    assert.equal(again.items[0]!.id, 'one');
    assert.equal(again.observed_at, source.observed_at);
    assert.equal(again.items[0]!.observed_at, source.items[0]!.observed_at);
    assert.equal(calls, 1);
  } finally { fixture.database.close(); }
});

test('cache expiry is anchored to the source timestamp; request echoes are projected out', async () => {
  const fixture = store();
  try {
    const source = { ...observation(), observed_at: new Date(Date.now() - 2000).toISOString(), private_criteria: 'do-not-persist' };
    const localPolicy: ObservationPolicy<typeof source> = { ...policy, kind: 'details',
      project: value => ({ observed_at: value.observed_at, items: value.items }),
      restore: value => ({ ...value as Value, private_criteria: 'do-not-persist' }) };
    await withCachedObservation(context(fixture.port), localPolicy, async () => source);
    const row = fixture.database.prepare('SELECT value_json,expires_at FROM public_observations').get()!;
    assert.equal(row.expires_at, Date.parse(source.observed_at) + 5000);
    assert.ok(!String(row.value_json).includes('do-not-persist'));
    const second = await withCachedObservation(context(fixture.port), localPolicy, async () => { throw new Error('cache missed'); });
    assert.deepEqual(second, source);
  } finally { fixture.database.close(); }
});

test('owner failure preserves Retry-After, releases the lease, and permits a waiting caller to recover', async () => {
  const fixture = store(); let calls = 0;
  const error = new ToolError('rate_limited', 'Controlled cooldown', { retryable: true, retry_at: '2026-11-07T12:00:00Z' });
  try {
    const load = async () => { calls++; if (calls === 1) { await delay(30); throw error; } return observation(); };
    const results = await Promise.allSettled([withCachedObservation(context(fixture.port), policy, load), withCachedObservation(context(fixture.port), policy, load)]);
    assert.equal(calls, 2);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    const failure = results.find(value => value.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failure.reason, error);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM public_observation_leases').get()!.count, 0);
  } finally { fixture.database.close(); }
});

test('partial observations and explicit refresh bypass never enter the shared cache', async () => {
  const fixture = store(); let calls = 0;
  try {
    const load = async () => { calls++; return observation(); };
    const partial = { ...policy, cacheable: () => false };
    await withCachedObservation(context(fixture.port), partial, load);
    await withCachedObservation(context(fixture.port), partial, load);
    assert.equal(calls, 2);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM public_observations').get()!.count, 0);
    const original = context(fixture.port), bypass = withoutObservationCache(original);
    assert.equal(bypass.fetch, original.fetch); assert.equal(bypass.deadline, original.deadline);
    await withCachedObservation(bypass, policy, load);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM public_observations').get()!.count, 0);
  } finally { fixture.database.close(); }
});

test('waiters obey cancellation/deadlines and cannot release the active owner', async () => {
  const fixture = store(); const hashed = await publicObservationKey(policy.kind, policy.input);
  try {
    fixture.value.claim(hashed, 'active', 5000);
    const abort = new AbortController(), cancelled = { ...context(fixture.port), signal: abort.signal };
    const pending = withCachedObservation(cancelled, policy, async () => { throw new Error('must not load'); });
    setTimeout(() => abort.abort(), 20);
    await assert.rejects(pending, error => error instanceof ToolError && error.code === 'cancelled');
    await assert.rejects(withCachedObservation({ ...context(fixture.port), deadline: Date.now() + 30 }, policy, async () => observation()),
      error => error instanceof ToolError && error.code === 'time_budget');
    assert.equal(fixture.value.claim(hashed, 'other', 1000).state, 'waiting');
  } finally { fixture.database.close(); }
});

test('a stuck cache RPC cannot outlive the caller deadline', async () => {
  const port: ObservationCachePort = { claim: () => new Promise(() => {}), commit: async () => false, release: async () => {} };
  await assert.rejects(withCachedObservation({ ...context(port), deadline: Date.now() + 25 }, policy, async () => observation()),
    error => error instanceof ToolError && error.code === 'time_budget');
});

test('an interrupted partial detail result preserves retry metadata instead of being replaced by a cache deadline error', async () => {
  const fixture = store(), request = context(fixture.port);
  const partial = { failures: [{ id: 'one', error: { code: 'time_budget', retryable: true } }], remaining_ids: ['one'] };
  try {
    const result = await withCachedObservation(request, { kind: 'details', input: { ids: ['one'], market: 'AT', language: 'de' },
      observed_at: () => NaN, cacheable: () => false }, async () => {
      request.deadline = Date.now() - 1;
      return partial;
    });
    assert.deepEqual(result, partial);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM public_observations').get()!.count, 0);
  } finally { fixture.database.close(); }
});
