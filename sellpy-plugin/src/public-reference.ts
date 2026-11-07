import { ToolError, type RequestContext } from './domain.js';
import { retryAt } from './http.js';
import { imageMime } from './images.js';
import { publicImageUrl } from './sellpy/normalize.js';

export const PUBLIC_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const PUBLIC_REFERENCE_MAX_REDIRECTS = 4;
export const PUBLIC_REFERENCE_TIMEOUT_MS = 15000;
const PRIVATE_SUFFIXES = new Set(['localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'home', 'home.arpa', 'onion', 'invalid', 'test']);
const ACCEPT = 'image/jpeg,image/png,image/webp';

export interface PreparedPublicReference {
  bytes: Uint8Array;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
  file_name: string;
  source_url: string;
}

/** URL policy is only one layer. Resolved-address isolation is the production
 * Workers global-fetch outbound proxy's responsibility, not a DNS preflight
 * vulnerable to a lookup/fetch race. Do not substitute a VPC/service binding or
 * an unprotected Node fetch in production. See:
 * https://developers.cloudflare.com/workers/reference/security-model/
 * This deployment uses workers.dev, without a zone-origin/private-network route.
 */
export function validatePublicReferenceUrl(input: string | URL): URL {
  const text = String(input);
  if (!text || text.length > 16000 || /[\u0000-\u001f\u007f\\]/.test(text)) {
    throw new ToolError('unsafe_reference_url', 'The reference must be an absolute public HTTPS URL without control characters or backslashes.');
  }
  let url: URL;
  try { url = new URL(text); }
  catch { throw new ToolError('unsafe_reference_url', 'The reference URL is malformed.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new ToolError('unsafe_reference_url', 'Public reference images require HTTPS without credentials or custom ports.');
  }
  const host = url.hostname.toLowerCase();
  // WHATWG parsing canonicalizes decimal, octal, hexadecimal and shortened IPv4
  // spellings; deny all literals, including public literals, rather than guess.
  if (!host.includes('.') || host.startsWith('[') || /^(?:\d+\.){3}\d+$/.test(host) || host.endsWith('.') ||
    host.length > 253 || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    [...PRIVATE_SUFFIXES].some(suffix => host === suffix || host.endsWith(`.${suffix}`)) ||
    host.split('.').some(label => ['localhost', 'metadata', 'instance-data'].includes(label))) {
    throw new ToolError('unsafe_reference_url', 'Local, private-network, internal and IP-literal reference destinations are not supported.', {
      next_action: 'Attach the image in chat or use an ordinary public HTTPS image host.',
    });
  }
  url.hash = '';
  return url;
}

export function isSellpyProductImageUrl(input: string): boolean {
  try { return publicImageUrl(validatePublicReferenceUrl(input).href) !== null; }
  catch { return false; }
}

/** Construct only uncredentialed public GETs. The caller must pass the native
 * global Workers fetch (bound to globalThis), never the Sellpy paced transport,
 * a private-network binding, or a caller-provided Request with inherited headers.
 * An injected transport is supported for controlled contract tests.
 */
export function createPublicReferenceFetch(rawFetch: typeof fetch = globalThis.fetch.bind(globalThis)): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const base = input instanceof Request ? input : undefined;
    const method = (init.method ?? base?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' || init.body !== undefined && init.body !== null || base?.body) {
      throw new ToolError('unsafe_reference_request', 'The public reference transport accepts body-free GET requests only.');
    }
    const url = validatePublicReferenceUrl(base?.url ?? String(input));
    return rawFetch(url.href, {
      method: 'GET', headers: { accept: ACCEPT }, credentials: 'omit', redirect: 'manual',
      referrerPolicy: 'no-referrer', signal: init.signal ?? base?.signal,
    });
  }) as typeof fetch;
}

function interrupt(context: RequestContext): ToolError {
  return context.signal?.aborted
    ? new ToolError('cancelled', 'The reference image download was cancelled.', { retryable: true })
    : new ToolError('time_budget', 'The reference image did not download within this call’s time budget.', {
      retryable: true, next_action: 'Retry with the same image or attach it in this chat.',
    });
}

async function abortable<T>(pending: Promise<T>, signal: AbortSignal, context: RequestContext): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(interrupt(context)); };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}

async function referenceBytes(response: Response, signal: AbortSignal, context: RequestContext): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > PUBLIC_REFERENCE_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ToolError('reference_too_large', 'A reference image must be at most 10 MiB.');
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw interrupt(context);
      const { done, value } = await abortable(reader.read(), signal, context);
      if (done) break;
      size += value.byteLength;
      if (size > PUBLIC_REFERENCE_MAX_BYTES) throw new ToolError('reference_too_large', 'A reference image must be at most 10 MiB.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Download with a dedicated public-reference context; validate and retain the
 * returned bytes per run, then use Sellpy's verified multipart upload route.
 * No arbitrary external URL is sent to the native product-image URL service.
 */
export async function preparePublicReference(input: string, context: RequestContext): Promise<PreparedPublicReference> {
  let url = validatePublicReferenceUrl(input);
  if (context.signal?.aborted || !Number.isFinite(context.deadline) || Date.now() >= context.deadline) throw interrupt(context);
  const controller = new AbortController();
  const propagateAbort = () => controller.abort();
  context.signal?.addEventListener('abort', propagateAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.min(PUBLIC_REFERENCE_TIMEOUT_MS, context.deadline - Date.now()));
  const signal = controller.signal;
  const visited = new Set<string>();
  // Wrapping again is safe: it ensures inherited headers and cf options cannot
  // enter through the RequestContext, while preserving the injected test seam.
  const publicFetch = createPublicReferenceFetch(context.fetch);
  try {
    for (let redirects = 0; ; redirects++) {
      if (signal.aborted || Date.now() >= context.deadline) throw interrupt(context);
      if (visited.has(url.href)) throw new ToolError('reference_redirect_loop', 'The reference image redirects in a loop.');
      visited.add(url.href);
      let response: Response;
      try { response = await abortable(publicFetch(url.href, { signal }), signal, context); }
      catch (error) {
        if (signal.aborted) throw interrupt(context);
        if (error instanceof ToolError) throw error;
        throw new ToolError('reference_unavailable', 'The public reference image could not be downloaded.', {
          retryable: true, next_action: 'Use another public image URL or attach the image in this chat.',
        });
      }
      if (response.redirected) {
        await response.body?.cancel().catch(() => undefined);
        throw new ToolError('unsafe_reference_redirect', 'The reference transport followed a redirect without validating its destination.');
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (redirects >= PUBLIC_REFERENCE_MAX_REDIRECTS) throw new ToolError('reference_redirect_limit', 'The public image exceeded the four-redirect budget.');
        if (!target || /[\u0000-\u001f\u007f\\]/.test(target)) throw new ToolError('unsafe_reference_redirect', 'The reference redirect has a missing or malformed target.');
        try { url = validatePublicReferenceUrl(new URL(target, url)); }
        catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError('unsafe_reference_redirect', 'The reference redirect target is malformed.');
        }
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const retry = retryAt(response.headers.get('retry-after'));
        throw new ToolError(response.status === 429 ? 'rate_limited' : 'reference_unavailable', `The public reference returned HTTP ${response.status}.`, {
          retryable: response.status === 429 || response.status === 408 || response.status >= 500,
          ...(retry !== null ? { retry_at: new Date(retry).toISOString() } : {}),
          next_action: 'Retry after any indicated pause, or attach the image in this chat.',
        });
      }
      const bytes = await referenceBytes(response, signal, context);
      if (signal.aborted || Date.now() >= context.deadline) throw interrupt(context);
      const mime = imageMime(bytes);
      if (!mime) throw new ToolError('unsupported_reference', 'The downloaded bytes are not a supported JPEG, PNG or WebP image.');
      return { bytes, mime_type: mime, file_name: `reference.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`,
        source_url: url.href };
    }
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener('abort', propagateAbort);
  }
}
