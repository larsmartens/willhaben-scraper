import { ToolError, type ItemImage, type ItemObservation, type Money, type SearchFilters } from '../domain.js';
import { record } from './http.js';

// Sellpy's public sellpy-commons REGION, CURRENCY and market-domain maps, verified 2026-11-06.
export const MARKETS: Record<string, { currency: string; origin: string; locales: string[] }> = {
  AT: { currency: 'EUR', origin: 'https://www.sellpy.at', locales: ['de', 'en'] },
  BE: { currency: 'EUR', origin: 'https://www.sellpy.be', locales: ['nl', 'fr', 'en'] },
  CZ: { currency: 'CZK', origin: 'https://www.sellpy.cz', locales: ['cs', 'en'] },
  DE: { currency: 'EUR', origin: 'https://www.sellpy.de', locales: ['de', 'en'] },
  DK: { currency: 'DKK', origin: 'https://www.sellpy.dk', locales: ['da', 'en'] },
  EU: { currency: 'EUR', origin: 'https://www.sellpy.com', locales: ['en'] },
  FI: { currency: 'EUR', origin: 'https://www.sellpy.fi', locales: ['fi', 'en'] },
  FR: { currency: 'EUR', origin: 'https://www.sellpy.fr', locales: ['fr', 'en'] },
  NL: { currency: 'EUR', origin: 'https://www.sellpy.nl', locales: ['nl', 'en'] },
  PL: { currency: 'PLN', origin: 'https://www.sellpy.pl', locales: ['pl', 'en'] },
  RO: { currency: 'RON', origin: 'https://www.sellpy.ro', locales: ['ro', 'en'] },
  SE: { currency: 'SEK', origin: 'https://www.sellpy.se', locales: ['sv', 'en'] },
};

export const IMAGE_HOSTS = new Set([
  'prod.images.sellpy.net', 'sellpy-parse-prod-files.s3.amazonaws.com',
  'sellpy-parse-prod-files.s3.eu-west-1.amazonaws.com',
]);

export const FACET_FIELDS = new Set([
  'sizes', 'style', 'segment', 'saleType', 'materials', 'brandGroups',
  'metadata.size', 'metadata.type', 'metadata.brand', 'metadata.color', 'metadata.fabric',
  'metadata.season', 'metadata.pattern', 'metadata.material', 'metadata.neckline',
  'metadata.condition', 'metadata.waistRise', 'metadata.demography', 'metadata.pantsLength',
  'metadata.defects.type', 'metadata.sleeveLength', 'metadata.garmentLength', 'searchableExternalCategory',
  'categories.lvl0', 'categories.lvl1', 'categories.lvl2', 'categories.lvl3',
]);

export const MEASUREMENT_FIELDS = new Set([
  'waistInCm', 'widthInCm', 'heightInCm', 'lengthInCm', 'innerLegLengthInCm', 'heelHeightInCm',
]);

export function validateLocale(market: string, language: string): void {
  const definition = MARKETS[market];
  if (!definition) throw new ToolError('unsupported_market', `The Sellpy market ${market} is not in the verified public market registry.`, {
    next_action: `Choose one of ${Object.keys(MARKETS).join(', ')}. EU is Sellpy's general European market.`,
  });
  if (!definition.locales.includes(language)) throw new ToolError('unsupported_market_language', `Sellpy's ${language} search index is not verified for the ${market} market.`, {
    next_action: `Use ${definition.locales.join(' or ')} for this market; English supports all verified markets.`,
  });
}

export function strings(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && !!entry);
}

export function string(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }

export function validateId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new ToolError('invalid_item_id', 'A Sellpy item ID has an unsupported format.');
  return id;
}

export function publicImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !IMAGE_HOSTS.has(url.hostname)) return null;
    return value;
  } catch { return null; }
}

// URL identity is independent of ordering. A changed URL receives a different ID.
export function imageIdentity(url: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(url)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return `image_${hash.toString(16).padStart(16, '0')}`;
}

function gallery(catalog: Record<string, unknown>, detail?: Record<string, unknown>): ItemImage[] {
  const photos = Array.isArray(detail?.photos) ? detail.photos.map((photo) => {
    const raw = record(photo);
    return record(raw.value ?? raw);
  }) : [];
  const roles = new Map(photos.flatMap((photo) => {
    const url = publicImageUrl(photo.url);
    const role = string(photo.type);
    return url && role ? [[new URL(url).pathname, role] as const] : [];
  }));
  const candidates: unknown[] = [
    ...(Array.isArray(catalog.images) ? catalog.images : []),
    ...(Array.isArray(detail?.images) ? detail.images.map((image) => record(image).value ?? image) : []),
    ...photos.map((photo) => photo.url),
  ];
  const seen = new Set<string>();
  const images: ItemImage[] = [];
  for (const candidate of candidates) {
    const url = publicImageUrl(candidate);
    if (!url) continue;
    // Both observed first-party hosts serve the same object path. Prefer the actual
    // catalog URL when it exists; retain unseen detail URLs literally, without rewriting hosts.
    const path = new URL(url).pathname;
    if (seen.has(path)) continue;
    seen.add(path);
    const role = roles.get(path);
    images.push({ id: imageIdentity(url), index: images.length, url, ...(role ? { role } : {}) });
  }
  return images;
}

export function moneyForMarket(raw: Record<string, unknown>, market: string): Money | null {
  const price = record(raw[`price_${market}`]);
  return typeof price.amount === 'number' && Number.isSafeInteger(price.amount) && price.amount > 0
    && price.currency === MARKETS[market]?.currency ? { amount_minor: price.amount, currency: price.currency as string } : null;
}

function defectDescriptions(value: unknown): string[] {
  if (!Array.isArray(value)) return strings(value);
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    const item = record(entry);
    const parts = [string(item.type), string(item.description), string(item.location)].filter((part): part is string => !!part);
    return parts.length ? [parts.join(': ')] : [];
  });
}

export function normalizeItem(raw: unknown, market: string, language: string, observedAt: string, detailRaw?: unknown): ItemObservation | null {
  const catalog = record(raw);
  const detail = detailRaw ? record(detailRaw) : undefined;
  const id = string(detail?.objectId) ?? string(catalog.objectID);
  if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
  const metadata = { ...record(catalog.metadata), ...record(detail?.localizedMetadata) };
  const english = record(detail?.metadata_en);
  const brand = string(metadata.brand);
  const itemType = string(metadata.type);
  const size = string(metadata.size);
  const price = moneyForMarket(catalog, market);
  const attributes: ItemObservation['attributes'] = {};
  for (const key of [
    'type', 'demography', 'season', 'fabric', 'pattern', 'neckline', 'waistRise', 'pantsLength',
    'sleeveLength', 'garmentLength', 'countryOfOrigin', 'productCode', 'sizeEstimated', 'materialRatios',
  ]) {
    const value = metadata[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') attributes[key] = value;
    else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) attributes[key] = value as string[];
  }
  for (const key of ['sizes', 'style', 'materials', 'keywords', 'brandGroups', 'segment', 'saleType']) {
    const value = catalog[key];
    if (typeof value === 'string' || typeof value === 'boolean') attributes[key] = value;
    else if (Array.isArray(value)) attributes[key] = strings(value);
  }
  if (typeof catalog.p2p === 'boolean') attributes.p2p = catalog.p2p;
  if (typeof catalog.saleStartedAt === 'number') attributes.sale_started_at = catalog.saleStartedAt;
  if (typeof catalog[`firstOfferedAt_${market}`] === 'number') attributes.first_offered_at = catalog[`firstOfferedAt_${market}`] as number;
  if (typeof detail?.itemStatus === 'string') attributes.source_item_status = detail.itemStatus;
  if (typeof detail?.createdAt === 'string') attributes.source_created_at = detail.createdAt;
  if (string(english.type)) attributes.type_en = string(english.type);
  if (!price) attributes.market_price_available = false;
  const measurements: ItemObservation['measurements'] = {};
  for (const [key, value] of Object.entries(record(metadata.measurement))) {
    if (MEASUREMENT_FIELDS.has(key) && (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))) measurements[key] = value;
  }
  const categories = record(catalog.categories);
  const categoryPaths = ['lvl0', 'lvl1', 'lvl2', 'lvl3'].flatMap((key) => strings(categories[key]));
  return {
    id, market, language, url: `${MARKETS[market]?.origin ?? 'https://www.sellpy.com'}/item/${encodeURIComponent(id)}`,
    title: [brand, itemType, size].filter(Boolean).join(' · ') || `Sellpy ${id}`,
    brand, price, original_price: null, size, size_system: size && size.split('-').length >= 3 ? size.split('-').at(-2) ?? null : null,
    condition: string(metadata.condition), categories: [...new Set(categoryPaths)], colors: strings(metadata.color),
    materials: strings(metadata.material), measurements, description: string(metadata.description),
    defects: defectDescriptions(metadata.defects), images: gallery(catalog, detail),
    availability: catalog.isReserved === true ? 'reserved' : catalog.isForSale === false ? 'sold' : price ? 'available' : 'unknown',
    observed_at: observedAt, source: detail ? 'detail' : 'catalog', attributes,
  };
}

export function effectiveFilters(input: SearchFilters | undefined, categoryRelaxed = false): SearchFilters {
  const filters: SearchFilters = structuredClone(input ?? {});
  for (const key of ['price_min', 'price_max'] as const) {
    const value = filters[key];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new ToolError('invalid_filter', `${key} must be a nonnegative finite amount in the market currency.`);
  }
  if (filters.price_min !== undefined && filters.price_max !== undefined && filters.price_min > filters.price_max) throw new ToolError('invalid_filter', 'The minimum price exceeds the maximum price.');
  const facets: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(filters.facets ?? {})) {
    if (!FACET_FIELDS.has(key)) throw new ToolError('unsupported_filter', `The facet ${key} is not a supported shopper filter.`, {
      next_action: 'Discover available facets for the chosen market and use their exact field names and values.',
    });
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value || value.length > 1000)) throw new ToolError('invalid_filter', `The facet ${key} must contain nonempty strings.`);
    if (categoryRelaxed && (key === 'metadata.type' || key.startsWith('categories.') || key === 'searchableExternalCategory')) continue;
    if (values.length) facets[key] = [...new Set(values)];
  }
  if (Object.keys(facets).length) filters.facets = facets; else delete filters.facets;
  for (const [key, range] of Object.entries(filters.measurements ?? {})) {
    if (!MEASUREMENT_FIELDS.has(key)) throw new ToolError('unsupported_filter', `The measurement ${key} is not in the verified native measurement schema.`);
    for (const value of [range.min, range.max]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new ToolError('invalid_filter', 'Measurements must be nonnegative finite centimeters.');
    if (range.min !== undefined && range.max !== undefined && range.min > range.max) throw new ToolError('invalid_filter', 'A minimum measurement exceeds its maximum.');
  }
  return filters;
}

function fieldValues(raw: Record<string, unknown>, path: string): string[] {
  let values: unknown[] = [raw];
  for (const part of path.split('.')) values = values.flatMap((value) => {
    const next = record(value)[part];
    return Array.isArray(next) ? next : next === undefined ? [] : [next];
  });
  return values.filter((value): value is string => typeof value === 'string');
}

export function matchesFilters(raw: Record<string, unknown>, filters: SearchFilters, market: string): boolean {
  const price = moneyForMarket(raw, market);
  if (!price || (filters.include_reserved === false && raw.isReserved !== false)) return false;
  if (filters.price_min !== undefined && price.amount_minor < Math.round(filters.price_min * 100)) return false;
  if (filters.price_max !== undefined && price.amount_minor > Math.round(filters.price_max * 100)) return false;
  for (const [key, desired] of Object.entries(filters.facets ?? {})) {
    const actual = fieldValues(raw, key);
    const positive = desired.filter((value) => !value.startsWith('-'));
    const negative = desired.filter((value) => value.startsWith('-')).map((value) => value.slice(1));
    if (positive.length && !positive.some((value) => actual.includes(value))) return false;
    if (negative.some((value) => actual.includes(value))) return false;
  }
  const measurements = record(record(raw.metadata).measurement);
  for (const [key, range] of Object.entries(filters.measurements ?? {})) {
    const value = measurements[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || (range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max)) return false;
  }
  return true;
}

export function algoliaFilterParams(filters: SearchFilters, market: string): Record<string, unknown> {
  const field = `price_${market}.amount`;
  const numericFilters: string[] = [];
  if (filters.price_min !== undefined) numericFilters.push(`${field}>=${Math.round(filters.price_min * 100)}`);
  if (filters.price_max !== undefined) numericFilters.push(`${field}<=${Math.round(filters.price_max * 100)}`);
  for (const [key, range] of Object.entries(filters.measurements ?? {})) {
    if (range.min !== undefined) numericFilters.push(`metadata.measurement.${key}>=${range.min}`);
    if (range.max !== undefined) numericFilters.push(`metadata.measurement.${key}<=${range.max}`);
  }
  const facetFilters: (string | string[])[] = [];
  for (const [key, values] of Object.entries(filters.facets ?? {})) {
    const positive = values.filter((value) => !value.startsWith('-')).map((value) => `${key}:${value}`);
    const negative = values.filter((value) => value.startsWith('-')).map((value) => `${key}:${value}`);
    if (positive.length) facetFilters.push(positive);
    facetFilters.push(...negative);
  }
  return {
    filters: `${field} > 0${filters.include_reserved === false ? ' AND isReserved:false' : ''}`,
    ...(numericFilters.length ? { numericFilters } : {}), ...(facetFilters.length ? { facetFilters } : {}),
  };
}

export function nativeFilters(filters: SearchFilters, market: string, language: string): { filters: Record<string, unknown>; post_filtered: string[] } {
  const result: Record<string, unknown> = {};
  const post_filtered: string[] = [];
  if (filters.price_min !== undefined || filters.price_max !== undefined) {
    result[`price.${MARKETS[market]?.currency}`] = [filters.price_min ?? 0, filters.price_max ?? Number.MAX_SAFE_INTEGER];
  }
  const native = new Set(['metadata.size', 'metadata.brand', 'metadata.type', 'metadata.demography', 'metadata.color', 'metadata.condition', 'metadata.material']);
  for (const [key, values] of Object.entries(filters.facets ?? {})) {
    const localeIndependent = key === 'metadata.size' || key === 'metadata.brand';
    if (native.has(key) && (language === 'en' || localeIndependent) && values.every((value) => !value.startsWith('-'))) result[key] = values;
    else post_filtered.push(key);
  }
  for (const key of Object.keys(filters.measurements ?? {})) post_filtered.push(`metadata.measurement.${key}`);
  if (filters.include_reserved === false) post_filtered.push('isReserved');
  return { filters: result, post_filtered };
}
