import { ToolError } from './domain.js';

const SELLpy_DOMAINS = new Set(['sellpy.com', 'sellpy.at', 'sellpy.de', 'sellpy.se', 'sellpy.nl', 'sellpy.fi', 'sellpy.dk', 'sellpy.fr', 'sellpy.be', 'sellpy.pl', 'sellpy.cz', 'sellpy.it', 'sellpy.es', 'sellpy.ee', 'sellpy.lt', 'sellpy.lv']);

export function allowedUpstreamURL(input: string | URL): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new ToolError('invalid_url', 'Expected an absolute HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new ToolError('unsafe_url', 'Only HTTPS URLs without credentials or custom ports are supported.');
  }
  const host = url.hostname.toLowerCase();
  const allowed = [...SELLpy_DOMAINS].some(domain => host === domain || host === `www.${domain}`) ||
    host === 'services.sellpy.net' || host === 'search.sellpy.net' || host === 'sellpy-parse-prod.herokuapp.com' ||
    host === 'prod.images.sellpy.net' || host === 'images.sellpy.net' ||
    host === 'sellpy-parse-prod-files.s3.amazonaws.com' || host === 'sellpy-parse-prod-files.s3.eu-west-1.amazonaws.com' ||
    /^[a-z0-9-]+\.(?:algolia\.net|algolianet\.com)$/.test(host) ||
    host === 'files.oaiusercontent.com' || host.endsWith('.oaiusercontent.com') ||
    host.endsWith('.usercontent.chatgpt.com') ||
    /^oaisd[a-z0-9-]*\.blob\.core\.windows\.net$/.test(host) ||
    /^oaisd[a-z0-9-]*\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com$/.test(host);
  if (!allowed) throw new ToolError('unsupported_image_host', 'This host is not a Sellpy service or a supported ChatGPT file host.', {
    next_action: 'Upload the reference image in this chat, or use a product image URL returned by Sellpy.'
  });
  url.hash = '';
  return url;
}

export function retryAt(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(now, date) : null;
}

export async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new ToolError('response_too_large', 'The upstream response exceeds this call’s memory budget.', {
      next_action: 'Request a smaller page or another image view; previously completed results remain available.'
    });
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ToolError('response_too_large', 'The upstream response exceeds this call’s memory budget.');
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function remaining(deadline: number): number {
  const duration = deadline - Date.now();
  if (duration <= 0) throw new ToolError('time_budget', 'This call reached its work deadline.', {
    retryable: true, next_action: 'Continue the same search with the returned cursor.'
  });
  return duration;
}

export async function pause(ms: number, deadline: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) { remaining(deadline); return; }
  if (ms >= remaining(deadline)) throw new ToolError('time_budget', 'The next paced request falls after this call’s deadline.', {
    retryable: true, retry_at: new Date(Date.now() + ms).toISOString(), next_action: 'Continue after retry_at.'
  });
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new ToolError('cancelled', 'The request was cancelled.', { retryable: true })); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { signal.removeEventListener('abort', abort); abort(); }
  });
}

export interface OriginPermit {
  wait_until: number;
  retry_until: number;
  granted: boolean;
}

export interface TrafficGate {
  reserve(now: number, spacing: number, deadline: number): Promise<OriginPermit>;
  cooldown(until: number): Promise<void>;
  cooldownUntil(): Promise<number>;
}

export function pacedFetch(options: { deadline: number; gate: (host: string) => TrafficGate; fetch: typeof fetch; signal?: AbortSignal }): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const base = input instanceof Request ? input : undefined;
    let url = allowedUpstreamURL(base?.url ?? String(input));
    const method = init.method ?? base?.method ?? 'GET';
    const headers = new Headers(init.headers ?? base?.headers);
    const body = init.body ?? (base && method !== 'GET' && method !== 'HEAD' ? await base.clone().arrayBuffer() : undefined);
    for (let attempt = 0; attempt < 3; attempt++) {
      for (let redirect = 0; redirect < 4; redirect++) {
        const gate = options.gate(url.hostname);
        const imageHost = url.hostname.endsWith('images.sellpy.net');
        const spacing = (imageHost ? 100 : 350) + Math.floor(Math.random() * 100);
        let permit = await gate.reserve(Date.now(), spacing, options.deadline);
        for (;;) {
          if (!permit.granted) throw new ToolError(permit.retry_until > Date.now() ? 'rate_limited' : 'time_budget', 'The provider is waiting before its next request.', {
            retryable: true, retry_at: new Date(Math.max(permit.wait_until, permit.retry_until)).toISOString(), next_action: 'Continue after retry_at; keep the current search cursor.'
          });
          await pause(permit.wait_until - Date.now(), options.deadline, options.signal);
          if (await gate.cooldownUntil() <= Date.now()) break;
          permit = await gate.reserve(Date.now(), spacing, options.deadline);
        }
        const timeout = AbortSignal.timeout(Math.min(15000, remaining(options.deadline)));
        const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
        let response: Response;
        try {
          response = await options.fetch(url.toString(), { ...init, method, headers, body, signal, redirect: 'manual' });
        } catch (error) {
          if (options.signal?.aborted) throw new ToolError('cancelled', 'The request was cancelled.', { retryable: true });
          if (Date.now() >= options.deadline) remaining(options.deadline);
          if (attempt < 2) { await pause(250 * (2 ** attempt), options.deadline, options.signal); break; }
          throw new ToolError('upstream_network', error instanceof Error ? error.message.slice(0,160) : 'Provider connection failed.', { retryable: true });
        }
        if ([301,302,303,307,308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location) throw new ToolError('invalid_redirect', 'Provider returned a redirect without a target.');
          const next = allowedUpstreamURL(new URL(location, url));
          if (next.origin !== url.origin && method !== 'GET' && method !== 'HEAD') {
            throw new ToolError('cross_origin_redirect', 'A provider POST redirected to another origin; credentials were not forwarded.');
          }
          if (next.origin !== url.origin) {
            for (const name of ['authorization','cookie','x-similaritems-key','x-parse-application-id','complementary-recommendations-api-key']) headers.delete(name);
          }
          url = next;
          continue;
        }
        if (response.status === 429 || response.status === 503) {
          const until = retryAt(response.headers.get('retry-after')) ?? Date.now() + (1000 * (2 ** attempt));
          await gate.cooldown(until);
          if (until + 100 >= options.deadline || attempt === 2) {
            await response.body?.cancel();
            throw new ToolError('rate_limited', `Provider requested a pause (${response.status}).`, {
              retryable: true, retry_at: new Date(until).toISOString(), next_action: 'Retry the same operation after retry_at.'
            });
          }
          await response.body?.cancel();
          await pause(until - Date.now(), options.deadline, options.signal);
          break;
        }
        if ([500,502,504].includes(response.status) && attempt < 2) {
          await response.body?.cancel();
          await pause(300 * (2 ** attempt), options.deadline, options.signal);
          break;
        }
        const bytes = await readBounded(response, 12 * 1024 * 1024);
        const outputHeaders = new Headers(response.headers);
        outputHeaders.delete('content-encoding');
        outputHeaders.set('content-length', String(bytes.length));
        return new Response([204,205,304].includes(response.status) ? null : bytes, { status: response.status, statusText: response.statusText, headers: outputHeaders });
      }
    }
    throw new ToolError('upstream_retry_exhausted', 'The provider did not complete this request after paced retries.', { retryable: true });
  }) as typeof fetch;
}
