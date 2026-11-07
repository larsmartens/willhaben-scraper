import { ToolError, type RequestContext } from '../domain.js';

export function checkDeadline(context: RequestContext): void {
  if (context.signal?.aborted || Date.now() >= context.deadline) {
    throw new ToolError('time_budget', 'The request time budget has ended.', {
      retryable: true, next_action: 'Continue the existing search to resume from its saved position.',
    });
  }
}

export async function request(url: string, init: RequestInit, context: RequestContext): Promise<Response> {
  checkDeadline(context);
  let response: Response;
  try {
    response = await context.fetch(url, { ...init, signal: context.signal });
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if (context.signal?.aborted || Date.now() >= context.deadline || (error instanceof Error && error.name === 'AbortError')) {
      throw new ToolError('time_budget', 'The Sellpy request did not finish within the available time.', {
        retryable: true, next_action: 'Continue the existing search; its previous progress is retained.',
      });
    }
    throw new ToolError('source_unavailable', 'The Sellpy service could not be reached.', {
      retryable: true, next_action: 'Retry the affected operation after a short delay.',
    });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const retry = response.headers.get('retry-after');
    const retryTime = retry && /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : retry ? Date.parse(retry) : NaN;
    const retry_at = Number.isFinite(retryTime) && retryTime > Date.now() ? new Date(retryTime).toISOString() : undefined;
    if (response.status === 429) throw new ToolError('rate_limited', 'Sellpy requested that these requests slow down.', {
      retryable: true, retry_at, next_action: 'Continue the existing search after the indicated retry time.',
    });
    if ([401, 403].includes(response.status)) throw new ToolError('source_access_changed', 'The public Sellpy service rejected this request.', {
      next_action: 'Refresh the public source configuration and verify the current first-party contract; do not bypass access controls.',
    });
    if (response.status === 404) throw new ToolError('source_not_found', 'The requested public Sellpy resource was not found.', {
      next_action: 'Check the item or reference and retry, or use another search route.',
    });
    throw new ToolError('source_http_error', `Sellpy returned HTTP ${response.status}.`, {
      retryable: response.status >= 500 || response.status === 408, retry_at,
      next_action: response.status >= 500 ? 'Retry the affected operation after a short delay.' : 'Check the request against the current public Sellpy contract.',
    });
  }
  return response;
}

export async function boundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ToolError('source_response_too_large', 'The response exceeds the safe per-request transfer budget.');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ToolError('source_response_too_large', 'The response exceeds the safe per-request transfer budget.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function requestText(url: string, init: RequestInit, context: RequestContext, maxBytes = 1024 * 1024): Promise<string> {
  return new TextDecoder().decode(await boundedBytes(await request(url, init, context), maxBytes));
}

export async function requestJson(url: string, init: RequestInit, context: RequestContext): Promise<unknown> {
  const text = await requestText(url, init, context, 16 * 1024 * 1024);
  try { return JSON.parse(text) as unknown; }
  catch { throw new ToolError('source_contract_changed', 'Sellpy returned a response that is not valid JSON.', {
    next_action: 'Verify the current first-party API contract before retrying this route.',
  }); }
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function contractError(message: string): ToolError {
  return new ToolError('source_contract_changed', message, {
    next_action: 'Verify the current Sellpy first-party contract; the saved search can resume after the adapter is updated.',
  });
}
