import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules', 'playwright'))); }
const outputDirectory = path.resolve(process.env.SELLPY_UI_ARTIFACTS ?? path.join(root, 'artifacts/private/ui'));
await mkdir(outputDirectory, { recursive: true });
// Test authored source without writing the release owner's generated files.
const bundle = await build({ absWorkingDir: root, entryPoints: ['ui/gallery.ts'], bundle: true, write: false, minify: true,
  format: 'iife', platform: 'browser', target: ['es2022'], legalComments: 'eof' });
const css = await readFile(path.join(root, 'ui/styles.css'), 'utf8');
const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main id="app" aria-busy="true"></main><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLF8AAAAASUVORK5CYII=';
let photo = pixel;
if (process.env.SELLPY_UI_PHOTO_PATH) {
  const bytes = await readFile(process.env.SELLPY_UI_PHOTO_PATH);
  photo = `data:${bytes.subarray(0, 4).toString() === 'RIFF' ? 'image/webp' : bytes[0] === 0x89 ? 'image/png' : 'image/jpeg'};base64,${bytes.toString('base64')}`;
}
const TOTAL = 10_137, RUN = 'run-gallery', at = '2026-11-07T10:00:00Z';
const calls = [], errors = [], feedbackState = new Map(), overrides = new Map(), widgetPhotos = new Set();
let feedbackTick = 0, activeCovers = 0, peakCovers = 0, photoDelay = 8, failRefresh = false, failPhotoOnce = false, failDetailsOnce = false;
let holdPage = null, holdPhoto = null, holdDetails = null, holdRefresh = null, holdFeedback = null;
let derivedSequence = 0;
const collections = new Map([['observed', { kind: 'observed', indices: null, order: 'discovery', view: 'source_order', remaining: 0 }]]);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function item(index, full = false) {
  const id = `item-${index}`;
  return { id, title: index === 3 ? '<img src=x onerror=alert(1)>' : `Aster Kleid ${index}`, brand: 'Aster', market: 'AT', language: 'de', url: `https://www.sellpy.at/item/${id}`,
    price: index === 1 ? null : { amount_minor: index === TOTAL - 1 ? 100 : index === 0 ? 2400 : Math.max(100, 20_000 - index), currency: index === 12 ? 'USD' : 'EUR' },
    original_price: null, size: 'M', size_system: 'EU', condition: 'Sehr gut', categories: ['Kleider'], colors: ['Creme'],
    materials: ['Baumwolle'], measurements: { Länge: '112 cm' }, description: full ? `Vollständige Shop-Beschreibung für ${id}. <img src=x onerror=alert(2)>` : null,
    defects: [], images: Array.from({ length: index === 0 ? 14 : 3 }, (_, n) => ({ id: `${id}-image-${n}`, index: n, url: `https://prod.images.sellpy.net/fixture/${id}-${n}.jpg` })),
    availability: index % 17 === 16 ? 'sold' : 'available', observed_at: at, source: 'detail', attributes: {}, ...(overrides.get(id) ?? {}) };
}
function card(index, full = false) {
  const value = item(index, full), feedback = feedbackState.get(value.id);
  const assessment = index === 0 ? { item_id: value.id, checked_image_ids: [value.images[0].id], observed_type: 'Kleid',
    matching_features: ['Manschette sichtbar', 'Manschette sichtbar'], mismatches: [], uncertainties: [],
    requirement_results: [{ requirement: 'Lange Ärmel', verdict: 'confirmed', evidence: 'Manschette sichtbar' },
      { requirement: '  LANGE  ÄRMEL ', verdict: 'confirmed', evidence: 'Manschette sichtbar' }], assessed_at: at, author: 'assistant' } : null;
  return { item: value, reason: `Auswahlnotiz ${index}`, cautions: [`Auswahlnotiz ${index}`, 'Maße prüfen', 'Maße prüfen'], paths: [], assessment,
    ...(feedback ? { feedback } : {}) };
}
function scope(total = TOTAL) {
  return { observed_at: at, candidates: TOTAL, search_pages: 73, detail_observations: 20, stored_descriptions: 20,
    model_delivered_photos: 2, model_delivered_fact_items: 12, model_delivered_description_items: 0,
    widget_delivered_photos: widgetPhotos.size, recorded_assessments: 1, collection_members: total,
    arms: [{ arm_id: 'catalog-a', route: 'catalog', query: 'creme Kleid', filters: { facets: { color: ['creme'] }, include_reserved: false },
      category_relaxed: false, pages: 73, candidates: TOTAL, native_total: 20_000, native_window: 15_000, status: 'ready', observed_at: at }], notes: [] };
}
function descriptor(id = 'observed', status = 'ready') {
  const source = collections.get(id) ?? { kind: 'observed', indices: null, order: 'discovery', view: 'source_order' };
  return { id, source: { kind: source.kind, ...(source.kind === 'derived' ? { base_collection_id: 'observed', view: source.view } : {}) },
    created_at: at, membership_as_of: at, order: source.order, total: status === 'preparing' ? null : source.indices?.length ?? TOTAL, status,
    ...(status === 'preparing' ? { progress: { scanned: 256 * (3 - source.remaining), cohort: TOTAL } } : {}) };
}
function gallery(offset = 0, size = 12, id = 'observed', requestId) {
  const source = collections.get(id), preparing = source?.remaining > 0;
  const indices = source?.indices ?? null, total = indices?.length ?? TOTAL;
  const positions = preparing ? [] : Array.from({ length: Math.min(size, Math.max(0, total - offset)) }, (_, n) => indices ? indices[offset + n] : offset + n);
  return { version: 3, run_id: RUN, language: 'de', title: id === 'observed' ? 'Alle beobachteten Kleider' : `Sammlung ${source?.view ?? id}`,
    cards: positions.map(index => card(index)), next_cursor: preparing ? `${id}@0` : offset + size < total ? `${id}@${offset + size}` : null,
    warnings: [], collection: descriptor(id, preparing ? 'preparing' : 'ready'),
    page: { size, start: positions.length ? offset + 1 : 0, end: positions.length ? offset + positions.length : 0, cursor: `${id}@${offset}`,
      previous_cursor: offset > 0 ? `${id}@${Math.max(0, offset - size)}` : null,
      next_cursor: preparing ? `${id}@0` : offset + size < total ? `${id}@${offset + size}` : null }, scope: scope(preparing ? null : total), ...(requestId ? { request_id: requestId } : {}) };
}
function galleryResult(data, eager = 2) {
  const images = {};
  for (const value of data.cards.slice(0, eager)) if (value.item.images[0]) { images[value.item.images[0].id] = photo; widgetPhotos.add(value.item.images[0].id); }
  return { content: [{ type: 'text', text: 'Collection page.' }], structuredContent: { run_id: data.run_id }, _meta: { gallery: data, images } };
}
function textResult(value, extra = {}) { return { content: [{ type: 'text', text: 'Tool result.' }], structuredContent: value, ...extra }; }
function hostPage(chat = true) {
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fafafa}iframe{display:block;border:0;width:100%;height:100vh}</style><iframe title="Sellpy test app" sandbox="allow-scripts allow-popups"></iframe><script>
  const frame=document.querySelector('iframe');let mode='inline';window.hostEvents=[];window.hostReplies=[];
  window.sendToApp=(method,params)=>frame.contentWindow.postMessage({jsonrpc:'2.0',method,params},'*');
  window.addEventListener('message',async event=>{
    if(event.source!==frame.contentWindow)return;const message=event.data;if(!message||message.jsonrpc!=='2.0')return;
    window.hostEvents.push({id:message.id,method:message.method,params:message.params});
    const reply=result=>{window.hostReplies.push(message.id);event.source.postMessage({jsonrpc:'2.0',id:message.id,result},'*');};
    if(message.method==='ui/initialize')reply({protocolVersion:message.params.protocolVersion,hostInfo:{name:'Sellpy browser test host',version:'1.0.0'},
      hostCapabilities:{serverTools:{},openLinks:{}${chat ? ',message:{text:{}},updateModelContext:{structuredContent:{}}' : ''}},
      hostContext:{theme:'light',locale:'de-AT',displayMode:mode,availableDisplayModes:['inline','fullscreen']}});
    else if(message.method==='ui/notifications/initialized')window.sendToApp('ui/notifications/tool-result',await window.initialResult());
    else if(message.method==='tools/call')reply(await window.simulateTool(message.params));
    else if(message.method==='ui/open-link')reply({});
    else if(message.method==='ui/request-display-mode'){mode=message.params.mode;reply({mode});window.sendToApp('ui/notifications/host-context-changed',{displayMode:mode});}
    else if(message.id!==undefined)reply({});
  });<\/script>`;
}

const browser = await chromium.launch({ headless: true, ...(process.env.SELLPY_UI_CHROMIUM_PATH ? { executablePath: process.env.SELLPY_UI_CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
await context.route('https://**/*', route => route.abort());
await page.exposeFunction('initialResult', () => galleryResult(gallery()));
await page.exposeFunction('simulateTool', async request => {
  calls.push(structuredClone(request)); const args = request.arguments;
  if (request.name === 'browse_collection') {
    assert.equal(typeof args.request_id, 'string'); assert.equal(args.run_id, RUN);
    if (args.action === 'details') {
      if (holdDetails) { const pending = holdDetails; holdDetails = null; return pending.promise; }
      if (failDetailsOnce) { failDetailsOnce = false; return textResult({ error: { message: 'Stored assessment temporarily unavailable.' } }, { isError: true }); }
      return textResult({}, { _meta: { collection_detail: { run_id: RUN, collection_id: args.collection_id, request_id: args.request_id,
        card: card(Number(args.item_id.slice(5)), true) } } });
    }
    if (args.action === 'coverage') return textResult({}, { _meta: { collection_scope: { run_id: RUN, collection_id: args.collection_id, request_id: args.request_id, scope: scope() } } });
    if (args.action === 'derive') {
      if (args.view.kind === 'source_order') return galleryResult(gallery(0, args.page_size, 'observed', args.request_id));
      const id = `derived-${++derivedSequence}`, view = args.view.kind;
      const indices = Array.from({ length: TOTAL }, (_, index) => index).filter(index => view === 'shortlist' ? feedbackState.get(`item-${index}`)?.decision === 'shortlist'
        : view === 'available' ? item(index).availability === 'available' : view === 'assessed' ? index === 0 : view === 'unassessed' ? index !== 0 : true);
      if (view === 'price_asc') indices.sort((a, b) => (item(a).price?.amount_minor ?? Infinity) - (item(b).price?.amount_minor ?? Infinity) || a - b);
      if (view === 'price_desc') indices.sort((a, b) => (item(b).price?.amount_minor ?? -Infinity) - (item(a).price?.amount_minor ?? -Infinity) || a - b);
      collections.set(id, { kind: 'derived', view, indices, order: view.startsWith('price_') ? view : 'discovery', remaining: view === 'price_asc' ? 2 : 0 });
      return galleryResult(gallery(0, args.page_size, id, args.request_id));
    }
    if (holdPage) { const pending = holdPage; holdPage = null; return pending.promise; }
    const source = collections.get(args.collection_id); if (source?.remaining) source.remaining--;
    const offset = args.cursor ? Number(args.cursor.slice(args.cursor.lastIndexOf('@') + 1)) : 0;
    return galleryResult(gallery(offset, args.page_size ?? 12, args.collection_id, args.request_id));
  }
  if (request.name === 'get_item_images') {
    assert.equal(args.for_model, false, 'widget photons must not be sent as model evidence');
    const cover = args.batch_size === 1 && args.refresh_details === false;
    if (cover) { activeCovers++; peakCovers = Math.max(peakCovers, activeCovers); assert.ok(activeCovers <= 4, 'visible cover concurrency exceeds four'); }
    try {
      if (holdPhoto && args.item_id === holdPhoto.item_id) { const pending = holdPhoto; holdPhoto = null; return await pending.promise; }
      await wait(photoDelay);
      const value = item(Number(args.item_id.slice(5))), selected = value.images.filter(image => image.index >= args.start_index).slice(0, args.batch_size);
      if (failPhotoOnce && args.item_id === 'item-0' && args.start_index === 1) {
        failPhotoOnce = false;
        return textResult({ error: { code: 'rate_limited', message: 'Fotos kurz pausiert.', retry_at: new Date(Date.now() + 250).toISOString() } }, { isError: true });
      }
      const images = {}; selected.forEach(image => { images[image.id] = photo; widgetPhotos.add(image.id); });
      const next = (selected.at(-1)?.index ?? -1) + 1;
      return textResult({ item_id: value.id, images: selected.map(image => ({ ...image, status: 'ready' })), next_index: next < value.images.length ? next : null }, { _meta: { images } });
    } finally { if (cover) activeCovers--; }
  }
  if (request.name === 'get_items') {
    assert.equal(args.for_model, false, 'app refresh must not inflate model-delivered description counts');
    if (holdRefresh) { const pending = holdRefresh; holdRefresh = null; return pending.promise; }
    if (failRefresh) return textResult({ error: { message: 'Fixture source unavailable.' } }, { isError: true });
    const id = args.ids[0]; overrides.set(id, { observed_at: '2026-11-07T11:00:00Z', price: { amount_minor: 2100, currency: 'EUR' }, availability: 'reserved' });
    return textResult({ run_id: RUN, items: [item(Number(id.slice(5)), true)] });
  }
  if (request.name === 'set_item_feedback') {
    if (holdFeedback) { const pending = holdFeedback; holdFeedback = null; await pending.promise; }
    const feedback = { item_id: args.item_id, decision: args.decision, updated_at: new Date(Date.parse(at) + ++feedbackTick * 1000).toISOString() };
    feedbackState.set(args.item_id, feedback); return textResult({ run_id: RUN, item_id: args.item_id, feedback });
  }
  if (request.name === 'get_item_history') {
    assert.equal(args.for_model, false, 'app history must not count as model-delivered item facts');
    const observations = Array.from({ length: Math.min(args.page_size, 27 - args.after) }, (_, index) => ({ id: args.item_id, sequence: args.after + index + 1,
      observed_at: new Date(Date.parse(at) + (args.after + index) * 60_000).toISOString(), source: 'detail', price: { amount_minor: 3000 - args.after - index, currency: 'EUR' },
      availability: 'available', size: 'M', condition: 'Sehr gut', materials: ['Baumwolle'] }));
    return textResult({ run_id: RUN, item_id: args.item_id, observations, next_after: args.after + observations.length < 27 ? args.after + observations.length : null });
  }
  if (request.name === 'present_items') {
    assert.equal(args.for_model, false); return galleryResult({ run_id: RUN, language: 'de', title: 'Legacy next page', cards: [card(300)], next_cursor: null, warnings: [] });
  }
  throw new Error(`Unexpected tool ${request.name}`);
});

const frame = page.frameLocator('iframe');
async function send(data, eager = 2) {
  const generation = await frame.locator('#app').getAttribute('data-generation');
  await page.evaluate(result => window.sendToApp('ui/notifications/tool-result', result), galleryResult(data, eager));
  await frame.locator('#app').evaluate((node, prior) => new Promise(resolve => {
    if (node.dataset.generation !== prior) return resolve(); const observer = new MutationObserver(() => { if (node.dataset.generation !== prior) { observer.disconnect(); resolve(); } }); observer.observe(node, { attributes: true });
  }), generation);
}
async function settled(predicate, message = 'condition did not settle') {
  const deadline = Date.now() + 10_000; while (!(await predicate())) { if (Date.now() > deadline) throw new Error(message); await wait(10); }
}
async function pageFirst(id) { await settled(async () => await frame.locator('.card').first().getAttribute('data-item-id') === id, `Expected first ${id}`); }
async function rpcId(name, itemId) {
  return page.evaluate(({ name, itemId }) => window.hostEvents.findLast(event => event.method === 'tools/call'
    && event.params.name === name && (!itemId || event.params.arguments.item_id === itemId))?.id, { name, itemId });
}
async function delivered(id) {
  await page.waitForFunction(value => window.hostReplies.includes(value), id);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function bounds() {
  const values = await frame.locator('#app').evaluate(node => ({ cards: node.querySelectorAll('.card').length, pages: Number(node.dataset.cachedPages),
    photos: Number(node.dataset.cachedPhotos), photoBytes: Number(node.dataset.photoBytes), requests: Number(node.dataset.coverRequests) }));
  assert.ok(values.cards <= 24); assert.ok(values.pages <= 3); assert.ok(values.photos <= 48); assert.ok(values.photoBytes <= 12 * 1024 * 1024); assert.ok(values.requests <= 4); return values;
}

try {
  await page.setContent(hostPage()); await page.locator('iframe').evaluate((node, source) => { node.srcdoc = source; }, html);
  await frame.locator('.card').nth(11).waitFor(); await frame.locator('.card').first().locator('img[src^="data:"]').waitFor();
  await frame.locator('.card').first().locator('img').evaluate(img => img.decode());
  assert.equal(await frame.locator('.card').count(), 12); assert.equal(await frame.locator('#page-range').innerText(), '1–12 / 10137 Artikel');
  assert.equal(await frame.locator('.card').first().locator('.price').innerText(), '24,00 €');
  assert.equal(await frame.locator('.card').first().locator('[data-fact="brand"]').count(), 0);
  assert.equal(await frame.locator('.card').first().locator('[data-fact="size"]').count(), 1);
  assert.equal(await frame.locator('.card').first().locator('[data-criterion]').count(), 1);
  assert.equal(await frame.locator('.card').first().getByText('Manschette sichtbar', { exact: true }).count(), 1, 'structured evidence is not repeated as legacy matching prose');
  assert.equal(calls.some(call => call.name === 'get_items'), false, 'initial page must not refresh all item details');
  const remoteBeforeVisible = await frame.locator('.card .photo-frame').evaluateAll(boxes => boxes.filter(box => box.dataset.visible !== 'true' && box.querySelector('img')?.hasAttribute('src')).length);
  assert.equal(remoteBeforeVisible, 0, 'offscreen cards have no network image source');
  assert.equal(await frame.locator('html').evaluate(node => node.scrollWidth <= innerWidth), true);
  await bounds(); await page.screenshot({ path: path.join(outputDirectory, 'collection-mobile-390.png'), fullPage: true });
  console.log('UI: initial 12-card page, compact evidence and visibility bounds passed');

  const first = frame.locator('.card[data-item-id="item-0"]');
  await first.locator('.item-details > summary').click(); await first.locator('.source-description').waitFor();
  await first.locator('.source-description > summary').click();
  assert.match(await first.locator('.description-text').innerText(), /Vollständige Shop-Beschreibung/);
  assert.equal(await first.locator('.description-text img').count(), 0);
  assert.equal(calls.filter(call => call.name === 'browse_collection' && call.arguments.action === 'details').length, 1);
  assert.equal(calls.some(call => call.name === 'get_item_history'), false);
  await first.locator('.history-load').click(); await first.locator('.history-snapshot').nth(11).waitFor();
  await first.getByRole('button', { name: 'Weitere Beobachtungen', exact: true }).click();
  await settled(async () => await first.locator('.history-snapshot').first().getAttribute('data-sequence') === '13');
  assert.equal(await first.locator('.history-snapshot').count(), 12, 'history replaces its page');
  await first.getByRole('button', { name: 'Weitere Beobachtungen', exact: true }).click();
  await settled(async () => await first.locator('.history-snapshot').count() === 3);
  console.log('UI: complete details and bounded observation history passed');

  // Full gallery preserves successful images and explicit retries, without recording model evidence.
  failPhotoOnce = true; await first.locator('.photo-open').click(); await frame.locator('dialog').waitFor({ state: 'visible' });
  await frame.getByRole('button', { name: 'Nächstes Foto', exact: true }).click(); await frame.getByText('Fotos kurz pausiert.', { exact: true }).first().waitFor();
  assert.equal(await frame.locator('.viewer-actions button').first().isDisabled(), true);
  await frame.getByRole('button', { name: 'Foto erneut laden', exact: true }).waitFor();
  await settled(async () => !(await frame.getByRole('button', { name: 'Foto erneut laden', exact: true }).isDisabled()));
  await frame.getByRole('button', { name: 'Foto erneut laden', exact: true }).click();
  await frame.locator('.viewer-stage img[src^="data:"]').waitFor(); await frame.locator('.viewer-stage img').evaluate(img => img.decode());
  for (let count = 0; count < 3; count++) {
    await settled(async () => await frame.locator('.more-photos').count() === 1 && !(await frame.locator('.more-photos').isDisabled()));
    await frame.locator('.more-photos').click();
  }
  await settled(async () => await frame.locator('.thumbnail img').count() === 14);
  await frame.getByRole('button', { name: 'Foto 14', exact: true }).click(); assert.equal(await frame.locator('.photo-position').innerText(), '14 von 14');
  await page.keyboard.press('Escape');
  assert.equal(calls.some(call => call.name === 'record_visual_assessment'), false);
  console.log('UI: photo retry and all 14 original photos passed');

  // Successive explicit decisions on one item serialize instead of racing in storage.
  const feedbackHold = deferred(); holdFeedback = feedbackHold;
  await first.locator('.shortlist-button').click();
  await settled(() => calls.some(call => call.name === 'set_item_feedback' && call.arguments.item_id === 'item-0'));
  await first.locator('.reject-button').click();
  assert.equal(calls.filter(call => call.name === 'set_item_feedback' && call.arguments.item_id === 'item-0').length, 1);
  feedbackHold.resolve();
  await settled(async () => await first.locator('.reject-button').getAttribute('aria-pressed') === 'true' && feedbackState.get('item-0')?.decision === 'reject');
  assert.deepEqual(calls.filter(call => call.name === 'set_item_feedback' && call.arguments.item_id === 'item-0').map(call => call.arguments.decision), ['shortlist', 'reject']);
  await frame.locator('.card[data-item-id="item-2"] .shortlist-button').click();
  await settled(() => feedbackState.get('item-2')?.decision === 'shortlist');

  await first.locator('[data-action="compare"]').check(); await frame.locator('.card[data-item-id="item-1"] [data-action="compare"]').check();
  await frame.locator('#next-page').click(); await pageFirst('item-12'); assert.equal(await frame.locator('.card').count(), 12, 'next page replaces old cards');
  assert.match(await frame.locator('.selection-count').innerText(), /^2\/4/);
  await frame.locator('.card[data-item-id="item-12"] [data-action="compare"]').check(); await frame.locator('.card[data-item-id="item-13"] [data-action="compare"]').check();
  await frame.locator('.card[data-item-id="item-14"] [data-action="compare"]').click();
  assert.equal(await frame.locator('.card[data-item-id="item-14"] [data-action="compare"]').isChecked(), false);
  await frame.locator('.compare-button').click(); assert.equal(await frame.locator('[data-comparison-item-id]').count(), 4);
  assert.match(await frame.locator('.subtotal').innerText(), /Preisangaben fehlen/); assert.match(await frame.locator('.subtotal').innerText(), /Getrennte Währungen/);
  assert.equal(await frame.locator('.card').count(), 0);
  const messagesBefore = await page.evaluate(() => window.hostEvents.filter(value => value.method === 'ui/message').length);
  await frame.locator('.discuss-selection').click();
  await settled(async () => await page.evaluate(() => window.hostEvents.filter(value => value.method === 'ui/message').length) > messagesBefore);
  const discussed = await page.evaluate(() => window.hostEvents.filter(value => value.method === 'ui/message').at(-1).params);
  assert.match(JSON.stringify(discussed), /item-0/); assert.match(JSON.stringify(discussed), /item-12/);
  await frame.locator('.clear-selection').click();
  console.log('UI: serialized feedback, cross-page comparison and explicit chat passed');

  // All controls derive a server collection; none reorders only the twelve visible cards.
  await frame.locator('#collection-view').selectOption('price_asc');
  await frame.locator('.preparation').waitFor();
  await pageFirst('item-10136'); assert.equal(await frame.locator('.card').count(), 12);
  await frame.locator('#collection-view').selectOption('shortlist'); await pageFirst('item-2'); assert.equal(await frame.locator('.card').count(), 1);
  await frame.locator('#collection-view').selectOption('source_order'); await pageFirst('item-0');
  await frame.locator('#page-size').selectOption('24'); await settled(async () => await frame.locator('.card').count() === 24);
  assert.equal(await frame.locator('#page-range').innerText(), '1–24 / 10137 Artikel');
  await frame.locator('#next-page').click(); await pageFirst('item-24');
  await frame.locator('#previous-page').click(); await pageFirst('item-0');
  await frame.locator('.scope > summary').click();
  assert.match(await frame.locator('.scope').innerText(), /Artikelfakten an Modell geliefert/);
  assert.match(await frame.locator('.scope').innerText(), /Geliefert bedeutet nicht gelesen oder geprüft/);
  await frame.locator('.scope-refresh').click();
  await settled(() => calls.some(call => call.name === 'browse_collection' && call.arguments.action === 'coverage'));
  await frame.locator('.scope > summary').click();

  // Refresh has an explicit action and never changes the immutable membership order.
  failRefresh = true; await frame.locator('.card').first().locator('.refresh').click();
  await frame.getByText('Aktualisierung fehlgeschlagen. Die bisherigen Angaben bleiben sichtbar.', { exact: true }).waitFor();
  failRefresh = false; await frame.locator('.card').first().locator('.refresh').click();
  await frame.getByText('Shop-Angaben aktualisiert.', { exact: true }).waitFor();
  assert.equal(await frame.locator('.card').first().locator('.price').innerText(), '21,00 €');
  assert.equal(await frame.locator('.card').first().getAttribute('data-item-id'), 'item-0');
  assert.equal(await frame.locator('.card[data-item-id="item-3"] h3 img').count(), 0);

  // Viewport and fullscreen layout stay bounded and readable.
  for (const width of [360, 390, 1120]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await frame.locator('html').evaluate(node => node.scrollWidth <= innerWidth), true, `${width}px must not overflow`);
    await page.screenshot({ path: path.join(outputDirectory, `collection-${width}.png`), fullPage: true });
  }
  await frame.locator('#expand').click(); await frame.locator('body[data-display="fullscreen"]').waitFor();
  await frame.locator('.card').first().locator('.item-link').click();
  assert.equal(await page.evaluate(() => window.hostEvents.filter(value => value.method === 'ui/open-link').at(-1).params.url), 'https://www.sellpy.at/item/item-0');
  await page.evaluate(() => window.sendToApp('ui/notifications/host-context-changed', { theme: 'dark' }));
  await frame.locator('html[data-theme="dark"]').waitFor(); await bounds();
  console.log('UI: server views, 12/24 paging, coverage, refresh and responsive layout passed');

  // Same run AND same collection replacement invalidates all earlier work.
  await send(gallery(240, 24));
  const pendingPage = deferred(); holdPage = pendingPage;
  await frame.locator('#next-page').click();
  await settled(() => holdPage === null);
  const oldPageRpc = await rpcId('browse_collection');
  const oldPageRequest = calls.findLast(call => call.name === 'browse_collection' && call.arguments.action === 'page');
  const replacement = { ...gallery(400, 12), title: 'Neue Ansicht derselben Sammlung' };
  await send(replacement); await pageFirst('item-400');
  pendingPage.resolve(galleryResult(gallery(264, 24, 'observed', oldPageRequest.arguments.request_id)));
  await delivered(oldPageRpc);
  await settled(async () => await frame.locator('#app').getAttribute('aria-busy') === 'false');
  assert.equal(await frame.locator('h2').innerText(), 'Neue Ansicht derselben Sammlung'); assert.equal(await frame.locator('.card').count(), 12);

  const raceGallery = { ...gallery(0, 12), title: 'Race A', collection: { ...descriptor(), id: 'race' },
    cards: Array.from({ length: 12 }, (_, index) => card(15_000 + index)), next_cursor: null,
    page: { size: 12, start: 1, end: 12, cursor: 'race@0', previous_cursor: null, next_cursor: null } };
  const pendingPhoto = deferred(); holdPhoto = { ...pendingPhoto, item_id: 'item-15000' };
  await send(raceGallery, 0); await settled(() => holdPhoto === null);
  const oldPhotoRpc = await rpcId('get_item_images', 'item-15000');
  await send({ ...raceGallery, title: 'Race B' }, 2);
  pendingPhoto.resolve(textResult({ error: { message: 'STALE PHOTO FAILURE' } }, { isError: true }));
  await delivered(oldPhotoRpc);
  await settled(() => activeCovers === 0);
  assert.equal(await frame.getByText('STALE PHOTO FAILURE', { exact: true }).count(), 0);
  assert.equal(await frame.locator('.card').first().locator('img').evaluate(img => img.naturalWidth > 0), true);

  const staleDetail = deferred(); holdDetails = staleDetail;
  await frame.locator('.card').first().locator('.item-details > summary').click(); await settled(() => holdDetails === null);
  const oldDetailRpc = await rpcId('browse_collection', 'item-15000');
  const detailRequest = calls.findLast(call => call.name === 'browse_collection' && call.arguments.action === 'details');
  await send({ ...raceGallery, title: 'Race C' });
  const staleCard = card(15_000, true); staleCard.reason = 'STALE DETAIL NOTE';
  staleDetail.resolve(textResult({}, { _meta: { collection_detail: { run_id: RUN, collection_id: 'race', request_id: detailRequest.arguments.request_id, card: staleCard } } }));
  await delivered(oldDetailRpc); assert.equal(await frame.getByText('STALE DETAIL NOTE', { exact: true }).count(), 0);

  const staleRefresh = deferred(); holdRefresh = staleRefresh;
  await frame.locator('.card').first().locator('.refresh').click(); await settled(() => holdRefresh === null);
  const oldRefreshRpc = await rpcId('get_items');
  await send({ ...raceGallery, title: 'Race D' });
  staleRefresh.resolve(textResult({ run_id: RUN, items: [{ ...item(15_000), price: { amount_minor: 999, currency: 'EUR' }, observed_at: '2026-11-08T12:00:00Z' }] }));
  await delivered(oldRefreshRpc); assert.notEqual(await frame.locator('.card').first().locator('.price').innerText(), '9,99 €');

  const staleFeedback = deferred(); holdFeedback = staleFeedback;
  await frame.locator('.card').first().locator('.shortlist-button').click(); await settled(() => holdFeedback === null);
  const oldFeedbackRpc = await rpcId('set_item_feedback', 'item-15000');
  await send({ ...raceGallery, title: 'Race E' }); staleFeedback.resolve();
  await delivered(oldFeedbackRpc);
  await settled(() => feedbackState.get('item-15000')?.decision === 'shortlist');
  assert.equal(await frame.locator('.card').first().locator('.shortlist-button').getAttribute('aria-pressed'), 'false', 'a stale acknowledgment must not modify a replacement view');
  console.log('UI: same-run page/photo/detail/refresh/feedback stale-response cases passed');

  // Changed observations cannot inherit an omitted old assessment if canonical follow-up fails.
  const partial = card(18_000); partial.item.images = partial.item.images.slice(0, 1);
  partial.summary = { omitted_fields: ['assessment', 'item.images'], image_count: 3, assessment_recorded: true, checked_image_count: 2 };
  const partialGallery = { ...raceGallery, title: 'Large assessment projection', collection: { ...raceGallery.collection, id: 'partial', total: 1 },
    cards: [partial], page: { size: 12, start: 1, end: 1, cursor: 'partial@0', previous_cursor: null, next_cursor: null } };
  await send(partialGallery); assert.match(await frame.locator('.inspection.checked').innerText(), /2\/3/);
  failDetailsOnce = true; await frame.locator('.card').first().locator('.refresh').click();
  await frame.getByText('Shop-Angaben aktualisiert · Bewertungsstatus nicht geladen', { exact: true }).waitFor();
  assert.equal(await frame.locator('.inspection.checked').count(), 0, 'old summary counts must not be re-stamped onto refreshed facts');
  assert.equal(await frame.locator('.inspection.unchecked').count(), 0, 'failed assessment retrieval is unknown, not an assertion that no assessment exists');
  assert.equal(await frame.locator('.inspection.unknown').innerText(), 'Bewertungsstatus offen');
  assert.equal(await frame.locator('.card').first().locator('.price').innerText(), '21,00 €');
  await send({ ...partialGallery, title: 'Older server page replay' });
  assert.equal(await frame.locator('.card').first().locator('.price').innerText(), '21,00 €', 'newer facts survive the old delivery');
  assert.equal(await frame.locator('.inspection.unknown').innerText(), 'Bewertungsstatus offen', 'the raw older observation cannot clear newer unresolved assessment state');
  assert.equal(await frame.locator('.inspection.checked,.inspection.unchecked').count(), 0);
  await frame.locator('.evidence-load').click(); await frame.locator('.inspection.unchecked').waitFor();
  assert.equal(await frame.locator('.inspection.unknown').count(), 0);
  assert.equal(await frame.getByText('Shop-Angaben aktualisiert · Bewertungsstatus nicht geladen', { exact: true }).count(), 0);
  console.log('UI: refreshed partial assessment remains unknown after failed follow-up, then recovers');

  // Source cards from every one of 423 pages remain reachable without accumulated DOM or image work.
  await page.setViewportSize({ width: 1120, height: 900 }); photoDelay = 2;
  await send(gallery(0, 24)); const seen = new Set(); let pages = 0, lastBounds;
  for (;;) {
    const ids = await frame.locator('.card').evaluateAll(nodes => nodes.map(node => node.dataset.itemId));
    for (const id of ids) { assert.equal(seen.has(id), false, `duplicate reachable member ${id}`); seen.add(id); }
    pages++; lastBounds = await bounds(); if (pages % 100 === 0) console.log(`UI: traversed ${pages} pages (${seen.size} unique members), bounds held`);
    if (await frame.locator('#next-page').isDisabled()) break;
    const expected = `item-${seen.size}`; await frame.locator('#next-page').evaluate(button => button.click()); await pageFirst(expected);
  }
  assert.equal(seen.size, TOTAL); assert.equal(pages, Math.ceil(TOTAL / 24)); assert.equal([...seen].at(-1), 'item-10136');
  assert.equal(await frame.locator('#page-range').innerText(), '10129–10137 / 10137 Artikel');
  assert.ok(peakCovers <= 4); assert.equal(calls.filter(call => call.name === 'get_items').length, 4, 'paging adds no eager canonical detail refreshes');
  assert.ok(calls.filter(call => call.name === 'get_item_images' && call.arguments.batch_size === 1).every(call => call.arguments.refresh_details === false));
  const legacy = { run_id: RUN, language: 'de', title: 'Legacy selection', cards: [card(290), card(291)], next_cursor: 'legacy-page-2', warnings: [] };
  await send(legacy); await pageFirst('item-290'); await frame.locator('#next-page').click(); await pageFirst('item-300');
  assert.equal(await frame.locator('.card').count(), 1, 'legacy continuation remains reachable without appending DOM');
  assert.equal(await frame.locator('#next-page').isDisabled(), true);
  assert.equal(errors.length, 0, errors.join('\n'));
  const report = { status: 'passed', source_bundle: true, unique_items_reached: seen.size, pages, peak_cover_requests: peakCovers,
    final_bounds: lastBounds, stale_response_cases: ['page', 'photo', 'details', 'refresh', 'feedback'], failed_assessment_refresh: 'unknown_then_recovered', browser_errors: errors, viewport_widths: [360, 390, 1120] };
  await writeFile(path.join(outputDirectory, 'collection-browser-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({ path: path.join(outputDirectory, 'collection-failure.png'), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ last_calls: calls.slice(-8), browser_errors: errors, state: await frame.locator('#app').evaluate(node => ({
    generation: node.dataset.generation, title: node.querySelector('h2')?.textContent, status: node.querySelector('#page-status')?.textContent,
    history: [...node.querySelectorAll('.history-snapshot')].map(entry => ({ sequence: entry.dataset.sequence, text: entry.textContent })) })).catch(() => null) }));
  throw error;
} finally { await browser.close(); }
