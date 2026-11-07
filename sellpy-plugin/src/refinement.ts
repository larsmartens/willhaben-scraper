import { ToolError, type Candidate, type ItemFeedback, type ItemObservation } from './domain.js';
import { normalizeEvidenceKey as key, resolveVisualRequirement } from './evidence.js';
import { sourceFacetEvidence } from './facet-evidence.js';
import { effectiveFilters } from './sellpy/normalize.js';

export interface RankingRequirement {
  requirement: string;
  priority: 'require' | 'avoid' | 'prefer';
}

export interface RankingPreferences {
  mode?: 'balanced' | 'relevance' | 'price_low' | 'diverse';
  diversity?: number;
  price_min?: number;
  price_max?: number;
  currency?: string;
  /** Exact Sellpy size labels, including their size system where supplied. */
  sizes?: string[];
  /** Exact native facet labels; a leading minus excludes a label. */
  source_facets?: Record<string, string[]>;
  excluded_brands?: string[];
  preferred_brands?: string[];
  /** At least one of these exact source material labels must be present. */
  required_materials?: string[];
  excluded_materials?: string[];
  preferred_materials?: string[];
  /** Exact source measurement keys; native InCm fields are already centimeters. */
  measurements?: Record<string, { min?: number; max?: number }>;
  /** Copy the exact requirement text into record_visual_assessment results. */
  requirements?: RankingRequirement[];
  unknown_policy?: 'keep' | 'exclude';
  include_reserved?: boolean;
}

export interface CriterionEvidence {
  criterion: string;
  priority: 'require' | 'avoid' | 'prefer';
  verdict: 'confirmed' | 'contradicted' | 'unknown';
  source: 'catalog' | 'visual_assessment' | 'feedback' | 'none';
  evidence: string;
  checked_image_ids?: string[];
}

export interface CandidateEvaluation {
  item_id: string;
  eligibility: 'pass' | 'fail' | 'unknown';
  included: boolean;
  /** A pool-independent heuristic, not a probability or an embedding score. */
  base_score: number;
  components: { retrieval: number; soft_preferences: number; feedback: number; price: number | null };
  evidence: CriterionEvidence[];
  warnings: string[];
}

export interface RankedCandidate {
  candidate: Candidate;
  evaluation: CandidateEvaluation;
  score: number;
  diversity_penalty: number;
  /** Response projection only. Full evidence remains in the saved refinement. */
  response_omissions?: { field: string; omitted_entries: number; retained_in: string }[];
}

export interface RankingResult {
  items: RankedCandidate[];
  excluded: CandidateEvaluation[];
  total_candidates: number;
  total_included: number;
  warnings: string[];
}

const RRF_UNIT = 1 / 61;
const PREFERENCE_WEIGHT = 0.2;
const SHORTLIST_BONUS = 0.2;

function values(input: readonly string[] | undefined): Set<string> {
  return new Set((input ?? []).map(key).filter(Boolean));
}

export function validateRankingPreferences(preferences: RankingPreferences): void {
  if (preferences.source_facets) effectiveFilters({ facets: preferences.source_facets });
  if (preferences.mode !== undefined && !['balanced', 'relevance', 'price_low', 'diverse'].includes(preferences.mode)) {
    throw new ToolError('invalid_ranking_preference', 'Choose balanced, relevance, price_low or diverse ranking.');
  }
  if (preferences.diversity !== undefined && (!Number.isFinite(preferences.diversity) || preferences.diversity < 0 || preferences.diversity > 1)) {
    throw new ToolError('invalid_ranking_preference', 'Diversity must be a finite value between 0 and 1.');
  }
  if ((preferences.unknown_policy !== undefined && !['keep', 'exclude'].includes(preferences.unknown_policy)) ||
    (preferences.include_reserved !== undefined && typeof preferences.include_reserved !== 'boolean')) {
    throw new ToolError('invalid_ranking_preference', 'Use keep or exclude for unknown facts and an explicit boolean for reserved items.');
  }
  for (const list of [preferences.sizes, preferences.excluded_brands, preferences.preferred_brands,
    preferences.required_materials, preferences.excluded_materials, preferences.preferred_materials]) {
    if (list !== undefined && (!Array.isArray(list) || list.some(value => typeof value !== 'string' || !key(value)))) {
      throw new ToolError('invalid_ranking_preference', 'Attribute choices must contain nonempty exact source labels.');
    }
  }
  if (preferences.currency !== undefined && !/^[A-Z]{3}$/.test(preferences.currency)) {
    throw new ToolError('invalid_ranking_preference', 'Use an explicit three-letter uppercase currency code.');
  }
  if ((preferences.price_min !== undefined || preferences.price_max !== undefined || preferences.mode === 'price_low') && !preferences.currency) {
    throw new ToolError('currency_required', 'Price constraints and price ranking need an explicit currency.', {
      next_action: 'Use the search market currency; currency conversion is not inferred.' });
  }
  for (const amount of [preferences.price_min, preferences.price_max]) {
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100)))) {
      throw new ToolError('invalid_ranking_preference', 'Price limits must be nonnegative finite amounts in major currency units.');
    }
  }
  if (preferences.price_min !== undefined && preferences.price_max !== undefined && preferences.price_min > preferences.price_max) {
    throw new ToolError('invalid_ranking_preference', 'The minimum price exceeds the maximum price.');
  }
  for (const [name, range] of Object.entries(preferences.measurements ?? {})) {
    if (!name.trim() || [range.min, range.max].some(value => value !== undefined && (!Number.isFinite(value) || value < 0)) ||
      (range.min !== undefined && range.max !== undefined && range.min > range.max)) {
      throw new ToolError('invalid_ranking_preference', 'Measurement bounds must be nonnegative and ordered.');
    }
  }
  const required = new Set<string>();
  const avoided = new Set<string>();
  for (const requirement of preferences.requirements ?? []) {
    if (!key(requirement.requirement) || !['require', 'avoid', 'prefer'].includes(requirement.priority)) {
      throw new ToolError('invalid_ranking_preference', 'Each visual requirement needs text and require, avoid or prefer priority.');
    }
    if (requirement.priority === 'require') required.add(key(requirement.requirement));
    if (requirement.priority === 'avoid') avoided.add(key(requirement.requirement));
  }
  if ([...required].some(requirement => avoided.has(requirement))) {
    throw new ToolError('contradictory_requirements', 'The same feature cannot be both required and forbidden.', {
      next_action: 'Choose whether to require or avoid the conflicting feature before refining.' });
  }
}

function numericMeasurement(value: string | number | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  // Exact numeric source values only. Never infer units, ranges or body circumference.
  if (typeof value !== 'string' || !/^\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const number = Number(value.trim().replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function visualRequirement(candidate: Candidate, requirement: RankingRequirement): CriterionEvidence {
  const result = resolveVisualRequirement(candidate, requirement.requirement);
  return { criterion: requirement.requirement, priority: requirement.priority, verdict: result.verdict, source: result.source,
    evidence: result.status === 'unavailable' ? 'No current, item-specific original-photo assessment is available.'
      : result.status === 'conflicting' ? 'Recorded visual evidence conflicts; inspect the item again.'
      : result.status === 'unassessed' ? 'This exact requirement has not been assessed on original images. Source titles or labels are not visual proof.'
      : result.evidence,
    ...(result.checked_image_ids ? { checked_image_ids: result.checked_image_ids } : {}) };
}

/** Evaluate one stored observation independently of the candidate pool. No I/O. */
export function evaluateCandidate(candidate: Candidate, preferences: RankingPreferences = {}, feedback?: ItemFeedback): CandidateEvaluation {
  validateRankingPreferences(preferences);
  if (feedback && feedback.item_id !== candidate.item.id) throw new ToolError('feedback_identity_mismatch', 'Feedback belongs to another item.');
  const item = candidate.item;
  const evidence: CriterionEvidence[] = [];
  const warnings: string[] = [];
  const add = (criterion: string, priority: CriterionEvidence['priority'], verdict: CriterionEvidence['verdict'], message: string,
    source: CriterionEvidence['source'] = 'catalog'): void => { evidence.push({ criterion, priority, verdict, source, evidence: message }); };

  add('availability', 'require', item.availability === 'available' || (item.availability === 'reserved' && preferences.include_reserved === true)
    ? 'confirmed' : item.availability === 'unknown' ? 'unknown' : 'contradicted',
  `Observed availability: ${item.availability}. Reserved items are included only when requested.`);

  if (preferences.currency) {
    add('currency', 'require', !item.price ? 'unknown' : item.price.currency === preferences.currency ? 'confirmed' : 'contradicted',
      item.price ? `Source currency: ${item.price.currency}; requested: ${preferences.currency}. No conversion was performed.` : 'No source price is available.');
  }
  if (preferences.price_min !== undefined || preferences.price_max !== undefined) {
    const min = preferences.price_min === undefined ? null : Math.round(preferences.price_min * 100);
    const max = preferences.price_max === undefined ? null : Math.round(preferences.price_max * 100);
    const price = item.price && item.price.currency === preferences.currency ? item.price.amount_minor : null;
    const verdict = price === null ? 'unknown' : (min === null || price >= min) && (max === null || price <= max) ? 'confirmed' : 'contradicted';
    add('price_range', 'require', verdict, price === null ? 'No comparable source price is available.'
      : `Source price: ${price} minor ${preferences.currency} units; allowed bounds: ${min ?? 'none'} to ${max ?? 'none'}.`);
  }

  const matchSource = (criterion: string, actual: string[], desired: string[] | undefined, priority: CriterionEvidence['priority']): void => {
    const wanted = values(desired);
    if (!wanted.size) return;
    const present = values(actual);
    add(criterion, priority, !present.size ? 'unknown' : [...wanted].some(value => present.has(value)) ? 'confirmed' : 'contradicted',
      !present.size ? 'The source does not state this attribute.'
        : `Exact source labels: ${actual.join(', ')}. Requested labels: ${(desired ?? []).join(', ')}.`, !present.size ? 'none' : 'catalog');
  };
  matchSource('size', item.size ? [item.size] : [], preferences.sizes, 'require');
  matchSource('excluded_brand', item.brand ? [item.brand] : [], preferences.excluded_brands, 'avoid');
  matchSource('preferred_brand', item.brand ? [item.brand] : [], preferences.preferred_brands, 'prefer');
  matchSource('required_material', item.materials, preferences.required_materials, 'require');
  matchSource('excluded_material', item.materials, preferences.excluded_materials, 'avoid');
  matchSource('preferred_material', item.materials, preferences.preferred_materials, 'prefer');
  evidence.push(...sourceFacetEvidence(item, preferences.source_facets));

  for (const [name, range] of Object.entries(preferences.measurements ?? {})) {
    if (range.min === undefined && range.max === undefined) continue;
    const measured = numericMeasurement(item.measurements[name]);
    add(`measurement:${name}`, 'require', measured === null ? 'unknown'
      : (range.min === undefined || measured >= range.min) && (range.max === undefined || measured <= range.max) ? 'confirmed' : 'contradicted',
    measured === null ? 'No unambiguous numeric source measurement is available; no value or unit was inferred.'
      : `Source ${name}: ${measured}; allowed bounds: ${range.min ?? 'none'} to ${range.max ?? 'none'}.`);
  }

  const seen = new Set<string>();
  for (const requirement of preferences.requirements ?? []) {
    const identity = `${requirement.priority}:${key(requirement.requirement)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    evidence.push(visualRequirement(candidate, requirement));
  }
  if (feedback?.decision === 'reject') add('user_feedback', 'require', 'contradicted', feedback.reason || 'The user rejected this item.', 'feedback');
  if (feedback?.decision === 'shortlist') add('user_feedback', 'prefer', 'confirmed', feedback.reason || 'The user shortlisted this item.', 'feedback');

  const hard = evidence.filter(entry => entry.priority !== 'prefer');
  const failed = hard.some(entry => entry.priority === 'avoid' ? entry.verdict === 'confirmed' : entry.verdict === 'contradicted');
  const unknown = hard.some(entry => entry.verdict === 'unknown');
  const eligibility = failed ? 'fail' : unknown ? 'unknown' : 'pass';
  const soft = evidence.filter(entry => entry.priority === 'prefer' && entry.source !== 'feedback');
  const preference = soft.length ? soft.reduce((sum, entry) => sum + (entry.verdict === 'confirmed' ? 1 : entry.verdict === 'contradicted' ? -1 : 0), 0) / soft.length : 0;
  const rawFusion = Number.isFinite(candidate.fusion_score) && candidate.fusion_score > 0 ? candidate.fusion_score : 0;
  const retrieval = rawFusion / (rawFusion + RRF_UNIT);
  const price = item.price && Number.isSafeInteger(item.price.amount_minor) && item.price.amount_minor >= 0
    && (!preferences.currency || item.price.currency === preferences.currency) ? 1 / (1 + item.price.amount_minor / 100) : null;
  const priceMode = preferences.mode === 'price_low';
  const feedbackScore = !priceMode && feedback?.decision === 'shortlist' ? SHORTLIST_BONUS : 0;
  const preferenceScore = priceMode ? 0 : PREFERENCE_WEIGHT * preference;
  // A saturating rank score permits streamed evaluation without pool normalization.
  // Price mode stays strictly monotonic in price; liking an item never hides a dearer price.
  const baseScore = priceMode ? price ?? 0 : Math.max(0, retrieval + preferenceScore + feedbackScore);
  if (priceMode && preferences.diversity) warnings.push('Price order is exact; diversity does not override it.');
  return { item_id: item.id, eligibility, included: eligibility !== 'fail' && (eligibility !== 'unknown' || preferences.unknown_policy !== 'exclude'),
    base_score: baseScore, components: { retrieval, soft_preferences: preferenceScore, feedback: feedbackScore, price }, evidence, warnings };
}

function featureSet(candidate: Candidate): Set<string> {
  const item = candidate.item;
  const features = new Set<string>();
  const add = (prefix: string, value: string | null | undefined): void => { if (value && key(value)) features.add(`${prefix}:${key(value)}`); };
  add('brand', item.brand);
  for (const color of item.colors) add('color', color);
  for (const material of item.materials) add('material', material);
  const sourceType = typeof item.attributes.type_en === 'string' ? item.attributes.type_en
    : typeof item.attributes.type === 'string' ? item.attributes.type : item.categories.at(-1)?.split('>').at(-1)?.trim();
  add('type', candidate.assessment?.observed_type ?? sourceType);
  for (const name of ['pattern', 'neckline', 'sleeveLength', 'garmentLength'] as const) {
    const value = item.attributes[name];
    if (typeof value === 'string') add(name, value);
    else if (Array.isArray(value)) for (const entry of value) add(name, entry);
  }
  for (const feature of candidate.assessment?.matching_features ?? []) add('observed', feature);
  return features;
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const value of left.size <= right.size ? left : right) if ((left.size <= right.size ? right : left).has(value)) shared++;
  return shared / (left.size + right.size - shared);
}

/** Disclosed metadata/recorded-feature overlap, not image or embedding similarity. */
export function metadataSimilarity(left: Candidate, right: Candidate): number {
  return left.item.id === right.item.id ? 1 : overlap(featureSet(left), featureSet(right));
}

function compareEntries(left: RankedCandidate, right: RankedCandidate, priceMode = false): number {
  const tier = (value: CandidateEvaluation): number => value.eligibility === 'pass' ? 1 : 0;
  const evidenceOrder = tier(right.evaluation) - tier(left.evaluation);
  const scoreOrder = right.score - left.score || right.evaluation.base_score - left.evaluation.base_score;
  return (priceMode ? scoreOrder || evidenceOrder : evidenceOrder || scoreOrder)
    || (left.candidate.item.id < right.candidate.item.id ? -1 : left.candidate.item.id > right.candidate.item.id ? 1 : 0);
}

/** MMR-style reranking of an explicitly bounded candidate window; never fetches or discards the ledger. */
export function rankCandidates(candidates: readonly Candidate[], preferences: RankingPreferences = {},
  feedback: ReadonlyMap<string, ItemFeedback> = new Map(), options: { limit?: number; diversity_context?: readonly Candidate[] } = {}): RankingResult {
  validateRankingPreferences(preferences);
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) {
    throw new ToolError('invalid_ranking_limit', 'A ranking window limit must be a positive safe integer.');
  }
  const seen = new Set<string>();
  const eligible: RankedCandidate[] = [];
  const excluded: CandidateEvaluation[] = [];
  const warnings = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.item.id)) continue;
    seen.add(candidate.item.id);
    const evaluation = evaluateCandidate(candidate, preferences, feedback.get(candidate.item.id));
    for (const warning of evaluation.warnings) warnings.add(warning);
    if (evaluation.included) eligible.push({ candidate, evaluation, score: evaluation.base_score, diversity_penalty: 0 });
    else excluded.push(evaluation);
  }
  const totalIncluded = eligible.length;
  const limit = Math.min(options.limit ?? eligible.length, eligible.length);
  const diversity = preferences.mode === 'price_low' ? 0 : preferences.diversity
    ?? (preferences.mode === 'relevance' ? 0 : preferences.mode === 'diverse' ? 0.45 : 0.2);
  if (!diversity) {
    eligible.sort((left, right) => compareEntries(left, right, preferences.mode === 'price_low'));
    return { items: eligible.slice(0, limit), excluded, total_candidates: seen.size, total_included: totalIncluded, warnings: [...warnings] };
  }
  const features = new Map(eligible.map(entry => [entry.candidate.item.id, featureSet(entry.candidate)]));
  const contexts = (options.diversity_context ?? []).map(featureSet);
  const similarity = new Map(eligible.map(entry => [entry.candidate.item.id,
    contexts.reduce((maximum, context) => Math.max(maximum, overlap(features.get(entry.candidate.item.id)!, context)), 0)]));
  const remaining = new Set(eligible);
  const items: RankedCandidate[] = [];
  // Cache each feature set and update only against the last selection: O(window * page_size).
  while (items.length < limit) {
    let best: RankedCandidate | null = null;
    for (const entry of remaining) {
      entry.diversity_penalty = diversity * similarity.get(entry.candidate.item.id)!;
      entry.score = (1 - diversity) * entry.evaluation.base_score - entry.diversity_penalty;
      if (!best || compareEntries(entry, best) < 0) best = entry;
    }
    if (!best) break;
    remaining.delete(best);
    items.push(best);
    const selectedFeatures = features.get(best.candidate.item.id)!;
    for (const entry of remaining) {
      const id = entry.candidate.item.id;
      similarity.set(id, Math.max(similarity.get(id)!, overlap(features.get(id)!, selectedFeatures)));
    }
  }
  return { items, excluded, total_candidates: seen.size, total_included: totalIncluded, warnings: [...warnings] };
}

/** Comparison facts are copied literally; this helper does not infer fit or quality. */
export function observedMeasurements(item: ItemObservation): Record<string, number | null> {
  return Object.fromEntries(Object.entries(item.measurements).map(([name, value]) => [name, numericMeasurement(value)]));
}
