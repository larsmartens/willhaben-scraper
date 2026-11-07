import type { RequestContext, Sort } from '../domain.js';
import { contractError, record, requestText } from './http.js';

export const SOURCE_ORIGIN = 'https://www.sellpy.com';
export const VERIFIED_RELEASE = 'a3f361d92d68c0aac28e373573978596738012d9';
export const VERIFIED_AT = '2026-11-06';
export const SERVICE_PATHS = {
  semantic: '/similar-items-app/get-similar-by-text',
  similar: '/similar-items-app/get-similar',
  image: '/similar-items-app/get-similar-image',
  upload: '/similar-items-app/get-similar-user-image',
  outfit: '/complementary-recommendations',
} as const;
export type NativeRoute = keyof typeof SERVICE_PATHS;
export const SIMILAR_BRANDS_URL = 'https://services.sellpy.net/similar-items-app/get-similar-brands';
export interface LocaleConfig {
  application_id: string;
  search_key: string;
  indices: Record<Sort, string>;
}
export interface PublicConfig {
  locales: Record<string, LocaleConfig>;
  services: Record<NativeRoute, { url: string; key: string }>;
  similar_brands?: { url: string; key: string };
  graphql_url: string;
  parse_application_id: string;
  source_version: string | null;
  source_url: string;
}

// This reads only static object literals. It never evaluates downloaded JavaScript.
class LiteralReader {
  private offset = 0;
  constructor(private readonly source: string) {}
  private skip(): void { while (/\s/.test(this.source[this.offset] ?? '') && this.offset < this.source.length) this.offset++; }
  private fail(): never { throw contractError('The public Sellpy configuration format has changed.'); }
  private string(): string {
    const quote = this.source[this.offset++];
    let value = '';
    while (this.offset < this.source.length) {
      const char = this.source[this.offset++];
      if (char === quote) return value;
      if (quote === '`' && char === '$' && this.source[this.offset] === '{') this.fail();
      if (char !== '\\') { value += char; continue; }
      const escaped = this.source[this.offset++];
      if (escaped === 'u') {
        const hex = this.source.slice(this.offset, this.offset + 4);
        if (!/^[\da-fA-F]{4}$/.test(hex)) this.fail();
        value += String.fromCharCode(parseInt(hex, 16)); this.offset += 4;
      } else if (escaped === 'x') {
        const hex = this.source.slice(this.offset, this.offset + 2);
        if (!/^[\da-fA-F]{2}$/.test(hex)) this.fail();
        value += String.fromCharCode(parseInt(hex, 16)); this.offset += 2;
      } else {
        const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
        value += escapes[escaped ?? ''] ?? escaped ?? this.fail();
      }
    }
    return this.fail();
  }
  value(depth = 0): unknown {
    if (depth > 12) this.fail();
    this.skip();
    const char = this.source[this.offset];
    if (char === '"' || char === "'" || char === '`') return this.string();
    if (char === '{') {
      this.offset++;
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (;;) {
        this.skip();
        if (this.source[this.offset] === '}') { this.offset++; return result; }
        const first = this.source[this.offset];
        let key: string;
        if (first === '"' || first === "'" || first === '`') key = this.string();
        else {
          const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.source.slice(this.offset));
          if (!match) this.fail();
          key = match[0]; this.offset += key.length;
        }
        if (['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(result, key)) this.fail();
        this.skip(); if (this.source[this.offset++] !== ':') this.fail();
        result[key] = this.value(depth + 1);
        this.skip();
        if (this.source[this.offset] === '}') { this.offset++; return result; }
        if (this.source[this.offset++] !== ',') this.fail();
      }
    }
    if (char === '[') {
      this.offset++;
      const result: unknown[] = [];
      for (;;) {
        this.skip(); if (this.source[this.offset] === ']') { this.offset++; return result; }
        result.push(this.value(depth + 1)); this.skip();
        if (this.source[this.offset] === ']') { this.offset++; return result; }
        if (this.source[this.offset++] !== ',') this.fail();
      }
    }
    const scalar = /^(true|false|null|!0|!1|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(this.source.slice(this.offset));
    if (!scalar) return this.fail();
    this.offset += scalar[0].length;
    const scalarValue = scalar[0];
    if (scalarValue === 'true' || scalarValue === '!0') return true;
    if (scalarValue === 'false' || scalarValue === '!1') return false;
    if (scalarValue === 'null') return null;
    return Number(scalarValue);
  }
}

function staticObject(source: string, field: string): Record<string, unknown> {
  const start = new RegExp(`(?:^|[,{}])\\s*${field}\\s*:\\s*(?=\\{)`).exec(source);
  if (!start) throw contractError(`The public Sellpy ${field} configuration is missing.`);
  return record(new LiteralReader(source.slice(start.index + start[0].length)).value());
}

function requiredString(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== 'string' || !value || value.length > 4096) throw contractError(`A required public Sellpy configuration field (${key}) is invalid.`);
  return value;
}

export function parsePublicConfig(source: string, sourceUrl: string): PublicConfig {
  const algolia = staticObject(source, 'algolia');
  const locales: Record<string, LocaleConfig> = {};
  const sortFields: Record<Sort, string> = {
    relevance: 'marketItemIndexRelevance', newest: 'marketItemIndexSaleStartDescending',
    price_asc: 'marketItemIndexPriceAscending', price_desc: 'marketItemIndexPriceDescending',
  };
  for (const [locale, raw] of Object.entries(record(algolia.locales))) {
    if (!/^[a-z]{2}$/.test(locale)) continue;
    const config = record(raw);
    const application_id = requiredString(config, 'applicationId');
    if (!/^[A-Z0-9]{5,32}$/.test(application_id)) throw contractError('The public search application identifier has an unsupported format.');
    const indices = {} as Record<Sort, string>;
    for (const [sort, field] of Object.entries(sortFields)) {
      const index = requiredString(config, field);
      if (!/^[\w-]{1,200}$/.test(index)) throw contractError('A public Sellpy search index has an unsupported format.');
      indices[sort as Sort] = index;
    }
    locales[locale] = { application_id, search_key: requiredString(config, 'searchKey'), indices };
  }
  if (!locales.en || !locales.de) throw contractError('The expected English and German public search configurations are unavailable.');
  const ml = staticObject(source, 'ml');
  const names: Record<NativeRoute, string> = {
    semantic: 'similarItemsByText', similar: 'similarItems', image: 'similarItemsFromImage',
    upload: 'similarItemsFromUserImage', outfit: 'complementaryItems',
  };
  const services = {} as PublicConfig['services'];
  for (const [route, field] of Object.entries(names)) {
    const config = record(ml[field]);
    const url = requiredString(config, 'url');
    if (url !== `https://services.sellpy.net${SERVICE_PATHS[route as NativeRoute]}`) {
      throw contractError('A public Sellpy service endpoint changed and requires contract review.');
    }
    services[route as NativeRoute] = { url, key: requiredString(config, 'key') };
  }
  let similar_brands: PublicConfig['similar_brands'];
  if (Object.hasOwn(ml, 'similarBrands')) {
    const config = record(ml.similarBrands);
    const url = requiredString(config, 'url');
    if (url !== SIMILAR_BRANDS_URL) throw contractError('The public Sellpy similar-brand endpoint changed and requires contract review.');
    similar_brands = { url, key: requiredString(config, 'key') };
  }
  const graphql_url = requiredString(staticObject(source, 'apollo'), 'uri');
  if (graphql_url !== 'https://sellpy-parse-prod.herokuapp.com/graphql') throw contractError('The public Sellpy item endpoint changed and requires contract review.');
  return {
    locales, services, ...(similar_brands ? { similar_brands } : {}), graphql_url,
    parse_application_id: requiredString(staticObject(source, 'parse'), 'applicationId'),
    source_url: sourceUrl, source_version: /SENTRY_RELEASE\s*=\s*\{id:\s*[`'"]([a-f\d]{40})[`'"]/.exec(source)?.[1] ?? null,
  };
}

export function createConfigLoader(ttlMs = 30 * 60 * 1000): (context: RequestContext) => Promise<PublicConfig> {
  let cached: { config: PublicConfig; expires: number } | undefined;
  return async (context) => {
    if (cached && cached.expires > Date.now()) return cached.config;
    const html = await requestText(`${SOURCE_ORIGIN}/search`, { headers: { accept: 'text/html' } }, context);
    const paths = (document: string): string[] => [...document.matchAll(/["'](?:https:\/\/www\.sellpy\.com)?(\/market\/config\.prod\.[\w-]+\.bundle\.js)["']/g)].map(match => match[1]!);
    const pending = paths(html);
    const visited = new Set<string>();
    if (!pending.length) throw contractError('The current Sellpy frontend did not expose its public service configuration.');
    // A stale regional HTML cache can reference a retired asset. Sellpy answers
    // that asset with its current SPA HTML (HTTP 200), which names the fresh asset.
    // Follow only observed first-party references; never evaluate the response.
    while (pending.length && visited.size < 3) {
      const path = pending.shift()!;
      if (visited.has(path)) continue;
      visited.add(path);
      const url = new URL(path, SOURCE_ORIGIN).href;
      const source = await requestText(url, {}, context, 512 * 1024);
      if (/^\s*</.test(source)) {
        pending.push(...paths(source).filter(candidate => !visited.has(candidate)));
        continue;
      }
      const config = parsePublicConfig(source, url);
      cached = { config, expires: Date.now() + ttlMs };
      return config;
    }
    throw contractError('A current Sellpy configuration asset could not be discovered from the frontend references.');
  };
}
