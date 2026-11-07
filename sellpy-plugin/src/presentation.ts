import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Candidate, GalleryCard, GalleryData, ItemFeedback, SelectionEntry } from './domain.js';
import { ToolError } from './domain.js';
import { projectCardFacts } from './card-facts.js';
import { formatMoney, parseFeedback, safeImageData, safeImageUrl, safeItemUrl } from '../ui/data.js';

export { PRESENTATION_HTML } from '../ui/generated/gallery.js';
export const PRESENTATION_URI = 'ui://sellpy/gallery-v3.html';
export const LEGACY_PRESENTATION_URI = 'ui://sellpy/gallery-v2.html';
export const PRESENTATION_MIME = 'text/html;profile=mcp-app';
export const PRESENTATION_RESOURCE_META = {
  ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: ['https://prod.images.sellpy.net', 'https://images.sellpy.net',
    'https://sellpy-parse-prod-files.s3.amazonaws.com', 'https://sellpy-parse-prod-files.s3.eu-west-1.amazonaws.com'] } },
  'openai/widgetDescription': 'Selected Sellpy items with original photographs, persistent shortlist and feedback, side-by-side comparison, source facts and separate visual evidence.',
  'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'] },
};

export interface GalleryInput {
  run_id: string;
  language: string;
  title: string;
  candidates: Candidate[];
  selection: SelectionEntry[];
  next_cursor?: string | null;
  warnings?: string[];
  feedback?: Record<string, ItemFeedback>;
}

export function buildGallery(input: GalleryInput): GalleryData {
  const byId = new Map(input.candidates.map(candidate => [candidate.item.id, candidate]));
  const cards: GalleryCard[] = [], warnings = [...(input.warnings ?? [])];
  const seen = new Set<string>();
  for (const selected of input.selection) {
    if (seen.has(selected.item_id)) continue;
    seen.add(selected.item_id);
    const candidate = byId.get(selected.item_id);
    if (!candidate) {
      warnings.push(`No observed item is available for ${selected.item_id}. Fetch its details before recommending it.`);
      continue;
    }
    const item = candidate.item;
    if (!safeItemUrl(item.url)) throw new ToolError('unsafe_item_url', `The original URL for ${item.id} is invalid.`);
    const images = item.images.filter(image => safeImageUrl(image.url));
    if (images.length !== item.images.length) warnings.push(`Some image references for ${item.id} are unavailable.`);
    const assessment = candidate.assessment?.item_id === item.id && candidate.assessment.author === 'assistant' && candidate.assessment.checked_image_ids.length &&
      candidate.assessment.checked_image_ids.every(id => images.some(image => image.id === id))
      ? candidate.assessment : null;
    const feedback = parseFeedback(input.feedback?.[item.id], item.id);
    cards.push({ item: { ...item, images }, reason: selected.reason, cautions: [...(selected.cautions ?? [])],
      assessment, paths: candidate.paths, ...(candidate.presentation_summary ? { summary: candidate.presentation_summary } : {}), ...(feedback ? { feedback } : {}) });
  }
  return { run_id: input.run_id, language: input.language, title: input.title, cards,
    next_cursor: input.next_cursor ?? null, warnings };
}

export function galleryResult(gallery: GalleryData, images: Record<string, string> = {}): CallToolResult {
  const imageUrls = new Map<string, Set<string>>();
  for (const card of gallery.cards) for (const image of card.item.images) {
    const urls = imageUrls.get(image.id) ?? new Set<string>();
    urls.add(image.url);
    imageUrls.set(image.id, urls);
  }
  const hydration: Record<string, string> = {};
  for (const [id, source] of Object.entries(images)) {
    if (imageUrls.get(id)?.size === 1 && safeImageData(source)) hydration[id] = source;
  }
  const cards = gallery.cards.map(({ item, reason, cautions, assessment, feedback, summary }) => ({
    item_id: item.id, title: item.title, url: item.url, market: item.market,
    price: item.price, price_display: formatMoney(item.price, gallery.language), size: item.size,
    condition: item.condition, availability: item.availability, observed_at: item.observed_at,
    image: item.images[0] ? { ...item.images[0], status: hydration[item.images[0].id] ? 'ready' : 'reference' } : null,
    image_count: summary?.image_count ?? item.images.length, reason, cautions, visually_assessed: summary?.assessment_recorded ?? assessment !== null,
    checked_image_ids: assessment?.checked_image_ids ?? [],
    ...(summary ? { summary } : {}),
    ...(feedback ? { feedback } : {}),
  }));
  const unassessed_item_ids = cards.filter(card => !card.visually_assessed).map(card => card.item_id);
  const visual_review = { unassessed_item_ids, next_action: unassessed_item_ids.length
    ? 'Catalog and price selections are ready to use. Before finalizing a recommendation based on visual fit for these unassessed items, inspect their original photos using get_item_images(for_model:true) as needed, save actual findings with record_visual_assessment, then run a fresh refine_search or present_items.'
    : null };
  const structuredContent = { run_id: gallery.run_id, title: gallery.title, cards: gallery.version === 3 ? cards.map((card, index) => {
    const projection = projectCardFacts(gallery.cards[index]!, gallery.language);
    return { ...card, evidence: projection.evidence.slice(0, 2).map(value => ({ requirement: value.requirement, verdict: value.verdict, evidence: value.evidence })),
      evidence_more: Math.max(0, projection.evidence.length - 2) };
  }) : cards,
    next_cursor: gallery.next_cursor, warnings: gallery.warnings, visual_review,
    ...(gallery.version ? { version: gallery.version } : {}), ...(gallery.collection ? { collection: gallery.collection, page: gallery.page, scope: gallery.scope } : {}),
    ...(gallery.request_id ? { request_id: gallery.request_id } : {}) };
  return {
    content: [{ type: 'text', text: gallery.collection?.status === 'preparing'
      ? 'Preparing a stable collection. Continue in the gallery.'
      : `${cards.length} Sellpy items${gallery.collection?.total !== undefined && gallery.collection.total !== null ? ` of ${gallery.collection.total}` : ''}. ` +
        (gallery.next_cursor ? 'More results are available in the gallery.' : 'This collection page is complete.') }],
    structuredContent,
    _meta: { gallery, images: hydration },
  };
}
