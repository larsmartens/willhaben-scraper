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
let oversizedPhotoId = null;
let unavailablePhotoId = null;
let deletedListingId = null;
let detailReplacement = null;
const photo = (id, index) => `https://cache.willhaben.at/mmo/fixture-${id}-${index}.png`;
const thumbnail = (id, index) => `https://cache.willhaben.at/mmo/fixture-${id}-${index}_thumb.png`;
function listing(id, detailed = false) {
  return { id: String(id), verticalId: 5, description: "Fixture Lamp " + id,
    advertStatus: { id: "active" }, attributes: { attribute: [
      { name: "PRICE", values: [String(id % 99 + 1)] },
      { name: "SEO_URL", values: ["kaufen-und-verkaufen/d/fixture-lamp-" + id] },
      ...(Number(id) === 1001 ? [{ name: "Modell", values: ["M".repeat(300)] }] : []),
      ...(detailed ? [{ name: "DESCRIPTION", values: ["Fixture description with an explicit lamp measurement."] }] : []),
    ] }, advertImageList: { advertImage: [0, 1].map(index => ({ id: index + 1,
      mainImageUrl: photo(id, index), thumbnailImageUrl: thumbnail(id, index),
      similarImageSearchUrl: "https://ad-search.willhaben.at/restapi/v2/imagesearch/atz?adId=" + id + "&imageId=" + (index + 1) + "&imageUrl=" + encodeURIComponent(photo(id, index)) + "&rows=30",
    })) } };
}
function html(props) {
  return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: props } }) + "</script>",
    { headers: { "content-type": "text/html" } });
}
const bundle = await build({ absWorkingDir: root, stdin: { contents: `
  import { invokeTool } from './src/tools.mjs';
  import { ensureResearch, recordResearch, resolveResearchObservations } from './src/research.mjs';
  import { OriginGate as BaseOriginGate } from './src/origin-gate.mjs';
  export class OriginGate extends BaseOriginGate {
    expireForTest() {
      this.ctx.storage.sql.exec('UPDATE observations SET expires_at = 0');
      return { expired: true };
    }
  }
  export { ResearchSession } from './src/research-session.mjs';
  export default { async fetch(request, env) {
    const { name, args } = await request.json();
    try {
      let result;
      if (name === '__test_expire_cache') result = await env.ORIGIN_GATE.getByName('https://www.willhaben.at').expireForTest();
      else if (name === '__test_observations') result = await resolveResearchObservations(env,args);
      else if (name === '__test_legacy') {
        result = await ensureResearch(env,{source:'live'});
        await recordResearch(env,{researchId:result.researchId,event:{type:'search',query:'Legacy',page:1,pageSize:50,ids:['1001','1999']}});
      } else result = await invokeTool(name,args,{...env,REQUEST_DEADLINE:Date.now()+35000});
      return Response.json({ result });
    }
    catch(error) { return Response.json({error:{code:error.code,message:error.message}},{status:400}); }
  } };`, resolveDir: root, sourcefile: "research-tools-entry.mjs" },
  bundle: true, format: "esm", platform: "browser", conditions: ["workerd"], external: ["cloudflare:*"], write: false });
const runtimeOptions = { modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-06-01",
  durableObjects: { ORIGIN_GATE: { className: "OriginGate", useSQLite: true }, RESEARCH_SESSIONS: { className: "ResearchSession", useSQLite: true } },
  durableObjectsPersist: state, bindings: { REQUEST_LIMIT_KEY: "fixture-owner", LIVE_ACCESS: "personal_test", IMAGE_ACCESS: "personal_test", REQUIRE_ORIGIN_GATE: true },
  outboundService: request => {
    const url = new URL(request.url);
    outbound.push(url.href);
    if (url.origin === "https://cache.willhaben.at") {
      if (url.href === photo(unavailablePhotoId, 0)) return new Response("gone", { status: 404 });
      if (url.href === photo(oversizedPhotoId, 0)) return new Response("oversize", {
        headers: { "content-type": "image/png", "content-length": String(5 * 1024 * 1024) },
      });
      return new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
    }
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
    if (id === deletedListingId) return new Response("deleted", { status: 404 });
    return html({ advertDetails: detailReplacement?.id === id ? detailReplacement : listing(Number(id), true) });
  },
};
let mf = new Miniflare(runtimeOptions);
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

  const beforeOverview = outbound.length;
  const overview = await call("present_listings", { source: "live", researchId, criteria: [{ key: "condition", value: "used" }] });
  const eagerCoverUrls = outbound.slice(beforeOverview);
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
  console.log("PASS 12-card pages retain the full selection with two eager covers");

  oversizedPhotoId = "1005";
  unavailablePhotoId = "1004";
  const beforeCovers = outbound.length;
  const covers = await call("browse_collection", { researchId, collectionId, action: "covers", ids: ["1003", "1004", "1005", "1006"] });
  oversizedPhotoId = null;
  unavailablePhotoId = null;
  assert.equal(covers._meta.listingImages.length, 4);
  assert.deepEqual(outbound.slice(beforeCovers), [photo(1003, 0), photo(1004, 0), thumbnail(1004, 0), photo(1005, 0), thumbnail(1005, 0), photo(1006, 0)]);
  assert.deepEqual(covers.results.map(result => [result.url, result.size]), [
    [photo(1003, 0), "full"], [thumbnail(1004, 0), "thumbnail"], [thumbnail(1005, 0), "thumbnail"], [photo(1006, 0), "full"],
  ]);
  assert.deepEqual(covers.errors, []);
  assert.deepEqual(eagerCoverUrls, [photo(1001, 0), photo(1002, 0)]);
  assert.deepEqual(overview.cards.slice(0, 2).map(card => card.image.size), ["full", "full"]);
  assert.equal(covers._images, undefined);
  assert.equal(covers.research.counts.uiPhotosLoaded, 6);
  assert.equal(covers.research.counts.uniqueModelPhotoIndices, 0);
  const beforeForeign = outbound.length;
  await assert.rejects(call("browse_collection", { researchId, collectionId, action: "covers", ids: ["99999"] }), { code: "collection_selection_mismatch" });
  assert.equal(outbound.length, beforeForeign);
  console.log("PASS two eager and four lazy covers use observed main photos with 404 and byte-bound thumbnail fallback and app-only delivery");

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

  const context = modelPhotos.reviewContexts[0];
  assert.equal(context.id, "1001");
  assert.equal(context.researchId, researchId);
  assert.deepEqual(context.photos.map(photo => photo.index), [0, 1]);
  assert.ok(context.photos.every(photo => /^wp_[a-f0-9]{64}$/.test(photo.photoId)));
  await call("record_review", { researchId, id: context.id, evidenceId: context.evidenceId,
    photoIndices: context.photos.map(photo => photo.index), photoIds: context.photos.map(photo => photo.photoId),
    findings: "Synthetic fixture requirement evidence.", requirements: [{ requirement: "Grüner Lampenschirm",
      verdict: "confirmed", evidence: "Explicit synthetic test judgment bound to these delivered photos." }] });
  const beforeRefinement = outbound.length;
  const refined = await call("refine_research", { researchId, unknownPolicy: "exclude",
    requirements: [{ requirement: "Grüner Lampenschirm", mode: "require" }] });
  assert.equal(refined.eligibleCount, 1);
  assert.deepEqual(refined.preview.map(item => item.id), ["1001"]);
  assert.equal(outbound.length, beforeRefinement);
  const refinedCards = await call("present_listings", { source: "live", researchId, collectionId: refined.collectionId });
  assert.deepEqual(refinedCards.cards.map(card => card.id), ["1001"]);
  assert.equal(refinedCards.cards[0].review.status, "current");
  assert.equal(refinedCards.cards[0].review.checkedPhotoIds, undefined);
  assert.equal(refinedCards.cards[0].review.requirements[0].photoIds, undefined);
  assert.deepEqual(refinedCards.cards[0].review.checkedPhotoIndices, [0, 1]);
  const focused = await call("get_research", { researchId, section: "listings", ids: ["1001"] });
  assert.deepEqual(focused.listings[0].review.checkedPhotoIds, context.photos.map(photo => photo.photoId));
  unavailablePhotoId = "1004";
  const partialPhotos = await call("inspect_listing_images", { researchId, id: "1004", indices: [0, 1] });
  assert.equal(partialPhotos._images.length, 1);
  assert.deepEqual(partialPhotos.reviewContexts[0].photos.map(photo => photo.index), [1]);
  assert.equal(partialPhotos.reviewContexts[0].requirements[0].requirement, "Grüner Lampenschirm");
  const failedPhotos = await call("inspect_listing_images", { researchId, id: "1004", indices: [0] });
  assert.equal(failedPhotos._images.length, 0);
  assert.deepEqual(failedPhotos.reviewContexts[0].photos, []);
  assert.equal(failedPhotos.reviewContexts[0].nextTool, "inspect_listing_images");
  unavailablePhotoId = null;
  console.log("PASS actual photo responses hand off only successful identities, strict refinement reuses them and full evidence stays directly retrievable");

  const known = await call("inspect_listings", { source: "live", ids: ["2001", "2003", "2005"], limit: 3 });
  assert.equal(known.research.queryCount, 0);
  const knownPhotos = await call("inspect_listing_images", { researchId: known.researchId, id: "2001", count: 1 });
  const knownContext = knownPhotos.reviewContexts[0];
  await call("record_review", { researchId: known.researchId, id: "2001", evidenceId: knownContext.evidenceId,
    photoIndices: knownContext.photos.map(photo => photo.index), photoIds: knownContext.photos.map(photo => photo.photoId),
    findings: "Synthetic fixture green shade.", requirements: [{ requirement: "Grüner Lampenschirm",
      verdict: "confirmed", evidence: "Explicit fixture judgment on delivered original image." }] });
  const knownBefore = outbound.length;
  const knownRefinement = await call("refine_research", { researchId: known.researchId, unknownPolicy: "exclude",
    requirements: [{ requirement: "Grüner Lampenschirm", mode: "require" }] });
  assert.equal(knownRefinement.totalCandidates, 3);
  assert.deepEqual(knownRefinement.preview.map(item => item.id), ["2001"]);
  assert.equal(outbound.length, knownBefore);
  console.log("PASS direct detail inspection of three known IDs supports strict follow-up without any search event or new provider request");

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

  const retained = await call("__test_observations", { researchId, ids: search.items.map(item => item.id) });
  assert.equal(retained.observations[0].listing.model.length, 300);
  const originalTimes = new Map(retained.observations.map(observation => [observation.id, observation.observedAt]));
  const beforeExpiry = await call("get_research", { researchId });
  await call("__test_expire_cache");
  const beforeRetainedPages = outbound.length;
  let cursor, displayed = [];
  do {
    const page = await call("browse_collection", { researchId, collectionId, action: "page", cursor });
    assert.equal(page.cards.length, Math.min(12, 100 - displayed.length));
    assert.equal(page.pageComplete, true);
    assert.equal(page.pageRequestedCount, page.cards.length);
    assert.deepEqual(page.missingIds, []);
    for (const card of page.cards) {
      assert.equal(card.observedAt, originalTimes.get(card.id));
      assert.ok(card.cacheAgeSeconds >= Math.floor((Date.now() - Date.parse(card.observedAt)) / 1000) - 1);
    }
    displayed.push(...page.cards.map(card => card.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(displayed, search.items.map(item => item.id));
  assert.equal(outbound.length, beforeRetainedPages);
  const retainedCovers = await call("browse_collection", { researchId, collectionId, action: "covers", ids: ["1007", "1099"] });
  assert.deepEqual(retainedCovers._meta.listingImages.map(image => image.id), ["1007", "1099"]);
  assert.deepEqual(retainedCovers.missingIds, []);
  assert.deepEqual(outbound.slice(beforeRetainedPages), [photo(1007, 0), photo(1099, 0)]);
  assert.equal(retainedCovers.research.counts.detailRecordsRetrieved, beforeExpiry.counts.detailRecordsRetrieved);
  assert.equal(retainedCovers.research.counts.detailRecordsDeliveredToModel, beforeExpiry.counts.detailRecordsDeliveredToModel);
  assert.equal(retainedCovers.research.counts.uniqueModelPhotoIndices, beforeExpiry.counts.uniqueModelPhotoIndices);
  await mf.dispose();
  mf = new Miniflare(runtimeOptions);
  const afterRestart = await call("browse_collection", { researchId, collectionId, action: "page", cursor: overview.nextCursor });
  assert.equal(afterRestart.cards.length, 12);
  assert.equal(afterRestart.cards[0].observedAt, originalTimes.get("1013"));
  const delayedPresentation = await call("present_listings", { source: "live", researchId, queryIds: [search.queryId] });
  assert.equal(delayedPresentation.total, 100);
  assert.equal(delayedPresentation.cards.length, 12);
  assert.equal(delayedPresentation._meta.listingImages.length, 2);
  console.log("PASS all 100 retained offers and covers survive expired native caches and a workerd restart without detail fetches");

  deletedListingId = "1003";
  await call("inspect_listings", { source: "live", researchId, ids: ["1003"], fresh: true });
  const deletion = (await call("__test_observations", { researchId, ids: ["1003"] })).observations[0];
  assert.equal(deletion.kind, "gone");
  const beforeNegativeHit = outbound.length;
  await call("inspect_listings", { source: "live", researchId, ids: ["1003"] });
  assert.equal(outbound.length, beforeNegativeHit);
  assert.deepEqual((await call("__test_observations", { researchId, ids: ["1003"] })).observations, [deletion]);
  await call("__test_expire_cache");
  const unavailable = await call("browse_collection", { researchId, collectionId, action: "page" });
  assert.equal(unavailable.cards.length, 11);
  assert.equal(unavailable.pageComplete, false);
  assert.equal(unavailable.pageRequestedCount, 12);
  assert.deepEqual(unavailable.missingIds, ["1003"]);
  assert.match(unavailable.nextAction, /Refresh the relevant search/);
  assert.equal(unavailable.cards.some(card => card.id === "1003"), false);
  deletedListingId = null;
  await call("search_listings", { source: "live", researchId, query: "Fixture Lamp", pageSize: 100, fresh: true });
  assert.equal((await call("browse_collection", { researchId, collectionId, action: "page" })).cards.length, 12);
  console.log("PASS deleted observations retain their original negative timestamp and suppress older snapshots until a newer search");

  const legacy = await call("__test_legacy");
  const legacyOverview = await call("present_listings", { source: "live", researchId: legacy.researchId });
  assert.equal(legacyOverview.cards.length, 1);
  assert.deepEqual(legacyOverview.missingIds, ["1999"]);
  assert.equal(legacyOverview.pageComplete, false);
  assert.equal(legacyOverview.pageRequestedCount, 2);
  await call("__test_expire_cache");
  const repaired = await call("browse_collection", { researchId: legacy.researchId, collectionId: legacyOverview.collectionId, action: "page" });
  assert.equal(repaired.cards[0].id, "1001");
  assert.deepEqual(repaired.missingIds, ["1999"]);
  assert.equal(repaired.research.counts.detailRecordsRetrieved, 0);
  console.log("PASS legacy pages disclose missing observations and retain positive cache repairs without invented detail evidence");

  detailReplacement = listing(3001, true);
  detailReplacement.attributes.attribute = [
    { name: "PRICE", values: ["120"] }, { name: "Stückzahl", values: ["2"] },
    { name: "Übergabe", values: ["Versand und Abholung"] }, { name: "Versandkosten", values: ["5"] },
    { name: "Zustand", values: ["Gebraucht"] }, { name: "LOCATION", values: ["Wien"] },
    { name: "ISPRIVATE", values: ["1"] }, { name: "DESCRIPTION", values: ["Original detail snapshot."] },
  ];
  const refreshSource = await call("inspect_listings", { source: "live", ids: ["3001"], fresh: true });
  assert.equal(refreshSource.results[0]?.listing?.price, 120, JSON.stringify(refreshSource));
  const refreshOverview = await call("present_listings", { source: "live", researchId: refreshSource.researchId,
    selections: [{ id: "3001" }], criteria: [{ key: "price", value: { max: 100 } }, { key: "quantity", value: { min: 2 } }] });
  assert.equal(refreshOverview.cards[0].price, 120);
  assert.equal(refreshOverview.cards[0].unitPrice, 60);
  assert.equal(refreshOverview.cards[0].totalPrice, 125);
  assert.equal(refreshOverview.cards[0].location, "Wien");
  detailReplacement.advertStatus.id = "sold";
  detailReplacement.attributes.attribute = [
    { name: "PRICE", values: ["75"] }, { name: "Stückzahl", values: ["1"] },
    { name: "Übergabe", values: ["Versand"] }, { name: "Versandkosten", values: ["10"] },
    { name: "Zustand", values: ["Defekt"] }, { name: "ISPRIVATE", values: ["0"] },
    { name: "DESCRIPTION", values: ["Updated detail snapshot."] },
  ];
  detailReplacement.advertImageList.advertImage[0].mainImageUrl = photo("3001-replaced", 0);
  await call("__test_expire_cache");
  const refreshed = (await call("browse_collection", { researchId: refreshSource.researchId,
    collectionId: refreshOverview.collectionId, action: "details", id: "3001" })).results[0];
  assert.deepEqual(refreshed.evaluation.criteria.map(item => [item.key, item.status]),
    [["price", "confirmed"], ["quantity", "contradicted"]], "Detail refresh must evaluate the collection's actual criteria");
  assert.equal(refreshed.card.price, 75);
  assert.equal(refreshed.card.status, "sold");
  assert.equal(refreshed.card.quantity, 1);
  assert.equal(refreshed.card.unitPrice, 75);
  assert.equal(refreshed.card.shippingCost, 10);
  assert.equal(refreshed.card.totalPrice, 85);
  assert.equal(refreshed.card.sellerType, "dealer");
  assert.equal(Object.hasOwn(refreshed.card, "location"), false);
  assert.equal(refreshed.card.galleryComplete, true);
  assert.equal(refreshed.card.image.url, photo("3001-replaced", 0));
  assert.equal(refreshed.card.image.status, "pending");
  assert.equal(refreshed.card.observedAt, refreshed.observedAt);
  assert.ok(refreshed.card.observedAt > refreshOverview.cards[0].observedAt);
  assert.deepEqual(refreshed.card.assessment.evaluation, refreshed.evaluation);
  detailReplacement.attributes.attribute = detailReplacement.attributes.attribute.filter(attribute => !["Stückzahl", "Versandkosten"].includes(attribute.name));
  await call("__test_expire_cache");
  const missingFacts = (await call("browse_collection", { researchId: refreshSource.researchId,
    collectionId: refreshOverview.collectionId, action: "details", id: "3001" })).results[0];
  for (const field of ["quantity", "unitPrice", "shippingCost", "totalPrice"]) assert.equal(Object.hasOwn(missingFacts.card, field), false);
  assert.equal(missingFacts.card.assessment.evaluation.status, "unknown");
  assert.equal(missingFacts.card.observedAt, missingFacts.observedAt);
  console.log("PASS detail refresh returns one complete current card with original source time, updated prices/criteria and absent unknown facts");

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
