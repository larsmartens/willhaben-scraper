import { ToolError, type SearchFilters, type Sort } from './domain.js';
import { effectiveFilters, FACET_FIELDS, MARKETS, validateLocale } from './sellpy/normalize.js';

export interface ParsedSearchUrl {
  market: string;
  language: string;
  query: string;
  sort: Sort;
  filters: SearchFilters;
  source_url: string;
  source_page: number;
  ignored_parameters: string[];
  warnings: string[];
}

// Verified native URL registry, intersected with the existing shopper allowlist.
// Native registry fields such as user, storageSite and internal classifications
// are deliberately not made available by importing an arbitrary query string.
const FACET_PARAMS: Record<string, string> = {
  brand: 'metadata.brand', type: 'metadata.type', color: 'metadata.color', material: 'metadata.material',
  season: 'metadata.season', fabric: 'metadata.fabric', pattern: 'metadata.pattern', condition: 'metadata.condition',
  pantsLength: 'metadata.pantsLength', demography: 'metadata.demography', sleeveLength: 'metadata.sleeveLength',
  neckline: 'metadata.neckline', garmentLength: 'metadata.garmentLength',
  sizes: 'sizes', style: 'style', brandGroups: 'brandGroups', materials: 'materials', saleType: 'saleType',
};
const MEASUREMENT_PARAMS: Record<string, string> = {
  Waist: 'waistInCm', InnerLegLength: 'innerLegLengthInCm', HeelHeight: 'heelHeightInCm',
  Length: 'lengthInCm', Width: 'widthInCm', Height: 'heightInCm',
};
const SORT_PARAMS: Record<string, Sort> = {
  relevance: 'relevance', price_asc: 'price_asc', price_desc: 'price_desc', saleStartedAt_desc: 'newest',
};
const TRACKING_PARAMS = new Set(['gclid', 'dclid', 'fbclid', 'msclkid', 'gbraid', 'wbraid', 'mc_cid', 'mc_eid']);
const HAS_CONTROL = /[\u0000-\u001f\u007f]/;

function fail(message: string, next_action = 'Copy a current Sellpy /search URL with supported shopper filters, or supply the criteria explicitly.'): never {
  throw new ToolError('invalid_search_url', message, { next_action });
}

function decodeStrict(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (HAS_CONTROL.test(decoded) || decoded.includes('\ufffd')) fail('The search URL contains invalid text or control characters.');
    return decoded;
  } catch (error) {
    if (error instanceof ToolError) throw error;
    return fail('The search URL contains malformed percent-encoded text.');
  }
}

function single(params: URLSearchParams, key: string): string | undefined {
  const values = [...new Set(params.getAll(key))];
  if (values.length > 1) fail(`The search URL gives conflicting values for ${key}.`);
  return values[0];
}

function amount(params: URLSearchParams, key: string): number | undefined {
  const raw = single(params, key);
  if (raw === undefined) return undefined;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) fail(`${key} must be a nonnegative decimal amount.`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) fail(`${key} is outside the supported numeric range.`);
  return value;
}

/** Parse only; this function never fetches a supplied URL or changes criteria. */
export function parseSearchUrl(input: string, overrides: { market?: string; language?: string } = {}): ParsedSearchUrl {
  if (typeof input !== 'string' || input.length > 16000 || HAS_CONTROL.test(input) || input.includes('\\')) {
    return fail('Provide a Sellpy search URL of at most 16000 characters without control characters or backslashes.');
  }
  const trimmed = input.trim();
  if (!/^https:\/\//i.test(trimmed)) return fail('A Sellpy search URL must use HTTPS.');
  let url: URL;
  try { url = new URL(trimmed); } catch { return fail('The Sellpy search URL is malformed.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return fail('Search URLs must use HTTPS without credentials or a custom port.');
  const host = url.hostname.toLowerCase();
  const marketEntry = Object.entries(MARKETS).find(([, definition]) => {
    const supportedHost = new URL(definition.origin).hostname;
    return host === supportedHost || host === supportedHost.replace(/^www\./, '');
  });
  if (!marketEntry) throw new ToolError('unsupported_search_host', 'This is not a supported Sellpy marketplace host.', {
    next_action: `Use a search URL from one of these markets: ${Object.keys(MARKETS).join(', ')}.`,
  });
  const [market, definition] = marketEntry;
  if (overrides.market !== undefined && overrides.market !== market) {
    return fail('The requested market conflicts with the Sellpy URL. Market currencies and localized filter values cannot be reinterpreted silently.',
      `Use market ${market}, omit the market override, or create a new search with explicit criteria for the other market.`);
  }
  const language = overrides.language ?? definition.locales[0]!;
  validateLocale(market, language);

  // WHATWG URL parsing removes dot segments. Inspect the supplied path first,
  // so normalized traversal is not accepted as an ordinary search permalink.
  const suppliedPath = trimmed.replace(/^https:\/\/[^/?#]+/i, '').split(/[?#]/)[0] ?? '';
  const suppliedSegments = suppliedPath.split('/');
  if (suppliedSegments.some(segment => ['.', '..'].includes(decodeStrict(segment)))) return fail('Search URLs must not contain dot-path segments.');
  if (!/^\/search(?:\/|$)/.test(url.pathname) || /\/\//.test(url.pathname)) return fail('Only Sellpy /search URLs and their category paths are supported.');
  const categorySlugs = url.pathname.slice('/search'.length).replace(/\/$/, '').split('/').filter(Boolean);
  if (categorySlugs.length > 4) return fail('The search category path is deeper than the verified shopper category schema.');
  const category = categorySlugs.map(slug => {
    const value = slug.split('-').map(decodeStrict).join(' ').replace(/_/g, '-');
    if (!value.trim() || value.length > 300) return fail('A category segment is empty or too long.');
    return value;
  });
  // URLSearchParams otherwise replaces malformed UTF-8 silently.
  for (const pair of url.search.slice(1).split('&')) {
    for (const part of pair.split('=')) decodeStrict(part.replace(/\+/g, ' '));
  }
  const params = url.searchParams;
  const accepted = new Set(['query', 'page', 'sortBy', 'minPrice', 'maxPrice', ...Object.keys(FACET_PARAMS),
    ...Object.keys(MEASUREMENT_PARAMS).flatMap(key => [`min${key}`, `max${key}`])]);
  const ignored_parameters: string[] = [];
  const unsupported: string[] = [];
  for (const key of new Set(params.keys())) {
    if (accepted.has(key)) continue;
    if (/^utm_[a-z0-9_]+$/i.test(key) || TRACKING_PARAMS.has(key.toLowerCase())) ignored_parameters.push(key);
    else unsupported.push(key.slice(0, 200));
  }
  if (unsupported.length) throw new ToolError('unsupported_search_parameters', `The search URL contains unsupported parameters: ${unsupported.join(', ')}.`, {
    next_action: 'These parameters were not dropped. Remove them explicitly or translate their intended restrictions into supported shopper filters before searching.',
  });
  const query = single(params, 'query') ?? '';
  if (query.length > 4000) return fail('The search query exceeds 4000 characters.');
  const sortValue = single(params, 'sortBy');
  if (sortValue !== undefined && !Object.hasOwn(SORT_PARAMS, sortValue)) return fail('The search URL contains an unsupported or empty sort order.');
  const sort = sortValue === undefined ? 'relevance' : SORT_PARAMS[sortValue]!;
  const pageValue = single(params, 'page');
  if (pageValue !== undefined && (!/^[1-9]\d*$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue)))) return fail('The source page must be a positive whole number.');
  const source_page = pageValue === undefined ? 1 : Number(pageValue);
  const facets: Record<string, string[]> = {};
  for (const [parameter, field] of Object.entries(FACET_PARAMS)) {
    const values = [...new Set(params.getAll(parameter))];
    if (!values.length) continue;
    if (!FACET_FIELDS.has(field)) return fail(`The shopper field ${parameter} is no longer supported.`);
    if (values.some(value => !value.trim() || value.length > 300 || value === '-' || value.startsWith('\\-'))) {
      return fail(`The ${parameter} filter contains an empty, oversized or unsupported escaped value.`);
    }
    const includes = new Set(values.filter(value => !value.startsWith('-')));
    if (values.some(value => value.startsWith('-') && includes.has(value.slice(1)))) return fail(`The ${parameter} filter both includes and excludes the same value.`);
    facets[field] = values;
  }
  if (category.length) facets[`categories.lvl${category.length - 1}`] = [category.join(' > ')];
  const measurements: NonNullable<SearchFilters['measurements']> = {};
  for (const [parameter, field] of Object.entries(MEASUREMENT_PARAMS)) {
    const min = amount(params, `min${parameter}`), max = amount(params, `max${parameter}`);
    if (min !== undefined || max !== undefined) measurements[field] = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }
  const price_min = amount(params, 'minPrice'), price_max = amount(params, 'maxPrice');
  const filters = effectiveFilters({ ...(Object.keys(facets).length ? { facets } : {}),
    ...(Object.keys(measurements).length ? { measurements } : {}),
    ...(price_min !== undefined ? { price_min } : {}), ...(price_max !== undefined ? { price_max } : {}),
  });
  const warnings: string[] = [];
  if (source_page !== 1) warnings.push(`The source link points to page ${source_page}. A new plugin search starts at its first page; source page numbers are not plugin cursors.`);
  if (overrides.language === undefined && (category.length || Object.keys(facets).some(key => key.startsWith('metadata.')))) {
    warnings.push(`The URL does not encode its content language. Using ${language}; source filter labels are preserved. Supply the matching language explicitly if the page used another supported language.`);
  }
  if (url.hash) ignored_parameters.push('#fragment');
  for (const key of ignored_parameters) if (key !== '#fragment') url.searchParams.delete(key);
  url.hash = '';
  if (ignored_parameters.length) warnings.push('Only recognized tracking parameters and the page fragment were ignored; shopper restrictions were preserved.');
  return { market, language, query, sort, filters, source_url: url.href, source_page, ignored_parameters, warnings };
}
