import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules', 'playwright'))); }
const outputDirectory = path.resolve(process.env.SELLPY_UI_ARTIFACTS ?? path.join(root, 'artifacts/private/ui'));
await mkdir(outputDirectory, { recursive: true });
const html = await readFile(path.join(root, 'ui/generated/gallery.html'), 'utf8');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLF8AAAAASUVORK5CYII=';
let photo = pixel;
if (process.env.SELLPY_UI_PHOTO_PATH) {
  const bytes = await readFile(process.env.SELLPY_UI_PHOTO_PATH);
  const mime = bytes.subarray(0, 4).toString() === 'RIFF' ? 'image/webp' : bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
  photo = `data:${mime};base64,${bytes.toString('base64')}`;
}
function item(id, title, price, imageCount = 3) {
  return { id, title, brand: 'Testmarke', market: 'AT', language: 'de', url: `https://www.sellpy.at/item/${id}`,
    price: price === null ? null : { amount_minor: price, currency: 'EUR' }, original_price: null,
    size: 'M', size_system: 'EU', condition: 'Sehr gut', categories: ['Kleider'], colors: ['Creme'],
    materials: ['Baumwolle'], measurements: { Länge: '112 cm', Brustweite: '45 cm' },
    description: 'Originalbeschreibung des Shops.', defects: ['Leichte Gebrauchsspuren'],
    images: Array.from({ length: imageCount }, (_, index) => ({ id: `${id}-image-${index}`, index,
      url: `https://prod.images.sellpy.net/fixture/${id}-${index}.jpg` })),
    availability: 'available', observed_at: '2026-11-06T10:00:00Z', source: 'detail', attributes: {} };
}
function card(value, reason = 'Florale Details und ein weicher Schnitt passen zur gesuchten Richtung.') {
  return { item: value, reason, cautions: ['Material und Maße vor dem Kauf prüfen.'], paths: [], assessment: null };
}
const initialCards = [card(item('dress', 'Besticktes Baumwollkleid', 2400, 14)),
  card(item('skirt', 'Rock mit floralen Details', 950)), card(item('blouse', 'Bluse mit Rüschenbesatz', 1700))];
const fallbackItem = item('fallback', 'Foto nachladen', 1299, 2);
const knownItems = new Map([...initialCards.map(value => [value.item.id, value.item]), [fallbackItem.id, fallbackItem]]);
const initialGallery = { run_id: 'run-gallery', language: 'de', title: 'Cottagecore · ruhige Farben & florale Details',
  cards: initialCards, next_cursor: 'presentation-page-2', warnings: [] };
function galleryResult(gallery, hydrate = true) {
  return { content: [{ type: 'text', text: 'Selected items.' }], structuredContent: { run_id: gallery.run_id },
    _meta: { gallery, images: hydrate ? Object.fromEntries(gallery.cards.flatMap(value => value.item.images[0] ? [[value.item.images[0].id, photo]] : [])) : {} } };
}
function textResult(value, extra = {}) { return { content: [{ type: 'text', text: 'Tool result.' }], structuredContent: value, ...extra }; }
function hostPage() {
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fafafa}iframe{display:block;border:0;width:100%;height:100vh}</style><iframe title="Sellpy test app" sandbox="allow-scripts allow-popups"></iframe><script>
  const frame=document.querySelector('iframe');
  let mode='inline';
  window.hostEvents=[]; window.hostReplies=[];
  window.sendToApp=(method,params)=>frame.contentWindow.postMessage({jsonrpc:'2.0',method,params},'*');
  window.addEventListener('message',async event=>{
    if(event.source!==frame.contentWindow)return;
    const message=event.data;if(!message||message.jsonrpc!=='2.0')return;
    window.hostEvents.push({method:message.method,params:message.params});
    const reply=result=>{window.hostReplies.push(message.id);event.source.postMessage({jsonrpc:'2.0',id:message.id,result},'*');};
    if(message.method==='ui/initialize')reply({protocolVersion:message.params.protocolVersion,
      hostInfo:{name:'Sellpy browser test host',version:'1.0.0'},hostCapabilities:{serverTools:{},openLinks:{}},
      hostContext:{theme:'light',locale:'de-AT',displayMode:mode,availableDisplayModes:['inline','fullscreen']}});
    else if(message.method==='ui/notifications/initialized')window.sendToApp('ui/notifications/tool-result',await window.initialResult());
    else if(message.method==='tools/call')reply(await window.simulateTool(message.params));
    else if(message.method==='ui/open-link')reply({});
    else if(message.method==='ui/request-display-mode'){
      mode=message.params.mode;reply({mode});window.sendToApp('ui/notifications/host-context-changed',{displayMode:mode});
    }
    else if(message.id!==undefined)reply({});
  });
  <\/script>`;
}

const browser = await chromium.launch({ headless: true,
  ...(process.env.SELLPY_UI_CHROMIUM_PATH ? { executablePath: process.env.SELLPY_UI_CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const pageErrors = [], calls = [];
let failFirstPhoto = true, failWholeBatch = true, refreshFails = true, holdRefresh = null, holdMore = null;
page.on('pageerror', error => pageErrors.push(error.message));
await context.route('https://**/*', route => route.abort());
await page.exposeFunction('initialResult', () => galleryResult(initialGallery));
await page.exposeFunction('simulateTool', async request => {
  calls.push(structuredClone(request));
  const args = request.arguments;
  if (request.name === 'get_item_images') {
    const value = knownItems.get(args.item_id);
    assert(value, 'image request must identify a known item');
    assert.equal(args.for_model, false, 'widget image bytes must not be sent as model-visible content');
    if (value.id === 'fallback' && args.start_index === 1 && failWholeBatch) {
      failWholeBatch = false;
      return textResult({ error: { code: 'rate_limited', message: 'Fotos kurz pausiert.', retryable: true,
        retry_at: new Date(Date.now() + 1600).toISOString() } }, { isError: true });
    }
    const images = value.images.filter(image => image.index >= args.start_index).slice(0, args.batch_size);
    const hydrate = {}, retryAt = new Date(Date.now() + 1600).toISOString();
    const rows = images.map(image => {
      if (args.item_id === 'dress' && args.start_index === 1 && failFirstPhoto && image.index === 1) {
        return { ...image, status: 'failed', error: { code: 'rate_limited', message: 'Foto vorübergehend nicht verfügbar.', retry_at: retryAt, retryable: true } };
      }
      hydrate[image.id] = photo;
      return { ...image, status: 'ready', mime_type: 'image/png' };
    });
    if (args.item_id === 'dress' && args.start_index === 1) failFirstPhoto = false;
    const next = images.at(-1)?.index + 1;
    return textResult({ item_id: value.id, images: rows, next_index: next < value.images.length ? next : null,
      remaining_indices: value.images.filter(image => image.index >= next).map(image => image.index) }, { _meta: { images: hydrate } });
  }
  if (request.name === 'get_items') {
    if (holdRefresh) return holdRefresh.promise;
    if (refreshFails) return textResult({ error: { message: 'Upstream temporarily unavailable.' } }, { isError: true });
    const old = initialCards.find(entry => entry.item.id === args.ids[0]).item;
    return textResult({ items: [{ ...old, price: { amount_minor: 2100, currency: 'EUR' }, availability: 'reserved', observed_at: '2026-11-06T11:00:00Z' }] });
  }
  if (request.name === 'present_items') {
    if (holdMore) return holdMore.promise;
    assert.equal(args.cursor, 'presentation-page-2');
    return galleryResult({ ...initialGallery, next_cursor: null, cards: [initialCards[2], card(item('extra', '<img src=x onerror=alert(1)>', null, 1), 'Wörtlicher Titel aus dem Shop.')] });
  }
  throw new Error(`Unexpected tool ${request.name}`);
});

try {
  await page.setContent(hostPage());
  await page.locator('iframe').evaluate((frame, content) => { frame.srcdoc = content; }, html);
  const frame = page.frameLocator('iframe');
  await frame.locator('.card').nth(2).waitFor();
  await frame.locator('.card').first().locator('img').evaluate(img => img.decode());
  assert.equal(await frame.locator('.card').count(), 3);
  assert.equal(await frame.locator('.card').first().locator('.price').innerText(), '24,00 €');
  assert.equal(await frame.locator('.card').first().locator('img').evaluate(img => getComputedStyle(img).objectFit), 'contain');
  assert.equal(await frame.locator('html').evaluate(node => node.scrollWidth <= innerWidth), true, 'mobile must not overflow horizontally');
  assert.equal(await frame.locator('.card').first().locator('img').evaluate(img => img.naturalWidth > 0), true);
  await page.screenshot({ path: path.join(outputDirectory, 'mobile-390.png'), fullPage: true });

  await frame.locator('#sort').selectOption('ascending');
  assert.equal(await frame.locator('.card').first().getAttribute('data-item-id'), 'skirt');
  assert.match(await frame.locator('.card').first().locator('img').getAttribute('data-photo-key'), /^skirt\|skirt-image-0\|/);
  await frame.locator('#sort').selectOption('recommended');
  await frame.locator('.photo-open').first().click();
  await frame.locator('dialog').waitFor({ state: 'visible' });
  await frame.getByRole('button', { name: 'Nächstes Foto', exact: true }).click();
  await frame.getByText('Foto vorübergehend nicht verfügbar.', { exact: true }).first().waitFor();
  assert.equal(await frame.locator('.viewer-actions button').first().isDisabled(), true, 'provider retry-at must disable the retry');
  assert.equal(await frame.locator('.thumbnail').first().locator('img').count(), 1, 'a failed photo must preserve the successful original');
  await page.screenshot({ path: path.join(outputDirectory, 'mobile-photo-retry.png'), fullPage: true });
  await frame.getByRole('button', { name: 'Foto erneut laden', exact: true }).waitFor();
  await frame.getByRole('button', { name: 'Foto erneut laden', exact: true }).click();
  await frame.locator('.viewer-stage img').waitFor({ state: 'visible' });
  await frame.locator('.viewer-stage img').evaluate(img => img.decode());
  assert.equal(await frame.locator('.viewer-stage img').isVisible(), true);
  for (let index = 0; index < 3; index++) {
    await frame.getByRole('button', { name: 'Weitere Fotos laden', exact: true }).click();
    await frame.locator('.viewer-actions button').first().filter({ hasText: 'Foto erneut laden' }).waitFor();
  }
  await frame.getByRole('button', { name: 'Foto 14', exact: true }).click();
  assert.equal(await frame.locator('.photo-position').innerText(), '14 von 14');
  assert.equal(await frame.locator('.thumbnail img').count(), 14, 'all source photos remain reachable beyond initial batches');
  assert.deepEqual([...new Set(calls.filter(call => call.name === 'get_item_images').map(call => call.arguments.start_index))], [1, 5, 9, 13]);
  await page.screenshot({ path: path.join(outputDirectory, 'mobile-all-photos.png'), fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await frame.locator('dialog').isVisible(), false);

  await frame.getByRole('button', { name: 'Preis und Status aktualisieren', exact: true }).first().click();
  await frame.getByText('Aktualisierung fehlgeschlagen. Die bisherigen Angaben bleiben sichtbar.', { exact: true }).waitFor();
  assert.equal(await frame.locator('.card').first().locator('.price').innerText(), '24,00 €');
  refreshFails = false;
  await frame.getByRole('button', { name: 'Preis und Status aktualisieren', exact: true }).first().click();
  await frame.getByText('Preis und Status aktualisiert.', { exact: true }).waitFor();
  assert.equal(await frame.locator('.card').first().locator('.price').innerText(), '21,00 €');
  assert.equal(await frame.locator('.card').first().locator('.availability').innerText(), 'Reserviert');

  await frame.getByRole('button', { name: 'Weitere Auswahl anzeigen', exact: true }).click();
  await frame.locator('.card').nth(3).waitFor();
  assert.equal(await frame.locator('.card').count(), 4, 'overlapping next pages deduplicate without dropping new cards');
  assert.equal(await frame.locator('.card').nth(3).locator('h3').innerText(), '<img src=x onerror=alert(1)>');
  assert.equal(await frame.locator('.card').nth(3).locator('h3 img').count(), 0, 'untrusted item titles must be plain text');
  assert.equal(await frame.locator('.load-more').count(), 0);
  assert.equal(await frame.locator('.card').nth(3).locator('.price').innerText(), 'Preis offen');

  await page.setViewportSize({ width: 1120, height: 900 });
  await frame.locator('.card').nth(2).locator('img').evaluate(img => img.decode());
  await page.screenshot({ path: path.join(outputDirectory, 'desktop-1120.png'), fullPage: true });
  await frame.getByRole('button', { name: 'Größer ansehen', exact: true }).click();
  await frame.locator('body[data-display="fullscreen"]').waitFor();
  await frame.getByRole('link', { name: 'Bei Sellpy ansehen', exact: true }).first().click();
  const links = await page.evaluate(() => window.hostEvents.filter(event => event.method === 'ui/open-link').map(event => event.params.url));
  assert.equal(links[0], 'https://www.sellpy.at/item/dress');
  await page.evaluate(() => window.sendToApp('ui/notifications/host-context-changed', { theme: 'dark' }));
  await frame.locator('html[data-theme="dark"]').waitFor();
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(await frame.locator('html').evaluate(node => node.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(outputDirectory, 'mobile-360-dark.png'), fullPage: true });

  let releaseRefresh;
  holdRefresh = { promise: new Promise(resolve => { releaseRefresh = resolve; }) };
  await frame.getByRole('button', { name: 'Preis und Status aktualisieren', exact: true }).first().click();
  const replacement = { ...initialGallery, run_id: 'different-run', title: 'Neue Suche', cards: [card(item('new', 'Neue Auswahl', 1234, 1))], next_cursor: null };
  await page.evaluate(result => window.sendToApp('ui/notifications/tool-result', result), galleryResult(replacement));
  await frame.getByText('Neue Auswahl', { exact: true }).waitFor();
  releaseRefresh(textResult({ error: { message: 'Old request failed.' } }, { isError: true }));
  await frame.locator('.card').first().locator('img').evaluate(img => img.decode());
  assert.equal(await frame.locator('.card').count(), 1);
  assert.equal(await frame.locator('.card').first().getAttribute('data-item-id'), 'new');
  assert.equal(await frame.locator('.card .status.error').count(), 0, 'old search failures must not modify a new search');

  let releaseMore;
  holdMore = { promise: new Promise(resolve => { releaseMore = resolve; }) };
  await page.evaluate(result => window.sendToApp('ui/notifications/tool-result', result), galleryResult(initialGallery));
  await frame.getByRole('button', { name: 'Weitere Auswahl anzeigen', exact: true }).click();
  const repliesBefore = await page.evaluate(() => window.hostReplies.length);
  const sameRunReplacement = { ...initialGallery, title: 'Neue Auswahl derselben Suche', cards: [card(item('new-only', 'Nur die neue Auswahl', 1800, 1))], next_cursor: null };
  await page.evaluate(result => window.sendToApp('ui/notifications/tool-result', result), galleryResult(sameRunReplacement));
  await frame.locator('.card[data-item-id="new-only"]').waitFor();
  releaseMore(galleryResult({ ...initialGallery, cards: [card(item('old-second', 'Veraltete Auswahl', 900, 1))], next_cursor: null }));
  await page.waitForFunction(count => window.hostReplies.length > count, repliesBefore);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await frame.locator('.card').evaluateAll(cards => cards.map(card => card.dataset.itemId)), ['new-only']);
  assert.equal(await frame.locator('h2').innerText(), 'Neue Auswahl derselben Suche');
  holdMore = null;

  const fallbackGallery = { ...initialGallery, run_id: 'fallback-run', title: 'Bilder über den Server nachladen', cards: [card(fallbackItem)], next_cursor: null };
  await page.evaluate(result => window.sendToApp('ui/notifications/tool-result', result), galleryResult(fallbackGallery, false));
  await frame.locator('.card[data-item-id="fallback"] img[src^="data:"]').waitFor();
  await frame.locator('.card[data-item-id="fallback"] img').evaluate(img => img.decode());
  const coverCalls = calls.filter(call => call.name === 'get_item_images' && call.arguments.item_id === 'fallback' && call.arguments.start_index === 0);
  assert.equal(coverCalls.length, 1, 'a failed direct cover must hydrate once through the server');
  assert.equal(coverCalls[0].arguments.batch_size, 1, 'cover fallback does not eagerly download every photo');
  await frame.locator('.photo-open').first().click();
  await frame.getByRole('button', { name: 'Nächstes Foto', exact: true }).click();
  await frame.getByText('Fotos kurz pausiert.', { exact: true }).first().waitFor();
  assert.equal(await frame.locator('.viewer-actions button').first().isDisabled(), true, 'whole-tool failures must retain retry-at');
  await frame.getByRole('button', { name: 'Foto erneut laden', exact: true }).waitFor();
  await frame.getByRole('button', { name: 'Foto erneut laden', exact: true }).click();
  await frame.locator('.viewer-stage img').waitFor({ state: 'visible' });
  await frame.locator('.viewer-stage img').evaluate(img => img.decode());
  await page.keyboard.press('Escape');
  assert.deepEqual(pageErrors, [], 'the browser must not report unhandled app exceptions');
  console.log(JSON.stringify({ passed: true, scenarios: ['MCP Apps initialization', '390px mobile', 'uncropped originals', 'sort identity', 'retry-at',
    'partial image failure', '14 photos', 'refresh failure and success', 'presentation continuation', 'untrusted text', '1120px desktop',
    'fullscreen', 'host-mediated original links', '360px dark mode', 'cross-run request isolation', 'same-run selection isolation', 'automatic cover hydration', 'whole-tool rate-limit recovery'], imageCalls: calls.filter(call => call.name === 'get_item_images').length,
    realPhotoPreview: photo !== pixel, screenshotDirectory: outputDirectory }, null, 2));
} finally {
  await browser.close();
}
