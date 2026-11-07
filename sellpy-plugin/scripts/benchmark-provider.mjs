#!/usr/bin/env node
// Live, opt-in A/B comparison. Does not read private connection credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const { values } = parseArgs({ options: {
  'baseline-ref': { type: 'string' },
  ids: { type: 'string', default: 'PZv57Y9Eot,zEeZQYpm0i,kwPIDKhoUS' },
  samples: { type: 'string', default: '5' },
  market: { type: 'string', default: 'AT' },
  language: { type: 'string', default: 'de' },
  output: { type: 'string', default: 'artifacts/private/provider-benchmark.json' },
} });
assert(values['baseline-ref'], 'Pass --baseline-ref <locally available Git revision>.');
const samples = Number(values.samples);
assert(Number.isInteger(samples) && samples >= 5 && samples <= 20, 'Use 5–20 paired samples for this explicit benchmark.');
const ids = [...new Set(values.ids.split(','))];
assert(ids.length > 0 && ids.length <= 10 && ids.every(id => /^[A-Za-z0-9_-]{1,100}$/.test(id)), 'Pass 1–10 public item IDs; this is a bounded benchmark workload.');
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: packageRoot, encoding: 'utf8' }).trim();
const repositoryRoot = git(['rev-parse', '--show-toplevel']);
const packagePrefix = git(['rev-parse', '--show-prefix']);
const baselineRef = git(['rev-parse', `${values['baseline-ref']}^{commit}`]);
const candidateCheckoutHead = git(['rev-parse', 'HEAD']);
const sourceFiles = ['src/domain.ts', 'src/sellpy/client.ts', 'src/sellpy/config.ts', 'src/sellpy/http.ts', 'src/sellpy/normalize.ts'];
const digest = text => createHash('sha256').update(text).digest('hex');
const artifactRoot = join(packageRoot, 'artifacts/private/provider-benchmark', `${Date.now()}-${process.pid}`);
await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
const baselineSources = {}, candidateSources = {};
for (const path of sourceFiles) {
  const source = execFileSync('git', ['show', `${baselineRef}:${packagePrefix}${path}`], { cwd: repositoryRoot, encoding: 'utf8' });
  const target = join(artifactRoot, 'baseline', path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, source, { mode: 0o600 });
  baselineSources[path] = digest(source);
  const candidateSource = await readFile(join(packageRoot, path));
  const candidateTarget = join(artifactRoot, 'candidate', path);
  await mkdir(dirname(candidateTarget), { recursive: true, mode: 0o700 });
  await writeFile(candidateTarget, candidateSource, { mode: 0o600 });
  candidateSources[path] = digest(candidateSource);
}
const baselineBundle = join(artifactRoot, 'baseline.mjs');
const candidateBundle = join(artifactRoot, 'candidate.mjs');
await build({ entryPoints: [join(artifactRoot, 'baseline/src/sellpy/client.ts')], outfile: baselineBundle, bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: true });
await build({ entryPoints: [join(artifactRoot, 'candidate/src/sellpy/client.ts')], outfile: candidateBundle, bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: true });
const baseline = await import(pathToFileURL(baselineBundle).href);
const candidate = await import(pathToFileURL(candidateBundle).href);
const sharedCandidate = candidate.sharedSellpyProvider ?? candidate.createSellpyProvider();

function timedContext() {
  const started = performance.now();
  const requests = [];
  let inflight = 0;
  let maxInflight = 0;
  const context = { deadline: Date.now() + 35_000, fetch: async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const route = url.pathname.includes('graphql') ? 'graphql' : url.pathname.endsWith('/objects') ? 'objects'
      : url.pathname.includes('config.prod.') ? 'config' : url.pathname === '/search' ? 'search_html' : 'other';
    const callStart = performance.now();
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    try {
      const timeout = AbortSignal.timeout(Math.min(15_000, Math.max(1, context.deadline - Date.now())));
      const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
      const response = await fetch(input, { ...init, signal });
      const bytes = await response.arrayBuffer();
      requests.push({ route, start_ms: Math.round(callStart - started), duration_ms: Math.round(performance.now() - callStart), bytes: bytes.byteLength, status: response.status });
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.set('content-length', String(bytes.byteLength));
      return new Response(bytes, { status: response.status, headers });
    } catch (error) {
      requests.push({ route, start_ms: Math.round(callStart - started), duration_ms: Math.round(performance.now() - callStart), error: error instanceof Error ? error.name : 'unknown' });
      throw error;
    } finally { inflight--; }
  } };
  return { context, finish: () => ({ elapsed_ms: Math.round(performance.now() - started), requests, max_inflight: maxInflight,
    request_count: requests.length, transferred_bytes: requests.reduce((sum, request) => sum + (request.bytes ?? 0), 0) }) };
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'observed_at').sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => [key, normalize(part)]));
  return value;
}

const warmups = [];
// Both versions first serve a capabilities call, as in a normal MCP workflow.
// V1 then recreated its provider for each detail tool. V2 reuses plain config.
for (const [label, provider] of [['baseline', baseline.createSellpyProvider()], ['candidate', sharedCandidate]]) {
  const measured = timedContext();
  const capabilities = await provider.capabilities(measured.context);
  warmups.push({ label, ...measured.finish(), source_version: capabilities.source_version });
}

const observations = [];
for (let pair = 0; pair < samples; pair++) {
  const order = pair % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
  for (const label of order) {
    const provider = label === 'baseline' ? baseline.createSellpyProvider() : sharedCandidate;
    const measured = timedContext();
    try {
      const result = await provider.details(ids, values.market, values.language, measured.context);
      const canonical = normalize(result);
      const errorCount = result.failures.length + result.remaining_ids.length;
      const observation = { pair: pair + 1, label, ...measured.finish(), item_ids: result.items.map(item => item.id), error_count: errorCount,
        failures: result.failures.map(failure => ({ id: failure.id, code: failure.error.code })), remaining_ids: result.remaining_ids,
        normalized_output_sha256: digest(JSON.stringify(canonical)),
        summary: result.items.map(item => ({ id: item.id, price: item.price, availability: item.availability, source: item.source, photos: item.images.length })) };
      observations.push(observation);
      console.log(JSON.stringify({ pair: pair + 1, label, elapsed_ms: observation.elapsed_ms, requests: observation.request_count, bytes: observation.transferred_bytes, max_inflight: observation.max_inflight, error_count: errorCount }));
    } catch (error) {
      const observation = { pair: pair + 1, label, ...measured.finish(), error_count: 1, error_code: error?.code ?? error?.name ?? 'unknown' };
      observations.push(observation);
      console.log(JSON.stringify({ pair: pair + 1, label, error_code: observation.error_code }));
    }
  }
}

function stats(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, min: sorted[0], max: sorted.at(-1) };
}
const equivalence = Array.from({ length: samples }, (_, index) => {
  const before = observations.find(item => item.pair === index + 1 && item.label === 'baseline');
  const after = observations.find(item => item.pair === index + 1 && item.label === 'candidate');
  return { pair: index + 1, equivalent: !!before.normalized_output_sha256 && before.normalized_output_sha256 === after.normalized_output_sha256,
    error_free: before.error_count === 0 && after.error_count === 0 };
});
const summaries = Object.fromEntries(['baseline', 'candidate'].map(label => {
  const values = observations.filter(item => item.label === label);
  return [label, { samples: values.length, elapsed_ms: stats(values.map(item => item.elapsed_ms)), requests: stats(values.map(item => item.request_count)),
    transferred_bytes: stats(values.map(item => item.transferred_bytes)), errors: values.reduce((sum, item) => sum + item.error_count, 0) }];
}));
const accepted = equivalence.every(pair => pair.equivalent && pair.error_free);
const result = {
  checked_at: new Date().toISOString(), baseline_ref: baselineRef, baseline_source_sha256: baselineSources,
  candidate_checkout_head: candidateCheckoutHead, candidate_source_sha256: candidateSources,
  baseline_bundle_sha256: digest(await readFile(baselineBundle)), candidate_bundle_sha256: digest(await readFile(candidateBundle)),
  environment: { node: process.version, platform: process.platform, uptime: execFileSync('uptime', { encoding: 'utf8' }).trim(), nproc: Number(execFileSync('nproc', { encoding: 'utf8' }).trim()),
    transport: 'Node public-source fetch. No production OriginGate pacing; not an end-to-end ChatGPT or deployed-edge latency result.' },
  workload: { operation: 'fresh canonical details', ids, market: values.market, language: values.language, samples_per_variant: samples,
    design: 'Alternating paired order. Each call makes fresh price and canonical detail requests. V1 provider factory per tool versus V2 shared plain configuration following a capabilities call. Only observed_at is excluded from normalized output equivalence.' },
  warmups, observations, equivalence, summaries,
  conclusion: accepted ? { status: 'paired_outputs_equal', median_elapsed_reduction_percent: Math.round((1 - summaries.candidate.elapsed_ms.median / summaries.baseline.elapsed_ms.median) * 1000) / 10,
    caveat: 'A small paired sample of one workload in one environment. Not a p95, broad retrieval benchmark or general latency guarantee.' }
    : { status: 'inconclusive', reason: 'At least one output differed or failed. Do not claim a matched speed improvement from this run.' },
};
const output = resolve(packageRoot, values.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output: values.output, summaries, conclusion: result.conclusion }, null, 2));
