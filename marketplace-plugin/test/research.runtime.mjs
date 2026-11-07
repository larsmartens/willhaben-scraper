import { Miniflare } from "miniflare";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const runtimeRoot = await mkdtemp(join(tmpdir(), "willhaben-research-"));
const entry = `import * as research from './research.mjs';
import { ResearchSession as BaseResearchSession } from './research-session.mjs';
export class ResearchSession extends BaseResearchSession {
  async inspectForTest({ action, expiresAt, collectionId }) {
    if (action === 'expiration') {
      this.ctx.storage.sql.exec('UPDATE session SET expires_ms = ? WHERE singleton = 1', expiresAt);
      return { alarm: await this.ctx.storage.getAlarm() };
    }
    if (action === 'alarm') {
      await this.alarm();
      return { alarm: await this.ctx.storage.getAlarm(),
        tables: this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('session', 'listing_observations')").toArray() };
    }
    if (action === 'failed-alarm') {
      const storage = this.ctx.storage;
      const descriptor = Object.getOwnPropertyDescriptor(storage, 'deleteAll');
      Object.defineProperty(storage, 'deleteAll', { configurable: true, value: async () => { throw new Error('synthetic cleanup failure'); } });
      let rejected = false;
      try { await this.alarm(); } catch { rejected = true; }
      finally {
        if (descriptor) Object.defineProperty(storage, 'deleteAll', descriptor);
        else delete storage.deleteAll;
      }
      return { rejected };
    }
    if (action === 'collection') return this.ctx.storage.sql.exec(
      'SELECT COUNT(*) AS storedSelections FROM collection_items WHERE collection_id = ?', collectionId).one();
    return { alarm: await this.ctx.storage.getAlarm(),
      events: this.ctx.storage.sql.exec('SELECT payload FROM events ORDER BY sequence').toArray(),
      observations: this.ctx.storage.sql.exec('SELECT * FROM listing_observations ORDER BY listing_id').toArray() };
  }
}
export default { async fetch(request, env) {
  const { action, args = {}, owner = 'first-fixture-owner' } = await request.json();
  const scoped = { ...env, REQUEST_LIMIT_KEY: owner };
  try {
    let result;
    if (action === 'inspectForTest') {
      const digest = await research.researchHash(owner);
      result = await env.RESEARCH_SESSIONS.getByName('research:' + digest + ':' + args.researchId).inspectForTest(args);
    } else result = await research[action](scoped, args);
    return Response.json({ result });
  } catch (error) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: 400 });
  }
} };`;

const modules = [{ type: "ESModule", path: runtimeRoot + "/entry.mjs", contents: entry }];
for (const file of ["research.mjs", "research-session.mjs", "engine.mjs"]) {
  modules.push({ type: "ESModule", path: runtimeRoot + "/" + file, contents: await readFile(sourceRoot + file, "utf8") });
}
const options = {
  name: "willhaben-research-test", modulesRoot: runtimeRoot, modules, compatibilityDate: "2026-06-01",
  durableObjects: { RESEARCH_SESSIONS: { className: "ResearchSession", useSQLite: true } },
  durableObjectsPersist: runtimeRoot + "/state",
  outboundService: async () => { throw new Error("Research accounting must not fetch upstream resources"); },
};
let mf = new Miniflare(options);

async function call(action, args = {}, owner) {
  const response = await mf.dispatchFetch("https://research-test.invalid/", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, args, owner }),
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error.message), body.error);
  return body.result;
}

try {
  const session = await call("ensureResearch", { source: "live" });
  const researchId = session.researchId;
  const append = event => call("recordResearch", { researchId, event });
  const query = { eventId: "search-first", type: "search", query: "Bankerlampe", filters: { priceMax: 100 },
    page: 1, pageSize: 50, ids: Array.from({ length: 50 }, (_, index) => String(index + 1)), reportedTotal: 125,
    nextCursor: "page-two", imageUrl: "https://private.invalid/image.png" };
  const first = await append(query);
  const queryId = first.queryId;
  assert.equal(first.counts.uniqueSearchListings, 50);
  assert.equal(first.counts.searchCalls, 1);
  assert.equal(first.queries[0].reportedTotal, 125);
  assert.match(queryId, /^q_[a-f0-9]{64}$/);
  const replay = await Promise.all(Array.from({ length: 16 }, () => append(query)));
  assert.ok(replay.every(result => result.duplicate));
  assert.ok(replay.every(result => result.counts.searchCalls === 1));
  await assert.rejects(append({ ...query, ids: ["changed"] }), { code: "research_event_conflict" });
  console.log("PASS concurrent event replay produces one atomic search observation");

  await Promise.all(Array.from({ length: 16 }, (_, index) => append({ ...query, eventId: "parallel-" + index,
    query: "Query " + index, ids: [String(index + 41), String(index + 101)] })));
  let summary = await call("getResearch", { researchId });
  assert.equal(summary.counts.searchCalls, 17);
  assert.equal(summary.counts.uniqueSearchListings, 72);
  assert.equal(summary.queryCount, 17);
  assert.equal(summary.queries.length, 8);
  assert.ok(summary.queriesNextCursor);
  const queries2 = await call("getResearch", { researchId, section: "queries", cursor: summary.queriesNextCursor, limit: 8 });
  assert.equal(queries2.queries.length, 8);
  assert.equal(queries2.offset, 8);
  const queries3 = await call("getResearch", { researchId, section: "queries", cursor: queries2.nextCursor, limit: 8 });
  assert.equal(queries3.queries.length, 1);
  assert.equal(queries3.nextCursor, null);
  console.log("PASS independent concurrent searches merge unique IDs and page their query audit");

  await append({ ...query, eventId: "search-second-call", ids: ["1", "2"], scannedCount: 50, filteredOutCount: 48, reportedTotal: 130 });
  summary = await call("getResearch", { researchId });
  assert.equal(summary.queries[0].calls, 2);
  assert.equal(summary.queries[0].pagesFetched, 1);
  assert.equal(summary.queries[0].rowsReturned, 52);
  assert.equal(summary.queries[0].scannedCount, 100);
  assert.equal(summary.queries[0].filteredOutCount, 48);
  assert.equal(summary.queries[0].uniqueListings, 50);
  assert.equal(summary.queries[0].reportedTotalChanged, true);
  const beforeConflict = summary.counts.searchCalls;
  await assert.rejects(append({ ...query, queryId, eventId: "query-conflict", query: "Different definition" }), { code: "research_query_conflict" });
  assert.equal((await call("getResearch", { researchId })).counts.searchCalls, beforeConflict);
  console.log("PASS repeated pages retain distinct page and raw call counts and conflicting events roll back");

  const criteria = [{ key: "price", value: { max: 100 } }, { key: "shipping", value: "shipping" }];
  const collection = await call("saveCollection", { researchId, title: "Alle beobachteten Angebote", criteria });
  assert.equal(collection.total, 72);
  assert.deepEqual(collection.criteria, criteria);
  const page1 = await call("readCollection", { researchId, collectionId: collection.collectionId });
  assert.equal(page1.selections.length, 12);
  assert.deepEqual(page1.criteria, criteria);
  assert.deepEqual(page1.selections.map(item => item.id), Array.from({ length: 12 }, (_, i) => String(i + 1)));
  const page2 = await call("readCollection", { researchId, collectionId: collection.collectionId, cursor: page1.nextCursor });
  assert.equal(page2.offset, 12);
  assert.deepEqual(page2.criteria, criteria);
  const previous = await call("readCollection", { researchId, collectionId: collection.collectionId, cursor: page2.previousCursor });
  assert.deepEqual(previous.selections, page1.selections);
  const wide = await call("readCollection", { researchId, collectionId: collection.collectionId, pageSize: 24 });
  assert.equal(wide.selections.length, 24);
  const subset = await call("readCollection", { researchId, collectionId: collection.collectionId, ids: ["20", "2"] });
  assert.equal(subset.subset, true);
  assert.deepEqual(subset.criteria, criteria);
  assert.deepEqual(subset.selections.map(item => item.id), ["2", "20"]);
  await assert.rejects(call("readCollection", { researchId, collectionId: collection.collectionId, ids: ["2", "99999"] }), { code: "collection_selection_mismatch" });
  await assert.rejects(call("readCollection", { researchId, collectionId: collection.collectionId, pageSize: 24, cursor: page1.nextCursor }), { code: "invalid_research_input" });
  const selectedQuery = await call("saveCollection", { researchId, queryIds: [queryId] });
  assert.equal(selectedQuery.total, 50);
  assert.equal((await call("saveCollection", { researchId, collectionId: collection.collectionId, title: collection.title, criteria })).total, 72);
  await assert.rejects(call("saveCollection", { researchId, collectionId: collection.collectionId, title: collection.title,
    criteria: [{ key: "price", value: { max: 200 } }] }), { code: "collection_conflict" });
  assert.deepEqual(selectedQuery.criteria, []);
  await assert.rejects(call("saveCollection", { researchId, collectionId: collection.collectionId, title: "Changed" }), { code: "collection_conflict" });
  console.log("PASS immutable collections provide 12/24-card pages and indexed member checks");

  await append({ eventId: "detail-gallery", type: "details", audience: "model", retrievedIds: ["1"], records: [
    { id: "1", fields: ["gallery", "title"] },
  ] });
  await append({ eventId: "detail-app", type: "details", audience: "app", records: [
    { id: "2", fields: ["description"], description: { deliveredChars: 200, totalChars: 200, truncated: false } },
  ] });
  await append({ eventId: "detail-model", type: "details", audience: "model", records: [
    { id: "1", fields: ["description", "price"], description: { deliveredChars: 1500, totalChars: 4000, truncated: true } },
    { id: "3", fields: ["description"], description: { deliveredChars: 300, totalChars: 300, truncated: false } },
  ] });
  summary = await call("getResearch", { researchId });
  assert.equal(summary.counts.detailRecordsRetrieved, 3);
  assert.equal(summary.counts.descriptionsDeliveredToModel, 2);
  assert.equal(summary.counts.descriptionsFull, 1);
  assert.equal(summary.counts.descriptionsTruncated, 1);
  await append({ eventId: "ui-photos", type: "photos", audience: "app", photos: [
    { id: "1", index: 0, size: "thumbnail", data: "base64-secret", url: "https://private.invalid/photo" },
  ] });
  await assert.rejects(append({ eventId: "review-early", type: "review", id: "1", photoIndices: [0], findings: "A green shade." }), { code: "review_photo_not_delivered" });
  await append({ eventId: "model-photos", type: "photos", audience: "model", photos: [
    { id: "1", index: 0, size: "thumbnail" }, { id: "1", index: 0, size: "full" }, { id: "1", index: 2, size: "full" },
  ] });
  await append({ eventId: "review-valid", type: "review", id: "1", photoIndices: [0, 2], findings: "Green glass shade and a visible base plate." });
  summary = await call("getResearch", { researchId });
  assert.equal(summary.counts.uiPhotosLoaded, 1);
  assert.equal(summary.counts.photoBlocksDeliveredToModel, 3);
  assert.equal(summary.counts.uniqueModelPhotoIndices, 2);
  assert.equal(summary.counts.visualFindingsRecorded, 1);
  assert.equal(summary.counts.photosWithRecordedFindings, 2);
  const listingPage = await call("getResearch", { researchId, section: "listings", limit: 2 });
  assert.equal(listingPage.listings[0].description.deliveredChars, 1500);
  assert.deepEqual(listingPage.listings[0].deliveredFields, ["description", "gallery", "price", "title"]);
  assert.equal(listingPage.listings[0].findings[0].evidenceType, "agent-reported");
  assert.equal(listingPage.listings[1].description, null);
  const third = await call("getResearch", { researchId, section: "listings", limit: 1, cursor: listingPage.nextCursor });
  assert.equal(third.listings[0].id, "3");
  console.log("PASS description projection, UI photos, model photo delivery and recorded visual findings remain distinct");

  const overlap = await call("ensureResearch", { source: "live" });
  const overlapAppend = event => call("recordResearch", { researchId: overlap.researchId, event });
  const overlapA = await overlapAppend({ eventId: "overlap-a", type: "search", query: "Bankerlampe", page: 1, pageSize: 50, ids: ["1", "2", "3"] });
  const overlapB = await overlapAppend({ eventId: "overlap-b", type: "search", query: "Schreibtischlampe", page: 1, pageSize: 50, ids: ["2", "4"] });
  const overlapEmpty = await overlapAppend({ eventId: "overlap-empty", type: "search", query: "Ungeprüft", page: 1, pageSize: 50, ids: ["5"] });
  await overlapAppend({ eventId: "overlap-a-repeat", type: "search", query: "Bankerlampe", page: 2, pageSize: 50, ids: ["2", "3"] });
  await overlapAppend({ eventId: "overlap-app-details", type: "details", audience: "app", retrievedIds: ["4", "99"], records: [
    { id: "4", fields: ["description"], description: { deliveredChars: 20, totalChars: 20, truncated: false } },
  ] });
  await overlapAppend({ eventId: "overlap-model-details", type: "details", audience: "model", records: [
    { id: "1", fields: ["title"] }, { id: "2", fields: ["description"], description: { deliveredChars: 40, totalChars: 100, truncated: true } },
  ] });
  await overlapAppend({ eventId: "overlap-model-photos", type: "photos", audience: "model", photos: [
    { id: "1", index: 0, size: "full" }, { id: "2", index: 0, size: "thumbnail" }, { id: "2", index: 0, size: "full" },
    { id: "2", index: 1, size: "full" }, { id: "99", index: 9, size: "full" },
  ] });
  await overlapAppend({ eventId: "overlap-ui-photos", type: "photos", audience: "app", photos: [
    { id: "2", index: 0, size: "thumbnail" }, { id: "2", index: 0, size: "full" }, { id: "4", index: 0, size: "full" },
  ] });
  await overlapAppend({ eventId: "overlap-review-1", type: "review", id: "1", photoIndices: [0], findings: "Visible fixture base." });
  await overlapAppend({ eventId: "overlap-review-2", type: "review", id: "2", photoIndices: [0, 1], findings: "Visible fixture shade and base." });
  await overlapAppend({ eventId: "overlap-review-2-repeat", type: "review", id: "2", photoIndices: [0], findings: "Second observation of the same shade." });
  await overlapAppend({ eventId: "outside-review", type: "review", id: "99", photoIndices: [9], findings: "Outside the search cohorts." });
  const overlapAudit = await call("getResearch", { researchId: overlap.researchId, section: "queries" });
  const queryCounts = id => overlapAudit.queries.find(query => query.queryId === id).counts;
  assert.deepEqual(queryCounts(overlapA.queryId), { detailRecordsRetrieved: 2, detailRecordsDeliveredToModel: 2,
    descriptionsDeliveredToModel: 1, uniqueModelPhotoIndices: 3, uniqueUiPhotoIndices: 1, photosWithRecordedFindings: 3 });
  assert.deepEqual(queryCounts(overlapB.queryId), { detailRecordsRetrieved: 2, detailRecordsDeliveredToModel: 1,
    descriptionsDeliveredToModel: 1, uniqueModelPhotoIndices: 2, uniqueUiPhotoIndices: 2, photosWithRecordedFindings: 2 });
  assert.deepEqual(queryCounts(overlapEmpty.queryId), { detailRecordsRetrieved: 0, detailRecordsDeliveredToModel: 0,
    descriptionsDeliveredToModel: 0, uniqueModelPhotoIndices: 0, uniqueUiPhotoIndices: 0, photosWithRecordedFindings: 0 });
  assert.equal(overlapAudit.counts.detailRecordsDeliveredToModel, 2);
  assert.equal(overlapAudit.counts.uniqueUiPhotoIndices, 2);
  assert.equal(queryCounts(overlapA.queryId).uniqueUiPhotoIndices + queryCounts(overlapB.queryId).uniqueUiPhotoIndices, 3);
  console.log("PASS query coverage deduplicates detail and photo evidence within overlapping search cohorts");

  const stored = await call("inspectForTest", { researchId });
  assert.ok(!JSON.stringify(stored.events).includes("private.invalid"));
  assert.ok(!JSON.stringify(stored.events).includes("base64-secret"));
  assert.equal(stored.events.filter(event => JSON.parse(event.payload).eventId === "review-early").length, 0);
  assert.ok(stored.alarm > Date.now() + 6.99 * 86400000);
  await assert.rejects(call("getResearch", { researchId }, "second-fixture-owner"), { code: "research_unavailable" });
  const other = await call("ensureResearch", { source: "live" });
  assert.equal((await call("getResearch", { researchId: other.researchId })).counts.searchCalls, 0);
  console.log("PASS media is absent from stored events and owners and research tasks are isolated");

  await append({ eventId: "large-search", type: "search", query: "Large catalogue", page: 1, pageSize: 1000,
    ids: Array.from({ length: 1000 }, (_, i) => String(1001 + i)) });
  const large = await call("saveCollection", { researchId });
  assert.equal(large.total, 1072);
  assert.equal(large.availableTotal, 1072);
  assert.equal(large.moreAvailable, false);
  assert.equal((await call("readCollection", { researchId, collectionId: large.collectionId })).selections.length, 12);
  assert.equal((await call("readCollection", { researchId, collectionId: collection.collectionId })).total, 72);
  console.log("PASS large searches retain all research IDs while collection pages and snapshots stay bounded");

  const progressSession = await call("ensureResearch");
  const progressId = progressSession.researchId;
  const observedAt = new Date(Date.now() - 1000).toISOString();
  const progressEvent = { type: "search", query: "Progress", pageSize: 50, observedAt, reportedTotal: 50 };
  await call("recordResearch", { researchId: progressId, event: { ...progressEvent, eventId: "progress-second", page: 2, ids: [], exhausted: true } });
  await call("recordResearch", { researchId: progressId, event: { ...progressEvent, eventId: "progress-first", page: 1, ids: ["1"], nextCursor: "PAGE_TWO" } });
  let progress = (await call("getResearch", { researchId: progressId })).queries[0];
  assert.equal(progress.pagesFetched, 2);
  assert.equal(progress.progressPage, 2);
  assert.equal(progress.exhausted, true);
  assert.equal(progress.nextCursor, null);
  await call("recordResearch", { researchId: progressId, event: { ...progressEvent, eventId: "progress-newer-first", page: 1,
    ids: ["1"], nextCursor: "PAGE_TWO", observedAt: new Date().toISOString() } });
  progress = (await call("getResearch", { researchId: progressId })).queries[0];
  assert.equal(progress.progressPage, 2);
  assert.equal(progress.exhausted, true);
  await call("recordResearch", { researchId: progressId, event: { ...progressEvent, eventId: "progress-changed-first", page: 1,
    ids: ["1"], nextCursor: "PAGE_TWO", reportedTotal: 60, observedAt: new Date().toISOString() } });
  progress = (await call("getResearch", { researchId: progressId })).queries[0];
  assert.equal(progress.progressPage, 2);
  assert.equal(progress.reportedTotal, 60);
  assert.equal(progress.exhausted, false);
  assert.equal(progress.restartRequired, true);
  console.log("PASS out-of-order and later lower pages preserve progress while changed totals invalidate completeness");

  const bulkSession = await call("ensureResearch");
  const bulkId = bulkSession.researchId;
  await call("recordResearch", { researchId: bulkId, event: { eventId: "known-before-search", type: "details", audience: "app", retrievedIds: ["777777"], records: [] } });
  for (let page = 1; page <= 10; page++) {
    await call("recordResearch", { researchId: bulkId, event: { eventId: "bulk-" + page, type: "search", query: "Bulk", page, pageSize: 1000,
      ids: Array.from({ length: 1000 }, (_, i) => String(10001 + (page - 1) * 1000 + i)), reportedTotal: 10000 } });
  }
  const subsetEvent = { type: "search", query: "Subset", pageSize: 1000 };
  const subsetQuery = await call("recordResearch", { researchId: bulkId, event: { ...subsetEvent, eventId: "subset-first", page: 1,
    ids: Array.from({ length: 10 }, (_, i) => String(10001 + i)) } });
  const bulkCollection = await call("saveCollection", { researchId: bulkId });
  const subsetCollection = await call("saveCollection", { researchId: bulkId, queryIds: [subsetQuery.queryId] });
  assert.equal(bulkCollection.total, 10000);
  assert.equal(subsetCollection.total, 10);
  assert.equal((await call("inspectForTest", { researchId: bulkId, action: "collection", collectionId: bulkCollection.collectionId })).storedSelections, 0);
  const startPaging = Date.now();
  let nextCursor, visited = 0, pages = 0, lastPage;
  do {
    lastPage = await call("readCollection", { researchId: bulkId, collectionId: bulkCollection.collectionId, pageSize: 24, cursor: nextCursor });
    assert.equal(lastPage.offset, visited);
    assert.equal(lastPage.selections[0].id, String(10001 + visited));
    visited += lastPage.selections.length;
    pages++;
    nextCursor = lastPage.nextCursor;
  } while (nextCursor);
  assert.equal(visited, 10000);
  assert.equal(pages, 417);
  assert.equal(lastPage.selections.length, 16);
  assert.equal(lastPage.selections.at(-1).id, "20000");
  const tail = await call("readCollection", { researchId: bulkId, collectionId: bulkCollection.collectionId, ids: ["20000"] });
  assert.deepEqual(tail.selections, [{ id: "20000" }]);
  await assert.rejects(call("readCollection", { researchId: bulkId, collectionId: subsetCollection.collectionId, ids: ["20000"] }), { code: "collection_selection_mismatch" });
  await call("recordResearch", { researchId: bulkId, event: { eventId: "bulk-later", type: "search", query: "Bulk", page: 11, pageSize: 1000, ids: ["777777", "20001"] } });
  await call("recordResearch", { researchId: bulkId, event: { ...subsetEvent, eventId: "subset-later", page: 2, ids: ["15000"] } });
  assert.equal((await call("readCollection", { researchId: bulkId, collectionId: bulkCollection.collectionId })).total, 10000);
  assert.equal((await call("readCollection", { researchId: bulkId, collectionId: subsetCollection.collectionId })).total, 10);
  await assert.rejects(call("readCollection", { researchId: bulkId, collectionId: bulkCollection.collectionId, ids: ["777777"] }), { code: "collection_selection_mismatch" });
  await assert.rejects(call("readCollection", { researchId: bulkId, collectionId: subsetCollection.collectionId, ids: ["15000"] }), { code: "collection_selection_mismatch" });
  assert.equal((await call("saveCollection", { researchId: bulkId })).total, 10002);
  console.log(`PASS all 10000 IDs page in 417 bounded reads with stable snapshot membership (${Date.now() - startPaging} ms)`);

  const retainedSession = await call("ensureResearch", { source: "live" });
  const retainedId = retainedSession.researchId;
  const retainedAt = new Date(Date.now() - 600000).toISOString();
  const retainedObservation = { id: "501", kind: "search", observedAt: retainedAt,
    listing: { id: "501", title: "Retained lamp", price: 30,
      url: "https://www.willhaben.at/iad/object?adId=501",
      images: ["https://cache.willhaben.at/mmo/501.jpg"],
      description: "unnecessary original description", imageUrl: "https://private.invalid/input.png" } };
  const retainedEvent = { eventId: "retained-search", type: "search", query: "Retained", page: 1, pageSize: 50, ids: ["501"], observedAt: retainedAt };
  const retainedAppend = { researchId: retainedId, event: retainedEvent, observations: [retainedObservation] };
  await call("recordResearch", retainedAppend);
  assert.equal((await call("recordResearch", retainedAppend)).duplicate, true);
  const resolve = (observations = []) => call("resolveResearchObservations", { researchId: retainedId, ids: ["501", "502"], observations });
  const initialRetained = await resolve();
  assert.equal(initialRetained.observations[0].observedAt, retainedAt);
  assert.deepEqual(initialRetained.missingIds, ["502"]);
  assert.equal(initialRetained.observations[0].listing.description, undefined);
  assert.ok(Date.now() - Date.parse(initialRetained.observations[0].observedAt) >= 600000);
  await assert.rejects(call("recordResearch", { ...retainedAppend, observations: [
    { ...retainedObservation, listing: { ...retainedObservation.listing, price: 99 } },
  ] }), { code: "research_event_conflict" });
  assert.deepEqual(await resolve(), initialRetained);
  await assert.rejects(call("recordResearch", { ...retainedAppend,
    event: { ...retainedEvent, eventId: "retained-query-conflict", queryId: (await call("getResearch", { researchId: retainedId })).queries[0].queryId, query: "Conflicting" },
    observations: [{ ...retainedObservation, listing: { ...retainedObservation.listing, price: 99 } }],
  }), { code: "research_query_conflict" });
  assert.deepEqual(await resolve(), initialRetained);
  const beforeResolveCounts = (await call("getResearch", { researchId: retainedId })).counts;
  const detailObservation = { ...retainedObservation, kind: "detail", listing: { ...retainedObservation.listing, price: 25, attributes: { diameterMm: 60 } } };
  await resolve([detailObservation]);
  assert.equal((await resolve([retainedObservation])).observations[0].listing.price, 25);
  const deletion = { id: "501", kind: "gone", observedAt: retainedAt };
  assert.deepEqual((await resolve([deletion])).observations, [deletion]);
  assert.deepEqual((await resolve([detailObservation])).observations, [deletion]);
  const refreshed = { ...retainedObservation, observedAt: new Date(Date.parse(retainedAt) + 1000).toISOString() };
  assert.equal((await resolve([refreshed])).observations[0].listing.attributes, undefined);
  assert.deepEqual((await call("getResearch", { researchId: retainedId })).counts, beforeResolveCounts);
  await assert.rejects(call("resolveResearchObservations", { researchId: retainedId, ids: ["501"] }, "second-fixture-owner"), { code: "research_unavailable" });
  const retainedStorage = await call("inspectForTest", { researchId: retainedId });
  assert.equal(JSON.stringify(retainedStorage).includes("private.invalid"), false);
  assert.equal(JSON.stringify(retainedStorage.events).includes("cache.willhaben.at"), false);
  assert.equal(JSON.stringify(retainedStorage.events).includes("Retained lamp"), false);
  console.log("PASS compact observations are atomic, replay-safe, owner-scoped and ordered as whole facts independently of evidence counters");

  await call("resolveResearchObservations", { researchId: other.researchId, ids: ["501"], observations: [retainedObservation] });
  const beforeRestart = await call("getResearch", { researchId });
  const retainedBeforeRestart = await resolve();
  await mf.dispose();
  mf = new Miniflare(options);
  assert.deepEqual((await call("getResearch", { researchId })).counts, beforeRestart.counts);
  assert.deepEqual((await call("readCollection", { researchId, collectionId: collection.collectionId })).selections, page1.selections);
  assert.deepEqual((await call("readCollection", { researchId, collectionId: collection.collectionId })).criteria, criteria);
  assert.deepEqual(await resolve(), retainedBeforeRestart);
  console.log("PASS research events, counts, listing observations and ordered collections survive a real workerd restart");

  const expirySession = other.researchId;
  const soon = Date.now() + 60000;
  await call("inspectForTest", { researchId: expirySession, action: "expiration", expiresAt: soon });
  const earlyAlarm = await call("inspectForTest", { researchId: expirySession, action: "alarm" });
  assert.equal(earlyAlarm.alarm, soon);
  const renewed = await call("getResearch", { researchId: expirySession });
  assert.ok(Date.parse(renewed.expiresAt) > Date.now() + 6.99 * 86400000);
  await call("inspectForTest", { researchId: expirySession, action: "expiration", expiresAt: Date.now() - 1 });
  await assert.rejects(call("getResearch", { researchId: expirySession }), { code: "research_expired" });
  assert.equal((await call("inspectForTest", { researchId: expirySession, action: "failed-alarm" })).rejected, true);
  const expired = await call("inspectForTest", { researchId: expirySession, action: "alarm" });
  assert.equal(expired.alarm, null);
  assert.equal(expired.tables.length, 0);
  await assert.rejects(call("getResearch", { researchId: expirySession }), { code: "research_expired" });
  console.log("PASS activity renews seven-day retention and expiry alarms retry failed cleanup before deleting stored research data");
  console.log("All ResearchSession Workers-runtime checks passed");
} finally {
  await mf.dispose();
  await rm(runtimeRoot, { recursive: true, force: true });
}
