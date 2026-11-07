import {
  buildSearchLink, getProvider, parseSearchUrl, PERSONAL_TEST, DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE, FILTER_SCHEMA, LISTING_SCHEMA, validateFilters,
} from "./providers.mjs";
import { runStudy, evaluateListing, validateCriteria } from "./engine.mjs";
import { createCursor, readCursor } from "./cursors.mjs";
import { galleryOf, imageBatch, pausesBatch, readGallery, toolFailure } from "./images.mjs";
import { presentListings } from "./presentation.mjs";
import { PRESENTATION_URI } from "./presentation-ui.mjs";
import { ensureResearch, recordResearch, getResearch, saveCollection, readCollection, resolveResearchObservations } from "./research.mjs";
import { VISUAL_IMAGE_SCHEMA } from "./visual-search.mjs";

const string = maxLength => ({ type: "string", minLength: 1, maxLength });
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const array = (items, minItems, maxItems) => ({ type: "array", items, minItems, maxItems });
const object = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const choice = (...values) => ({ type: "string", enum: values });
const boolean = { type: "boolean" };
const cursor = { ...string(512), description: "Copy nextCursor from this tool and repeat the original selection arguments." };
const researchId = { type: "string", pattern: "^wr_[a-f0-9]{32}$",
  description: "Reuse the researchId returned by the first search for every related search, detail, photo and presentation call in this task." };
const collectionId = { type: "string", pattern: "^wc_[a-f0-9]{32}$" };
const researchCursor = string(4096);
const overviewPageSize = { type: "integer", enum: [12, 24], default: 12 };
const queries = array(string(150), 1, 8);
const criteria = array(object({ key: string(64), value: { anyOf: [
  string(100), { type: "number" }, boolean,
  { ...object({ min: { type: "number" }, max: { type: "number" } }), minProperties: 1 },
] } }, ["key", "value"]), 0, 12);
const source = {
  ...choice("live", "provided", "demo"),
  description: "Use live for current marketplace listings. Provided covers submitted records. Use demo only for an explicitly requested synthetic demonstration.",
};
const data = { source, listings: array(LISTING_SCHEMA, 0, 300) };
const fresh = { ...boolean, default: false, description: "Bypass cached observations when current availability or price is important." };
const search = { ...data, query: { type: "string", maxLength: 160 }, filters: FILTER_SCHEMA, fresh };
const pageSize = { ...integer(1, MAX_PAGE_SIZE), default: DEFAULT_PAGE_SIZE };
const spec = { ...data, queries, filters: FILTER_SCHEMA, criteria, pageSize, fresh,
  maxPages: integer(1, 32), maxDetails: integer(0, 100) };
const handle = { type: "string", pattern: "^ms_[a-f0-9]{32}$" };
const photoId = { ...string(20), pattern: "^[0-9]{1,20}$" };
const photoIndex = integer(0, Number.MAX_SAFE_INTEGER);
const presentationSelection = object({ id: string(96), reason: string(280),
  cautions: array(string(180), 0, 3), photoIndex }, ["id"]);
const summaryFields = ["title", "url", "price", "priceType", "location", "condition", "status", "model",
  "category", "categoryId", "areaId", "sellerType", "paylivery", "shipping", "imageCount", "hasPhotos",
  "thumbnailUrl", "galleryComplete", "publishedAt", "seller"];
const detailFields = [...summaryFields, "description", "attributes", "gallery", "quantity", "shippingCost"];
const fields = names => ({ ...array(choice(...names), 1, names.length), uniqueItems: true,
  description: "Select output fields. The listing ID is always included." });
const defaultSummary = ["title", "url", "price", "location", "status", "imageCount"];
const defaultDetails = [...defaultSummary, "priceType", "condition", "description", "attributes"];
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const online = { ...read, openWorldHint: true };
const def = (name, title, description, inputSchema, annotations = read) => ({ name, title, description, inputSchema, annotations });

export const toolDefinitions = [
  def("plan_search", "Suche vorbereiten",
    "Plan search variants and native links when scope or connection availability needs clarification. For a known query, call search_listings directly.",
    object({ queries, filters: FILTER_SCHEMA }, ["queries"])),
  def("parse_search_url", "Such-URL übernehmen",
    "Convert a willhaben Marketplace search URL into supported search arguments without fetching it. Review unsupportedParameters before treating the imported scope as exact.",
    object({ url: string(6000) }, ["url"])),
  def("discover_filters", "Filter ermitteln",
    "Discover category, location and other native filter values. Default output is an overview with three examples per dimension. Select dimension or filter, optionally valueQuery, to inspect values in repeatable batches.",
    object({ ...search, dimension: string(100), filter: string(64), valueQuery: string(120),
      limit: { ...integer(1, 50), default: 10 }, cursor }, ["source", "query"]), online),
  def("search_listings", "Inserate suchen",
    "Read one compact result page, 50 listings by default and at most 100. Follow continuation for further pages and carry researchId through this task. Select fields and images for the next decision. thumbnails reads covers for imageIds from this page or the first imageLimit results with photos. A full-size fallback is marked full. A null total means unknown. Local text filters can leave an empty page with more results in nextCursor.",
    object({ ...search, pageSize, cursor, fields: fields(summaryFields),
      images: { ...choice("none", "links", "thumbnails"), default: "none" },
      imageLimit: { ...integer(1, 8), default: 4 },
      imageIds: { ...array(string(96), 1, 8), uniqueItems: true } }, ["source", "query"]), online),
  def("inspect_listings", "Inserate prüfen",
    "Inspect selected IDs with descriptions, attributes and criterion evidence. Defaults to five details per call. Supply up to 100 IDs and repeat nextCursor to inspect every ID. Select fields or attributeKeys for focused checks. gallery returns eight links and a nextIndex for inspect_listing_images.",
    object({ ...data, ids: array(string(96), 1, 100), criteria,
      limit: { ...integer(1, 10), default: 5 }, cursor, fields: fields(detailFields),
      attributeKeys: { ...array(string(80), 1, 45), uniqueItems: true },
      descriptionLimit: { ...integer(1, 6000), default: 1500,
        description: "When descriptionTruncated is true, increase this to 6000 to read the retained description." }, fresh }, ["source", "ids"]), online),
  def("inspect_listing_images", "Inseratfotos ansehen",
    "Read actual photos or links from one listing gallery. Defaults to four full-size photos. Use nextIndex as start to reach every photo, or request precise zero-based indices. Each call returns at most eight photos. Unscaled photos provide visual evidence, while dimensions require explicit listing evidence.",
    object({ id: photoId, start: photoIndex, count: { ...integer(1, 8), default: 4 },
      indices: { ...array(photoIndex, 1, 8), uniqueItems: true },
      size: { ...choice("thumbnail", "full"), default: "full" },
      mode: { ...choice("images", "links"), default: "images" }, fresh }, ["id"]), online),
  def("inspect_listing_image", "Ein Inseratfoto ansehen",
    "Retrieve one zero-based photo index for compatibility. Prefer inspect_listing_images for gallery browsing and batched visual comparisons.",
    object({ id: photoId, index: photoIndex, fresh }, ["id", "index"]), online),
  {
    ...def("present_listings", "Angebote mit Bildern präsentieren",
      "Show 12 offers initially, optionally 24 per page, with original photos, facts, links and research coverage. Pass researchId for all observed results or queryIds for selected searches. Use selections for a ranked selection with reasons or open questions. The user can page through the collection and open galleries. For missingIds, refresh the relevant search with the same researchId and fresh=true, then repeat the presentation. Keep offer facts and photos in the app cards. Finish a display request with one plain sentence pointing to them. For requested advice, add decision analysis. Inspect actual image blocks before visual claims. Search summaries provide the initial overview, and the app loads its cover photos.",
      object({ ...data, researchId, selections: array(presentationSelection, 1, 1000),
        queryIds: array(string(100), 1, 32), pageSize: overviewPageSize,
        title: string(100), summary: string(400), criteria }, ["source"]), online),
    _meta: {
      ui: { resourceUri: PRESENTATION_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": PRESENTATION_URI,
      "openai/widgetAccessible": true,
      "openai/toolInvocation/invoking": "Angebote werden dargestellt",
      "openai/toolInvocation/invoked": "Angebote mit Bildern bereit",
    },
  },
  def("study_market", "Marktstudie rechnen",
    "Deduplicate search variants, evaluate explicit criteria and compare observed asking-price cohorts. Live defaults to one search page in total and zero details. Request-scoped coverage and continuation describe any unfinished search. Each call permits up to 32 search pages in total and 100 details within its time budget.",
    object(spec, ["source", "queries"]), online),
  def("save_study", "Studie für Folgefragen speichern",
    "On an explicit save request, run a study and store its report, search terms and criteria for 24 hours on Cloudflare. Anyone holding its secret study ID can read it.",
    object(spec, ["source", "queries"]), { ...online, readOnlyHint: false, idempotentHint: false }),
  def("get_study", "Gespeicherte Studie lesen",
    "Read a saved report with its original observation time. Keep the secret study ID private.",
    object({ study_id: handle }, ["study_id"])),
  def("compare_studies", "Zwei Studien vergleichen",
    "Compare saved observations, coverage, cohort sizes and asking-price changes. Report changed search definitions and incomplete membership.",
    object({ before: handle, after: handle }, ["before", "after"])),
];

for (const name of ["search_listings", "inspect_listings", "inspect_listing_images", "inspect_listing_image", "study_market", "save_study"]) {
  toolDefinitions.find(tool => tool.name === name).inputSchema.properties.researchId = researchId;
}

toolDefinitions.push(
  {
    ...def("search_by_image", "Mit Foto suchen",
      "Use willhaben's native visual search to find similar offers. Start with exactly one image attachment, public HTTPS imageUrl, or listingId with a zero-based photoIndex. Attachment inputs are downloaded and normalized outside the model context. Continue with nextCursor alone and the same researchId. The default is 50 compact listings, at most 100 per page. Results are native similarity matches and still need requirement checks. Pass the researchId to present_listings for a photo overview.",
      object({ image: VISUAL_IMAGE_SCHEMA, imageUrl: string(6000), listingId: photoId, photoIndex,
        filters: FILTER_SCHEMA, pageSize, cursor: researchCursor, fields: fields(summaryFields), researchId, fresh }), online),
    _meta: { "openai/fileParams": ["image"] },
  },
  def("get_research", "Rechercheumfang anzeigen",
    "Read the current research audit. Summary gives compact counters, queries gives native totals and retrieved pages per query, listings gives delivered fields, description lengths, exact photo indices and documented findings. Counts distinguish server retrieval, delivery to ChatGPT and display in the app. Use section and cursor for precise follow-up.",
    object({ researchId, section: { ...choice("summary", "queries", "listings"), default: "summary" },
      limit: { ...integer(1, 100), default: 24 }, cursor: researchCursor }, ["researchId"])),
  def("record_review", "Fotoprüfung dokumentieren",
    "Record your actual visual findings after receiving the selected image blocks through inspect_listing_images or search thumbnails. Supply the precise zero-based photoIndices and a concise evidence-grounded finding. The audit labels this as an agent-reported review and rejects photo indices not previously delivered to ChatGPT in this research.",
    object({ researchId, id: string(96), photoIndices: { ...array(photoIndex, 1, 32), uniqueItems: true },
      findings: string(2000) }, ["researchId", "id", "photoIndices", "findings"]),
    { ...read, readOnlyHint: false, idempotentHint: false }),
  {
    ...def("browse_collection", "Angebotsübersicht bedienen",
      "Load a saved offer page, visible covers, selected gallery photos or a focused detail view for the app. Photo bytes are app metadata. Every selected ID must belong to this research collection.",
      object({ researchId, collectionId, action: choice("page", "covers", "photos", "details"),
        cursor: researchCursor, pageSize: overviewPageSize,
        ids: { ...array(string(96), 1, 8), uniqueItems: true }, id: string(96),
        start: photoIndex, count: { ...integer(1, 8), default: 4 },
        indices: { ...array(photoIndex, 1, 8), uniqueItems: true } }, ["researchId", "collectionId", "action"]), online),
    _meta: { ui: { visibility: ["app"] }, "openai/widgetAccessible": true },
  },
);

for (const name of ["inspect_listings", "inspect_listing_images", "get_research"]) {
  toolDefinitions.find(tool => tool.name === name)._meta = {
    ui: { visibility: ["model", "app"] }, "openai/widgetAccessible": true,
  };
}

function invalid(message) {
  throw Object.assign(new TypeError(message), { code: "invalid_input", recoverable: false });
}

function checkValue(value, schema, name) {
  if (schema.anyOf) {
    for (const candidate of schema.anyOf) {
      try { checkValue(value, candidate, name); return; } catch { /* Try the next valid schema. */ }
    }
    invalid("Invalid " + name);
  }
  if (schema.enum && !schema.enum.includes(value)) invalid("Invalid " + name);
  if (schema.type === "null" && value !== null) invalid("Invalid " + name);
  if (schema.type === "string" && (typeof value !== "string" ||
      value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) ||
      (schema.minLength && !value.trim()) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) invalid("Invalid " + name);
  if (schema.type === "boolean" && typeof value !== "boolean") invalid("Invalid " + name);
  if (["integer", "number"].includes(schema.type) && (!Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isSafeInteger(value)) ||
      value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) invalid("Invalid " + name);
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity) ||
        (schema.uniqueItems && new Set(value).size !== value.length)) invalid("Invalid " + name);
    value.forEach(item => checkValue(item, schema.items, name));
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Invalid " + name);
    if (Object.keys(value).length < (schema.minProperties ?? 0) || Object.keys(value).length > (schema.maxProperties ?? Infinity)) invalid("Invalid " + name);
    for (const key of schema.required ?? []) if (value[key] === undefined) invalid("Missing " + name + "." + key);
    if (schema.properties) {
      for (const [key, entry] of Object.entries(value)) {
        if (Object.hasOwn(schema.properties, key)) checkValue(entry, schema.properties[key], name + "." + key);
        else if (schema.additionalProperties === false) invalid("Unknown argument " + name + "." + key +
          ". Use the available fields " + Object.keys(schema.properties).join(", "));
      }
    }
  }
}

function checkArgs(name, args) {
  const definition = toolDefinitions.find(tool => tool.name === name);
  if (!definition) invalid("Unknown tool");
  checkValue(args, definition.inputSchema, "arguments");
  if (args.filters !== undefined) validateFilters(args.filters);
  if (args.source !== undefined && (args.source === "provided") !== (args.listings !== undefined)) invalid("Pass listings exactly when source is provided");
  if (args.criteria !== undefined) validateCriteria(args.criteria);
  if (args.ids?.some(id => !/^[A-Za-z0-9_-]{1,96}$/.test(id) || (args.source === "live" && !/^\d{1,20}$/.test(id)))) invalid("Invalid listing ID");
  if (name === "present_listings") {
    if (!args.selections && !args.researchId) invalid("Pass selections or an existing researchId to present observed offers");
    if (args.selections && args.queryIds) invalid("Use selections or queryIds in one presentation");
    if (args.source === "provided" && (!args.selections || args.selections.length > 24)) invalid("Select up to 24 provided offers for one presentation");
  }
  if (args.selections) {
    const selectedIds = args.selections.map(selection => selection.id);
    if (new Set(selectedIds).size !== selectedIds.length) invalid("Each presentation selection must use a different listing ID");
    if (selectedIds.some(id => !/^[A-Za-z0-9_-]{1,96}$/.test(id) || args.source === "live" && !/^\d{1,20}$/.test(id))) invalid("Invalid listing ID");
  }
  if (name === "browse_collection") {
    if (args.action === "covers" && !args.ids?.length) invalid("Cover loading requires ids");
    if (["photos", "details"].includes(args.action) && !args.id) invalid("Gallery and detail loading require id");
    if (args.action === "page" && (args.ids || args.id || args.indices || args.start !== undefined || args.count !== undefined)) invalid("Page loading accepts pagination arguments");
  }
  if (args.indices && (args.start !== undefined || args.count !== undefined)) invalid("Use indices or start/count in one photo request");
  if (args.dimension !== undefined && args.filter !== undefined) invalid("Select dimension or filter in one discovery request");
  if (args.imageLimit !== undefined && args.images !== "thumbnails") invalid("imageLimit requires images=thumbnails");
  if (args.imageIds && (args.images !== "thumbnails" || args.imageLimit !== undefined)) invalid("Use imageIds with images=thumbnails and omit imageLimit");
  if (args.imageIds?.some(id => !/^[A-Za-z0-9_-]{1,96}$/.test(id) || (args.source === "live" && !/^\d{1,20}$/.test(id)))) invalid("Invalid cover listing ID");
  if (args.attributeKeys && args.fields && !args.fields.includes("attributes")) invalid("Include attributes in fields when selecting attributeKeys");
}

const scope = {
  demo: "Synthetic demonstration catalogue",
  provided: "Submitted listings with unknown upstream marketplace coverage",
  live: "Observed willhaben search scope during this run",
};
const ttl = 86400;
const requestDeadline = env => Math.min(Date.now() + 35000, Number.isFinite(env.REQUEST_DEADLINE) ? env.REQUEST_DEADLINE : Infinity);
const datasetIdentity = args => ({ source: args.source, ...(args.source === "provided" ? { listings: args.listings } : {}) });
const searchIdentity = args => ({ ...datasetIdentity(args), query: args.query.trim(),
  filters: { ...args.filters, ...(args.filters?.attributeIds ? { attributeIds: [...args.filters.attributeIds].sort((a, b) => a - b) } : {}) },
  pageSize: args.pageSize ?? DEFAULT_PAGE_SIZE });
const observation = provider => ({ source: provider.kind, scope: scope[provider.kind] });

function projectListing(row, selection, { descriptionLimit = 1500, attributeKeys } = {}) {
  const selected = { id: row.id };
  for (const key of selection) {
    if (key === "imageCount") selected.imageCount = row.imageCount ?? galleryOf(row).length;
    else if (key === "hasPhotos") selected.hasPhotos = (row.imageCount ?? galleryOf(row).length) > 0;
    else if (key === "description" && typeof row.description === "string") {
      selected.description = row.description.slice(0, descriptionLimit);
      selected.descriptionLength = Math.max(row.descriptionLength ?? 0, row.description.length);
      selected.descriptionTruncated = Boolean(row.descriptionTruncated || selected.description.length < selected.descriptionLength);
    } else if (key === "attributes" && row.attributes) {
      selected.attributes = attributeKeys
        ? Object.fromEntries(attributeKeys.filter(name => Object.hasOwn(row.attributes, name)).map(name => [name, row.attributes[name]]))
        : row.attributes;
    } else if (key === "gallery") {
      const gallery = galleryOf(row);
      selected.gallery = { total: gallery.length, items: gallery.slice(0, 8), nextIndex: gallery.length > 8 ? 8 : null };
    } else if (Object.hasOwn(row, key) && row[key] !== undefined) selected[key] = row[key];
  }
  if (selection.includes("imageCount") && row.galleryComplete !== undefined) selected.galleryComplete = row.galleryComplete;
  return selected;
}

function plan(args, env) {
  const filters = { ...args.filters }, verifyInDetail = {};
  for (const key of ["shipping", "paylivery"]) {
    if (filters[key] !== undefined && key === "paylivery" && filters[key] === false) {
      verifyInDetail[key] = filters[key];
      delete filters[key];
    }
  }
  const personal = env.LIVE_ACCESS === PERSONAL_TEST;
  const authorized = env.LIVE_ACCESS === "authorized" && Boolean(env.MCP_BEARER_TOKEN);
  return {
    source: "search_plan", liveAvailable: personal || authorized,
    imageAvailable: personal && env.IMAGE_ACCESS === PERSONAL_TEST || authorized && env.IMAGE_ACCESS === "authorized",
    ...(personal ? { mode: PERSONAL_TEST } : {}), resultCount: null, filtersInLinks: filters, verifyInDetail,
    defaults: { pageSize: DEFAULT_PAGE_SIZE, maxPageSize: MAX_PAGE_SIZE, detailsPerCall: 5, photosPerCall: 4, overviewCards: 12, overviewPageMax: 24 },
    searches: [...new Set(args.queries.map(query => query.trim()))].map(query => ({ query,
      url: buildSearchLink(query, filters), webQuery: "site:willhaben.at/iad/kaufen-und-verkaufen/d/ " + query })),
    guidance: "Search one compact page, inspect promising IDs, then request relevant photos. Continue with nextCursor or nextIndex as needed. Report observed coverage and respect retryAt when returned.",
  };
}

async function parseUrl(args) {
  const parsed = parseSearchUrl(args.url);
  const searchArguments = { source: "live", query: parsed.query, filters: parsed.filters, pageSize: parsed.pageSize };
  if (parsed.page > 1) searchArguments.cursor = await createCursor("search", searchIdentity(searchArguments), parsed.page);
  return { ...parsed, searchArguments,
    ...(parsed.fullyRepresented ? {} : { nextStep: "Resolve unsupportedParameters before claiming the imported search scope is exact." }) };
}

function dimensionsOf(facets) {
  if (!Array.isArray(facets.dimensions)) {
    return Object.entries(facets.dimensions ?? {}).map(([id, values]) => ({
      id, label: id, values: values.map(value => ({ ...value,
        ...(Object.hasOwn(FILTER_SCHEMA.properties, id) ? { filter: id } : { searchText: String(value.value) }) })), truncated: false,
    }));
  }
  const seen = new Set();
  return facets.dimensions.map((dimension, index) => {
    let id = String(dimension.id || "dimension-" + index);
    if (seen.has(id)) id += "-" + index;
    seen.add(id);
    return { ...dimension, id };
  });
}

const folded = value => String(value ?? "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replaceAll("ß", "ss");

async function discover(args, env, provider) {
  const identity = { ...datasetIdentity(args), query: args.query.trim(), filters: args.filters ?? {},
    dimension: args.dimension, filter: args.filter, valueQuery: args.valueQuery ?? "" };
  const offset = await readCursor(args.cursor, "facets", identity, 0);
  const facets = await provider.facets({ query: args.query, filters: args.filters ?? {},
    fresh: args.fresh ?? false, deadline: requestDeadline(env) });
  const dimensions = dimensionsOf(facets);
  const limit = args.limit ?? 10;
  const common = { ...observation(provider), query: args.query.trim(), observedAt: facets.observedAt,
    cacheAgeSeconds: facets.cacheAgeSeconds ?? 0, total: facets.total ?? null };
  if (args.dimension || args.filter || args.valueQuery) {
    const selected = dimensions.filter(dimension => args.dimension ? dimension.id === args.dimension
      : args.filter ? dimension.values.some(value => value.filter === args.filter) : true);
    if (!selected.length && (args.dimension || args.filter)) {
      return { ...common, status: "selection_required", reason: "Unknown dimension or filter for this search.",
        availableDimensions: dimensions.slice(0, 10).map(({ id, label }) => ({ id, label })),
        dimensionCount: dimensions.length, nextStep: "Call discover_filters with the same search and omit dimension and filter to browse the overview." };
    }
    const needle = folded(args.valueQuery);
    const values = selected.flatMap(dimension => dimension.values
      .filter(value => (!args.filter || value.filter === args.filter) &&
        (!needle || folded([value.label, value.value].join(" ")).includes(needle)))
      .map(value => ({ dimension: dimension.id, ...value })));
    const returned = values.slice(offset, offset + limit);
    const next = offset + returned.length;
    return { ...common, mode: "values", matchingValues: values.length, offset, values: returned,
      upstreamTruncated: selected.some(dimension => dimension.truncated === true),
      nextCursor: next < values.length ? await createCursor("facets", identity, next) : null };
  }
  const returned = dimensions.slice(offset, offset + limit).map(dimension => ({
    id: dimension.id, label: dimension.label, valueCount: dimension.values.length,
    filterable: dimension.values.some(value => value.filter),
    examples: dimension.values.slice(0, 3), upstreamTruncated: dimension.truncated === true,
  }));
  const next = offset + returned.length;
  return { ...common, mode: "overview", dimensionCount: dimensions.length, offset, dimensions: returned,
    nextCursor: next < dimensions.length ? await createCursor("facets", identity, next) : null };
}

function coverOf(row) {
  const first = galleryOf(row)[0];
  const thumbnailUrl = row.thumbnailUrl ?? first?.thumbnailUrl;
  const url = thumbnailUrl ?? first?.url;
  return url ? { url, size: thumbnailUrl ? "thumbnail" : "full" } : null;
}

async function searchListings(args, env, provider) {
  const identity = searchIdentity(args);
  const pageNumber = await readCursor(args.cursor, "search", identity, 1);
  if (pageNumber < 1) invalid("Search pages start at one");
  const deadline = requestDeadline(env);
  const page = await provider.search({ query: args.query, filters: args.filters ?? {},
    cursor: String(pageNumber), pageSize: identity.pageSize, fresh: args.fresh ?? false, deadline });
  const selectedFields = args.fields ?? defaultSummary;
  const items = page.items.map(row => {
    const item = projectListing(row, selectedFields);
    if (args.images === "links") item.coverImage = coverOf(row);
    return item;
  });
  const result = { ...observation(provider), query: args.query.trim(), observedAt: page.observedAt,
    ...(page.researchQueryId ? { queryId: page.researchQueryId } : {}),
    cacheAgeSeconds: page.cacheAgeSeconds ?? 0, page: pageNumber,
    requestedPageSize: page.requestedPageSize ?? identity.pageSize, returnedCount: items.length,
    ...(page.upstreamPageSize !== undefined ? { upstreamPageSize: page.upstreamPageSize } : {}),
    total: page.total, end: page.end, items,
    ...(page.scannedCount !== undefined ? { scannedCount: page.scannedCount, filteredOutCount: page.filteredOutCount ?? 0, totalScope: page.totalScope, localFilterScope: page.localFilterScope } : {}),
    nextCursor: page.nextCursor == null ? null : await createCursor("search", identity, Number(page.nextCursor)) };
  if (args.images === "thumbnails") {
    const selected = args.imageIds ? args.imageIds.map(id => {
      const row = page.items.find(item => item.id === id);
      if (!row) invalid("imageIds must identify listings on the current result page");
      return row;
    }) : page.items.filter(row => coverOf(row)).slice(0, args.imageLimit ?? 4);
    const requests = selected.map(row => ({ id: row.id, index: 0, ...coverOf(row) }));
    const batch = await imageBatch(requests, env, { deadline });
    result.coverImages = { results: batch.results, errors: batch.errors, stopReason: batch.stopReason,
      remainingIds: requests.slice(batch.processed).map(request => request.id) };
    result._images = batch._images;
  }
  return result;
}

async function inspectListings(args, env, provider) {
  const ids = [...new Set(args.ids)];
  const identity = { ...datasetIdentity(args), ids };
  const offset = await readCursor(args.cursor, "details", identity, 0);
  if (offset >= ids.length) invalid("The detail cursor is outside this ID selection");
  const deadline = requestDeadline(env);
  const end = Math.min(ids.length, offset + (args.limit ?? 5));
  const results = [], errors = [];
  let position = offset, stopReason = null;
  while (position < end) {
    if (Date.now() >= deadline) { stopReason = "time_budget"; break; }
    const id = ids[position];
    try {
      const row = await provider.detail(id, { fresh: args.fresh ?? false, deadline });
      results.push(row ? { id, observedAt: row.observedAt ?? null, cacheAgeSeconds: row.cacheAgeSeconds ?? 0,
        listing: projectListing(row, args.fields ?? defaultDetails, args), evaluation: evaluateListing(row, args.criteria ?? []) }
        : { id, status: "unavailable" });
      position++;
    } catch (cause) {
      const error = { id, ...toolFailure(cause) };
      errors.push(error);
      if (pausesBatch(error)) { stopReason = error.code; break; }
      position++;
    }
  }
  const remainingCount = ids.length - position;
  const retry = errors.find(error => error.retryAt);
  return { ...observation(provider), observedAt: new Date().toISOString(),
    status: remainingCount || errors.length ? "partial" : "complete", results, errors,
    requestedCount: ids.length, processedCount: position - offset, remainingCount,
    failedIds: errors.map(error => error.id), stopReason: stopReason ?? (remainingCount ? "batch_size" : null),
    nextCursor: remainingCount ? await createCursor("details", identity, position) : null,
    ...(retry ? { retryAt: retry.retryAt, retryAfterSeconds: retry.retryAfterSeconds } : {}) };
}

async function readSaved(id, env) {
  if (typeof id !== "string" || !/^ms_[a-f0-9]{32}$/.test(id)) invalid("Invalid study ID");
  if (!env.STUDIES) throw new Error("Snapshot storage is not configured");
  const value = await env.STUDIES.get(id, "json");
  if (!value || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) {
    throw new Error("Study unavailable or expired. A new snapshot may take a moment to propagate.");
  }
  return value;
}

function signature(value) {
  if (Array.isArray(value)) return value.map(signature);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, signature(value[key])]));
  return value;
}

function compare(before, after) {
  const beforeDefinition = { ...before.definition }, afterDefinition = { ...after.definition };
  delete beforeDefinition.fresh;
  delete afterDefinition.fresh;
  const sameDefinition = JSON.stringify(signature(beforeDefinition)) === JSON.stringify(signature(afterDefinition));
  const key = cohort => JSON.stringify([cohort.category, cohort.model, cohort.condition, cohort.basis]);
  const previous = new Map(before.report.cohorts.map(cohort => [key(cohort), cohort]));
  return {
    sameDefinition,
    before: { observedAt: before.report.observedAt, coverage: before.report.coverage.status, counts: before.report.counts },
    after: { observedAt: after.report.observedAt, coverage: after.report.coverage.status, counts: after.report.counts },
    guidance: "Medians describe observed asking-price cohorts. A changed cohort can reflect composition. The samples alone do not establish sales or price revisions of individual listings.",
    cohorts: after.report.cohorts.map(cohort => {
      const old = previous.get(key(cohort));
      return { category: cohort.category, model: cohort.model, condition: cohort.condition, basis: cohort.basis,
        before: old?.askingEUR ?? null, after: cohort.askingEUR,
        medianChangeEUR: sameDefinition && Number.isFinite(old?.askingEUR?.median) && Number.isFinite(cohort.askingEUR?.median)
          ? Math.round((cohort.askingEUR.median - old.askingEUR.median) * 100) / 100 : null };
    }),
    previousOnlyCohorts: before.report.cohorts.filter(cohort => !after.report.cohorts.some(next => key(cohort) === key(next)))
      .map(cohort => ({ category: cohort.category, model: cohort.model, condition: cohort.condition, basis: cohort.basis })),
  };
}

async function study(name, args, env, provider) {
  if (name === "save_study" && !env.STUDIES) throw new Error("Snapshot storage is not configured");
  const definition = { source: args.source, queries: args.queries, filters: args.filters ?? {}, criteria: args.criteria ?? [],
    pageSize: args.pageSize ?? DEFAULT_PAGE_SIZE, fresh: args.fresh ?? false,
    maxPages: args.maxPages ?? (args.source === "live" ? 1 : 12),
    maxDetails: args.maxDetails ?? (args.source === "live" ? 0 : 8) };
  const report = await runStudy(provider, definition, { deadline: requestDeadline(env) });
  for (const query of report.coverage.queries) {
    if (!query.continuation) continue;
    const identity = searchIdentity({ ...args, query: query.query, pageSize: definition.pageSize });
    query.continuation = { ...query.continuation, tool: "search_listings", pageSize: definition.pageSize, ...(args.researchId ? {researchId:args.researchId} : {}),
      cursor: await createCursor("search", identity, Number(query.continuation.cursor ?? 1)) };
  }
  if (name === "study_market") return report;
  const study_id = "ms_" + crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const value = JSON.stringify({ definition, report, expiresAt });
  if (new TextEncoder().encode(value).length > 700000) throw new Error("Report too large to save; narrow the study");
  await env.STUDIES.put(study_id, value, { expirationTtl: ttl });
  return { study_id, expiresAt, report };
}

async function coverageFor(env, researchId) {
  return getResearch(env, { researchId });
}

async function recordPhotos(env, researchId, result, audience) {
  const records = result.coverImages?.results ?? result.results ?? [];
  const photos = records.filter(row => Number.isSafeInteger(row.imageContentIndex)).map(row => ({
    id: row.id, index: row.index, size: row.size, observedAt: result.observedAt,
  }));
  if (photos.length) await recordResearch(env, { researchId, event: { type: "photos", audience, photos } });
}

function trackedProvider(provider, env, researchId, audience = "model", listings) {
  if (!researchId) return provider;
  return {
    ...provider,
    async search(options) {
      const page = await provider.search(options);
      const nextCursor = page.nextCursor == null ? null : await createCursor("search",
        searchIdentity({ source: provider.kind, listings, query: options.query, filters: options.filters, pageSize: options.pageSize }), Number(page.nextCursor));
      const logged = await recordResearch(env, { researchId,
        observations: provider.kind === "live" ? page.items.map(row => ({
          id: row.id, kind: "search", observedAt: page.observedAt, listing: row,
        })) : undefined,
        event: {
          type: "search", query: options.query, filters: options.filters, searchType: "text",
          page: Number(options.cursor ?? 1), pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
          ids: page.items.map(row => row.id), scannedCount: page.scannedCount,
          filteredOutCount: page.filteredOutCount, reportedTotal: page.total, exhausted: page.end === true,
          nextCursor, observedAt: page.observedAt,
        } });
      return { ...page, researchQueryId: logged.queryId };
    },
    async detail(id, options) {
      const row = await provider.detail(id, { ...options, includeGone: true });
      if (row) await recordResearch(env, { researchId,
        observations: provider.kind === "live" ? [{ id: row.id, kind: row.gone ? "gone" : "detail",
          observedAt: row.observedAt, ...(!row.gone ? { listing: row } : {}) }] : undefined,
        event: {
          type: "details", audience, retrievedIds: row.gone ? [] : [row.id], records: [], observedAt: row.observedAt,
        } });
      return row?.gone ? null : row;
    },
  };
}

async function visualSearch(args, env, provider) {
  const page = await provider.searchByImage({ ...args, deadline: requestDeadline(env) });
  const result = { ...observation(provider), visual: page.visual,
    observedAt: page.observedAt, cacheAgeSeconds: page.cacheAgeSeconds ?? 0,
    page: page.page ?? page.pageNumber ?? 1, requestedPageSize: page.requestedPageSize ?? args.pageSize ?? DEFAULT_PAGE_SIZE,
    returnedCount: page.items.length, total: page.total, end: page.end,
    items: page.items.map(row => projectListing(row, args.fields ?? defaultSummary)), nextCursor: page.nextCursor,
    ...(page.scannedCount !== undefined ? { scannedCount: page.scannedCount, filteredOutCount: page.filteredOutCount ?? 0, totalScope: page.totalScope, localFilterScope: page.localFilterScope } : {}),
  };
  if (args.researchId) {
    const descriptor = page.visual?.listingId ? "Inseratfoto " + page.visual.listingId + " / " + (page.visual.photoIndex ?? 0)
      : page.visual?.source === "attachment" ? "Hochgeladenes Bild" : "Bild aus öffentlicher URL";
    const logged = await recordResearch(env, { researchId: args.researchId,
      observations: page.items.map(row => ({ id: row.id, kind: "search", observedAt: page.observedAt, listing: row })),
      event: {
        type: "search", searchType: "visual", query: descriptor,
        queryId: page.visual?.searchId ?? page.visual?.pictureKey,
        filters: page.filters ?? args.filters ?? {}, page: result.page, pageSize: result.requestedPageSize,
        ids: page.items.map(row => row.id), scannedCount: page.scannedCount,
        filteredOutCount: page.filteredOutCount, reportedTotal: page.total, exhausted: page.end === true,
        nextCursor: page.nextCursor, observedAt: page.observedAt,
      } });
    result.queryId = logged.queryId;
  }
  return result;
}

async function presentationProvider(provider, env, researchId, selections) {
  if (!researchId || provider.kind !== "live") return provider;
  const ids = selections.map(selection => selection.id);
  const cached = await Promise.allSettled(ids.map(id => provider.summaryObservation(id, { deadline: requestDeadline(env) })));
  const resolved = await resolveResearchObservations(env, { researchId, ids,
    observations: cached.filter(result => result.status === "fulfilled" && result.value).map(result => result.value) });
  const byId = new Map(resolved.observations.map(observation => [observation.id, observation]));
  const errors = new Map(cached.flatMap((result, index) => result.status === "rejected" ? [[ids[index], result.reason]] : []));
  return {
    ...provider,
    async summary(id) {
      const observation = byId.get(id);
      if (observation?.kind === "gone") return null;
      if (observation) return { ...observation.listing, observedAt: observation.observedAt,
        cacheAgeSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(observation.observedAt)) / 1000)) };
      if (errors.has(id)) throw errors.get(id);
      return null;
    },
  };
}

async function present(args, env, provider) {
  if (args.researchId && provider.kind !== "provided") {
    const collection = await saveCollection(env, { researchId: args.researchId,
      selections: args.selections, queryIds: args.queryIds, title: args.title, summary: args.summary, criteria: args.criteria });
    const page = await readCollection(env, { researchId: args.researchId,
      collectionId: collection.collectionId, pageSize: args.pageSize ?? 12 });
    const observed = await presentationProvider(provider, env, args.researchId, page.selections);
    const result = await presentListings({ ...args, selections: page.selections }, env, observed);
    const { selections, ...navigation } = page;
    return { ...result, ...navigation, requestedCount: page.total, shownCount: result.cards.length };
  }
  if (!args.selections) invalid("This connection needs explicit selections for presentation");
  if (args.selections.length > 24) invalid("A saved researchId is required to page through more than 24 offers");
  return presentListings({ ...args, hydrationLimit: args.selections.length }, env, provider);
}

function appImages(result) {
  const { _images = [], ...data } = result;
  return { ...data, _meta: { ...data._meta, listingImages: (result.results ?? []).flatMap(row => {
    const image = _images[row.imageContentIndex - 1];
    return image ? [{ id: row.id, index: row.index, size: row.size, mimeType: image.mimeType, data: image.data }] : [];
  }) } };
}

async function browseCollection(args, env) {
  const page = await readCollection(env, { researchId: args.researchId, collectionId: args.collectionId,
    pageSize: args.pageSize ?? 12, cursor: args.cursor,
    ...(args.action === "covers" ? { ids: args.ids } : args.action === "page" ? {} : { ids: [args.id] }) });
  let provider = trackedProvider(getProvider(page.source, env), env, args.researchId, "app");
  if (["page", "covers"].includes(args.action)) provider = await presentationProvider(provider, env, args.researchId, page.selections);
  let result;
  if (args.action === "page") {
    const rendered = await presentListings({ selections: page.selections, title: page.title,
      summary: page.summary, criteria: page.criteria, hydrationLimit: 0 }, env, provider);
    const { selections, ...navigation } = page;
    result = { ...rendered, ...navigation, requestedCount: page.total };
    await recordResearch(env, { researchId: args.researchId, event: { type: "presentation", ids: rendered.cards.map(card => card.id) } });
  } else if (args.action === "covers") {
    if (!args.ids?.length) invalid("Cover loading requires ids");
    const requests = [], missingIds = [];
    for (const selection of page.selections) {
      const row = await provider.summary(selection.id, { deadline: requestDeadline(env) });
      const index = selection.photoIndex ?? 0;
      const photo = galleryOf(row)[index];
      const url = photo?.url ?? photo?.thumbnailUrl;
      if (url) requests.push({ id: selection.id, index, url,
        size: photo.url ? "full" : "thumbnail", thumbnailUrl: photo.thumbnailUrl });
      else missingIds.push(selection.id);
    }
    const batch = await imageBatch(requests, env, { deadline: requestDeadline(env) });
    await recordPhotos(env, args.researchId, batch, "app");
    result = appImages({ ...batch, missingIds, remainingIds: requests.slice(batch.processed).map(row => row.id) });
  } else if (args.action === "photos") {
    if (!args.id) invalid("Gallery loading requires id");
    const gallery = await readGallery({ id: args.id, start: args.start, count: args.count,
      indices: args.indices, mode: "images", size: "full" }, env, provider);
    await recordPhotos(env, args.researchId, gallery, "app");
    result = appImages(gallery);
  } else {
    if (!args.id) invalid("Detail loading requires id");
    result = await inspectListings({ source: page.source, ids: [args.id], limit: 1,
      fields: [...defaultDetails, "seller", "shipping", "shippingCost", "quantity"], descriptionLimit: 6000 }, env, provider);
    await recordDetails(env, args.researchId, result, "app");
  }
  return { ...result, researchId: args.researchId, collectionId: args.collectionId,
    research: await coverageFor(env, args.researchId) };
}

async function recordDetails(env, researchId, result, audience) {
  const records = result.results.filter(row => row.listing).map(row => ({
    id: row.id, fields: Object.keys(row.listing).filter(key => key !== "id"),
    ...(row.observedAt ? { observedAt: row.observedAt } : {}),
    ...(typeof row.listing.description === "string" ? { description: {
      deliveredChars: row.listing.description.length, totalChars: row.listing.descriptionLength,
      truncated: row.listing.descriptionTruncated,
    } } : {}),
  }));
  if (records.length) await recordResearch(env, { researchId, event: { type: "details", audience, records } });
}

async function dispatch(name, args, env, provider) {
  if (name === "inspect_listing_images") return readGallery(args, env, provider);
  if (name === "inspect_listing_image") {
    const result = await readGallery({ ...args, indices: [args.index] }, env, provider);
    if (!result._images.length && result.errors.length) {
      const { message, ...error } = result.errors[0];
      throw Object.assign(new Error(message), error);
    }
    return { ...result, index: args.index, url: result.results[0]?.url ?? null };
  }
  if (name === "present_listings") return present(args, env, provider);
  if (name === "discover_filters") return discover(args, env, provider);
  if (name === "search_listings") return searchListings(args, env, provider);
  if (name === "search_by_image") return visualSearch(args, env, provider);
  if (name === "inspect_listings") return inspectListings(args, env, provider);
  return study(name, args, env, provider);
}

function continuationFor(name, args, nextCursor) {
  if (!nextCursor || !["search_listings", "inspect_listings", "search_by_image"].includes(name)) return {};
  const { listings, image, imageUrl, listingId, photoIndex, imageIds, ...next } = args;
  if (name === "search_by_image") {
    delete next.filters;
    delete next.pageSize;
  }
  if (imageIds) next.images = "none";
  return { continuation: { tool: name, arguments: { ...next, cursor: nextCursor },
    ...(listings ? { repeatArguments: ["listings"] } : {}) } };
}

export async function invokeTool(name, args, env = {}) {
  checkArgs(name, args);
  if (name === "plan_search") return plan(args, env);
  if (name === "parse_search_url") return parseUrl(args);
  if (name === "get_study") return readSaved(args.study_id, env);
  if (name === "compare_studies") return compare(await readSaved(args.before, env), await readSaved(args.after, env));
  if (name === "get_research") return getResearch(env, args);
  if (name === "record_review") return recordResearch(env, { researchId: args.researchId,
    event: { type: "review", id: args.id, photoIndices: args.photoIndices, findings: args.findings } });
  if (name === "browse_collection") return browseCollection(args, env);
  const source = ["inspect_listing_images", "inspect_listing_image", "search_by_image"].includes(name) ? "live" : args.source;
  const session = name !== "discover_filters" && (env.REQUEST_LIMIT_KEY || args.researchId)
    ? await ensureResearch(env, { researchId: args.researchId, source }) : null;
  args = session ? { ...args, researchId: session.researchId } : args;
  const provider = trackedProvider(getProvider(source, env, args.listings), env, session?.researchId, "model", args.listings);
  const result = await dispatch(name, args, env, provider);
  if (!session) return result;
  const id = session.researchId;
  if (name === "inspect_listings") await recordDetails(env, id, result, "model");
  if (["study_market", "save_study"].includes(name)) {
    const report = result.report ?? result;
    const records = [...report.shortlist, ...report.unknown, ...report.excluded]
      .filter(row => row.detailed).map(row => ({ id: row.id, fields: Object.keys(row).filter(key => key !== "id"),
        ...(row.observedAt ? { observedAt: row.observedAt } : {}) }));
    if (records.length) await recordResearch(env, { researchId: id, event: { type: "details", audience: "model", records } });
  }
  if (result._images?.length) await recordPhotos(env, id, result, "model");
  if (name === "present_listings") {
    await recordResearch(env, { researchId: id, event: { type: "presentation", ids: result.cards.map(card => card.id) } });
    const photos = (result._meta?.listingImages ?? []).map(photo => ({ id: photo.id, index: photo.index,
      size: result.cards.find(card => card.id === photo.id)?.image.size ?? "thumbnail" }));
    if (photos.length) await recordResearch(env, { researchId: id, event: { type: "photos", audience: "app", photos } });
  }
  return { ...result, researchId: id, research: await coverageFor(env, id),
    ...continuationFor(name, args, result.nextCursor) };
}
