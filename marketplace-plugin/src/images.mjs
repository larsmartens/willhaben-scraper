import { PERSONAL_TEST } from "./providers.mjs";
import { fetchPublic } from "./traffic.mjs";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_ENCODED_BYTES = 8 * 1024 * 1024 - 512 * 1024;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const stoppedCodes = new Set([
  "upstream_rate_limited", "upstream_forbidden", "upstream_blocked", "upstream_busy",
  "upstream_unavailable", "upstream_timeout", "traffic_unavailable", "traffic_not_configured",
  "time_budget", "response_budget",
]);

function failure(code, message, recoverable = false) {
  return Object.assign(new Error(message), { code, recoverable });
}

export function toolFailure(cause) {
  const code = typeof cause?.code === "string" && /^[a-z_]{2,55}$/.test(cause.code) ? cause.code : "provider_error";
  return {
    code,
    message: String(cause?.message || "The request failed.").replace(/[\x00-\x1f]/g, " ").slice(0, 500),
    recoverable: cause?.recoverable === true,
    ...(Number.isFinite(cause?.retryAfterSeconds) ? { retryAfterSeconds: cause.retryAfterSeconds } : {}),
    ...(typeof cause?.retryAt === "string" ? { retryAt: cause.retryAt } : {}),
  };
}

export function pausesBatch(error) {
  return stoppedCodes.has(error.code) || typeof error.retryAt === "string";
}

export function requireImageAccess(env) {
  const personal = env.LIVE_ACCESS === PERSONAL_TEST && env.IMAGE_ACCESS === PERSONAL_TEST;
  const authorized = env.LIVE_ACCESS === "authorized" && env.IMAGE_ACCESS === "authorized" && Boolean(env.MCP_BEARER_TOKEN);
  if (!personal && !authorized) {
    throw failure("image_access_not_configured", "Photo bytes require a photo-enabled private connection.");
  }
}

function imageUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw failure("image_unavailable", "This image has no usable source URL."); }
  if (url.origin !== "https://cache.willhaben.at" || !url.pathname.startsWith("/mmo/") ||
      url.username || url.password || url.port || url.hash) {
    throw failure("image_source", "The photo source must be the willhaben image CDN.");
  }
  return url;
}

function validSignature(bytes, type) {
  if (type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  return String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
}

async function readImage(value, env, deadline, encodedBudget) {
  const url = imageUrl(value);
  const remaining = deadline - Date.now();
  if (remaining < 100) throw failure("time_budget", "Continue with the remaining photo indices.", true);
  const response = await fetchPublic(url, env, {
    accept: "image/webp,image/jpeg,image/png",
    timeoutMs: Math.min(8000, remaining),
  });
  const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const declared = Number(response.headers.get("content-length"));
  if (!response.ok || !imageTypes.has(mimeType) || !response.body) {
    await response.body?.cancel();
    throw failure("image_unavailable", "The photo is unavailable or uses an unsupported format.");
  }
  if (declared > MAX_IMAGE_BYTES) {
    await response.body.cancel();
    throw failure("image_too_large", "This photo exceeds 4 MiB. Request its thumbnail or a link.");
  }
  if (Math.ceil(declared / 3) * 4 > encodedBudget) {
    await response.body.cancel();
    throw failure("response_budget", "Continue with this photo in the next image batch.", true);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES || Math.ceil(size / 3) * 4 > encodedBudget) {
        await reader.cancel();
        throw size > MAX_IMAGE_BYTES
          ? failure("image_too_large", "This photo exceeds 4 MiB. Request its thumbnail or a link.")
          : failure("response_budget", "Continue with this photo in the next image batch.", true);
      }
      chunks.push(value);
    }
  } catch (cause) {
    await reader.cancel().catch(() => {});
    if (["image_too_large", "response_budget"].includes(cause?.code)) throw cause;
    if (Date.now() >= deadline) {
      throw failure("time_budget", "Continue with this photo in the next image batch.", true);
    }
    if (cause?.name === "AbortError" || cause?.name === "TimeoutError") {
      throw failure("upstream_timeout", "The photo stream timed out. Continue with this photo in the next batch.", true);
    }
    throw failure("upstream_unavailable", "The photo stream was interrupted. Continue with this photo in the next batch.", true);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!validSignature(bytes, mimeType)) throw failure("image_format", "The returned bytes do not match the photo format.");
  const blocks = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    blocks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return { image: { type: "image", mimeType, data: btoa(blocks.join("")) }, bytes: size };
}

export async function imageBatch(requests, env, { mode = "images", deadline = Date.now() + 35000, encodedBudget = MAX_ENCODED_BYTES } = {}) {
  if (!Array.isArray(requests) || requests.length > 8 || !["images", "links"].includes(mode)) {
    throw failure("invalid_input", "Request at most eight photos in images or links mode.");
  }
  if (Number.isFinite(env.REQUEST_DEADLINE)) deadline = Math.min(deadline, env.REQUEST_DEADLINE);
  encodedBudget = Math.min(MAX_ENCODED_BYTES, encodedBudget);
  if (mode === "images" && requests.length) requireImageAccess(env);
  const results = [], errors = [], images = [];
  let processed = 0, encodedBytes = 0, stopReason = null;
  for (const request of requests) {
    try {
      if (Date.now() >= deadline) throw failure("time_budget", "Continue with the remaining photo indices.", true);
      let url = imageUrl(request.url).href;
      let size = request.size;
      if (mode === "links") {
        results.push({ id: request.id, index: request.index, url, size });
      } else {
        let fetched;
        try {
          fetched = await readImage(url, env, deadline, encodedBudget - encodedBytes);
        } catch (cause) {
          if (!["image_unavailable", "image_too_large", "response_budget"].includes(cause?.code) ||
              !request.thumbnailUrl || request.thumbnailUrl === url) throw cause;
          url = imageUrl(request.thumbnailUrl).href;
          size = "thumbnail";
          fetched = await readImage(url, env, deadline, encodedBudget - encodedBytes);
        }
        encodedBytes += fetched.image.data.length;
        images.push(fetched.image);
        results.push({ id: request.id, index: request.index, url, size,
          mimeType: fetched.image.mimeType, bytes: fetched.bytes, imageContentIndex: images.length });
      }
      processed++;
    } catch (cause) {
      const error = { id: request.id, index: request.index, ...toolFailure(cause) };
      errors.push(error);
      if (pausesBatch(error)) {
        stopReason = error.code;
        break;
      }
      processed++;
    }
  }
  return { results, errors, processed, stopReason, _images: images };
}

export function galleryOf(row) {
  if (Array.isArray(row?.gallery)) return row.gallery;
  return (row?.images ?? []).map((url, index) => ({ index, url, thumbnailUrl: index === 0 ? row.thumbnailUrl : null }));
}

export async function readGallery(args, env, provider) {
  const deadline = Math.min(Date.now() + 35000, Number.isFinite(env.REQUEST_DEADLINE) ? env.REQUEST_DEADLINE : Infinity);
  if ((args.mode ?? "images") === "images") requireImageAccess(env);
  const row = await provider.detail(args.id, { fresh: args.fresh ?? false, deadline });
  if (!row) throw failure("listing_unavailable", "This listing is unavailable.");
  const gallery = galleryOf(row);
  const start = args.start ?? 0;
  const indices = args.indices ?? Array.from(
    { length: Math.min(args.count ?? 4, Math.max(0, gallery.length - start)) },
    (_, i) => start + i,
  );
  const size = args.size ?? "full";
  const requests = indices.map(index => {
    const photo = gallery[index];
    const thumbnail = size === "thumbnail" && photo?.thumbnailUrl;
    return { id: row.id, index, url: thumbnail || photo?.url, size: thumbnail ? "thumbnail" : "full" };
  });
  const batch = await imageBatch(requests, env, { mode: args.mode ?? "images", deadline });
  const nextIndex = args.indices ? null : start + batch.processed < gallery.length ? start + batch.processed : null;
  const remainingIndices = args.indices ? indices.slice(batch.processed) : [];
  return {
    source: "live", id: row.id, observedAt: new Date().toISOString(),
    listingObservedAt: row.observedAt ?? null, cacheAgeSeconds: row.cacheAgeSeconds ?? 0,
    galleryTotal: gallery.length, galleryComplete: row.galleryComplete === true,
    status: batch.errors.length || nextIndex !== null || remainingIndices.length || row.galleryComplete !== true ? "partial" : "complete",
    mode: args.mode ?? "images", requestedSize: size, results: batch.results, errors: batch.errors,
    nextIndex, ...(args.indices ? { remainingIndices } : {}),
    stopReason: batch.stopReason ?? (nextIndex !== null || remainingIndices.length ? "batch_size" : null),
    _images: batch._images,
  };
}
