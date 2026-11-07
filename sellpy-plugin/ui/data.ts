import type { GalleryCard, GalleryData, ItemFeedback, ItemImage, ItemObservation, Money, RetrievalPath, VisualAssessment } from '../src/domain.js';
import { assessmentStillApplies, preferObservation } from '../src/ranking.js';

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

export function formatMoney(value: Money | null, language = 'de'): string {
  if (!value) return language.startsWith('de') ? 'Preis offen' : 'Price unknown';
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency: value.currency }).format(value.amount_minor / 100);
  } catch { return `${(value.amount_minor / 100).toFixed(2)} ${value.currency}`; }
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
  const item = preferObservation(current.item, incoming.item) ? incoming.item : current.item;
  const previousAssessment = assessmentStillApplies(current, item) ? current.assessment : null;
  const receivedAssessment = assessmentStillApplies(incoming, item) ? incoming.assessment : null;
  const assessment = receivedAssessment && (!previousAssessment
    || Date.parse(receivedAssessment.assessed_at) > Date.parse(previousAssessment.assessed_at)) ? receivedAssessment : previousAssessment;
  const feedback = incoming.feedback && (!current.feedback
    || Date.parse(incoming.feedback.updated_at) > Date.parse(current.feedback.updated_at)) ? incoming.feedback : current.feedback;
  return { ...incoming, item, assessment, ...(feedback ? { feedback } : {}) };
}

export function parseGallery(value: unknown): GalleryData | null {
  const data = record(value);
  if (!data || typeof data.run_id !== 'string' || !Array.isArray(data.cards)) return null;
  const cards: GalleryCard[] = [];
  const seen = new Set<string>();
  for (const entry of data.cards) {
    const card = record(entry), item = parseItem(card?.item);
    if (!card || !item || seen.has(item.id)) continue;
    seen.add(item.id);
    const feedback = parseFeedback(card.feedback, item.id);
    cards.push({ item, reason: string(card.reason) ?? '', cautions: strings(card.cautions),
      assessment: parseAssessment(card.assessment, item), paths: parsePaths(card.paths), ...(feedback ? { feedback } : {}) });
  }
  return { run_id: data.run_id, cards, language: string(data.language) ?? 'de', title: string(data.title) ?? '',
    next_cursor: string(data.next_cursor), warnings: strings(data.warnings) };
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
