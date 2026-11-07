import { evaluateListing } from "./engine.mjs";
import { galleryOf, imageBatch, pausesBatch, requireImageAccess, toolFailure } from "./images.mjs";
import { safeWebUrl } from "./providers.mjs";

function sourceUrl(value, kind) {
  const url = safeWebUrl(value, kind);
  return url && !new URL(url).hash ? url : null;
}

function listingCard(row, selection, rank, source, criteria) {
  const gallery = galleryOf(row);
  const index = selection.photoIndex ?? 0;
  const photo = gallery[index];
  const url = sourceUrl(photo?.url, "image");
  const card = {
    id: row.id, rank, title: row.title, url: sourceUrl(row.url, "ad"), price: row.price,
    status: row.status ?? "unknown",
    observedAt: source === "live" ? row.observedAt ?? null : null,
    cacheAgeSeconds: source === "live" ? row.cacheAgeSeconds ?? null : null,
    imageCount: row.imageCount ?? gallery.length,
    image: { index, url, status: url ? "pending" : "missing" },
    assessment: { reason: selection.reason ?? null, cautions: selection.cautions ?? [],
      evaluation: criteria.length ? evaluateListing(row, criteria) : null },
  };
  if (!photo && (gallery.length || index > 0)) {
    card.image.status = "failed";
    card.image.error = {
      id: row.id, index, code: "photo_index_unavailable", recoverable: true,
      message: "This photo index is outside the known gallery. Choose an available index or inspect the listing to verify its full gallery.",
      availableIndices: gallery.map((_, availableIndex) => availableIndex),
      nextAction: "Repeat present_listings with an available photoIndex. Use inspect_listings first if the full gallery is still unknown.",
    };
  }
  for (const key of ["priceType", "location", "condition", "quantity", "shipping", "shippingCost", "sellerType", "galleryComplete"]) {
    if (row[key] !== undefined) card[key] = row[key];
  }
  if (Number.isFinite(row.price) && Number.isSafeInteger(row.quantity) && row.quantity > 0) {
    card.unitPrice = Math.round(row.price / row.quantity * 100) / 100;
  }
  if (Number.isFinite(row.price) && Number.isFinite(row.shippingCost) && ["shipping", "both"].includes(row.shipping)) {
    card.totalPrice = Math.round((row.price + row.shippingCost) * 100) / 100;
  }
  return { card, thumbnailUrl: sourceUrl(photo?.thumbnailUrl, "image") };
}

export async function presentListings(args, env, provider) {
  const deadline = Math.min(Date.now() + 35000, Number.isFinite(env.REQUEST_DEADLINE) ? env.REQUEST_DEADLINE : Infinity);
  const cards = [], missingIds = [], errors = [], requests = [];
  for (const [position, selection] of args.selections.entries()) {
    try {
      if (Date.now() >= deadline) throw Object.assign(new Error("Continue this selection in another call."), { code: "time_budget", recoverable: true });
      const row = await provider.summary(selection.id, { deadline });
      if (!row) {
        missingIds.push(selection.id);
        continue;
      }
      if (row.id !== selection.id) throw Object.assign(new Error("The cached observation has a different listing ID. Inspect this ID again."), {
        code: "observation_mismatch", recoverable: true,
      });
      const { card, thumbnailUrl } = listingCard(row, selection, position + 1, provider.kind, args.criteria ?? []);
      cards.push(card);
      if (card.image.error) errors.push({ ...card.image.error, stage: "image" });
      if (card.image.url) requests.push({ id: card.id, index: card.image.index,
        url: card.image.url, size: "full", thumbnailUrl });
    } catch (cause) {
      const error = { id: selection.id, stage: "observation", ...toolFailure(cause) };
      errors.push(error);
      missingIds.push(selection.id);
      if (pausesBatch(error)) {
        missingIds.push(...args.selections.slice(position + 1).map(item => item.id));
        break;
      }
    }
  }

  let imageAccess = true;
  try { requireImageAccess(env); } catch { imageAccess = false; }
  const listingImages = [];
  if (requests.length && imageAccess) {
    const selectedRequests = requests.slice(0, args.hydrationLimit ?? 2);
    const batch = { results: [], errors: [], processed: 0, _images: [] };
    let encodedBudget = 8 * 1024 * 1024 - 512 * 1024;
    for (let offset = 0; offset < selectedRequests.length; offset += 8) {
      const part = await imageBatch(selectedRequests.slice(offset, offset + 8), env, { deadline, encodedBudget });
      batch.results.push(...part.results.map(result => ({ ...result, imageContentIndex: result.imageContentIndex + batch._images.length })));
      batch.errors.push(...part.errors);
      batch.processed += part.processed;
      batch._images.push(...part._images);
      encodedBudget -= part._images.reduce((sum, image) => sum + image.data.length, 0);
      if (part.stopReason) break;
    }
    const byId = new Map(cards.map(card => [card.id, card]));
    for (const result of batch.results) {
      const card = byId.get(result.id);
      const image = batch._images[result.imageContentIndex - 1];
      if (!card || card.image.index !== result.index || !image) throw new Error("Photo result does not match the selected listing.");
      card.image = { index: result.index, url: result.url, status: "ready", size: result.size };
      listingImages.push({ id: result.id, index: result.index, mimeType: image.mimeType, data: image.data });
    }
    for (const error of batch.errors) {
      const card = byId.get(error.id);
      if (!card || card.image.index !== error.index) throw new Error("Photo failure does not match the selected listing.");
      card.image.status = pausesBatch(error) ? "pending" : "failed";
      card.image.error = error;
      errors.push({ ...error, stage: "image" });
    }
    const paused = batch.errors.find(pausesBatch);
    if (paused) {
      for (const request of requests.slice(batch.processed, args.hydrationLimit ?? 2)) {
        const card = byId.get(request.id);
        card.image.error ??= { ...paused, id: card.id, index: card.image.index };
      }
    }
  } else if (!imageAccess) {
    for (const card of cards) if (card.image.url) card.image.status = "not_enabled";
  }

  const retry = errors.find(error => error.retryAt);
  let nextAction = "For a request to show offers, finish with one plain-text sentence pointing to the app cards. For requested advice or a study, add the requested decision analysis. Keep each offer's photos, facts and original links in the app cards.";
  if (missingIds.length) {
    nextAction = "Keep missingIds visible as unavailable observations. Refresh the relevant search in the same researchId with fresh=true, then retry this collection page. Use inspect_listings for targeted verification of individual missingIds.";
  } else if (errors.some(error => error.code === "photo_index_unavailable")) {
    nextAction = "Keep the available cards. Correct photoIndex using image.error.availableIndices, then repeat present_listings. Respect retryAt for pending photos.";
  } else if (errors.length) {
    nextAction = "Keep the available cards. Respect retryAt, then retry the affected photos with inspect_listing_images.";
  }
  return {
    source: provider.kind, title: args.title ?? "Ausgewählte Angebote",
    ...(args.summary ? { summary: args.summary } : {}),
    requestedCount: args.selections.length, pageRequestedCount: args.selections.length,
    pageComplete: missingIds.length === 0, shownCount: cards.length, cards, missingIds, errors,
    nextAction,
    ...(retry ? { retryAt: retry.retryAt, retryAfterSeconds: retry.retryAfterSeconds } : {}),
    _meta: { listingImages },
  };
}
