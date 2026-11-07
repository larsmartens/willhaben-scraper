import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { reviewEvidence } from "../src/review.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const storage = await mkdtemp(join(tmpdir(), "willhaben-refinement-"));
const bundle = await build({ absWorkingDir: root, stdin: { contents: `
  import * as research from './src/research.mjs';
  import { invokeTool } from './src/tools.mjs';
  export { ResearchSession } from './src/research-session.mjs';
  export default { async fetch(request, env) {
    const { action, args, owner = 'fixture-owner' } = await request.json();
    const scoped = { ...env, REQUEST_LIMIT_KEY: owner };
    try {
      const result = action === 'tool' ? await invokeTool(args.name, args.arguments, scoped)
        : await research[action](scoped, args);
      return Response.json({ result });
    } catch(error) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: 400 });
    }
  } };`, resolveDir: root, sourcefile: "refinement-entry.mjs" }, bundle: true, format: "esm",
  platform: "browser", conditions: ["workerd"], external: ["cloudflare:*"], write: false });
let upstreamCalls = 0;
const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-06-01",
  durableObjects: { RESEARCH_SESSIONS: { className: "ResearchSession", useSQLite: true } }, durableObjectsPersist: storage,
  outboundService() { upstreamCalls++; throw new Error("Refinement must use retained research observations"); } });

async function call(action, args = {}, owner) {
  const response = await mf.dispatchFetch("https://refinement.invalid/", { method: "POST",
    body: JSON.stringify({ action, args, owner }) });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error.message), body.error);
  return body.result;
}
const tool = (name, args, owner) => call("tool", { name, arguments: args }, owner);
const sourceTime = new Date(Date.now() - 60000).toISOString();
const listing = id => ({ id: String(id), title: "Lampe " + id, price: id % 2 ? 65 : 150, status: "active",
  galleryComplete: true, gallery: [0, 1].map(index => ({ index, url: `https://cache.willhaben.at/mmo/${id}-${index}.jpg` })) });

async function seed(researchId, rows, eventId, observedAt = sourceTime) {
  return call("recordResearch", { researchId,
    event: { type: "search", eventId, query: "Lampen", page: 1, pageSize: 1000, ids: rows.map(row => row.id), observedAt },
    observations: rows.map(row => ({ id: row.id, kind: "search", observedAt, listing: row })) });
}

async function deliver(researchId, row, indices, audience = "model", eventId = crypto.randomUUID()) {
  const evidence = await reviewEvidence(row);
  const result = await call("recordResearch", { researchId, event: { eventId, type: "photos", audience,
    photos: indices.map(index => ({ id: row.id, index, size: "full", evidenceId: evidence.evidenceId,
      photoId: evidence.photos[index].photoId, listingObservedAt: sourceTime })) } });
  return { evidence, result };
}

try {
  const { researchId } = await call("ensureResearch", { source: "live" });
  for (let start = 1; start <= 650; start += 200) {
    await seed(researchId, Array.from({ length: Math.min(200, 651 - start) }, (_, index) => listing(start + index)), "seed-" + start);
  }
  await tool("set_listing_feedback", { researchId, id: "1", decision: "reject" });
  await tool("set_listing_feedback", { researchId, id: "2", decision: "shortlist" });
  const first = await tool("refine_research", { researchId, criteria: [{ key: "price", value: { max: 100 } }] });
  assert.equal(first.stepEvaluated, 256);
  assert.equal(first.completed, false);
  assert.equal(first.collectionId, null);
  await tool("set_listing_feedback", { researchId, id: "259", decision: "reject" });
  await seed(researchId, [listing(651)], "later-discovery");
  const second = await tool("refine_research", first.continuation.arguments);
  assert.deepEqual(await tool("refine_research", first.continuation.arguments), second);
  await assert.rejects(tool("refine_research", { ...first.continuation.arguments, unknownPolicy: "exclude" }), { code: "invalid_research_input" });
  await assert.rejects(tool("refine_research", first.continuation.arguments, "another-owner"), { code: "research_unavailable" });
  const final = await tool("refine_research", second.continuation.arguments);
  assert.equal(final.stepEvaluated, 138);
  assert.equal(final.totalCandidates, 650);
  assert.equal(final.eligibleCount, 324);
  assert.equal(final.excludedCount, 326);
  assert.equal(final.completed, true);
  const ids = [];
  let cursor;
  do {
    const page = await call("readCollection", { researchId, collectionId: final.collectionId, pageSize: 24, cursor });
    ids.push(...page.selections.map(item => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(ids).size, 324);
  assert.ok(ids.includes("259"));
  assert.ok(!ids.includes("1") && !ids.includes("2") && !ids.includes("651"));
  assert.equal(upstreamCalls, 0);
  console.log("PASS 650 retained candidates refine in bounded steps with frozen membership/feedback, immutable replay and no upstream requests");

  const visual = await call("ensureResearch", { source: "live" });
  const row = listing(9001), red = listing(9003), unknown = listing(9005);
  await seed(visual.researchId, [row, red, unknown], "visual-seed");
  const appOnly = await deliver(visual.researchId, row, [0], "app");
  const reviewArgs = { researchId: visual.researchId, id: row.id, photoIndices: [0],
    evidenceId: appOnly.evidence.evidenceId, photoIds: [appOnly.evidence.photos[0].photoId], findings: "Grüner Schirm auf Originalfoto.",
    requirements: [{ requirement: "Grüner Lampenschirm", verdict: "confirmed", evidence: "Grüner Schirm in Frontansicht." }] };
  await assert.rejects(tool("record_review", reviewArgs), { code: "review_photo_not_delivered" });
  const delivered = await deliver(visual.researchId, row, [0]);
  assert.equal(delivered.result.reviewContexts[0].photos.length, 1);
  assert.equal(delivered.result.reviewContexts[0].photos[0].photoId, reviewArgs.photoIds[0]);
  await tool("record_review", reviewArgs);
  await deliver(visual.researchId, row, [1]);
  await tool("record_review", { ...reviewArgs, photoIndices: [1], photoIds: [delivered.evidence.photos[1].photoId],
    requirements: [{ requirement: "Original um 1930", verdict: "unknown", evidence: "Alter auf diesem Foto nicht belegbar." }] });
  const redDelivery = await deliver(visual.researchId, red, [0]);
  await tool("record_review", { ...reviewArgs, id: red.id, evidenceId: redDelivery.evidence.evidenceId,
    photoIds: [redDelivery.evidence.photos[0].photoId],
    requirements: [{ requirement: "Grüner Lampenschirm", verdict: "contradicted", evidence: "Schirm ist auf dem Foto rot." }] });
  const strictArgs = { researchId: visual.researchId, requirements: [{ requirement: "  Grüner   LAMPENSCHIRM ", mode: "require" }], unknownPolicy: "exclude" };
  const strict = await tool("refine_research", strictArgs);
  assert.deepEqual(strict.preview.map(item => item.id), [row.id]);
  assert.equal(strict.unknownCount, 1);
  const audit = await tool("get_research", { researchId: visual.researchId, section: "listings", ids: [row.id] });
  assert.equal(audit.listings[0].review.requirements.length, 2);
  assert.equal(audit.counts.photoBlocksDeliveredToModel, 3);
  assert.equal(audit.counts.uiPhotosLoaded, 1);
  assert.equal(audit.counts.detailRecordsRetrieved, 0);
  const negated = await tool("refine_research", { ...strictArgs, requirements: [{ requirement: "Kein grüner Lampenschirm", mode: "require" }] });
  assert.equal(negated.eligibleCount, 0);
  console.log("PASS strict visual follow-up reuses exact original-photo judgments while keeping unrelated requirements and unknown authenticity");

  const recent = new Date(Date.now() - 5000).toISOString();
  const earlier = new Date(Date.now() - 10000).toISOString();
  const record = (eventId, verdict, observedAt) => call("recordResearch", { researchId: visual.researchId,
    event: { ...reviewArgs, type: "review", eventId, observedAt,
      requirements: [{ requirement: "Grüner Lampenschirm", verdict, evidence: "Explizite erneute Bewertung." }] } });
  await record("later-confirmed", "confirmed", recent);
  await record("earlier-unknown", "unknown", earlier);
  assert.equal((await tool("refine_research", strictArgs)).eligibleCount, 1);
  await tool("record_review", { ...reviewArgs, requirements: [{ requirement: "Grüner Lampenschirm", verdict: "unknown", evidence: "Die Farbe bleibt offen." }] });
  assert.equal((await tool("refine_research", strictArgs)).eligibleCount, 0);
  console.log("PASS older overlapping reviews cannot replace newer requirements and a new explicit unknown replaces a positive judgment");

  await tool("record_review", reviewArgs);
  const reordered = { ...row, gallery: [...row.gallery].reverse().map((photo, index) => ({ ...photo, index })) };
  await seed(visual.researchId, [reordered], "photo-reorder", new Date(Date.now() + 1000).toISOString());
  assert.equal((await tool("refine_research", strictArgs)).eligibleCount, 1);
  const reorderedAudit = await tool("get_research", { researchId: visual.researchId, section: "listings", ids: [row.id] });
  assert.deepEqual(reorderedAudit.listings[0].review.requirements.find(item => item.verdict === "confirmed").photoIndices, [1]);
  await seed(visual.researchId, [{ ...reordered, price: 80 }], "price-change", new Date(Date.now() + 2000).toISOString());
  assert.equal((await tool("refine_research", strictArgs)).eligibleCount, 0);
  await assert.rejects(tool("record_review", reviewArgs), { code: "review_evidence_stale" });
  await seed(visual.researchId, [row], "facts-return", new Date(Date.now() + 3000).toISOString());
  assert.equal((await tool("refine_research", strictArgs)).eligibleCount, 0);
  await assert.rejects(tool("record_review", reviewArgs), { code: "review_photo_not_delivered" });
  assert.equal(upstreamCalls, 0);
  console.log("PASS photo identities survive reordering, changed facts invalidate evidence permanently until a new model-photo delivery");
} finally {
  await mf.dispose();
  await rm(storage, { recursive: true, force: true });
}
