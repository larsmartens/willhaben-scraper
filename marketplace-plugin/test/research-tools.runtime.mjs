import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, Response } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const state = await mkdtemp(join(tmpdir(), "willhaben-tool-research-"));
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const outbound = [];
let rejectVisual = false;
const photo = (id, index) => `https://cache.willhaben.at/mmo/fixture-${id}-${index}.png`;
function listing(id, detailed = false) {
  return { id: String(id), verticalId: 5, description: "Fixture Lamp " + id,
    advertStatus: { id: "active" }, attributes: { attribute: [
      { name: "PRICE", values: [String(id % 99 + 1)] },
      { name: "SEO_URL", values: ["kaufen-und-verkaufen/d/fixture-lamp-" + id] },
      ...(detailed ? [{ name: "DESCRIPTION", values: ["Fixture description with an explicit lamp measurement."] }] : []),
    ] }, advertImageList: { advertImage: [0, 1].map(index => ({ id: index + 1,
      mainImageUrl: photo(id, index), thumbnailImageUrl: photo(id, index),
      similarImageSearchUrl: "https://ad-search.willhaben.at/restapi/v2/imagesearch/atz?adId=" + id + "&imageId=" + (index + 1) + "&imageUrl=" + encodeURIComponent(photo(id, index)) + "&rows=30",
    })) } };
}
function html(props) {
  return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: props } }) + "</script>",
    { headers: { "content-type": "text/html" } });
}
const bundle = await build({ absWorkingDir: root, stdin: { contents: `
  import { invokeTool } from './src/tools.mjs';
  export { OriginGate } from './src/origin-gate.mjs';
  export { ResearchSession } from './src/research-session.mjs';
  export default { async fetch(request, env) {
    const { name, args } = await request.json();
    try { return Response.json({ result: await invokeTool(name,args,{...env,REQUEST_DEADLINE:Date.now()+35000}) }); }
    catch(error) { return Response.json({error:{code:error.code,message:error.message}},{status:400}); }
  } };`, resolveDir: root, sourcefile: "research-tools-entry.mjs" },
  bundle: true, format: "esm", platform: "browser", conditions: ["workerd"], external: ["cloudflare:*"], write: false });
const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-06-01",
  durableObjects: { ORIGIN_GATE: { className: "OriginGate", useSQLite: true }, RESEARCH_SESSIONS: { className: "ResearchSession", useSQLite: true } },
  durableObjectsPersist: state, bindings: { REQUEST_LIMIT_KEY: "fixture-owner", LIVE_ACCESS: "personal_test", IMAGE_ACCESS: "personal_test", REQUIRE_ORIGIN_GATE: true },
  outboundService: request => {
    const url = new URL(request.url);
    outbound.push(url.href);
    if (url.origin === "https://cache.willhaben.at") return new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
    assert.equal(url.origin, "https://www.willhaben.at");
    if (rejectVisual && url.pathname.includes("aehnlichkeitssuche")) return new Response("Forbidden", { status: 403 });
    if (url.pathname.includes("marktplatz") || url.pathname.includes("aehnlichkeitssuche")) {
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("rows") ?? 50);
      const start = (page - 1) * size;
      const rows = Array.from({ length: Math.min(size, Math.max(0, 120 - start)) }, (_, index) => listing(1001 + start + index));
      return html({ searchResult: { verticalId: 5, pageRequested: page, rowsRequested: size, rowsReturned: rows.length,
        rowsFound: 120, advertSummaryList: { advertSummary: rows } } });
    }
    const id = url.pathname === "/iad/object" ? url.searchParams.get("adId") : url.pathname.match(/-(\d+)\/?$/)?.[1];
    assert.ok(id, "Expected a fixture detail ID");
    return html({ advertDetails: listing(Number(id), true) });
  },
});
async function call(name, args) {
  const response = await mf.dispatchFetch("https://fixture.invalid/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args }) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error.message), value.error);
  return value.result;
}
try {
  const search = await call("search_listings", { source: "live", query: "Fixture Lamp", pageSize: 100 });
  const researchId = search.researchId;
  assert.equal(search.items.length, 100);
  assert.equal(search.research.counts.uniqueSearchListings, 100);
  assert.equal(search.research.queryCount, 1);
  assert.equal(search.research.counts.descriptionsDeliveredToModel, 0);
  assert.equal(search.research.queries[0].queryId, search.queryId);
  assert.equal(search.continuation.arguments.researchId, researchId);
  assert.equal(search.continuation.arguments.query, "Fixture Lamp");
  assert.equal(search.continuation.arguments.pageSize, 100);
  console.log("PASS search starts an isolated audit with 100 compact results");

  const overview = await call("present_listings", { source: "live", researchId, criteria: [{ key: "condition", value: "used" }] });
  assert.equal(overview.cards.length, 12);
  assert.equal(overview.continuation, undefined);
  assert.equal(overview.total, 100);
  assert.equal(overview._meta.listingImages.length, 2);
  assert.equal(overview.research.counts.uniqueModelPhotoIndices, 0);
  assert.equal(overview.research.counts.uiPhotosLoaded, 2);
  const collectionId = overview.collectionId;
  const next = await call("browse_collection", { researchId, collectionId, action: "page", cursor: overview.nextCursor });
  assert.equal(next.cards.length, 12);
  assert.equal(next.cards[0].id, "1013");
  assert.equal(next._meta.listingImages.length, 0);
  assert.equal(next.total, 100);
  assert.deepEqual(next.criteria, overview.criteria);
  assert.deepEqual(next.cards[0].assessment.evaluation, overview.cards[0].assessment.evaluation);
  console.log("PASS 12-card pages retain the full selection with two eager thumbnails");

  const covers = await call("browse_collection", { researchId, collectionId, action: "covers", ids: ["1003", "1004", "1005", "1006"] });
  assert.equal(covers._meta.listingImages.length, 4);
  assert.equal(covers._images, undefined);
  assert.equal(covers.research.counts.uiPhotosLoaded, 6);
  assert.equal(covers.research.counts.uniqueModelPhotoIndices, 0);
  const beforeForeign = outbound.length;
  await assert.rejects(call("browse_collection", { researchId, collectionId, action: "covers", ids: ["99999"] }), { code: "collection_selection_mismatch" });
  assert.equal(outbound.length, beforeForeign);
  console.log("PASS lazy covers stay app-only and membership rejects foreign IDs before fetch");

  const detail = await call("inspect_listings", { source: "live", researchId, ids: ["1001"], fields: ["description"], descriptionLimit: 8 });
  assert.equal(detail.research.counts.descriptionsDeliveredToModel, 1);
  assert.equal(detail.research.counts.descriptionsTruncated, 1);
  assert.equal(detail.results[0].listing.description.length, 8);
  const modelPhotos = await call("inspect_listing_images", { researchId, id: "1001", count: 2 });
  assert.equal(modelPhotos._images.length, 2);
  assert.equal(modelPhotos.research.counts.uniqueModelPhotoIndices, 2);
  const appPhotos = await call("browse_collection", { researchId, collectionId, action: "photos", id: "1001", count: 2 });
  assert.equal(appPhotos._meta.listingImages.length, 2);
  assert.equal(appPhotos.research.counts.uniqueModelPhotoIndices, 2);
  await call("record_review", { researchId, id: "1001", photoIndices: [0, 1], findings: "Synthetic test evidence" });
  await assert.rejects(call("record_review", { researchId, id: "1001", photoIndices: [2], findings: "Unseen" }), { code: "review_photo_not_delivered" });
  const audit = await call("get_research", { researchId, section: "listings", limit: 1 });
  assert.equal(audit.listings[0].description.deliveredChars, 8);
  assert.equal(audit.listings[0].modelPhotos.length, 2);
  assert.equal(audit.listings[0].findings[0].evidenceType, "agent-reported");
  console.log("PASS projected descriptions, model photos, app photos and declared findings have distinct audit records");

  const visual = await call("search_by_image", { researchId, listingId: "1001", photoIndex: 1 });
  assert.equal(visual.items.length, 50);
  const moreVisual = await call("search_by_image", { researchId, cursor: visual.nextCursor });
  assert.equal(moreVisual.page, 2);
  assert.equal(moreVisual.queryId, visual.queryId);
  assert.equal(moreVisual.research.queryCount, 2);
  const anotherVisual = await call("search_by_image", { researchId, listingId: "1001", photoIndex: 0 });
  assert.notEqual(anotherVisual.queryId, visual.queryId);
  assert.equal(anotherVisual.research.queryCount, 3);
  console.log("PASS visual scopes retain identity across pages and distinguish different photos");

  const sourcePhoto = await call("search_by_image", { listingId: "1199", pageSize: 30 });
  assert.equal(sourcePhoto.research.counts.detailRecordsRetrieved, 1);
  assert.equal(sourcePhoto.research.counts.detailRecordsDeliveredToModel, 0);
  assert.equal(sourcePhoto.research.counts.descriptionsDeliveredToModel, 0);
  const sourceNext = await call(sourcePhoto.continuation.tool, sourcePhoto.continuation.arguments);
  assert.equal(sourceNext.research.counts.detailRecordsRetrieved, 1);
  const sourceLarger = await call("search_by_image", { researchId: sourcePhoto.researchId, listingId: "1199", pageSize: 100 });
  assert.notEqual(sourceLarger.queryId, sourcePhoto.queryId);
  assert.equal(sourceLarger.research.queryCount, 2);
  console.log("PASS image-search source details are audited without claiming model inspection and page sizes have separate scopes");

  const provided = Array.from({ length: 101 }, (_, index) => ({ id: "p-" + index, title: "Fixture Lamp", price: 30, description: "Fixture description", condition: "used" }));
  const supplied = await call("search_listings", { source: "provided", listings: provided, query: "Fixture", pageSize: 100 });
  assert.deepEqual(supplied.continuation.repeatArguments, ["listings"]);
  const suppliedNext = await call(supplied.continuation.tool, { ...supplied.continuation.arguments, listings: provided });
  assert.equal(suppliedNext.items.length, 1);
  const study = await call("study_market", { source: "provided", listings: provided.slice(0, 2), queries: ["Fixture"], maxDetails: 2 });
  assert.equal(study.research.counts.detailRecordsDeliveredToModel, 2);
  assert.equal(study.research.counts.descriptionsDeliveredToModel, 0);
  console.log("PASS supplied-data cursors bind the dataset and study evidence counts only delivered projections");

  rejectVisual = true;
  await assert.rejects(call("search_by_image", { researchId: sourcePhoto.researchId, listingId: "1198" }), { code: "upstream_forbidden" });
  const afterFailure = await call("get_research", { researchId: sourcePhoto.researchId });
  assert.equal(afterFailure.counts.detailRecordsRetrieved, 2);
  assert.equal(afterFailure.counts.detailRecordsDeliveredToModel, 0);
  console.log("PASS successful source-detail retrieval stays audited when the following visual search fails");
} finally {
  await mf.dispose();
  await rm(state, { recursive: true, force: true });
}
