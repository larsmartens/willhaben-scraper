import { fetchPublic, fetchVisualSearch } from "./traffic.mjs";

export const VISUAL_SEARCH_PATH = "/iad/kaufen-und-verkaufen/aehnlichkeitssuche";
export const MAX_VISUAL_IMAGE_BYTES = 10 * 1024 * 1024;
export const VISUAL_IMAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    download_url: { type: "string", minLength: 1, maxLength: 6000 },
    file_id: { type: "string", minLength: 1, maxLength: 200 },
    mime_type: { type: "string", minLength: 1, maxLength: 100 },
    file_name: { type: "string", minLength: 1, maxLength: 300 },
  },
  required: ["download_url", "file_id"],
};

const ORIGIN = "https://www.willhaben.at";
const MARKETPLACE = ORIGIN + "/iad/kaufen-und-verkaufen/marktplatz";
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (code, message, recoverable = false) => {
  throw Object.assign(new Error(message), { code, recoverable });
};

export function publicImageUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail("invalid_input", "Provide a public HTTPS image URL."); }
  const host = url.hostname.toLowerCase();
  if (typeof value !== "string" || value.length > 6000 || url.protocol !== "https:" ||
      url.username || url.password || url.port || url.hash ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|intranet|home|lan|test|invalid)$/.test(host)) {
    fail("invalid_input", "Use a public HTTPS image URL without credentials, a custom port, or a local address.");
  }
  return url;
}

export function validateVisualSource(args) {
  const sources = [args.image !== undefined, args.imageUrl !== undefined, args.listingId !== undefined];
  if (args.cursor !== undefined) {
    if (sources.some(Boolean) || args.photoIndex !== undefined)
      fail("invalid_input", "Continue with the returned cursor and omit the original image source.");
    return null;
  }
  if (sources.filter(Boolean).length !== 1)
    fail("invalid_input", "Choose exactly one image attachment, imageUrl, or listingId.");
  if (args.listingId !== undefined) {
    const index = args.photoIndex ?? 0;
    if (typeof args.listingId !== "string" || !/^\d{1,20}$/.test(args.listingId) ||
        !Number.isSafeInteger(index) || index < 0)
      fail("invalid_input", "Use a numeric listingId and a zero-based photoIndex.");
    return { source: "listing", listingId: args.listingId, photoIndex: index };
  }
  if (args.photoIndex !== undefined)
    fail("invalid_input", "photoIndex requires a listingId.");
  if (args.image !== undefined) {
    const file = args.image;
    if (!plain(file) || Object.keys(file).some(key => !Object.hasOwn(VISUAL_IMAGE_SCHEMA.properties, key)))
      fail("invalid_input", "Use the image attachment supplied by ChatGPT.");
    for (const [key, definition] of Object.entries(VISUAL_IMAGE_SCHEMA.properties)) {
      const value = file[key];
      if (value === undefined && !VISUAL_IMAGE_SCHEMA.required.includes(key)) continue;
      if (typeof value !== "string" || !value.trim() || value.length > definition.maxLength)
        fail("invalid_input", "The image attachment needs a valid download_url and file_id.");
    }
    return { source: "attachment", url: publicImageUrl(file.download_url).href };
  }
  return { source: "url", url: publicImageUrl(args.imageUrl).href };
}

export function validateVisualUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail("invalid_cursor", "The image-search continuation is invalid."); }
  const allowed = new Set(["pictureKey", "adId", "imageId", "imageUrl", "ATTRIBUTE_TREE", "rows", "page",
    "isNavigation", "publishedDateTo", "PRICE_FROM", "PRICE_TO", "areaId", "ISPRIVATE", "sort", "paylivery", "treeAttributes", "periode"]);
  if (url.origin !== ORIGIN || url.pathname !== VISUAL_SEARCH_PATH || url.username || url.password || url.hash ||
      [...url.searchParams.keys()].some(key => !allowed.has(key)))
    fail("invalid_cursor", "The image-search continuation has an unexpected destination.");
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    if (key !== "treeAttributes" && values.length !== 1)
      fail("invalid_cursor", "The image-search continuation contains conflicting parameters.");
    for (const text of values) {
      const numeric = Number(text);
      const valid = key === "pictureKey" ? uuid.test(text)
        : key === "imageUrl" ? validListingPhoto(text)
        : key === "isNavigation" || key === "paylivery" ? text === "true"
        : key === "ISPRIVATE" ? text === "0" || text === "1"
        : key === "periode" ? text === "2"
        : key === "PRICE_FROM" || key === "PRICE_TO" ? /^\d+(?:\.\d+)?$/.test(text) && numeric <= 1e9
        : /^\d+$/.test(text) && Number.isSafeInteger(numeric) && numeric >= (key === "publishedDateTo" ? 0 : 1);
      if (!valid) fail("invalid_cursor", "The image-search continuation contains an invalid parameter.");
    }
  }
  const pictureKey = url.searchParams.get("pictureKey");
  const photoParameters = ["adId", "imageId", "imageUrl"].map(key => url.searchParams.has(key));
  if (pictureKey ? photoParameters.some(Boolean) : !photoParameters.every(Boolean))
    fail("invalid_cursor", "The image-search continuation has no unique image identity.");
  const rows = Number(url.searchParams.get("rows") ?? 30);
  if (rows < 1 || rows > 100) fail("invalid_cursor", "Use a page size between 1 and 100.");
  return url;
}

function validListingPhoto(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://cache.willhaben.at" && !url.username && !url.password && !url.hash &&
      url.pathname.startsWith("/mmo/") && value.length <= 1200;
  } catch { return false; }
}

export function listingVisualUrl(listing, photoIndex) {
  const photo = listing.gallery?.[photoIndex];
  if (!photo) fail("image_index", "Choose a photoIndex from this listing's gallery.");
  if (!photo.similarSearchUrl)
    fail("visual_search_unavailable", "This listing photo has no native similarity-search link. Use its public image URL instead.");
  const url = validateVisualUrl(photo.similarSearchUrl);
  if (url.searchParams.get("adId") !== listing.id)
    fail("upstream_schema", "The native similarity link belongs to another listing.");
  return url;
}

export function nativeSimilarityUrl(value) {
  if (typeof value !== "string" || value.length > 3000) return null;
  try {
    const upstream = new URL(value);
    if (upstream.origin !== "https://ad-search.willhaben.at" || upstream.pathname !== "/restapi/v2/imagesearch/atz" ||
        upstream.username || upstream.password || upstream.hash) return null;
    return validateVisualUrl(ORIGIN + VISUAL_SEARCH_PATH + upstream.search).href;
  } catch { return null; }
}

export function encodeVisualCursor(url, filters, visual, requestedKeys = Object.keys(filters)) {
  const payload = JSON.stringify({ v: 1, url: validateVisualUrl(url).href, filters, visual, requestedKeys });
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  if (encoded.length > 4092) fail("invalid_cursor", "The image-search continuation is too large.");
  return "vs1." + encoded;
}

export function decodeVisualCursor(cursor) {
  let data;
  try {
    if (typeof cursor !== "string" || cursor.length > 4096 || !/^vs1\.[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const raw = atob(cursor.slice(4).replaceAll("-", "+").replaceAll("_", "/"));
    data = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, char => char.charCodeAt(0))));
  } catch { fail("invalid_cursor", "Use the nextCursor returned by search_by_image."); }
  if (!plain(data) || data.v !== 1 || Object.keys(data).some(key => !["v", "url", "filters", "visual", "requestedKeys"].includes(key)) ||
      !plain(data.filters) || !plain(data.visual))
    fail("invalid_cursor", "The image-search continuation is invalid.");
  const requestedKeys = data.requestedKeys ?? Object.keys(data.filters);
  if (!Array.isArray(requestedKeys) || requestedKeys.length > 32 || new Set(requestedKeys).size !== requestedKeys.length ||
      requestedKeys.some(key => typeof key !== "string" || !Object.hasOwn(data.filters,key)))
    fail("invalid_cursor", "The image-search filter identity is invalid.");
  const visual = data.visual;
  if (Object.keys(visual).some(key => !["source", "listingId", "photoIndex"].includes(key)) ||
      !["attachment", "url", "listing"].includes(visual.source))
    fail("invalid_cursor", "The image-search source is invalid.");
  if (visual.source === "listing") validateVisualSource({ listingId: visual.listingId, photoIndex: visual.photoIndex });
  else if (visual.listingId !== undefined || visual.photoIndex !== undefined)
    fail("invalid_cursor", "The image-search source is inconsistent.");
  return { url: validateVisualUrl(data.url), filters: data.filters, visual, requestedKeys,
    requestedFilters:Object.fromEntries(requestedKeys.map(key => [key,data.filters[key]])) };
}

async function boundedBytes(response, maximum, deadline) {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    fail("image_too_large", "Choose an image up to 10 MiB.");
  }
  if (!response.body) fail("image_unavailable", "The image response has no content.");
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const remaining = deadline-Date.now();
      if (remaining <= 0) fail("time_budget", "The image-search response exceeded the call's time budget.", true);
      let timer;
      const next = await Promise.race([
        reader.read(),
        new Promise((_,reject) => { timer=setTimeout(() => {
          reject(Object.assign(new Error("The image-search response exceeded the call's time budget."),{code:"time_budget",recoverable:true}));
          reader.cancel().catch(()=>{});
        },remaining); }),
      ]).finally(()=>clearTimeout(timer));
      const { done, value } = next;
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        fail("image_too_large", "Choose an image up to 10 MiB.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function imageFormat(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  const text = new TextDecoder().decode(bytes.subarray(0, 16));
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  if (/^GIF8[79]a/.test(text)) return "image/gif";
  if (text.slice(4, 8) === "ftyp" && /^avi[fs]/.test(text.slice(8, 12))) return "image/avif";
  fail("image_format", "Choose a JPEG, PNG, WebP, GIF, or AVIF image.");
}

async function downloadImage(value, env, deadline) {
  let url = publicImageUrl(value);
  for (let redirect = 0; redirect < 4; redirect++) {
    const remaining = Math.min(12000, deadline - Date.now());
    if (remaining < 100) fail("time_budget", "Retry the image search in another call.", true);
    const response = url.origin === "https://cache.willhaben.at" && url.pathname.startsWith("/mmo/")
      ? await fetchPublic(url, { ...env, REQUEST_DEADLINE: deadline }, { accept: "image/*", timeoutMs: remaining })
      : await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(remaining), headers: { Accept: "image/*" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) fail("image_unavailable", "The image redirect has no destination.");
      url = publicImageUrl(new URL(location, url).href);
      continue;
    }
    const mimeType = response.headers.get("content-type")?.split(";",1)[0].toLowerCase();
    if (!response.ok || !(mimeType?.startsWith("image/") || mimeType === "application/octet-stream")) {
      await response.body?.cancel();
      fail("image_unavailable", "The source image could not be downloaded. Supply an accessible image or a fresh attachment.");
    }
    return boundedBytes(response, MAX_VISUAL_IMAGE_BYTES, deadline);
  }
  fail("image_unavailable", "The source image redirected too many times.");
}

async function prepareJpeg(source, env, deadline) {
  const bytes = await downloadImage(source.url, env, deadline);
  const format = imageFormat(bytes);
  if (!env.IMAGES) {
    if (format === "image/jpeg") return bytes;
    fail("image_transform_unavailable", "Image conversion is unavailable. Supply a JPEG image or enable the Cloudflare IMAGES binding.");
  }
  const remaining = deadline-Date.now();
  if (remaining <= 0) fail("time_budget", "Retry the image search in another call.", true);
  let image, timer;
  try {
    image = await Promise.race([
      env.IMAGES.input(new Response(bytes).body)
        .transform({ width: 300, height: 300, fit: "scale-down" })
        .output({ format: "image/jpeg", quality: 90, anim: false }),
      new Promise((_,reject) => { timer=setTimeout(() => reject(Object.assign(new Error("Image conversion timed out."),
        {code:"time_budget",recoverable:true})),remaining); }),
    ]);
  } catch (error) {
    if (error?.code === "time_budget") throw error;
    fail("image_transform_unavailable", "Image conversion failed. Supply a JPEG image or check the Cloudflare IMAGES binding.", true);
  } finally { clearTimeout(timer); }
  const jpeg = await boundedBytes(image.response(), MAX_VISUAL_IMAGE_BYTES, deadline);
  if (imageFormat(jpeg) !== "image/jpeg") fail("image_format", "Image conversion did not produce JPEG content.");
  return jpeg;
}

function anonymousSession(headers) {
  const combined = headers.get("set-cookie") ?? "";
  const values = (headers.getSetCookie?.() ?? [combined]).flatMap(value => value.split(/,(?=\s*[^;,=\s]+=)/));
  const cookies = values.map(value => value.split(";", 1)[0].trim()).filter(value => /^[^=;,\s]+=[^\r\n;]*$/.test(value));
  const csrf = cookies.find(value => value.startsWith("x-bbx-csrf-token="));
  if (!csrf) fail("visual_search_unavailable", "willhaben did not provide its anonymous image-search session. Retry later.", true);
  return { cookie: cookies.join("; "), csrfToken: csrf.slice("x-bbx-csrf-token=".length) };
}

export async function uploadSearchImage(source, env, deadline) {
  try {
    const jpeg = await prepareJpeg(source, env, deadline);
    const bootstrap = await fetchPublic(MARKETPLACE, { ...env, REQUEST_DEADLINE: deadline });
    await bootstrap.body?.cancel();
    if (!bootstrap.ok) fail("visual_search_unavailable", "The anonymous image-search session is unavailable.", true);
    const session = anonymousSession(bootstrap.headers);
    const response = await fetchVisualSearch(jpeg, session, { ...env, REQUEST_DEADLINE: deadline });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      await response.body?.cancel();
      fail("visual_search_unavailable", "willhaben could not complete the image search.", true);
    }
    const bytes = await boundedBytes(response, 4 * 1024 * 1024, deadline);
    let result;
    try { result = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { fail("upstream_schema", "The native image-search response changed."); }
    const link = result?.searchContextLinks?.contextLink?.find(entry => entry.id === "resultListSeoNavigatorLink")?.uri;
    if (typeof link !== "string") fail("upstream_schema", "The native image search returned no continuation.");
    const native = new URL(link, ORIGIN);
    const key = native.searchParams.get("pictureKey");
    if (!key || !uuid.test(key)) fail("upstream_schema", "The native image search returned an invalid picture key.");
    const url = new URL(VISUAL_SEARCH_PATH, ORIGIN);
    url.searchParams.set("pictureKey", key);
    url.searchParams.set("isNavigation", "true");
    return { url, raw: result };
  } catch (error) {
    if (typeof error?.code === "string") throw error;
    fail(Date.now() >= deadline ? "time_budget" : "image_unavailable",
      "The image search could not complete. Retry with an accessible image.", true);
  }
}
