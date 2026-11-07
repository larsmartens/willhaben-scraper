import type { GalleryCard, GalleryData, ItemFeedback, ItemImage, ItemObservation, Money, RetrievalPath, SearchFilters, VisualAssessment } from '../src/domain.js';
import type { CollectionDescriptor, CollectionDetail, CollectionPageInfo, CollectionScope } from '../src/collection-contract.js';
import { assessmentStillApplies, preferObservation } from '../src/ranking.js';
export { formatMoney } from '../src/card-facts.js';

const ITEM_HOST = /^(?:www\.)?sellpy\.(?:com|at|de|se|nl|fi|dk|fr|be|pl|cz|it|es|ee|lt|lu|sk|hr|hu|si|pt|ie|ro|bg|gr)$/;
const IMAGE_HOSTS = new Set(['prod.images.sellpy.net', 'images.sellpy.net', 'sellpy-parse-prod-files.s3.amazonaws.com', 'sellpy-parse-prod-files.s3.eu-west-1.amazonaws.com']);

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function safeItemUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ITEM_HOST.test(url.hostname) && url.pathname.startsWith('/item/') ? url.href : null;
  } catch { return null; }
}

export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && IMAGE_HOSTS.has(url.hostname)
      ? url.href : null;
  } catch { return null; }
}

export function safeImageData(value: unknown): string | null {
  return typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value) ? value : null;
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function string(value: unknown): string | null { return typeof value === 'string' ? value : null; }

function money(value: unknown): Money | null {
  const data = record(value);
  return data && Number.isSafeInteger(data.amount_minor) && (data.amount_minor as number) >= 0 &&
    typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency)
    ? { amount_minor: data.amount_minor as number, currency: data.currency } : null;
}

export function parseItem(value: unknown): ItemObservation | null {
  const data = record(value);
  if (!data || typeof data.id !== 'string' || !data.id || typeof data.title !== 'string') return null;
  const images: ItemImage[] = [];
  const ids = new Set<string>();
  for (const entry of Array.isArray(data.images) ? data.images : []) {
    const image = record(entry), url = safeImageUrl(image?.url);
    if (!image || !url || typeof image.id !== 'string' || !image.id || ids.has(image.id) ||
      !Number.isSafeInteger(image.index) || (image.index as number) < 0) continue;
    ids.add(image.id);
    images.push({ id: image.id, index: image.index as number, url, ...(typeof image.role === 'string' ? { role: image.role } : {}) });
  }
  const measurements: ItemObservation['measurements'] = Object.create(null);
  for (const [key, entry] of Object.entries(record(data.measurements) ?? {})) {
    if (typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry))) measurements[key] = entry;
  }
  return {
    id: data.id, title: data.title, url: safeItemUrl(data.url) ?? '', market: string(data.market) ?? '',
    language: string(data.language) ?? 'de', brand: string(data.brand), price: money(data.price),
    original_price: money(data.original_price), size: string(data.size), size_system: string(data.size_system),
    condition: string(data.condition), categories: strings(data.categories), colors: strings(data.colors),
    materials: strings(data.materials), measurements, description: string(data.description), defects: strings(data.defects),
    images: images.sort((a, b) => a.index - b.index),
    availability: ['available', 'reserved', 'sold'].includes(String(data.availability)) ? data.availability as ItemObservation['availability'] : 'unknown',
    observed_at: string(data.observed_at) ?? '', source: data.source === 'detail' ? 'detail' : 'catalog', attributes: {},
  };
}

function parseAssessment(value: unknown, item: ItemObservation): VisualAssessment | null {
  const data = record(value);
  if (!data || data.item_id !== item.id || data.author !== 'assistant') return null;
  const checked = strings(data.checked_image_ids);
  if (!checked.length || checked.some(id => !item.images.some(image => image.id === id))) return null;
  const requirements: VisualAssessment['requirement_results'] = [];
  for (const entry of Array.isArray(data.requirement_results) ? data.requirement_results : []) {
    const result = record(entry);
    if (result && typeof result.requirement === 'string' && typeof result.evidence === 'string' &&
      ['confirmed', 'contradicted', 'unknown'].includes(String(result.verdict))) {
      requirements.push({ requirement: result.requirement, evidence: result.evidence,
        verdict: result.verdict as 'confirmed' | 'contradicted' | 'unknown' });
    }
  }
  return { item_id: item.id, checked_image_ids: checked, observed_type: string(data.observed_type),
    matching_features: strings(data.matching_features), mismatches: strings(data.mismatches),
    uncertainties: strings(data.uncertainties), requirement_results: requirements,
    assessed_at: string(data.assessed_at) ?? '', author: 'assistant' };
}

function parsePaths(value: unknown): RetrievalPath[] {
  const paths: RetrievalPath[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const path = record(entry);
    if (!path || typeof path.arm_id !== 'string' || !Number.isFinite(path.rank) ||
      !['catalog', 'semantic', 'similar', 'image', 'upload', 'outfit'].includes(String(path.route))) continue;
    paths.push({ arm_id: path.arm_id, route: path.route as RetrievalPath['route'], rank: path.rank as number,
      observed_at: string(path.observed_at) ?? '' });
  }
  return paths;
}

export function parseFeedback(value: unknown, itemId: string): ItemFeedback | null {
  const data = record(value);
  if (!data || data.item_id !== itemId || !['shortlist', 'reject', 'neutral'].includes(String(data.decision)) ||
    typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at))) return null;
  return { item_id: itemId, decision: data.decision as ItemFeedback['decision'], updated_at: data.updated_at,
    ...(typeof data.reason === 'string' ? { reason: data.reason } : {}) };
}

export function feedbackFromResult(value: unknown, runId: string, itemId: string): ItemFeedback | null {
  const result = record(value), data = record(result?.structuredContent);
  if (result?.isError || data?.run_id !== runId || data?.item_id !== itemId) return null;
  return parseFeedback(data.feedback, itemId);
}

/** Overlapping pages may have been captured before an acknowledged refresh or feedback write. */
export function mergeAppendedCard(current: GalleryCard | undefined, incoming: GalleryCard): GalleryCard {
  if (!current || current.item.id !== incoming.item.id) return incoming;
  const sameObservation = current.item.observed_at === incoming.item.observed_at && current.item.source === incoming.item.source;
  const enrichesProjection = sameObservation && Boolean(current.summary?.omitted_fields.length) && !incoming.summary?.omitted_fields.length;
  const item = preferObservation(current.item, incoming.item) || enrichesProjection ? incoming.item : current.item;
  const previousAssessment = assessmentStillApplies(current, item) ? current.assessment : null;
  const receivedAssessment = assessmentStillApplies(incoming, item) ? incoming.assessment : null;
  const assessment = receivedAssessment && (!previousAssessment
    || Date.parse(receivedAssessment.assessed_at) > Date.parse(previousAssessment.assessed_at)) ? receivedAssessment : previousAssessment;
  const feedback = incoming.feedback && (!current.feedback
    || Date.parse(incoming.feedback.updated_at) > Date.parse(current.feedback.updated_at)) ? incoming.feedback : current.feedback;
  const summary = item === incoming.item ? incoming.summary : current.summary;
  const { summary: _receivedSummary, ...received } = incoming;
  return { ...received, item, assessment, ...(summary ? { summary } : {}), ...(feedback ? { feedback } : {}) };
}

export function parseGallery(value: unknown): GalleryData | null {
  const data = record(value);
  if (!data || typeof data.run_id !== 'string' || !Array.isArray(data.cards)) return null;
  const cards: GalleryCard[] = [];
  const seen = new Set<string>();
  for (const entry of data.cards) {
    const card = parseCard(entry);
    if (!card || seen.has(card.item.id)) continue;
    seen.add(card.item.id);
    cards.push(card);
  }
  const collection = parseCollection(data.collection), page = parseCollectionPage(data.page), scope = parseScope(data.scope);
  if (data.version === 3 && (!collection || !page || cards.length > 24 || cards.length > page.size)) return null;
  return { run_id: data.run_id, cards, language: string(data.language) ?? 'de', title: string(data.title) ?? '',
    next_cursor: page?.next_cursor ?? string(data.next_cursor), warnings: strings(data.warnings),
    ...(data.version === 3 ? { version: 3 } : {}), ...(collection ? { collection } : {}), ...(page ? { page } : {}),
    ...(scope ? { scope } : {}), ...(typeof data.request_id === 'string' ? { request_id: data.request_id } : {}) };
}

export function parseCard(value: unknown): GalleryCard | null {
  const card = record(value), item = parseItem(card?.item);
  if (!card || !item) return null;
  const feedback = parseFeedback(card.feedback, item.id);
  const summary = record(card.summary);
  const validSummary = summary && count(summary.image_count) !== null && count(summary.checked_image_count) !== null
    && (summary.image_count as number) >= item.images.length && (summary.checked_image_count as number) <= (summary.image_count as number)
    && typeof summary.assessment_recorded === 'boolean';
  return { item, reason: string(card.reason) ?? '', cautions: strings(card.cautions),
    assessment: parseAssessment(card.assessment, item), paths: parsePaths(card.paths), ...(feedback ? { feedback } : {}),
    ...(validSummary ? { summary: { omitted_fields: strings(summary.omitted_fields), image_count: summary.image_count as number,
      assessment_recorded: summary.assessment_recorded as boolean, checked_image_count: summary.checked_image_count as number } } : {}) };
}

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}
function timestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}
const collectionKinds = ['observed', 'arm', 'selection', 'shortlist', 'refinement', 'derived'];
const collectionOrders = ['discovery', 'arm_discovery', 'selection', 'shortlist', 'refinement', 'price_asc', 'price_desc'];
const collectionViews = ['shortlist', 'available', 'assessed', 'unassessed', 'price_asc', 'price_desc', 'source_order'];

export function parseCollection(value: unknown): CollectionDescriptor | null {
  const data = record(value), source = record(data?.source), progress = record(data?.progress), evaluation = record(data?.evaluation);
  if (!data || typeof data.id !== 'string' || !data.id || !source || !collectionKinds.includes(String(source.kind))
    || !collectionOrders.includes(String(data.order)) || !['ready', 'preparing'].includes(String(data.status))
    || !timestamp(data.created_at) || !timestamp(data.membership_as_of) || (data.total !== null && count(data.total) === null)) return null;
  return { id: data.id, source: { kind: source.kind as CollectionDescriptor['source']['kind'],
    ...(typeof source.arm_id === 'string' ? { arm_id: source.arm_id } : {}),
    ...(typeof source.refinement_id === 'string' ? { refinement_id: source.refinement_id } : {}),
    ...(typeof source.base_collection_id === 'string' ? { base_collection_id: source.base_collection_id } : {}),
    ...(collectionViews.includes(String(source.view)) ? { view: source.view as NonNullable<CollectionDescriptor['source']['view']> } : {}) },
    created_at: data.created_at as string, membership_as_of: data.membership_as_of as string,
    order: data.order as CollectionDescriptor['order'], total: count(data.total), status: data.status as CollectionDescriptor['status'],
    ...(progress && count(progress.scanned) !== null && count(progress.cohort) !== null
      ? { progress: { scanned: progress.scanned as number, cohort: progress.cohort as number } } : {}),
    ...(evaluation && timestamp(evaluation.started_at) ? { evaluation: { started_at: evaluation.started_at as string,
      completed_at: timestamp(evaluation.completed_at), observations_from: timestamp(evaluation.observations_from), observations_to: timestamp(evaluation.observations_to) } } : {}) };
}

export function parseCollectionPage(value: unknown): CollectionPageInfo | null {
  const data = record(value);
  if (!data || count(data.size) === null || (data.size as number) < 1 || (data.size as number) > 24
    || count(data.start) === null || count(data.end) === null || (data.end as number) < (data.start as number)
    || ['cursor', 'previous_cursor', 'next_cursor'].some(key => data[key] !== null && typeof data[key] !== 'string')) return null;
  return { size: data.size as number, start: data.start as number, end: data.end as number,
    cursor: string(data.cursor), previous_cursor: string(data.previous_cursor), next_cursor: string(data.next_cursor) };
}

function parseFilters(value: unknown): SearchFilters {
  const data = record(value);
  if (!data) return {};
  const facets: Record<string, string[]> = Object.create(null), measurements: NonNullable<SearchFilters['measurements']> = Object.create(null);
  for (const [key, values] of Object.entries(record(data.facets) ?? {})) facets[key] = strings(values);
  for (const [key, value] of Object.entries(record(data.measurements) ?? {})) {
    const range = record(value);
    if (range) measurements[key] = { ...(typeof range.min === 'number' && Number.isFinite(range.min) ? { min: range.min } : {}),
      ...(typeof range.max === 'number' && Number.isFinite(range.max) ? { max: range.max } : {}) };
  }
  return { ...(Object.keys(facets).length ? { facets } : {}), ...(Object.keys(measurements).length ? { measurements } : {}),
    ...(typeof data.price_min === 'number' && Number.isFinite(data.price_min) ? { price_min: data.price_min } : {}),
    ...(typeof data.price_max === 'number' && Number.isFinite(data.price_max) ? { price_max: data.price_max } : {}),
    ...(typeof data.include_reserved === 'boolean' ? { include_reserved: data.include_reserved } : {}) };
}

export function parseScope(value: unknown): CollectionScope | null {
  const data = record(value);
  if (!data || !timestamp(data.observed_at) || count(data.candidates) === null || count(data.search_pages) === null
    || count(data.model_delivered_photos) === null || count(data.recorded_assessments) === null) return null;
  const arms: CollectionScope['arms'] = [];
  for (const value of Array.isArray(data.arms) ? data.arms : []) {
    const arm = record(value);
    if (!arm || typeof arm.arm_id !== 'string' || typeof arm.route !== 'string' || count(arm.pages) === null || typeof arm.status !== 'string') continue;
    arms.push({ arm_id: arm.arm_id, route: arm.route, query: string(arm.query), filters: parseFilters(arm.filters),
      category_relaxed: arm.category_relaxed === true, pages: arm.pages as number, candidates: count(arm.candidates),
      native_total: count(arm.native_total), native_window: count(arm.native_window), status: arm.status, observed_at: timestamp(arm.observed_at) });
  }
  return { observed_at: data.observed_at as string, candidates: data.candidates as number, search_pages: data.search_pages as number,
    detail_observations: count(data.detail_observations), stored_descriptions: count(data.stored_descriptions),
    model_delivered_photos: data.model_delivered_photos as number, model_delivered_fact_items: count(data.model_delivered_fact_items),
    model_delivered_description_items: count(data.model_delivered_description_items), widget_delivered_photos: count(data.widget_delivered_photos),
    recorded_assessments: data.recorded_assessments as number, collection_members: count(data.collection_members), arms, notes: strings(data.notes) };
}

export function detailFromResult(value: unknown): CollectionDetail | null {
  const result = record(value), meta = record(result?._meta), detail = record(meta?.collection_detail), card = parseCard(detail?.card);
  if (result?.isError || !detail || !card || typeof detail.run_id !== 'string' || typeof detail.collection_id !== 'string') return null;
  return { run_id: detail.run_id, collection_id: detail.collection_id, card,
    ...(typeof detail.request_id === 'string' ? { request_id: detail.request_id } : {}) };
}

/** Bounded LRU by both entry count and estimated resident bytes. */
export class BoundedCache<K, V> {
  private entries = new Map<K, { value: V; bytes: number }>();
  private totalBytes = 0;
  constructor(readonly maxEntries: number, readonly maxBytes: number, private sizeOf: (value: V) => number) {}
  get size(): number { return this.entries.size; }
  get bytes(): number { return this.totalBytes; }
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  peek(key: K): V | undefined { return this.entries.get(key)?.value; }
  has(key: K): boolean { return this.entries.has(key); }
  set(key: K, value: V): boolean {
    const bytes = Math.max(0, this.sizeOf(value));
    this.delete(key);
    if (!Number.isFinite(bytes) || bytes > this.maxBytes || this.maxEntries < 1) return false;
    this.entries.set(key, { value, bytes }); this.totalBytes += bytes;
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) this.delete(this.entries.keys().next().value!);
    return true;
  }
  delete(key: K): void { const entry = this.entries.get(key); if (entry) { this.totalBytes -= entry.bytes; this.entries.delete(key); } }
  clear(): void { this.entries.clear(); this.totalBytes = 0; }
  keys(): IterableIterator<K> { return this.entries.keys(); }
  *values(): IterableIterator<V> { for (const entry of this.entries.values()) yield entry.value; }
}

export function galleryFromResult(value: unknown): GalleryData | null {
  const result = record(value), meta = record(result?._meta), structured = record(result?.structuredContent);
  return parseGallery(meta?.gallery ?? structured?.gallery);
}

export function hydrationFromResult(value: unknown, cards: GalleryCard[]): Map<string, string> {
  const result = record(value), meta = record(result?._meta), source = record(meta?.images);
  const known = new Map<string, Set<string>>();
  for (const card of cards) for (const image of card.item.images) {
    const urls = known.get(image.id) ?? new Set<string>();
    urls.add(image.url);
    known.set(image.id, urls);
  }
  const images = new Map<string, string>();
  for (const [id, entry] of Object.entries(source ?? {})) {
    const data = safeImageData(entry);
    if (data && known.get(id)?.size === 1) images.set(id, data);
  }
  return images;
}

export function errorMessage(value: unknown, fallback: string): string {
  const data = record(value), error = record(data?.error);
  return typeof error?.message === 'string' ? error.message : typeof data?.message === 'string' ? data.message : fallback;
}

export function retryTime(value: unknown): number | null {
  const data = record(value), error = record(data?.error);
  const date = error?.retry_at ?? data?.retry_at;
  if (typeof date !== 'string') return null;
  const valueMs = Date.parse(date);
  return Number.isFinite(valueMs) ? valueMs : null;
}
