import type { ReferenceImage, SearchArm, SearchFilters, SearchIntent, SearchPlan, Sort } from './domain.js';

export interface CommonSearch {
  market: string;
  language: string;
  page_size: number;
  filters?: SearchFilters;
}

export function catalogPlan(input: CommonSearch & { query: string; sort?: Sort }): SearchPlan {
  return {
    market: input.market, language: input.language, page_size: input.page_size,
    intent: { query: input.query },
    arms: [{ id: 'catalog', route: 'catalog', query: input.query, filters: input.filters, sort: input.sort ?? 'relevance' }]
  };
}

export function relaxCategory(filters: SearchFilters = {}): SearchFilters {
  const facets = Object.fromEntries(Object.entries(filters.facets ?? {}).filter(([name]) =>
    !/(?:^categories(?:\.|$)|category|demograph|itemtype|item_type|type$)/i.test(name)));
  return { ...filters, facets };
}

function relaxStyleMetadata(filters: SearchFilters = {}): SearchFilters {
  const relaxed = relaxCategory(filters);
  return { ...relaxed, facets: Object.fromEntries(Object.entries(relaxed.facets ?? {}).filter(([name]) =>
    !/(?:^|[._])(?:styles?|aesthetics?)$/i.test(name))) };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(v => v.trim()).filter(Boolean))];
}

function canonicalFilters(filters: SearchFilters | undefined): SearchFilters {
  const facets = Object.fromEntries(Object.entries(filters?.facets ?? {}).filter(([, values]) => values.length)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, values]) => [name, [...new Set(values)].sort()]));
  const measurements = Object.fromEntries(Object.entries(filters?.measurements ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, range]) => [name, { ...(range.min !== undefined ? { min: range.min } : {}), ...(range.max !== undefined ? { max: range.max } : {}) }]));
  return {
    ...(Object.keys(facets).length ? { facets } : {}),
    ...(Object.keys(measurements).length ? { measurements } : {}),
    ...(filters?.price_min !== undefined ? { price_min: filters.price_min } : {}),
    ...(filters?.price_max !== undefined ? { price_max: filters.price_max } : {}),
    ...(filters?.include_reserved !== undefined ? { include_reserved: filters.include_reserved } : {}),
  };
}

/** Duplicate query arms are neither independent retrieval evidence nor useful extra I/O. */
function distinctRequests(arms: SearchArm[]): SearchArm[] {
  const seen = new Map<string, SearchArm>();
  for (const arm of arms) {
    const identity = JSON.stringify({ route: arm.route, query: arm.query ?? '', seed_ids: arm.seed_ids ?? [],
      image_url: arm.image_url, reference: arm.reference, filters: canonicalFilters(arm.filters), sort: arm.sort ?? 'relevance' });
    const existing = seen.get(identity);
    if (!existing) seen.set(identity, { ...arm });
    else if (arm.category_relaxed) existing.category_relaxed = true;
  }
  return [...seen.values()];
}

export function stylePlan(input: CommonSearch & {
  query: string;
  style: string;
  desired_type?: string;
  attribute_queries: string[];
  relaxed_queries: string[];
  include?: string[];
  exclude?: string[];
  seed_ids?: string[];
}): SearchPlan {
  const arms: SearchArm[] = [{ id: 'catalog', route: 'catalog', query: input.query, filters: input.filters, sort: 'relevance' }];
  for (const [index, query] of unique([input.style, ...input.attribute_queries]).entries()) {
    arms.push({ id: `semantic-${index}`, route: 'semantic', query, filters: input.filters });
  }
  for (const [index, query] of unique(input.relaxed_queries).entries()) {
    arms.push({ id: `relaxed-semantic-${index}`, route: 'semantic', query, filters: relaxStyleMetadata(input.filters), category_relaxed: true });
    arms.push({ id: `relaxed-catalog-${index}`, route: 'catalog', query, filters: relaxStyleMetadata(input.filters), category_relaxed: true, sort: 'relevance' });
  }
  for (const [index, id] of unique(input.seed_ids ?? []).entries()) {
    arms.push({ id: `seed-${index}`, route: 'similar', seed_ids: [id], filters: relaxStyleMetadata(input.filters), category_relaxed: true });
  }
  const intent: SearchIntent = { query: input.query, style: input.style, desired_type: input.desired_type, include: input.include, exclude: input.exclude };
  return { market: input.market, language: input.language, page_size: input.page_size, intent, arms: distinctRequests(arms) };
}

export function similarPlan(input: CommonSearch & { seed_ids: string[]; relax_categories?: boolean; query?: string }): SearchPlan {
  return { market: input.market, language: input.language, page_size: input.page_size,
    intent: { query: input.query ?? 'Find visually similar items' },
    arms: unique(input.seed_ids).map((id,index) => ({ id: `similar-${index}`, route: 'similar', seed_ids: [id],
      filters: input.relax_categories ? relaxCategory(input.filters) : input.filters,
      category_relaxed: input.relax_categories ?? false })) };
}

export function imagePlan(input: CommonSearch & { reference?: ReferenceImage; image_url?: string; modification?: string; attribute_queries?: string[]; exclude?: string[]; desired_type?: string }): SearchPlan {
  const arms: SearchArm[] = [{ id: 'reference-image', route: input.reference ? 'upload' : 'image', reference: input.reference,
    image_url: input.image_url, filters: relaxCategory(input.filters), category_relaxed: true }];
  for (const [index, query] of unique([...(input.modification ? [input.modification] : []), ...(input.attribute_queries ?? [])]).entries()) {
    arms.push({ id: `image-modification-${index}`, route: 'semantic', query, filters: relaxCategory(input.filters), category_relaxed: true });
  }
  return { market: input.market, language: input.language, page_size: input.page_size,
    intent: { query: 'Find items from a reference image', modification: input.modification, exclude: input.exclude, desired_type: input.desired_type }, arms: distinctRequests(arms) };
}

export function outfitPlan(input: CommonSearch & { item_id: string }): SearchPlan {
  return { market: input.market, language: input.language, page_size: input.page_size,
    intent: { query: 'Find complementary outfit pieces' },
    arms: [{ id: 'outfit', route: 'outfit', seed_ids: [input.item_id], filters: input.filters }] };
}
