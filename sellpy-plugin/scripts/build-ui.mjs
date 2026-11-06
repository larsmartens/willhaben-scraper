import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  absWorkingDir: root, entryPoints: ['ui/gallery.ts'], bundle: true, write: false, minify: true,
  format: 'iife', platform: 'browser', target: ['es2022'], legalComments: 'eof',
});
const javascript = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile(path.join(root, 'ui/styles.css'), 'utf8');
const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Sellpy Auswahl</title><style>${css}</style></head><body><main id="app" aria-busy="true"><p class="empty" role="status">Die Auswahl wird geladen.</p></main><script>${javascript}</script></body></html>`;
await mkdir(path.join(root, 'ui/generated'), { recursive: true });
await writeFile(path.join(root, 'ui/generated/gallery.html'), html);
await writeFile(path.join(root, 'ui/generated/gallery.ts'), `export const PRESENTATION_HTML = ${JSON.stringify(html)};\n`);
console.log(JSON.stringify({ artifact: 'ui/generated/gallery.html', bytes: Buffer.byteLength(html), bundled: true }));
