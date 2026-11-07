import {
  ToolError, type DetailBatch, type FacetResult, type ProviderCapabilities, type ProviderPage,
  type ProviderPageRequest, type ReferenceImage, type RequestContext, type SearchFilters, type SellpyProvider,
} from '../domain.js';
import { createConfigLoader, VERIFIED_AT, VERIFIED_RELEASE, type LocaleConfig, type NativeRoute, type PublicConfig } from './config.js';
import { boundedBytes, checkDeadline, contractError, record, request, requestJson } from './http.js';
import { withCachedObservation } from '../provider-cache.js';
import {
  algoliaFilterParams, effectiveFilters, FACET_FIELDS, MARKETS, matchesFilters, MEASUREMENT_FIELDS,
  nativeFilters, normalizeItem, publicImageUrl, string, validateId, validateLocale,
} from './normalize.js';

const REQUEST_SOURCE = 'sellpy-chatgpt-plugin';
const DETAIL_FIELDS = 'objectId createdAt itemStatus paidAt metadata_en localizedMetadata(locale: $locale) images { ... on Element { value } } photos { ... on Element { value } }';
const CATALOG_ATTRIBUTES = [
  'objectID', 'metadata', 'images', 'isReserved', 'isForSale', 'p2p', 'categories', 'sizes', 'materials',
  'keywords', 'style', 'brandGroups', 'segment', 'saleType', 'saleStartedAt', 'searchableExternalCategory',
];
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const OUTFIT_WINDOW_PER_PART = 20;
const REQUEST_OBJECT_CACHE_SIZE = 2000;

export interface SimilarBrandsInput {
  brands: string[];
  limit: number;
  market: string;
  language: string;
}

export interface SimilarBrand {
  brand: string;
  brand_object_id: string | null;
  native_score: number | null;
}

export interface SimilarBrandsResult {
  market: string;
  language: string;
  seed_brands: string[];
  brands: SimilarBrand[];
  requested_limit: number;
  inventory_checked: false;
  source_url: string;
  source_version: string | null;
  observed_at: string;
  warnings: string[];
}

export type NativeSellpyProvider = SellpyProvider & {
  similarBrands(input: SimilarBrandsInput, context: RequestContext): Promise<SimilarBrandsResult>;
};

interface CatalogObject {
  value: Record<string, unknown>;
  observed_at: string;
}

type ObjectMemo = Map<string, CatalogObject | null>;

function catalogAttributes(market: string): string[] {
  return [...CATALOG_ATTRIBUTES, `price_${market}`, `firstOfferedAt_${market}`];
}

function objectCacheKey(id: string, locale: LocaleConfig, market: string): string {
  return `${locale.application_id}:${locale.indices.newest}:${market}:${id}`;
}

function memoizeObject(memo: ObjectMemo | undefined, key: string, item: CatalogObject | null): void {
  if (!memo) return;
  memo.delete(key);
  memo.set(key, item);
  // This bounds temporary memory, not the number of reachable search results.
  while (memo.size > REQUEST_OBJECT_CACHE_SIZE) memo.delete(memo.keys().next().value!);
}

function localeConfig(config: PublicConfig, market: string, language: string): LocaleConfig {
  validateLocale(market, language);
  const locale = config.locales[language];
  if (!locale) throw new ToolError('unsupported_language', 'The requested language is no longer present in Sellpy’s public configuration.');
  return locale;
}

async function algolia(path: string, body: unknown, locale: LocaleConfig, context: RequestContext): Promise<Record<string, unknown>> {
  return record(await requestJson(`https://${locale.application_id.toLowerCase()}-dsn.algolia.net/1/indexes/*/${path}`, {
    method: 'POST', headers: {
      'content-type': 'application/json', 'x-algolia-application-id': locale.application_id,
      'x-algolia-api-key': locale.search_key,
    }, body: JSON.stringify(body),
  }, context));
}

async function objects(ids: string[], locale: LocaleConfig, market: string, context: RequestContext, memo?: ObjectMemo): Promise<Map<string, CatalogObject>> {
  checkDeadline(context);
  const output = new Map<string, CatalogObject>();
  const unique = [...new Set(ids.map(validateId))];
  const pending = unique.filter(id => {
    const key = objectCacheKey(id, locale, market);
    if (!memo?.has(key)) return true;
    const cached = memo.get(key);
    if (cached) output.set(id, cached);
    return false;
  });
  // Sellpy's own getObjects adapter uses batches of at most 1,000 objects.
  for (let start = 0; start < pending.length; start += 1000) {
    const batch = pending.slice(start, start + 1000);
    const response = await algolia('objects', { requests: batch.map((objectID) => ({ indexName: locale.indices.newest, objectID,
      attributesToRetrieve: catalogAttributes(market) })) }, locale, context);
    if (!Array.isArray(response.results) || response.results.length !== batch.length) throw contractError('Sellpy’s item lookup response no longer matches its requested objects.');
    const observed_at = new Date().toISOString();
    const records = response.results.map((result, index) => {
      if (result === null) return null;
      const value = record(result);
      if (string(value.objectID) !== batch[index]) throw contractError('Sellpy’s item lookup returned an unexpected item identifier.');
      return { value, observed_at };
    });
    // Validate the whole batch before retaining any part of a changed contract.
    for (const [index, id] of batch.entries()) {
      const item = records[index] ?? null;
      memoizeObject(memo, objectCacheKey(id, locale, market), item);
      if (item) output.set(id, item);
    }
  }
  return output;
}

async function graphDetails(ids: string[], config: PublicConfig, market: string, language: string, context: RequestContext): Promise<{ items: Map<string, Record<string, unknown>>; missing: Set<string>; failed: Set<string> }> {
  const variables: Record<string, string> = { locale: language };
  const declarations = ['$locale: String!'];
  const selections = ids.map((id, index) => {
    variables[`id${index}`] = validateId(id); declarations.push(`$id${index}: ID!`);
    return `item${index}: getPdpItem(itemId: $id${index}) { ${DETAIL_FIELDS} }`;
  });
  const query = `query SellpyPluginItems(${declarations.join(', ')}) { ${selections.join(' ')} }`;
  const response = record(await requestJson(`${config.graphql_url}?_=SellpyPluginItems`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Parse-Application-Id': config.parse_application_id, region: market },
    body: JSON.stringify({ operationName: 'SellpyPluginItems', query, variables }),
  }, context));
  const data = record(response.data);
  const errors = Array.isArray(response.errors) ? response.errors : [];
  if (!response.data && !errors.length) throw contractError('The public Sellpy item response has no data or error envelope.');
  const items = new Map<string, Record<string, unknown>>();
  const missing = new Set<string>();
  const failed = new Set<string>();
  ids.forEach((id, index) => {
    const key = `item${index}`;
    const error = errors.some((entry) => {
      const path = record(entry).path;
      return !Array.isArray(path) || path[0] === key;
    });
    const item = record(data[key]);
    if (item.objectId === id) { items.set(id, item); if (error) failed.add(id); }
    else if (error) failed.add(id);
    else if (data[key] === null) missing.add(id);
    else throw contractError('The public Sellpy item response has an unexpected item shape.');
  });
  return { items, missing, failed };
}

function numeric(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }

function validatePage(input: ProviderPageRequest): void {
  if (!Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isSafeInteger(input.page_size) || input.page_size < 1 || input.page_size > 1000) {
    throw new ToolError('invalid_pagination', 'Source pages need a nonnegative integer offset and between 1 and 1,000 items per request.', {
      next_action: 'Use smaller source pages and continue the search; there is no plugin total-results cap.',
    });
  }
}

function errorForDetail(error: unknown): ToolError {
  return error instanceof ToolError ? error : new ToolError('source_unavailable', 'The requested Sellpy item details could not be loaded.', { retryable: true });
}

function detailInterrupted(error: ToolError): boolean {
  return ['time_budget', 'rate_limited', 'cancelled'].includes(error.code);
}

function dominantDetailFailure(errors: ToolError[]): ToolError {
  // If both concurrent sources fail, retain an observed cooldown/deadline even
  // when the other failure would normally be a non-pausing source error.
  const pauses = errors.filter(detailInterrupted);
  return pauses.sort((a, b) => (Date.parse(b.retry_at ?? '') || 0) - (Date.parse(a.retry_at ?? '') || 0))[0] ?? errors[0]!;
}

function nativeResults(response: unknown, expected: string[], key: 'text' | 'objectid'): { id: string; score?: number; local_rank: number }[] {
  const results = record(response).results;
  if (!Array.isArray(results)) throw contractError('The native Sellpy search response has no results array.');
  const ranked = new Map<string, { id: string; score?: number; local_rank: number }>();
  for (const seed of expected) {
    const group = results.find((entry) => record(entry)[key] === seed);
    if (!group || !Array.isArray(record(group).items)) throw contractError('The native Sellpy search response does not contain the requested query or seed.');
    (record(group).items as unknown[]).forEach((entry, index) => {
      const item = record(entry);
      const id = string(item.objectid);
      if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw contractError('The native Sellpy search response contains an invalid item identifier.');
      const score = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : undefined;
      // Multiple seeds form one arm: interleave the lists by rank, preserving best occurrence.
      const previous = ranked.get(id);
      if (!previous || previous.local_rank > index + 1) ranked.set(id, { id, local_rank: index + 1, ...(score !== undefined ? { score } : {}) });
    });
  }
  return [...ranked.values()].sort((a, b) => a.local_rank - b.local_rank);
}

function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  const marker = new TextDecoder().decode(bytes.slice(0, 12));
  return marker.startsWith('RIFF') && marker.slice(8) === 'WEBP' ? 'image/webp' : null;
}

async function referenceImage(reference: ReferenceImage, context: RequestContext): Promise<{ bytes: Uint8Array; mime_type: string; file_name: string }> {
  checkDeadline(context);
  const prepared = await context.read_reference?.(reference);
  let bytes: Uint8Array;
  if (prepared) bytes = prepared.bytes;
  else {
    // The caller's context.fetch enforces the reference-download host policy and redirects.
    const response = await request(reference.download_url, { headers: { accept: 'image/*' } }, context);
    bytes = await boundedBytes(response, MAX_REFERENCE_BYTES);
  }
  if (bytes.byteLength > MAX_REFERENCE_BYTES) throw new ToolError('reference_too_large', 'The reference image exceeds the 10 MiB per-file transfer budget.', {
    next_action: 'Attach a smaller image; this is a file-transfer limit, not a search-results limit.',
  });
  const mime_type = imageMime(bytes);
  if (!mime_type) throw new ToolError('unsupported_reference_image', 'The reference must contain a JPEG, PNG, or WebP image.', {
    next_action: 'Attach the reference as JPEG, PNG, or WebP and start the image search again.',
  });
  const extension = mime_type === 'image/jpeg' ? 'jpg' : mime_type.split('/')[1];
  return { bytes, mime_type, file_name: `reference.${extension}` };
}

export function createSellpyProvider(): NativeSellpyProvider {
  const loadConfig = createConfigLoader();
  // Only completed public data is memoized, scoped by the current tool request.
  // No response, stream, request or I/O promise survives a request boundary.
  const objectMemos = new WeakMap<RequestContext, ObjectMemo>();
  function objectMemo(context: RequestContext): ObjectMemo {
    let memo = objectMemos.get(context);
    if (!memo) { memo = new Map(); objectMemos.set(context, memo); }
    return memo;
  }

  async function catalog(input: ProviderPageRequest, filters: SearchFilters, config: PublicConfig, context: RequestContext): Promise<ProviderPage> {
    if (input.offset % input.page_size !== 0) throw new ToolError('invalid_pagination', 'A catalog offset must align with the source page size.');
    const locale = localeConfig(config, input.market, input.language);
    const sort = input.arm.sort ?? 'relevance';
    const indexName = locale.indices[sort];
    if (!indexName) throw new ToolError('unsupported_sort', 'The requested Sellpy catalog sort is unsupported.');
    const response = await algolia('queries', { requests: [{
      indexName, query: input.arm.query ?? '', hitsPerPage: input.page_size, page: input.offset / input.page_size,
      ...algoliaFilterParams(filters, input.market),
      attributesToRetrieve: catalogAttributes(input.market),
    }] }, locale, context);
    const result = record(Array.isArray(response.results) ? response.results[0] : undefined);
    if (!Array.isArray(result.hits)) throw contractError('The public Sellpy catalog response has no hits array.');
    const page = numeric(result.page), total = numeric(result.nbHits), pages = numeric(result.nbPages);
    if (page !== input.offset / input.page_size || total === null || pages === null) throw contractError('The public Sellpy catalog pagination contract changed.');
    const window = Math.min(total, pages * input.page_size);
    const observed_at = new Date().toISOString();
    const ranks: Record<string, number> = {};
    const items = result.hits.flatMap((raw, index) => {
      const hit = record(raw);
      if (!matchesFilters(hit, filters, input.market)) return [];
      const item = normalizeItem(hit, input.market, input.language, observed_at);
      if (!item) throw contractError('The public Sellpy catalog returned an invalid item.');
      ranks[item.id] = input.offset + index + 1;
      return [item];
    });
    const next = input.offset + input.page_size;
    const reachedWindow = next >= window || result.hits.length < input.page_size;
    const warnings: string[] = [];
    if (result.exhaustiveNbHits === false) warnings.push('Sellpy reports an estimated catalog total for this query.');
    if (items.length < result.hits.length) warnings.push('Some source hits no longer met the selected market or hard filters when normalized.');
    return {
      items, ranks, next_offset: reachedWindow ? null : next, total, window,
      end_reason: reachedWindow ? (window < total ? 'upstream_window' : 'source_exhausted') : null,
      applied_filters: filters, warnings, observed_at,
    };
  }

  async function native(input: ProviderPageRequest, filters: SearchFilters, config: PublicConfig, context: RequestContext): Promise<ProviderPage> {
    const route = input.arm.route as NativeRoute;
    const service = config.services[route];
    if (!service) throw new ToolError('unsupported_route', 'The requested native Sellpy route is unavailable.');
    const locale = localeConfig(config, input.market, input.language);
    const translated = nativeFilters(filters, input.market, input.language);
    const warnings = translated.post_filtered.length ? [`These hard filters are checked against hydrated ${input.language} item data: ${translated.post_filtered.join(', ')}. Source offsets still advance over every retrieved candidate.`] : [];
    if (input.arm.sort && input.arm.sort !== 'relevance') warnings.push('Native visual and semantic routes retain Sellpy relevance order; use a catalog arm for a global price or newest sort.');
    const common = {
      nItems: input.page_size, offset: input.offset, request_source: REQUEST_SOURCE,
      ...(Object.keys(translated.filters).length ? { filters: translated.filters } : {}),
    };
    let ranked: { id: string; score?: number; local_rank: number }[];
    let sourceCount: number;
    let sourceFull: boolean;
    if (route === 'upload') {
      if (!input.arm.reference) throw new ToolError('missing_reference', 'An uploaded reference image is required for this search route.');
      const reference = await referenceImage(input.arm.reference, context);
      const form = new FormData();
      form.set('image', new Blob([reference.bytes.slice().buffer], { type: reference.mime_type }), reference.file_name);
      form.set('nItems', String(input.page_size)); form.set('offset', String(input.offset)); form.set('request_source', REQUEST_SOURCE);
      const response = await requestJson(service.url, { method: 'POST', headers: { 'X-SimilarItems-Key': service.key }, body: form }, context);
      if (!Array.isArray(response) || response.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))) throw contractError('The native Sellpy image-upload response no longer contains an item-ID array.');
      ranked = [...new Set(response as string[])].map((id) => ({ id, local_rank: (response as string[]).indexOf(id) + 1 }));
      sourceCount = response.length; sourceFull = sourceCount >= input.page_size;
      if (Object.keys(filters).length) warnings.push('Upload-route hard filters are applied after item hydration; native multipart filter support has not been verified.');
    } else if (route === 'outfit') {
      if (input.offset !== 0) throw new ToolError('upstream_window', 'The outfit service has no verified pagination cursor.', {
        next_action: 'Start another outfit arm with another seed or a larger per-part recommendation request.',
      });
      const seed = input.arm.seed_ids?.[0];
      if (!seed) throw new ToolError('missing_seed', 'An outfit search requires a Sellpy seed item.');
      if ((input.arm.seed_ids?.length ?? 0) !== 1) throw new ToolError('invalid_seed_count', 'Each outfit arm needs exactly one seed; create one arm per additional seed.');
      const graph = await graphDetails([validateId(seed)], config, input.market, 'en', context);
      const seedItem = graph.items.get(seed);
      if (!seedItem) throw new ToolError('seed_unavailable', 'The public seed item cannot currently provide outfit metadata.');
      const metadata = record(seedItem.metadata_en);
      const seedImages = (Array.isArray(seedItem.images) ? seedItem.images : []).map((entry) => publicImageUrl(record(entry).value)).filter((url): url is string => !!url);
      const safeMetadata: Record<string, unknown> = {};
      for (const key of ['size', 'type', 'brand', 'color', 'material', 'demography', 'condition', 'season', 'fabric', 'pattern', 'neckline', 'sleeveLength', 'garmentLength']) {
        const value = metadata[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || (Array.isArray(value) && value.every((part) => typeof part === 'string'))) safeMetadata[key] = value;
      }
      const outfitFilters: Record<string, unknown> = {};
      const sizes = filters.facets?.['metadata.size'];
      if (sizes?.length && sizes.every((size) => !size.startsWith('-'))) outfitFilters.size = sizes;
      const demography = string(metadata.demography);
      if (demography) outfitFilters.demography = ['Women', 'Men'].includes(demography) ? [demography, 'Unisex (Adults)'] : [demography];
      const perPart = OUTFIT_WINDOW_PER_PART;
      const response = record(await requestJson(service.url, { method: 'POST', headers: {
        'content-type': 'application/json', 'COMPLEMENTARY-RECOMMENDATIONS-API-Key': service.key,
      }, body: JSON.stringify({ item_objectid: seed, item_metadata_en: safeMetadata, item_images: seedImages, filters: outfitFilters, limit_per_part: perPart }) }, context));
      const recommendations = record(response.data).recommendations;
      if (response.success !== true || !Array.isArray(recommendations)) throw contractError('The native outfit response does not contain a successful recommendation set.');
      ranked = recommendations.map((entry, index) => {
        const id = string(record(entry).objectid);
        if (!id) throw contractError('The native outfit response contains an invalid item identifier.');
        return { id: validateId(id), local_rank: index + 1 };
      });
      sourceCount = recommendations.length; sourceFull = false;
      warnings.push('Sellpy outfit recommendations are a finite per-part window with no verified offset or cursor. This does not mean the catalog is exhausted. Hard filters are checked after hydration.');
      warnings.push('The full native outfit window uses Sellpy’s verified maximum of 20 recommendations per part; the plugin page size only controls how the returned set is presented.');
    } else {
      let body: Record<string, unknown>;
      let expected: string[];
      let key: 'text' | 'objectid' = 'objectid';
      if (route === 'semantic') {
        const query = input.arm.query?.trim();
        if (!query) throw new ToolError('missing_query', 'A semantic Sellpy search requires a text query.');
        body = { texts: [query], ...common }; expected = [query]; key = 'text';
      } else if (route === 'image') {
        const image = publicImageUrl(input.arm.image_url);
        if (!image) throw new ToolError('invalid_image_url', 'Image-URL searches require an observed public Sellpy image URL.', {
          next_action: 'Choose an image returned by an item tool, or attach a reference file and use the upload route.',
        });
        body = { images: [image], ...common }; expected = [image];
      } else {
        expected = [...new Set((input.arm.seed_ids ?? []).map(validateId))];
        if (!expected.length) throw new ToolError('missing_seed', 'A similar-item search requires at least one Sellpy item ID.');
        body = { objectids: expected, ...common };
      }
      const response = await requestJson(service.url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-SimilarItems-Key': service.key }, body: JSON.stringify(body) }, context);
      ranked = nativeResults(response, expected, key);
      const groups = record(response).results as unknown[];
      const counts = expected.map((seed) => {
        const group = groups.find((entry) => record(entry)[key] === seed);
        return (record(group).items as unknown[]).length;
      });
      sourceCount = Math.max(0, ...counts); sourceFull = sourceCount >= input.page_size;
    }
    const hydrated = await objects(ranked.map((entry) => entry.id), locale, input.market, context, objectMemo(context));
    const observed_at = new Date().toISOString();
    const ranks: Record<string, number> = {}, scores: Record<string, number> = {};
    const seen = new Set<string>();
    const items = ranked.flatMap((entry) => {
      const observation = hydrated.get(entry.id);
      const raw = observation?.value;
      if (!raw || !matchesFilters(raw, filters, input.market) || seen.has(entry.id)) return [];
      const item = normalizeItem(raw, input.market, input.language, observation!.observed_at);
      if (!item) throw contractError('A hydrated Sellpy result has an invalid item shape.');
      seen.add(entry.id); ranks[entry.id] = input.offset + entry.local_rank;
      if (entry.score !== undefined) scores[entry.id] = entry.score;
      return [item];
    });
    if (items.length < ranked.length) warnings.push(`${ranked.length - items.length} retrieved candidates were unavailable in this market or did not satisfy the hard filters.`);
    if (!sourceFull && route !== 'outfit') warnings.push('This native retrieval window ended. Sellpy does not expose a complete catalog total for this route.');
    return {
      items, ranks, scores, next_offset: sourceFull ? input.offset + input.page_size : null,
      total: null, window: sourceFull ? null : input.offset + sourceCount,
      end_reason: sourceFull ? null : 'upstream_window', applied_filters: filters, warnings, observed_at,
    };
  }

  return {
    async similarBrands(input, context): Promise<SimilarBrandsResult> {
      validateLocale(input.market, input.language);
      if (!Array.isArray(input.brands) || !input.brands.length || input.brands.length > 50 ||
        input.brands.some(brand => typeof brand !== 'string' || !brand.trim() || brand.length > 300 || /[\u0000-\u001f\u007f]/.test(brand))) {
        throw new ToolError('invalid_brand_seeds', 'Provide between 1 and 50 nonempty native brand names, each at most 300 characters.');
      }
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw new ToolError('invalid_brand_limit', 'Request between 1 and 100 brand alternatives per call. This is a response budget, not a catalog limit.');
      }
      const identity = (brand: string): string => brand.normalize('NFKC').toLowerCase();
      const seeds = new Map<string, string>();
      for (const brand of input.brands) if (!seeds.has(identity(brand.trim()))) seeds.set(identity(brand.trim()), brand.trim());
      return withCachedObservation(context, {
        kind: 'brands', input, observed_at: value => Date.parse(value.observed_at),
        project: value => { const { seed_brands: _seeds, ...publicResult } = value; return publicResult; },
        restore: value => ({ ...value as Omit<SimilarBrandsResult, 'seed_brands'>, seed_brands: [...seeds.values()] }),
      }, async (): Promise<SimilarBrandsResult> => {
        const config = await loadConfig(context);
        const service = config.similar_brands;
        if (!service) throw new ToolError('unsupported_native_capability', 'The current public Sellpy configuration does not expose similar-brand discovery.', {
          next_action: 'Use an exact brand catalog search, or retry after the native configuration is updated.',
        });
        const response = await request(service.url, {
          method: 'POST', headers: { 'content-type': 'application/json', 'X-SimilarItems-Key': service.key },
          body: JSON.stringify({ brand_groups: [[...seeds.values()]], n_items: input.limit, request_source: REQUEST_SOURCE }),
        }, context);
        let parsed: unknown;
        try { parsed = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 128 * 1024))) as unknown; }
        catch (error) {
          if (error instanceof ToolError) throw error;
          throw contractError('The native similar-brand response is not valid JSON.');
        }
        if (!Array.isArray(parsed) || parsed.length !== 1 || !Array.isArray(parsed[0])) {
          throw contractError('The native similar-brand response no longer matches the requested brand group.');
        }
        const brands: SimilarBrand[] = [];
        const seen = new Set(seeds.keys());
        for (const raw of parsed[0] as unknown[]) {
          const entry = record(raw);
          if (typeof entry.brand !== 'string' || !entry.brand.trim() || entry.brand.length > 300 || /[\u0000-\u001f\u007f]/.test(entry.brand) ||
            (entry.objectid !== undefined && (typeof entry.objectid !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(entry.objectid))) ||
            (entry.score !== undefined && (typeof entry.score !== 'number' || !Number.isFinite(entry.score)))) {
            throw contractError('The native similar-brand response contains invalid brand metadata.');
          }
          const name = entry.brand.trim(), key = identity(name);
          if (seen.has(key)) continue;
          seen.add(key);
          if (brands.length < input.limit) brands.push({ brand: name,
            brand_object_id: typeof entry.objectid === 'string' ? entry.objectid : null,
            native_score: typeof entry.score === 'number' ? entry.score : null });
        }
        return { market: input.market, language: input.language, seed_brands: [...seeds.values()], brands,
          requested_limit: input.limit, inventory_checked: false, source_url: service.url,
          source_version: config.source_version, observed_at: new Date().toISOString(),
          warnings: ['Native brand alternatives are not market-stock checks or item matches. Native scores are not probabilities and are not comparable with item-search scores.',
            'Sellpy exposes a finite requested brand window; no continuation cursor or exhaustive total is verified.'],
        };
      });
    },
    async capabilities(context): Promise<ProviderCapabilities> {
      const config = await loadConfig(context);
      const evidence = `First-party frontend contract and successful public request verified ${VERIFIED_AT}; configuration discovered at runtime.`;
      const changed = config.source_version !== VERIFIED_RELEASE ? ' The frontend release changed after the contract probe; each response is schema-checked and failures remain explicit.' : '';
      return {
        markets: Object.keys(MARKETS), languages: [...new Set(Object.values(MARKETS).flatMap((market) => market.locales))].filter((language) => !!config.locales[language]),
        source_version: config.source_version, observed_at: new Date().toISOString(), routes: {
          catalog: { available: true, evidence, limitation: `Algolia exposes a query-specific pagination window; no plugin total-results cap.${changed}` },
          semantic: { available: true, evidence, limitation: `Native relevance retrieval, no complete catalog total; localized hard filters may be applied after hydration.${changed}` },
          similar: { available: true, evidence, limitation: `Native relevance retrieval using seed IDs; no complete catalog total.${changed}` },
          image: { available: true, evidence, limitation: `Accepts observed public Sellpy image URLs; use upload for attached references.${changed}` },
          upload: { available: true, evidence, limitation: `Verified multipart image input and ordered ID array; filters apply after hydration. JPEG, PNG, WebP, 10 MiB per file.${changed}` },
          outfit: { available: true, evidence, limitation: `Finite recommendations per outfit part; no verified continuation cursor.${changed}` },
        },
      };
    },
    async search(input, context): Promise<ProviderPage> {
      validatePage(input); validateLocale(input.market, input.language);
      const filters = effectiveFilters(input.arm.filters, input.arm.category_relaxed);
      const load = async () => {
        const config = await loadConfig(context);
        return input.arm.route === 'catalog' ? catalog(input, filters, config, context) : native(input, filters, config, context);
      };
      // Retained uploads and private reference state never enter a shared key
      // or value. Only public catalog/seed/Sellpy-photo routes are coordinated.
      if (input.arm.route === 'upload' || input.arm.reference) return load();
      const { id: _identity, ...arm } = input.arm;
      return withCachedObservation(context, {
        kind: 'search', input: { ...input, arm },
        observed_at: (value: ProviderPage) => Math.min(Date.parse(value.observed_at), ...value.items.map(item => Date.parse(item.observed_at))),
        project: value => { const { applied_filters: _filters, ...publicPage } = value; return publicPage; },
        restore: value => ({ ...value as Omit<ProviderPage, 'applied_filters'>, applied_filters: structuredClone(filters) }),
      }, load);
    },
    async details(ids, market, language, context): Promise<DetailBatch> {
      validateLocale(market, language);
      const unique = [...new Set(ids.map(validateId))];
      const result: DetailBatch = { items: [], failures: [], remaining_ids: [] };
      if (!unique.length) return result;
      return withCachedObservation(context, {
        kind: 'details', input: { ids, market, language },
        observed_at: (value: DetailBatch) => Math.min(...value.items.map(item => Date.parse(item.observed_at))),
        cacheable: value => !value.failures.length && !value.remaining_ids.length && value.items.length === unique.length,
      }, async () => {
        const config = await loadConfig(context);
        const locale = localeConfig(config, market, language);
        for (let start = 0; start < unique.length; start += 10) {
          const batch = unique.slice(start, start + 10);
          if (context.signal?.aborted || Date.now() >= context.deadline) { result.remaining_ids = unique.slice(start); break; }
          try {
            // These two sources are independent. Keep concurrency at two while
            // awaiting both outcomes so a failed source never leaves floating I/O.
            // Canonical details deliberately bypass request-local search hydration
            // memoization. Explicit refresh callers also bypass the five-second
            // completed-observation cache using withoutObservationCache().
            const [catalogResult, graphResult] = await Promise.allSettled([
              objects(batch, locale, market, context),
              graphDetails(batch, config, market, language, context),
            ]);
            if (catalogResult.status === 'rejected') throw dominantDetailFailure([
              errorForDetail(catalogResult.reason), ...(graphResult.status === 'rejected' ? [errorForDetail(graphResult.reason)] : []),
            ]);
            const catalogItems = catalogResult.value;
            let graph: Awaited<ReturnType<typeof graphDetails>>;
            try {
              if (graphResult.status === 'rejected') throw graphResult.reason;
              graph = graphResult.value;
            }
            catch (error) {
              const providerError = errorForDetail(error);
              if (detailInterrupted(providerError)) {
                result.remaining_ids = unique.slice(start);
                result.failures.push(...result.remaining_ids.map(id => ({id,error:providerError.toJSON()})));
                break;
              }
              for (const id of batch) {
                const observation = catalogItems.get(id);
                const item = normalizeItem(observation?.value, market, language, observation?.observed_at ?? new Date().toISOString());
                if (item) result.items.push(item);
                result.failures.push({ id, error: providerError.toJSON() });
              }
              continue;
            }
            for (const id of batch) {
              const item = normalizeItem(catalogItems.get(id)?.value, market, language, new Date().toISOString(), graph.items.get(id));
              if (item && graph.missing.has(id)) item.availability = 'unknown';
              if (item) result.items.push(item);
              if (graph.failed.has(id)) result.failures.push({ id, error: new ToolError('detail_unavailable', 'Sellpy returned an error for this public item detail.', { retryable: true }).toJSON() });
              else if (graph.missing.has(id)) result.failures.push({ id, error: new ToolError('item_not_found', 'The canonical Sellpy item could not be found; current availability is unconfirmed.').toJSON() });
            }
          } catch (error) {
            const providerError = errorForDetail(error);
            if (detailInterrupted(providerError)) {
              result.remaining_ids = unique.slice(start);
              result.failures.push(...result.remaining_ids.map(id => ({id,error:providerError.toJSON()})));
              break;
            }
            for (const id of batch) result.failures.push({ id, error: providerError.toJSON() });
          }
        }
        return result;
      });
    },
    async facets(query, inputFilters, market, language, context): Promise<FacetResult> {
      validateLocale(market, language);
      const filters = effectiveFilters(inputFilters);
      return withCachedObservation(context, {
        kind: 'facets', input: { query, filters: inputFilters, market, language },
        observed_at: (value: FacetResult) => Date.parse(value.observed_at),
      }, async () => {
        const config = await loadConfig(context), locale = localeConfig(config, market, language);
        const response = await algolia('queries', { requests: [{ indexName: locale.indices.relevance, query,
          hitsPerPage: 0, page: 0, facets: ['*'], ...algoliaFilterParams(filters, market),
        }] }, locale, context);
        const result = record(Array.isArray(response.results) ? response.results[0] : undefined);
        if (!result.facets || typeof result.facets !== 'object' || numeric(result.nbHits) === null) throw contractError('Sellpy did not return the expected public facet response.');
        const facets: FacetResult['facets'] = {}, numeric_facets: FacetResult['numeric_facets'] = {};
        for (const [key, raw] of Object.entries(record(result.facets))) {
          if (!FACET_FIELDS.has(key)) continue;
          facets[key] = Object.fromEntries(Object.entries(record(raw)).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0));
        }
        for (const [key, raw] of Object.entries(record(result.facets_stats))) {
          if (key !== `price_${market}.amount` && !(key.startsWith('metadata.measurement.') && MEASUREMENT_FIELDS.has(key.slice('metadata.measurement.'.length)))) continue;
          const values = record(raw), min = numeric(values.min), max = numeric(values.max);
          if (min === null || max === null) continue;
          // Price statistics use the same base currency unit as SearchFilters; measurements remain cm.
          numeric_facets[key] = key === `price_${market}.amount` ? { min: min / 100, max: max / 100 } : { min, max };
        }
        return { market, language, facets, numeric_facets, total: numeric(result.nbHits), observed_at: new Date().toISOString() };
      });
    },
  };
}

// Stateless tool handlers reuse the already existing parsed-configuration TTL.
// SearchRun retains its own instance; only request-local data is memoized above.
export const sharedSellpyProvider = createSellpyProvider();
