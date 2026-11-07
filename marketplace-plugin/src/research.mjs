import { validateCriteria } from "./engine.mjs";

export const RESEARCH_INACTIVITY_DAYS = 7;
export const RESEARCH_INACTIVITY_MS = RESEARCH_INACTIVITY_DAYS * 86400000;
export const MAX_COLLECTION_SIZE = 1000;

const researchPattern = /^wr_[a-f0-9]{32}$/;
const collectionPattern = /^wc_[a-f0-9]{32}$/;
const encoder = new TextEncoder();

export function researchError(code, message) {
  return Object.assign(new Error(message), { code, recoverable: true });
}

function invalid(message) {
  throw researchError("invalid_research_input", message);
}

function text(value, name, max, allowEmpty = false) {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) invalid(`Invalid ${name}`);
  return value;
}

function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`Invalid ${name}`);
  return value;
}

function list(value, name, max, parse, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(`Invalid ${name}`);
  return value.map(parse);
}

function oneOf(value, values, name) {
  if (!values.includes(value)) invalid(`Invalid ${name}`);
  return value;
}

function listingId(value) {
  const id = text(value, "listing ID", 96);
  if (!/^[\p{L}\p{N}_.:-]+$/u.test(id)) invalid("Invalid listing ID");
  return id;
}

function identifier(value, name) {
  const id = text(value, name, 128);
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) invalid(`Invalid ${name}`);
  return id;
}

function observedTime(value) {
  if (value === undefined) return new Date().toISOString();
  const parsed = Date.parse(text(value, "observation time", 40));
  if (!Number.isFinite(parsed) || parsed > Date.now() + 300000) invalid("Invalid observation time");
  return new Date(parsed).toISOString();
}

function filterValue(value, depth = 0) {
  if (depth > 3) invalid("Research filters are too deeply nested");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    text(value, "filter value", 160, true);
    if (/https?:\/\/|data:|blob:/i.test(value)) invalid("Research filters cannot contain image URLs or data");
    return value;
  }
  if (Array.isArray(value)) return list(value, "filter values", 64, item => filterValue(item, depth + 1));
  if (!value || typeof value !== "object") invalid("Invalid research filters");
  const entries = Object.entries(value);
  if (entries.length > 32) invalid("Too many research filters");
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || /url|base64|imagedata|photodata/i.test(key) || key === "data") invalid("Invalid research filter name");
    return [key, filterValue(item, depth + 1)];
  }));
}

export async function researchHash(value) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function validateResearchId(value) {
  if (typeof value !== "string" || !researchPattern.test(value)) invalid("Invalid researchId");
  return value;
}

export function validateCollectionId(value) {
  if (typeof value !== "string" || !collectionPattern.test(value)) invalid("Invalid collectionId");
  return value;
}

export function validateResearchSource(value) {
  return oneOf(value, ["live", "provided", "demo"], "research source");
}

function detailRecord(record, observedAt) {
  if (!record || typeof record !== "object") invalid("Invalid detail record");
  const fields = [...new Set(list(record.fields, "delivered fields", 64, field => {
    if (typeof field !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(field)) invalid("Invalid delivered field");
    return field;
  }))].sort();
  const result = { id: listingId(record.id), fields, observedAt: observedTime(record.observedAt ?? observedAt) };
  if (record.description !== undefined) {
    if (!fields.includes("description")) invalid("Description accounting requires the delivered description field");
    const deliveredChars = integer(record.description?.deliveredChars, "delivered description characters");
    const totalChars = integer(record.description?.totalChars, "total description characters", deliveredChars);
    if (typeof record.description?.truncated !== "boolean" || record.description.truncated !== (deliveredChars < totalChars)) {
      invalid("Description truncation must match its delivered and total lengths");
    }
    result.description = { deliveredChars, totalChars, truncated: record.description.truncated, observedAt: result.observedAt };
  }
  return result;
}

export async function normalizeResearchEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Invalid research event");
  const type = oneOf(input.type, ["search", "details", "photos", "review", "presentation"], "research event type");
  const event = { eventId: identifier(input.eventId ?? crypto.randomUUID(), "eventId"), type,
    observedAt: observedTime(input.observedAt) };
  if (type === "search") {
    event.searchType = oneOf(input.searchType ?? "text", ["text", "visual"], "search type");
    event.query = text(input.query ?? (event.searchType === "visual" ? "Bildsuche" : ""), "query", 160, true).trim();
    event.filters = filterValue(input.filters ?? {});
    if (Array.isArray(event.filters) || event.filters === null || typeof event.filters !== "object") invalid("Invalid research filters");
    if (encoder.encode(JSON.stringify(event.filters)).length > 4096) invalid("Research filters exceed their metadata budget");
    event.pageSize = integer(input.pageSize, "search page size", 1, 1000);
    event.queryId = input.queryId === undefined
      ? "q_" + await researchHash(JSON.stringify([event.searchType, event.query, event.filters, event.pageSize]))
      : identifier(input.queryId, "queryId");
    event.page = integer(input.page, "search page", 1);
    event.ids = list(input.ids, "search IDs", 1000, listingId);
    event.scannedCount = integer(input.scannedCount ?? event.ids.length, "scanned result count", event.ids.length);
    event.filteredOutCount = integer(input.filteredOutCount ?? 0, "filtered result count", 0, event.scannedCount - event.ids.length);
    event.reportedTotal = input.reportedTotal == null ? null : integer(input.reportedTotal, "reported total");
    if (input.exhausted !== undefined && typeof input.exhausted !== "boolean") invalid("Invalid search exhaustion");
    event.exhausted = input.exhausted ?? false;
    event.nextCursor = input.nextCursor == null ? null : text(input.nextCursor, "search cursor", 8192);
  }
  if (type === "details") {
    event.audience = oneOf(input.audience, ["model", "app"], "detail audience");
    event.records = list(input.records, "detail records", 1000, record => detailRecord(record, event.observedAt));
    event.retrievedIds = [...new Set(list(input.retrievedIds ?? event.records.map(record => record.id), "retrieved IDs", 1000, listingId))];
  }
  if (type === "photos") {
    event.audience = oneOf(input.audience, ["model", "app"], "photo audience");
    event.photos = list(input.photos, "delivered photos", 1000, photo => ({
      id: listingId(photo?.id), index: integer(photo?.index, "photo index"),
      size: oneOf(photo?.size, ["thumbnail", "full"], "photo size"),
      observedAt: observedTime(photo.observedAt ?? event.observedAt),
    }));
  }
  if (type === "review") {
    event.id = listingId(input.id);
    event.photoIndices = [...new Set(list(input.photoIndices, "reviewed photo indices", 1000,
      index => integer(index, "reviewed photo index"), 1))].sort((a, b) => a - b);
    event.findings = text(input.findings, "visual findings", 2000);
    event.evidenceType = "agent-reported";
  }
  if (type === "presentation") event.ids = [...new Set(list(input.ids, "presented IDs", 1000, listingId))];
  if (encoder.encode(JSON.stringify(event)).length > 256 * 1024) invalid("Research event exceeds its metadata budget");
  return event;
}

function observationUrl(value, photo = false) {
  if (value == null) return null;
  text(value, "listing observation URL", 1200);
  let url;
  try { url = new URL(value); } catch { invalid("Invalid listing observation URL"); }
  const allowed = photo
    ? url.hostname === "cache.willhaben.at" && url.pathname.startsWith("/mmo/")
    : ["www.willhaben.at", "willhaben.at"].includes(url.hostname) &&
      (url.pathname.startsWith("/iad/kaufen-und-verkaufen/d/") ||
        (url.pathname === "/iad/object" && /^\d+$/.test(url.searchParams.get("adId") ?? "")));
  if (!allowed || url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    invalid("Listing observations require canonical willhaben URLs");
  }
  return url.href;
}

function compactListing(input, id) {
  if (!input || typeof input !== "object" || input.id !== id) invalid("Listing observation identity mismatch");
  const listing = { id, title: text(input.title, "observed title", 300),
    price: input.price == null ? null : input.price };
  if (listing.price !== null && (!Number.isFinite(listing.price) || listing.price < 0)) invalid("Invalid observed price");
  if (input.url != null) listing.url = observationUrl(input.url);
  for (const [key, max] of Object.entries({ priceType: 20, status: 20, condition: 20, location: 150,
    shipping: 20, category: 160, model: 300, sellerType: 20 })) {
    if (input[key] !== undefined) listing[key] = text(input[key], "observed " + key, max);
  }
  for (const key of ["quantity", "categoryId", "areaId", "imageCount"]) {
    if (input[key] !== undefined) listing[key] = integer(input[key], "observed " + key);
  }
  if (input.shippingCost !== undefined) {
    if (!Number.isFinite(input.shippingCost) || input.shippingCost < 0) invalid("Invalid observed shipping cost");
    listing.shippingCost = input.shippingCost;
  }
  for (const key of ["paylivery", "galleryComplete"]) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") invalid("Invalid observed " + key);
      listing[key] = input[key];
    }
  }
  if (input.attributes !== undefined) {
    if (!input.attributes || typeof input.attributes !== "object" || Array.isArray(input.attributes)) invalid("Invalid observed attributes");
    const entries = Object.entries(input.attributes);
    if (entries.length > 45) invalid("Too many observed attributes");
    listing.attributes = Object.fromEntries(entries.map(([key, value]) => {
      text(key, "observed attribute name", 80);
      if (typeof value === "string") text(value, "observed attribute value", 300, true);
      else if (typeof value !== "boolean" && !Number.isFinite(value)) invalid("Invalid observed attribute value");
      return [key, value];
    }));
  }
  const gallery = input.gallery ?? (input.images ?? []).map((url, index) => ({
    index, url, thumbnailUrl: index === 0 ? input.thumbnailUrl : null,
  }));
  listing.gallery = list(gallery, "observed listing photos", 10000, (photo, index) => ({
    index, url: observationUrl(photo?.url, true), thumbnailUrl: observationUrl(photo?.thumbnailUrl, true),
  }));
  return listing;
}

export function normalizeListingObservations(input = []) {
  const observations = list(input, "listing observations", 200, item => {
    const observation = { id: listingId(item?.id), kind: oneOf(item?.kind, ["search", "detail", "gone"], "observation kind"),
      observedAt: observedTime(item?.observedAt) };
    if (item?.observedAt === undefined) invalid("Listing observations require their original observation time");
    if (observation.kind !== "gone") observation.listing = compactListing(item.listing, observation.id);
    return observation;
  });
  if (encoder.encode(JSON.stringify(observations)).length > 4 * 1024 * 1024) invalid("Listing observations exceed their metadata budget");
  return observations;
}

export function newestListingObservation(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;
  const rank = { search: 0, detail: 1, gone: 2 };
  return incoming.observedAt > current.observedAt ||
    (incoming.observedAt === current.observedAt && rank[incoming.kind] > rank[current.kind]) ? incoming : current;
}

export function normalizeObservationIds(ids) {
  return [...new Set(list(ids, "observed listing IDs", 100, listingId))];
}

export function normalizeResearchRead(args = {}) {
  return { section: oneOf(args.section ?? "summary", ["summary", "queries", "listings"], "research section"),
    limit: integer(args.limit ?? 24, "research page limit", 1, 100), cursor: args.cursor };
}

export function normalizeCollection(args) {
  const result = { collectionId: validateCollectionId(args.collectionId ?? "wc_" + crypto.randomUUID().replaceAll("-", "")),
    title: text(args.title ?? "Angebote", "collection title", 160),
    summary: text(args.summary ?? "", "collection summary", 1000, true) };
  if (args.criteria !== undefined) {
    validateCriteria(args.criteria);
    if (args.criteria.length) {
      result.criteria = args.criteria.map(({ key, value }) => ({
        key,
        value: typeof value === "object"
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value,
      }));
    }
  }
  if (args.selections !== undefined && args.queryIds !== undefined) invalid("Choose selections or queryIds for a collection");
  if (args.selections !== undefined) {
    result.selections = list(args.selections, "collection selections", MAX_COLLECTION_SIZE, selection => {
      const item = { id: listingId(selection?.id) };
      if (selection.reason !== undefined) item.reason = text(selection.reason, "selection reason", 280);
      if (selection.cautions !== undefined) item.cautions = list(selection.cautions, "selection cautions", 3,
        caution => text(caution, "selection caution", 180));
      if (selection.photoIndex !== undefined) item.photoIndex = integer(selection.photoIndex, "selected photo index");
      return item;
    }, 1);
    if (new Set(result.selections.map(item => item.id)).size !== result.selections.length) invalid("Collection selections must have distinct IDs");
  }
  if (args.queryIds !== undefined) result.queryIds = [...new Set(list(args.queryIds, "collection query IDs", 32,
    id => identifier(id, "queryId"), 1))].sort();
  return result;
}

export function normalizeCollectionIds(ids) {
  return [...new Set(list(ids, "collection member IDs", 8, listingId, 1))];
}

export function researchCursor(scope, offset) {
  return "wrp1." + btoa(JSON.stringify([scope, offset])).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function readResearchCursor(cursor, scope) {
  if (cursor === undefined || cursor === null) return 0;
  if (typeof cursor !== "string" || cursor.length > 1024 || !/^wrp1\.[A-Za-z0-9_-]+$/.test(cursor)) invalid("Invalid research cursor");
  try {
    const [actual, offset] = JSON.parse(atob(cursor.slice(5).replaceAll("-", "+").replaceAll("_", "/")));
    if (actual !== scope) invalid("The cursor belongs to a different research page");
    return integer(offset, "research cursor position");
  } catch {
    invalid("Invalid research cursor for this selection");
  }
}

async function researchStub(env, researchId) {
  validateResearchId(researchId);
  if (!env.RESEARCH_SESSIONS) throw researchError("research_unavailable", "Research storage is unavailable. Continue without a saved research session.");
  if (typeof env.REQUEST_LIMIT_KEY !== "string" || !env.REQUEST_LIMIT_KEY || env.REQUEST_LIMIT_KEY.length > 256) {
    throw researchError("research_owner_required", "Research storage requires an authenticated connection scope.");
  }
  const owner = await researchHash(env.REQUEST_LIMIT_KEY);
  return env.RESEARCH_SESSIONS.getByName("research:" + owner + ":" + researchId);
}

async function rpc(stub, method, args) {
  try {
    const response = await stub[method](args);
    if (response.error) throw researchError(response.error.code, response.error.message);
    return response;
  } catch (error) {
    if (error.code) throw error;
    throw researchError("research_unavailable", "Research storage could not complete this operation. Retry with the same researchId and eventId.");
  }
}

export async function ensureResearch(env, { researchId, source = "live" } = {}) {
  if (!env.RESEARCH_SESSIONS && researchId === undefined) return null;
  validateResearchSource(source);
  const created = researchId === undefined;
  researchId ??= "wr_" + crypto.randomUUID().replaceAll("-", "");
  const stub = await researchStub(env, researchId);
  const result = await rpc(stub, created ? "initialize" : "read", created ? { researchId, source } : { section: "summary" });
  if (result.source !== source) throw researchError("research_source_mismatch", "Continue this research with its original source or start a new research session.");
  return result;
}

export async function recordResearch(env, { researchId, event, observations }) {
  return rpc(await researchStub(env, researchId), "append", { ...event, ...(observations ? { observations } : {}) });
}

export async function resolveResearchObservations(env, { researchId, ...args }) {
  return rpc(await researchStub(env, researchId), "resolveObservations", args);
}

export async function getResearch(env, { researchId, ...args }) {
  return rpc(await researchStub(env, researchId), "read", args);
}

export async function saveCollection(env, { researchId, ...args }) {
  return rpc(await researchStub(env, researchId), "saveCollection", args);
}

export async function readCollection(env, { researchId, ...args }) {
  return rpc(await researchStub(env, researchId), "readCollection", args);
}
