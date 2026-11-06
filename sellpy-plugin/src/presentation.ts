import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Candidate, GalleryCard, GalleryData, SelectionEntry } from './domain.js';
import { ToolError } from './domain.js';
import { formatMoney, safeImageData, safeImageUrl, safeItemUrl } from '../ui/data.js';

export { PRESENTATION_HTML } from '../ui/generated/gallery.js';
export const PRESENTATION_URI = 'ui://sellpy/gallery-v1.html';
export const PRESENTATION_MIME = 'text/html;profile=mcp-app';
export const PRESENTATION_RESOURCE_META = {
  ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: ['https://prod.images.sellpy.net', 'https://images.sellpy.net',
    'https://sellpy-parse-prod-files.s3.amazonaws.com', 'https://sellpy-parse-prod-files.s3.eu-west-1.amazonaws.com'] } },
  'openai/widgetDescription': 'Selected Sellpy items with original photographs, prices, size, condition, reasons, uncertainties and an on-demand gallery.',
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
    cards.push({ item: { ...item, images }, reason: selected.reason, cautions: [...(selected.cautions ?? [])],
      assessment, paths: candidate.paths });
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
  const cards = gallery.cards.map(({ item, reason, cautions, assessment }) => ({
    item_id: item.id, title: item.title, url: item.url, market: item.market,
    price: item.price, price_display: formatMoney(item.price, gallery.language), size: item.size,
    condition: item.condition, availability: item.availability, observed_at: item.observed_at,
    image: item.images[0] ? { ...item.images[0], status: hydration[item.images[0].id] ? 'ready' : 'reference' } : null,
    image_count: item.images.length, reason, cautions, visually_assessed: assessment !== null,
    checked_image_ids: assessment?.checked_image_ids ?? [],
  }));
  const structuredContent = { run_id: gallery.run_id, title: gallery.title, cards,
    next_cursor: gallery.next_cursor, warnings: gallery.warnings };
  return {
    content: [{ type: 'text', text: `${cards.length} selected Sellpy items are ready in the gallery. ` +
      'Each structured card contains its exact original photo and listing URL. If the gallery cannot be displayed, render every recommended card with its own image using ![item title](card.image.url), then its price, size, condition, reason and listing link. ' +
      'Never substitute another item’s photograph or claim image inspection from gallery display. ' +
      (gallery.next_cursor ? 'More selected items are available with the presentation next_cursor.' : 'This presentation selection is complete.') }],
    structuredContent,
    _meta: { gallery, images: hydration },
  };
}
