import { authenticate, allowedOrigin } from './auth.js';
import { createHandler } from './mcp.js';
export { SearchRun } from './search-run.js';
export { OriginGate } from './traffic.js';

function responseHeaders(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
    headers.set('access-control-allow-methods', 'POST, GET, DELETE, OPTIONS');
    headers.set('access-control-allow-headers', 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id');
    headers.set('access-control-expose-headers', 'MCP-Protocol-Version, MCP-Session-Id');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!allowedOrigin(request)) return Response.json({ error: 'origin_not_allowed' }, { status: 403 });
    if (request.method === 'OPTIONS') return responseHeaders(new Response(null, { status: 204 }), request.headers.get('origin'));
    if (url.pathname === '/health' && request.method === 'GET') {
      return responseHeaders(Response.json({ status: 'ok', service: 'sellpy-studio', version: env.VERSION }), null);
    }
    if (url.pathname !== '/mcp' && !/^\/personal\/[A-Za-z0-9_-]{43,128}\/mcp$/.test(url.pathname)) {
      return responseHeaders(Response.json({ error: 'not_found' }, { status: 404 }), null);
    }
    const principal = await authenticate(request, env.PERSONAL_KEY_SHA256);
    if (!principal) return responseHeaders(Response.json({ error: 'unauthorized' }, { status: 401 }), null);
    try {
      return responseHeaders(await createHandler(env, principal).fetch(request), request.headers.get('origin'));
    } catch {
      console.error(JSON.stringify({ event: 'request_failed' }));
      return responseHeaders(Response.json({ error: 'request_failed', retryable: true }, { status: 500 }), request.headers.get('origin'));
    }
  },
} satisfies ExportedHandler<Env>;
