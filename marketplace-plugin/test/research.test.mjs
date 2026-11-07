import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureResearch, getResearch, recordResearch, normalizeResearchEvent, normalizeCollection,
  normalizeCollectionIds, researchCursor, readResearchCursor, RESEARCH_INACTIVITY_MS,
  normalizeListingObservations, newestListingObservation, normalizeObservationIds,
} from "../src/research.mjs";

test("research is optional without a binding and explicit references require storage", async () => {
  assert.equal(await ensureResearch({}), null);
  await assert.rejects(ensureResearch({}, { researchId: "wr_" + "a".repeat(32) }), { code: "research_unavailable" });
  assert.equal(RESEARCH_INACTIVITY_MS, 7 * 24 * 60 * 60 * 1000);
});

test("routing isolates owners without disclosing the connection key", async () => {
  const names = [];
  const binding = { getByName(name) {
    names.push(name);
    return { read: async () => ({ researchId: "wr_" + "a".repeat(32), source: "live" }) };
  } };
  const researchId = "wr_" + "a".repeat(32);
  for (const owner of ["first-fixture-owner", "second-fixture-owner", "first-fixture-owner"]) {
    await getResearch({ RESEARCH_SESSIONS: binding, REQUEST_LIMIT_KEY: owner }, { researchId });
  }
  assert.equal(names[0], names[2]);
  assert.notEqual(names[0], names[1]);
  assert.ok(names.every(name => !name.includes("fixture-owner")));
  await assert.rejects(getResearch({ RESEARCH_SESSIONS: binding }, { researchId }), { code: "research_owner_required" });
});

test("RPC failures retain typed errors and hide infrastructure messages", async () => {
  const researchId = "wr_" + "a".repeat(32);
  const env = { REQUEST_LIMIT_KEY: "fixture", RESEARCH_SESSIONS: { getByName() {
    return { append: async () => ({ error: { code: "review_photo_not_delivered", message: "Read the photo first." } }),
      read: async () => { throw new Error("Internal storage path"); } };
  } } };
  await assert.rejects(recordResearch(env, { researchId, event: {} }), { code: "review_photo_not_delivered" });
  await assert.rejects(getResearch(env, { researchId }), error => error.code === "research_unavailable" && !error.message.includes("Internal"));
});

test("search identity canonicalizes filters and excludes arbitrary input media", async () => {
  const input = { type: "search", query: "  Lampe  ", page: 1, pageSize: 50, ids: ["41", "42"],
    filters: { priceMax: 100, condition: "used" }, imageUrl: "https://private.invalid/input.png", imageData: "secret image bytes" };
  const a = await normalizeResearchEvent(input);
  const b = await normalizeResearchEvent({ ...input, filters: { condition: "used", priceMax: 100 } });
  assert.equal(a.queryId, b.queryId);
  assert.notEqual(a.queryId, (await normalizeResearchEvent({ ...input, pageSize: 100 })).queryId);
  assert.equal(a.query, "Lampe");
  assert.equal(a.reportedTotal, null);
  assert.equal(a.scannedCount, 2);
  const filtered = await normalizeResearchEvent({ ...input, scannedCount: 50, filteredOutCount: 48 });
  assert.equal(filtered.scannedCount, 50);
  assert.equal(filtered.filteredOutCount, 48);
  await assert.rejects(normalizeResearchEvent({ ...input, scannedCount: 1 }), { code: "invalid_research_input" });
  await assert.rejects(normalizeResearchEvent({ ...input, scannedCount: 3, filteredOutCount: 2 }), { code: "invalid_research_input" });
  assert.ok(!JSON.stringify(a).includes("private.invalid"));
  assert.ok(!JSON.stringify(a).includes("secret image bytes"));
  await assert.rejects(normalizeResearchEvent({ ...input, filters: { query: "https://private.invalid/input.png" } }), { code: "invalid_research_input" });
  await assert.rejects(normalizeResearchEvent({ ...input, ids: ["https://private.invalid/input.png"] }), { code: "invalid_research_input" });
});

test("description accounting follows delivered fields and exact truncation", async () => {
  const base = { type: "details", audience: "model", records: [{ id: "41", fields: ["description", "price"],
    description: { deliveredChars: 1500, totalChars: 4000, truncated: true } }] };
  const event = await normalizeResearchEvent(base);
  assert.deepEqual(event.retrievedIds, ["41"]);
  assert.equal(event.records[0].description.deliveredChars, 1500);
  await assert.rejects(normalizeResearchEvent({ ...base, records: [{ ...base.records[0], fields: ["price"] }] }), { code: "invalid_research_input" });
  await assert.rejects(normalizeResearchEvent({ ...base, records: [{ ...base.records[0], description: { deliveredChars: 1500, totalChars: 1500, truncated: true } }] }), { code: "invalid_research_input" });
});

test("photo events retain indices and delivery audience while dropping image bytes and URLs", async () => {
  const event = await normalizeResearchEvent({ type: "photos", audience: "app", photos: [
    { id: "41", index: 2, size: "thumbnail", url: "https://cache.willhaben.at/mmo/secret.jpg", data: "base64secret" },
  ] });
  assert.equal(event.audience, "app");
  assert.equal(event.photos[0].index, 2);
  assert.equal(event.photos[0].size, "thumbnail");
  assert.ok(!JSON.stringify(event).includes("secret"));
  await assert.rejects(normalizeResearchEvent({ type: "photos", audience: "seen", photos: [] }), { code: "invalid_research_input" });
});

test("collections normalize ordered references and enforce bounded membership lookups", () => {
  const selections = Array.from({ length: 1000 }, (_, index) => ({ id: String(index + 1), reason: "Suitable", imageUrl: "discarded" }));
  const collection = normalizeCollection({ selections });
  assert.equal(collection.selections.length, 1000);
  assert.match(collection.collectionId, /^wc_[a-f0-9]{32}$/);
  assert.ok(!JSON.stringify(collection).includes("discarded"));
  assert.throws(() => normalizeCollection({ selections: [...selections, { id: "1001" }] }), { code: "invalid_research_input" });
  assert.throws(() => normalizeCollection({ selections: [{ id: "1" }, { id: "1" }] }), { code: "invalid_research_input" });
  assert.throws(() => normalizeCollection({ selections: [{ id: "1" }], queryIds: ["q_a"] }), { code: "invalid_research_input" });
  assert.deepEqual(normalizeCollectionIds(["1", "1", "2"]), ["1", "2"]);
  assert.throws(() => normalizeCollectionIds(Array.from({ length: 9 }, (_, i) => String(i))), { code: "invalid_research_input" });
});

test("collection criteria reuse the evaluator contract and discard unrelated fields", () => {
  const criteria = [{ key: "price", value: { max: 100, min: 20 }, imageUrl: "discarded" }, { key: "shipping", value: "shipping" }];
  const collection = normalizeCollection({ criteria });
  assert.deepEqual(collection.criteria, [{ key: "price", value: { max: 100, min: 20 } }, { key: "shipping", value: "shipping" }]);
  assert.equal(JSON.stringify(collection).includes("discarded"), false);
  assert.equal(Object.hasOwn(normalizeCollection({ criteria: [] }), "criteria"), false);
  assert.throws(() => normalizeCollection({ criteria: [{ key: "price", value: { min: 100, max: 20 } }] }), { code: "invalid_input" });
  assert.throws(() => normalizeCollection({ criteria: [{ key: "constructor", value: "x" }] }), { code: "invalid_input" });
});

test("research cursors bind the research, section, collection and page size", () => {
  const scope = "wr_fixture:wc_fixture:12";
  const cursor = researchCursor(scope, 24);
  assert.equal(readResearchCursor(cursor, scope), 24);
  assert.equal(readResearchCursor(undefined, scope), 0);
  assert.throws(() => readResearchCursor(cursor, "wr_fixture:wc_fixture:24"), { code: "invalid_research_input" });
  assert.throws(() => readResearchCursor("wrp1.bad", scope), { code: "invalid_research_input" });
});

test("retained observations keep compact listing facts and original photo metadata", () => {
  const observedAt = "2026-01-01T12:00:00.000Z";
  const input = { id: "41", kind: "detail", observedAt, listing: {
    id: "41", title: "Lamp", price: 30, quantity: 2, shippingCost: 5, shipping: "both",
    url: "https://www.willhaben.at/iad/object?adId=41", condition: "used", imageCount: 2,
    description: "A private description is unnecessary for a retained overview", seller: { email: "private@example.invalid" },
    attributes: { diameterMm: 60, Zustand: "Gebraucht" }, galleryComplete: true,
    gallery: [{ index: 0, url: "https://cache.willhaben.at/mmo/41.jpg", thumbnailUrl: "https://cache.willhaben.at/mmo/41_thumb.jpg",
      data: "secret-base64", similarSearchUrl: "https://private.invalid/upload" }],
    imageUrl: "https://private.invalid/input.png",
  } };
  const [observation] = normalizeListingObservations([input]);
  assert.equal(observation.observedAt, observedAt);
  assert.equal(observation.kind, "detail");
  assert.deepEqual(observation.listing.attributes, input.listing.attributes);
  assert.equal(observation.listing.gallery[0].index, 0);
  assert.equal(observation.listing.imageCount, 2);
  assert.equal(observation.listing.galleryComplete, true);
  assert.equal(JSON.stringify(observation).includes("private"), false);
  assert.equal(JSON.stringify(observation).includes("base64"), false);
  assert.equal(observation.listing.description, undefined);
  assert.throws(() => normalizeListingObservations([{ ...input, observedAt: undefined }]), { code: "invalid_research_input" });
  assert.throws(() => normalizeListingObservations([{ ...input, listing: { ...input.listing, id: "42" } }]), { code: "invalid_research_input" });
  assert.throws(() => normalizeListingObservations([{ ...input, listing: { ...input.listing, gallery: [{ url: "https://private.invalid/input.jpg" }] } }]), { code: "invalid_research_input" });
  assert.deepEqual(normalizeListingObservations([{ ...input, kind: "gone" }]), [{ id: "41", kind: "gone", observedAt }]);
  assert.throws(() => normalizeObservationIds(Array.from({ length: 101 }, (_, index) => String(index))), { code: "invalid_research_input" });
});

test("the observation budget accommodates full 100-row pages independently of the audit budget", () => {
  const observations = Array.from({ length: 100 }, (_, index) => ({ id: String(index + 1), kind: "search",
    observedAt: "2026-01-01T12:00:00.000Z", listing: { id: String(index + 1), title: "Lamp", price: 30,
      gallery: Array.from({ length: 10 }, (_, photo) => ({
        url: "https://cache.willhaben.at/mmo/" + "a".repeat(1000) + index + "-" + photo + ".jpg",
        thumbnailUrl: "https://cache.willhaben.at/mmo/" + "a".repeat(1000) + index + "-" + photo + "_thumb.jpg",
      })) } }));
  const result = normalizeListingObservations(observations);
  assert.equal(result.length, 100);
  assert.ok(JSON.stringify(result).length > 256 * 1024);
  assert.ok(JSON.stringify(result).length < 4 * 1024 * 1024);
});

test("whole-observation ordering preserves newer facts, detail ties and deletion evidence", () => {
  const search = { id: "1", kind: "search", observedAt: "2026-01-01T12:00:00.000Z", listing: { price: 30 } };
  const detail = { ...search, kind: "detail", listing: { price: 25, condition: "used" } };
  const gone = { id: "1", kind: "gone", observedAt: search.observedAt };
  assert.equal(newestListingObservation(search, detail), detail);
  assert.equal(newestListingObservation(detail, search), detail);
  assert.equal(newestListingObservation(detail, gone), gone);
  assert.equal(newestListingObservation(gone, detail), gone);
  const newer = { ...search, observedAt: "2026-01-01T12:00:01.000Z" };
  assert.equal(newestListingObservation(detail, newer), newer);
  assert.equal(newestListingObservation(gone, newer), newer);
  assert.equal(newestListingObservation(null, search), search);
});
