import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { createHash } from 'node:crypto';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: { PERSONAL_KEY_SHA256: createHash('sha256').update('t'.repeat(43)).digest('hex') } },
  })],
  test: { include: ['test/*.runtime.ts'], testTimeout: 30000 },
});
