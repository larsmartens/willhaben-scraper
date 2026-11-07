// Controlled local CPU-cost probe, not a Sellpy relevance or end-to-end latency benchmark.
// Run: node --import tsx scripts/benchmark-refinement.mjs
import { performance } from 'node:perf_hooks';
import { evaluateCandidate, rankCandidates } from '../src/refinement.ts';

const observedAt = '2026-11-06T23:00:00.000Z';
function candidate(index) {
  const id = `synthetic-${index}`;
  const imageId = `${id}-front`;
  return { item: { id, market: 'AT', language: 'de', url: `https://www.sellpy.at/item/${id}`,
    title: `Synthetic dress ${index}`, brand: `Brand ${index % 17}`, price: { amount_minor: 700 + (index % 70) * 100, currency: 'EUR' },
    original_price: null, size: 'WMN-INT-M', size_system: 'INT', condition: 'Gut', categories: ['Damen > Kleidung > Kleider'],
    colors: [`Color ${index % 7}`], materials: [index % 2 ? 'Baumwolle' : 'Leinen'], measurements: { lengthInCm: 90 + index % 30 },
    description: null, defects: [], images: [{ id: imageId, index: 0, url: `https://prod.images.sellpy.net/fixture/${id}.jpg` }],
    availability: 'available', observed_at: observedAt, source: 'catalog', attributes: { pattern: `Pattern ${index % 4}`, sleeveLength: 'Long sleeves' } },
    paths: [{ arm_id: 'semantic', route: 'semantic', rank: index + 1, observed_at: observedAt }], fusion_score: 1 / (61 + index),
    assessment: { item_id: id, checked_image_ids: [imageId], observed_type: 'dress', matching_features: ['floral pattern'], mismatches: [],
      uncertainties: [], requirement_results: [{ requirement: 'long sleeves', verdict: index % 5 ? 'confirmed' : 'unknown', evidence: 'Synthetic fixture verdict, not an actual image assessment.' }],
      assessed_at: observedAt, author: 'assistant' } };
}

const pool = Array.from({ length: 10000 }, (_, index) => candidate(index));
const preferences = { currency: 'EUR', price_max: 80, sizes: ['WMN-INT-M'],
  measurements: { lengthInCm: { min: 90, max: 120 } }, preferred_materials: ['Leinen'],
  requirements: [{ requirement: 'long sleeves', priority: 'require' }], mode: 'balanced' };

function measure(name, count, operation) {
  operation();
  const samples = Array.from({ length: 7 }, () => {
    const cpuStart = process.cpuUsage();
    const start = performance.now();
    const result = operation();
    const duration = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    if (result !== count) throw new Error(`Unexpected ${name} result count: ${result}`);
    return { elapsed: duration, cpu: (cpu.user + cpu.system) / 1000 };
  });
  const elapsed = samples.map(value => value.elapsed).sort((a, b) => a - b);
  const cpu = samples.map(value => value.cpu).sort((a, b) => a - b);
  return { name, count, samples: samples.length,
    median_elapsed_ms: Number(elapsed[3].toFixed(3)), maximum_elapsed_ms: Number(elapsed.at(-1).toFixed(3)),
    median_process_cpu_ms: Number(cpu[3].toFixed(3)), maximum_process_cpu_ms: Number(cpu.at(-1).toFixed(3)) };
}

const measurements = [
  measure('streamed_evaluation_500', 500, () => pool.slice(0, 500).filter(value => evaluateCandidate(value, preferences).included).length),
  measure('streamed_evaluation_10000', 10000, () => pool.filter(value => evaluateCandidate(value, preferences).included).length),
  measure('mmr_window_500_page_20', 20, () => rankCandidates(pool.slice(0, 500), preferences, new Map(), { limit: 20 }).items.length),
];
console.log(JSON.stringify({ kind: 'synthetic_local_cpu_probe', node: process.version, date: new Date().toISOString(),
  source: 'scripts/benchmark-refinement.mjs', network_requests: 0, measurements,
  limitations: ['One shared runtime and a deterministic synthetic fixture; elapsed time can vary with host contention.', 'Process CPU includes the Node process threads and is not hosted Worker CPU time.', 'Does not measure Sellpy recall, real user preferences or network latency.',
    'Source image URLs are inert fixture identifiers; no original photos are accessed or assessed.'] }, null, 2));
