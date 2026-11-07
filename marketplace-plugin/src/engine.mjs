// Provider contract: end is explicit, a missing total is null, and cursors are opaque.
const MAX_QUERIES = 8;
const MAX_CRITERIA = 12;
const MIN_COMPARABLE = 5;
const SOURCE_SCOPE = {
  demo: 'Synthetic demonstration catalogue only',
  provided: 'Only supplied records, searched during the run. Coverage of the marketplace is unknown.',
  live: 'Live search variants during the observation interval. Listings may change between requests.'
};
const stopProvider = code => ['upstream_rate_limited','upstream_cooldown','upstream_busy','upstream_denied','upstream_blocked','upstream_forbidden','upstream_unavailable','upstream_timeout','live_access_not_configured','traffic_not_configured','traffic_unavailable','time_budget'].includes(code);
const primitive = v => typeof v === 'string' || typeof v === 'boolean' || Number.isFinite(v);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const norm = v => typeof v === 'string' ? v.normalize('NFKC').trim().toLocaleLowerCase('de-AT').replace(/\s+/g, ' ') : v;
const money = v => Number.isFinite(v) && v >= 0 && v <= 1e11;
const cent = v => Math.round((v + Number.EPSILON) * 100) / 100;
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype', 'description', 'url', 'images', 'attributes', 'sellerName', 'phone', 'email']);
const fieldNames = new Set(['id', 'title', 'price', 'quantity', 'shippingCost', 'condition', 'status', 'location', 'shipping', 'category', 'categoryId', 'areaId', 'sellerType', 'paylivery', 'model', 'priceType']);

function invalid(message) {
  return Object.assign(new TypeError(message), { code: 'invalid_input' });
}

function limit(v, fallback, min, max, name) {
  if (v === undefined) return fallback;
  if (!Number.isSafeInteger(v) || v < min || v > max) throw invalid(`${name} must be between ${min} and ${max}`);
  return v;
}

export function validateCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length > MAX_CRITERIA) throw invalid('criteria must contain at most 12 entries');
  for (const c of criteria) {
    if (!object(c) || typeof c.key !== 'string' || !/^[\p{L}][\p{L}\d _.-]{0,63}$/u.test(c.key) || forbiddenKeys.has(c.key)) {
      throw invalid('Invalid criterion key');
    }
    const v = c.value;
    if (primitive(v) && (typeof v !== 'string' || (v.trim().length && v.length <= 100))) continue;
    if (object(v) && Object.keys(v).length && Object.keys(v).every(k => (k === 'min' || k === 'max') && Number.isFinite(v[k])) &&
        !(v.min !== undefined && v.max !== undefined && v.min > v.max)) continue;
    throw invalid('A criterion needs a short scalar or an inclusive numeric min/max range');
  }
}

function field(listing, key) {
  if (fieldNames.has(key) && Object.hasOwn(listing, key) && primitive(listing[key])) {
    return { actual: listing[key], evidence: key };
  }
  if (object(listing.attributes) && Object.hasOwn(listing.attributes, key) && primitive(listing.attributes[key])) {
    return { actual: listing.attributes[key], evidence: `attributes.${key}` };
  }
  return { actual: null, evidence: null };
}

// Accept measurements only from a named structured property, with an explicit unit.
const dimensions = {
  diameterMm: ['Durchmesser','Kugeldurchmesser'], diameter_mm: ['Durchmesser','Kugeldurchmesser'],
  openingMm: ['Öffnungsdurchmesser','Durchmesser Öffnung'], opening_mm: ['Öffnungsdurchmesser','Durchmesser Öffnung'],
  storageGb: ['Speicher','Speicherkapazität']
};
const labels = {
  shape: {round:'round',rund:'round', kugel:'spherical', kugelförmig:'spherical', spherical:'spherical', sphere:'spherical',
    zylinder:'cylinder', zylindrisch:'cylinder', cylinder:'cylinder', rechteckig:'rectangular', rectangular:'rectangular'},
  finish: {matte:'matte', matt:'matte', mattiert:'matte', glossy:'glossy', glänzend:'glossy', clear:'clear', klar:'clear'}
};

function trait(listing, key) {
  let result = field(listing,key);
  const aliases = Object.hasOwn(dimensions,key) ? dimensions[key]
    : key === 'shape' ? ['Form'] : key === 'finish' ? ['Oberfläche'] : [];
  if (!aliases.length) return result;
  if (result.actual === null && object(listing.attributes)) {
    const entries = Object.entries(listing.attributes).filter(([k]) => aliases.some(alias => norm(k) === norm(alias)));
    if (entries.length !== 1) return result;
    const [[name,value]] = entries;
    result = {actual:value, evidence:`attributes.${name}`};
  }
  if (result.actual === null) return result;
  const raw = result.actual;
  if (Object.hasOwn(dimensions,key)) {
    // A number under an explicitly unit-bearing canonical key is already normalized.
    if (Number.isFinite(raw) && result.evidence === `attributes.${key}`) return result;
    const match = typeof raw === 'string' && /^(\d+(?:[.,]\d+)?)\s*(mm|cm|gb)$/i.exec(raw.trim());
    const unit = match && norm(match[2]);
    const compatible = key === 'storageGb' ? unit === 'gb' : ['mm','cm'].includes(unit);
    result.actual = compatible ? Number(match[1].replace(',', '.')) * (unit === 'cm' ? 10 : 1) : null;
  } else {
    const translations = labels[key], normalized = norm(raw);
    result.actual = typeof normalized === 'string' && Object.hasOwn(translations,normalized) ? translations[normalized] : null;
  }
  if (raw !== result.actual && primitive(raw)) result.sourceValue = typeof raw === 'string' ? text(raw,120) : raw;
  return result;
}

function check(listing, { key, value }, filter = false) {
  const evidenceField = trait(listing,key);
  let { actual, evidence } = evidenceField;
  let status = 'unknown';
  if (actual !== null && !(typeof actual === 'string' && ['', 'unknown', 'unbekannt'].includes(norm(actual)))) {
    if (object(value)) {
      if (typeof actual === 'number') status = (value.min === undefined || actual >= value.min) && (value.max === undefined || actual <= value.max) ? 'confirmed' : 'contradicted';
    } else if (typeof actual === typeof value) {
      let expected = norm(value);
      if (Object.hasOwn(labels,key) && typeof expected === 'string' && Object.hasOwn(labels[key],expected)) expected = labels[key][expected];
      const matches = norm(actual) === expected || (key === 'shape' && actual === 'spherical' && expected === 'round') ||
        (filter && key === 'shipping' && actual === 'both' && ['shipping', 'pickup'].includes(value));
      status = matches ? 'confirmed' : key === 'shape' && actual === 'round' && expected === 'spherical' ? 'unknown' : 'contradicted';
    }
  }
  if (typeof actual === 'string') actual = text(actual, 120);
  return { key, expected: value, actual, status, evidence, ...(Object.hasOwn(evidenceField,'sourceValue') ? {sourceValue:evidenceField.sourceValue} : {}), ...(filter ? { origin: 'filter' } : {}) };
}

function verdict(checks) {
  if (checks.some(c => c.status === 'contradicted')) return 'contradicted';
  return checks.some(c => c.status === 'unknown') ? 'unknown' : 'confirmed';
}

export function evaluateListing(listing, criteria = []) {
  if (!object(listing)) throw invalid('Expected a listing object');
  validateCriteria(criteria);
  const checks = criteria.map(c => check(listing, c));
  return { status: verdict(checks), criteria: checks };
}

function observe(listing, criteria, filters) {
  const checks = criteria.map(c => check(listing, c));
  if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
    const value = {};
    if (filters.priceMin !== undefined) value.min = filters.priceMin;
    if (filters.priceMax !== undefined) value.max = filters.priceMax;
    checks.push(check(listing, { key: 'price', value }, true));
  }
  for (const key of ['condition', 'shipping', 'sellerType', 'paylivery', 'categoryId', 'areaId']) {
    if (filters[key] === undefined) continue;
    const f = check(listing, { key, value: filters[key] }, true);
    // A leaf ID alone cannot disprove a selected parent category or region.
    if ((key === 'categoryId' || key === 'areaId') && f.status === 'contradicted') {
      const path = listing[key === 'categoryId' ? 'categoryPathIds' : 'areaPathIds'];
      f.status = Array.isArray(path) && path.includes(filters[key]) ? 'confirmed' : 'unknown';
    }
    checks.push(f);
  }
  for (const id of filters.attributeIds ?? []) {
    const present = Array.isArray(listing.attributeIds);
    checks.push({key:'attributeId', expected:id, actual:present && listing.attributeIds.includes(id) ? id : null,
      status:present ? listing.attributeIds.includes(id) ? 'confirmed' : 'contradicted' : 'unknown',
      evidence:present ? 'attributeIds' : null, origin:'filter'});
  }
  return { status: verdict(checks), criteria: checks };
}

function validateListing(l) {
  return object(l) && typeof l.id === 'string' && l.id.trim().length > 0 && l.id.length <= 128 &&
    typeof l.title === 'string' && l.title.trim().length > 0 && (l.price === null || money(l.price));
}

function validatePage(page) {
  return object(page) && Array.isArray(page.items) && page.items.length <= 200 && page.items.every(validateListing) &&
    (page.total === null || (Number.isSafeInteger(page.total) && page.total >= 0)) &&
    typeof page.end === 'boolean' &&
    (page.end ? page.nextCursor === null : typeof page.nextCursor === 'string' && page.nextCursor.length > 0 && page.nextCursor.length <= 4096);
}

const errorCode = error => typeof error?.code === 'string' && /^[a-z_]{2,55}$/.test(error.code) ? error.code : 'provider_error';

function retryInfo(error) {
  return {
    ...(Number.isFinite(error?.retryAfterSeconds) && error.retryAfterSeconds >= 0 ? {retryAfterSeconds:error.retryAfterSeconds} : {}),
    ...(typeof error?.retryAt === 'string' && Number.isFinite(Date.parse(error.retryAt)) ? {retryAt:error.retryAt} : {}),
    ...(error?.recoverable === true ? {recoverable:true} : {}),
  };
}

async function collect(provider, queries, filters, budget, pageSize, fresh, deadline) {
  const states = queries.map(query => ({query, cursor: null, seenCursors: new Set(), ids: new Set(), raw: 0,
    pages: 0, reported: null, stop: null, changed: false}));
  const listings = new Map();
  let remaining = budget;
  let providerStopped = null;
  let retry = {};
  while (remaining && !providerStopped && states.some(s => !s.stop)) {
    for (const s of states) {
      if (!remaining || providerStopped) break;
      if (s.stop) continue;
      if (Date.now() >= deadline) { providerStopped = 'time_budget'; break; }
      remaining--;
      let page;
      try {
        page = await provider.search({ query: s.query, filters, cursor: s.cursor, pageSize, fresh });
      } catch (error) {
        s.stop = errorCode(error);
        if (stopProvider(s.stop)) { providerStopped = s.stop; retry = retryInfo(error); }
        continue;
      }
      if (!validatePage(page)) { s.stop = 'upstream_schema'; continue; }
      s.pages++;
      if (page.total !== null) {
        if (s.reported !== null && page.total !== s.reported) s.changed = true;
        s.reported = page.total;
      }
      for (const item of page.items) {
        s.raw++;
        s.ids.add(item.id);
        const observation = {
          ...item,
          observedAt:item.observedAt ?? page.observedAt,
          cacheAgeSeconds:item.cacheAgeSeconds ?? page.cacheAgeSeconds ?? 0,
          cacheHit:item.cacheHit ?? page.cacheHit ?? false,
        };
        const current = listings.get(item.id);
        if (!current || (Date.parse(observation.observedAt) || 0) > (Date.parse(current.observedAt) || 0)) {
          listings.set(item.id, observation);
        }
      }
      if (page.end) {
        if (s.changed) s.stop = 'total_changed';
        else if (page.totalScope !== 'upstream_before_local_filters' && s.reported !== null && s.reported !== s.ids.size) s.stop = 'total_mismatch';
        else s.stop = 'exhausted';
      } else if (s.seenCursors.has(page.nextCursor)) s.stop = 'repeated_cursor';
      else { s.seenCursors.add(page.nextCursor); s.cursor = page.nextCursor; }
    }
  }
  return {
    listings, providerStopped, retry,
    queries: states.map(s => {
      const stopReason = s.stop ?? providerStopped ?? 'page_budget';
      return {query:s.query, pages:s.pages, raw:s.raw, unique:s.ids.size, reportedTotal:s.reported,
        totalChanged:s.changed, stopReason,
        ...(['page_budget','time_budget','upstream_rate_limited','upstream_cooldown','upstream_busy','upstream_unavailable','upstream_timeout','traffic_unavailable'].includes(stopReason)
          ? {continuation:{cursor:s.cursor,firstPage:s.cursor === null},...retry} : {})};
    }),
  };
}

function publicUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.port || u.username || u.password || !['www.willhaben.at','willhaben.at'].includes(u.hostname)) return null;
    return u.href.slice(0, 600);
  } catch { return null; }
}

function pricing(l) {
  const quantity = Number.isSafeInteger(l.quantity) && l.quantity > 0 ? l.quantity : null;
  const price = money(l.price) ? l.price : null;
  const unit = quantity && price !== null ? cent(price / quantity) : null;
  const shipping = money(l.shippingCost) ? l.shippingCost : null;
  const allInUnit = unit !== null && shipping !== null ? cent((price + shipping) / quantity) : null;
  return { askingEUR:price, quantity, unitEUR:unit, shippingEUR:shipping, shippedUnitEUR:allInUnit };
}

function summary(l, evaluation, detailed) {
  return { id:l.id, title:text(l.title, 180), url:publicUrl(l.url), model:text(l.model, 100) || null,
    location:text(l.location, 100) || null, condition:text(l.condition, 60) || null, status:text(l.status, 60) || null,
    priceType:text(l.priceType, 30) || null,
    ...(l.observedAt ? {observedAt:l.observedAt,cacheAgeSeconds:l.cacheAgeSeconds ?? 0} : {}),
    detailed, ...pricing(l), verdict:evaluation.status, evidence:evaluation.criteria };
}

function exclusion(l, price) {
  if (['sold','reserved','inactive','deleted','expired','verkauft','reserviert'].includes(norm(l.status))) return 'not_available';
  if (price.askingEUR === null || l.priceType === 'on_request') return 'unpriced';
  if (price.askingEUR === 0 || l.priceType === 'free') return 'free';
  return null;
}

function quantile(sorted, p) {
  const i = (sorted.length - 1) * p, lo = Math.floor(i);
  return cent(sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo));
}

function stats(values, comparable) {
  if (!values.length) return { n:0 };
  const sorted = [...values].sort((a,b) => a-b);
  return { n:sorted.length, min:sorted[0], max:sorted.at(-1),
    ...(comparable && sorted.length >= MIN_COMPARABLE ? { p25:quantile(sorted,.25), median:quantile(sorted,.5), p75:quantile(sorted,.75) } : {}) };
}

function addCohort(cohorts, l, p) {
  const category = text(l.category, 100) || (l.categoryId ? String(l.categoryId) : null);
  const model = text(l.model, 100) || null;
  const condition = text(l.condition, 60) || null;
  const basis = p.quantity === null ? 'per_ad_quantity_unknown' : 'per_item';
  const key = JSON.stringify([norm(category), norm(model), norm(condition), basis]);
  if (!cohorts.has(key)) cohorts.set(key, { category, model, condition, basis, asking:[], shipped:[] });
  const c = cohorts.get(key);
  c.asking.push(p.unitEUR ?? p.askingEUR);
  if (p.shippedUnitEUR !== null) c.shipped.push(p.shippedUnitEUR);
  return key;
}

export async function runStudy(provider, spec, {deadline = Date.now() + 35000} = {}) {
  const startedAt = new Date().toISOString();
  if (!object(spec) || !Array.isArray(spec.queries) || !spec.queries.length || spec.queries.length > MAX_QUERIES ||
      spec.queries.some(q => typeof q !== 'string' || !q.trim() || q.length > 150)) throw invalid('Supply 1–8 search phrases, 1–150 characters each');
  const criteria = spec.criteria ?? [];
  validateCriteria(criteria);
  const filters = spec.filters ?? {};
  if (!object(filters)) throw invalid('filters must be an object');
  if (['priceMin','priceMax'].some(k => k in filters && !money(filters[k])) || filters.priceMin > filters.priceMax) throw invalid('Invalid price range');
  const maxPages = limit(spec.maxPages, 12, 1, 32, 'maxPages');
  const maxDetails = limit(spec.maxDetails, 8, 0, 100, 'maxDetails');
  const pageSize = limit(spec.pageSize, 50, 1, 100, 'pageSize');
  const queries = [...new Set(spec.queries.map(q => q.trim()))];
  const { listings, queries:reports, providerStopped, retry } = await collect(provider, queries, filters, maxPages, pageSize, spec.fresh === true, deadline);
  const records = [...listings.values()].map(l => ({ l, evaluation:observe(l, criteria, filters), detailed:false }));
  // Detail requests are spent first on candidates whose hard requirements are still unverified.
  const pending = records.filter(r => r.evaluation.status !== 'contradicted');
  pending.sort((a,b) => Number(b.evaluation.status === 'unknown') - Number(a.evaluation.status === 'unknown'));
  let details = 0, failed = 0, detailStop = providerStopped;
  const detailErrors = Object.create(null);
  let detailRetry = retry;
  for (const r of pending) {
    if (details >= maxDetails || detailStop) break;
    if (Date.now() >= deadline) { detailStop = 'time_budget'; break; }
    details++;
    try {
      const detail = await provider.detail(r.l.id, {fresh:spec.fresh === true});
      if (!detail || detail.id !== r.l.id || !validateListing(detail)) throw Object.assign(new Error(), {code: detail ? 'upstream_schema' : 'detail_unavailable'});
      if ((Date.parse(detail.observedAt) || 0) >= (Date.parse(r.l.observedAt) || 0)) {
        r.l = detail;
        r.evaluation = observe(r.l, criteria, filters);
        r.detailed = true;
      }
    } catch (error) {
      const code = errorCode(error);
      r.detailError = code;
      detailErrors[code] = (detailErrors[code] ?? 0) + 1;
      if (stopProvider(code)) { detailStop = code; detailRetry = retryInfo(error); }
      failed++;
    }
  }
  const counts = { raw:reports.reduce((n,q) => n+q.raw, 0), unique:records.length, confirmed:0, unknown:0, contradicted:0,
    priceEligible:0, detailsAttempted:details, detailsFetched:details-failed, detailsFailed:failed };
  const byStatus = {confirmed:[], unknown:[], contradicted:[]};
  const exceptions = Object.create(null), cohortMap = new Map(), rowCohorts = new Map();
  for (const r of records) {
    const {l, evaluation} = r;
    counts[evaluation.status]++;
    const row = summary(l, evaluation, r.detailed);
    if (r.detailError) row.detailError = r.detailError;
    const reason = r.detailError === 'detail_unavailable' ? 'no_longer_verified' : exclusion(l, row);
    if (reason) row.pricingExclusion = reason;
    byStatus[evaluation.status].push(row);
    if (evaluation.status === 'confirmed') {
      if (reason) exceptions[reason] = (exceptions[reason] ?? 0) + 1;
      else { counts.priceEligible++; rowCohorts.set(row, addCohort(cohortMap, l, row)); }
    }
  }
  const cohortStats = new Map([...cohortMap].map(([key,c]) => {
    const comparable = [c.category,c.model,c.condition].every(v => v && !['unknown','unbekannt'].includes(norm(v))) && c.basis === 'per_item';
    return [key, {category:c.category, model:c.model, condition:c.condition, basis:c.basis,
      comparable:comparable && c.asking.length >= MIN_COMPARABLE, askingEUR:stats(c.asking,comparable), shippedEUR:stats(c.shipped,comparable)}];
  }));
  const cohorts = [...cohortStats.values()].sort((a,b) => b.askingEUR.n-a.askingEUR.n);
  for (const [row,key] of rowCohorts) {
    const cohort = cohortStats.get(key);
    if (cohort.comparable && cohort.askingEUR.median > 0) row.priceContext = {
      sampleSize:cohort.askingEUR.n, medianUnitEUR:cohort.askingEUR.median,
      belowMedianPercent:cent(100 * (cohort.askingEUR.median-row.unitEUR) / cohort.askingEUR.median),
    };
  }
  for (const group of Object.values(byStatus)) group.sort((a,b) => Number(!!a.pricingExclusion)-Number(!!b.pricingExclusion) ||
    (a.unitEUR ?? a.askingEUR ?? Infinity) - (b.unitEUR ?? b.askingEUR ?? Infinity) || a.id.localeCompare(b.id));
  const searchExhausted = reports.every(r => r.stopReason === 'exhausted');
  const observations = records.map(r => r.l.observedAt).filter(value => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort();
  const remainingDetailIds = pending.filter(r => !r.detailed).map(r => r.l.id);
  return {source:provider.kind, startedAt, observedAt:new Date().toISOString(), request:{queries,filters,criteria,maxPages,maxDetails,pageSize},
    ...(observations.length ? {dataFreshness:{oldestObservationAt:observations[0],newestObservationAt:observations.at(-1),cachedRecords:records.filter(r => r.l.cacheHit === true || r.l.cacheAgeSeconds > 0).length}} : {}),
    coverage:{status:searchExhausted ? 'exhausted' : 'partial', scope:SOURCE_SCOPE[provider.kind],
      ...(reports.some(r => r.continuation) ? {continuationScope:'A later search_listings call is a separate observation; it does not extend this snapshot.'} : {}),
      searchExhausted, detailsComplete:remainingDetailIds.length === 0, queries:reports, detailErrors, detailStop, ...detailRetry,
      remainingDetailIds, detailsUnexamined:remainingDetailIds.length},
    counts, pricing:{currency:'EUR', kind:'asking', minimumComparable:MIN_COMPARABLE, excluded:exceptions, cohortsTotal:cohorts.length},
    cohorts:cohorts.slice(0,32), shortlist:byStatus.confirmed.slice(0,24), unknown:byStatus.unknown.slice(0,16), excluded:byStatus.contradicted.slice(0,12) };
}
