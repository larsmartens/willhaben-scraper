import { evaluateListing, validateCriteria } from "./engine.mjs";

export const REFINEMENT_STEP_SIZE = 256;

const failure = message => Object.assign(new TypeError(message), { code: "invalid_research_input", recoverable: true });
const labels = new Set(["confirmed", "contradicted", "unknown"]);

export function requirementKey(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function shortText(value, name, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw failure(`Invalid ${name}`);
  return value.trim();
}

export function normalizeRequirements(input = [], reviewed = false) {
  if (!Array.isArray(input) || input.length > 24) throw failure("Supply at most 24 visual requirements");
  const requirements = input.map(item => {
    const requirement = shortText(item?.requirement, "requirement", 160);
    if (reviewed) {
      if (!labels.has(item.verdict)) throw failure("Requirement verdict must be confirmed, contradicted or unknown");
      const result = { requirement, verdict: item.verdict, evidence: shortText(item.evidence, "requirement evidence", 600) };
      if (item.photoIds !== undefined) result.photoIds = normalizePhotoIds(item.photoIds);
      return result;
    }
    if (!["require", "avoid", "prefer"].includes(item?.mode)) throw failure("Requirement mode must be require, avoid or prefer");
    return { requirement, mode: item.mode };
  });
  const keys = requirements.map(item => requirementKey(item.requirement));
  if (new Set(keys).size !== keys.length) throw failure("Use each exact normalized requirement once");
  return requirements;
}

export function normalizePhotoIds(input) {
  if (!Array.isArray(input) || !input.length || input.length > 32 ||
      input.some(id => typeof id !== "string" || !/^wp_[a-f0-9]{64}$/.test(id)) || new Set(input).size !== input.length) {
    throw failure("Copy distinct photoIds from the successfully delivered review context");
  }
  return input;
}

export function validateEvidenceId(value) {
  if (typeof value !== "string" || !/^we_[a-f0-9]{64}$/.test(value)) {
    throw failure("Copy evidenceId from the successfully delivered review context");
  }
  return value;
}

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function reviewEvidence(listing) {
  const facts = Object.fromEntries(["id", "title", "price", "priceType", "status", "condition", "quantity",
    "shipping", "shippingCost", "category", "categoryId", "model"].map(key => [key, listing[key] ?? null]));
  facts.attributes = Object.fromEntries(Object.keys(listing.attributes ?? {}).sort().map(key => [key, listing.attributes[key]]));
  const gallery = listing.gallery ?? (listing.images ?? []).map((url, index) => ({
    index, url, thumbnailUrl: index === 0 ? listing.thumbnailUrl : null,
  }));
  return { evidenceId: "we_" + await digest(JSON.stringify(facts)),
    photos: await Promise.all(gallery.map(async (photo, index) => {
      const originalUrl = photo.url ?? photo.thumbnailUrl;
      return { index, photoId: originalUrl ? "wp_" + await digest(new URL(originalUrl).href) : null };
    })) };
}

export function normalizeRefinement(args) {
  const requirements = normalizeRequirements(args.requirements);
  const criteria = args.criteria ?? [];
  validateCriteria(criteria);
  const unknownPolicy = args.unknownPolicy ?? "include";
  const feedbackFilter = args.feedbackFilter ?? "all";
  if (!["include", "exclude"].includes(unknownPolicy)) throw failure("unknownPolicy must be include or exclude");
  if (!["all", "shortlisted"].includes(feedbackFilter)) throw failure("feedbackFilter must be all or shortlisted");
  return { requirements, criteria, unknownPolicy, feedbackFilter };
}

export function evaluateRefinement(observation, review, feedback, preferences) {
  if (!observation?.listing || observation.kind === "gone") return {
    eligible: false, unknown: false, score: 0, reason: "observation_unavailable", requirements: [], factual: null,
    observedAt: observation?.observedAt ?? null,
  };
  const factual = evaluateListing(observation.listing, preferences.criteria);
  const byKey = new Map((review?.requirements ?? []).map(item => [requirementKey(item.requirement), item]));
  const requirements = preferences.requirements.map(item => {
    const evidence = byKey.get(requirementKey(item.requirement));
    return { ...item, verdict: evidence?.verdict ?? "unknown", evidence: evidence?.evidence ?? "",
      photoIds: evidence?.photoIds ?? [], photoIndices: evidence?.photoIndices ?? [] };
  });
  const hard = requirements.filter(item => item.mode !== "prefer");
  const unknown = factual.status === "unknown" || hard.some(item => item.verdict === "unknown");
  const contradicted = factual.status === "contradicted" || hard.some(item =>
    item.verdict === (item.mode === "avoid" ? "confirmed" : "contradicted"));
  let reason = "requirements_match";
  if (feedback.decision === "reject") reason = "user_rejected";
  else if (preferences.feedbackFilter === "shortlisted" && feedback.decision !== "shortlist") reason = "not_shortlisted";
  else if (contradicted) reason = "requirement_contradicted";
  else if (unknown && preferences.unknownPolicy === "exclude") reason = "requirement_unknown";
  const score = (feedback.decision === "shortlist" ? 100 : 0) +
    hard.filter(item => item.verdict === (item.mode === "avoid" ? "contradicted" : "confirmed")).length * 2 +
    requirements.filter(item => item.mode === "prefer" && item.verdict === "confirmed").length;
  return { eligible: reason === "requirements_match", unknown, score, reason, factual, requirements,
    observedAt: observation.observedAt };
}
