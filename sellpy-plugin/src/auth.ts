export async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function equalHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function authenticate(request: Request, expectedHash: string | undefined): Promise<string | null> {
  if (!expectedHash) return null;
  const path = new URL(request.url).pathname;
  const match = /^\/personal\/([A-Za-z0-9_-]{43,128})\/mcp$/.exec(path);
  const bearer = /^Bearer ([A-Za-z0-9_-]{43,128})$/i.exec(request.headers.get('authorization') ?? '');
  const token = match?.[1] ?? bearer?.[1];
  if (!token || !equalHex(await sha256(token), expectedHash)) return null;
  return 'personal-owner';
}

export function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.origin === new URL(request.url).origin ||
      (url.protocol === 'https:' && (url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com'));
  } catch { return false; }
}
