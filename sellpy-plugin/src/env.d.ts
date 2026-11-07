export {};
declare global {
  interface Env { PERSONAL_KEY_SHA256: string; }
  namespace Cloudflare { interface Env { PERSONAL_KEY_SHA256: string; } }
}
