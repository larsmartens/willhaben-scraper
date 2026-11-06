import type { Candidate, ItemObservation, RetrievalPath, SearchArm } from './domain.js';

const RRF_OFFSET = 60;

export function reciprocalRankScore(paths: RetrievalPath[], arms: SearchArm[]): number {
  const weights = new Map(arms.map(arm => [arm.id, arm.weight ?? 1]));
  const bestRanks = new Map<string, number>();
  for (const path of paths) {
    if (!Number.isSafeInteger(path.rank) || path.rank < 1) continue;
    bestRanks.set(path.arm_id, Math.min(bestRanks.get(path.arm_id) ?? Infinity, path.rank));
  }
  let score = 0;
  for (const [id, rank] of bestRanks) score += (weights.get(id) ?? 1) / (RRF_OFFSET + rank);
  return score;
}

export function preferObservation(current: ItemObservation, incoming: ItemObservation): boolean {
  const difference = Date.parse(incoming.observed_at) - Date.parse(current.observed_at);
  return difference > 0 || (difference === 0 && incoming.source === 'detail' && current.source !== 'detail');
}

export function assessmentStillApplies(current: Candidate, incoming: ItemObservation): boolean {
  if (!current.assessment) return false;
  const imageIds = new Set(incoming.images.map(image => image.id));
  if (current.assessment.checked_image_ids.some(id => !imageIds.has(id))) return false;
  for (const field of ['price', 'size', 'size_system', 'availability', 'materials', 'measurements', 'defects'] as const) {
    if (JSON.stringify(current.item[field]) !== JSON.stringify(incoming[field])) return false;
  }
  return true;
}
