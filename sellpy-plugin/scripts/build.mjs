import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
execFileSync(process.execPath, ['scripts/build-ui.mjs'], { stdio: 'inherit' });
await mkdir('dist', { recursive: true });
const result = await build({
  entryPoints: ['src/worker.ts'], bundle: true, format: 'esm', platform: 'browser',
  target: 'es2022', conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:workers', 'node:*'],
  outfile: 'dist/worker.js', sourcemap: true, minify: true, metafile: true,
});
await writeFile('dist/metafile.json', JSON.stringify(result.metafile, null, 2));
console.log(`Worker bundle: ${result.metafile.outputs['dist/worker.js'].bytes} bytes`);
