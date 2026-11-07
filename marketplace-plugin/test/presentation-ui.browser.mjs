import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PRESENTATION_HTML } from "../src/presentation-ui.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const configurationPath = process.env.PLAYWRIGHT_BROWSER_CONFIG;
const configuration = configurationPath ? JSON.parse(await readFile(configurationPath, "utf8")) : {};
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || configuration.executablePath;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: configuration.args || ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 360, height: 900 }, timezoneId: "Europe/Vienna", colorScheme: "dark" });
page.setDefaultTimeout(8000);
const pageErrors = [];
const externalRequests = [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("request", request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });

function pass(name) { console.log("PASS " + name); }

try {
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#171717}iframe{display:block;width:100%;height:880px;border:0}</style></head><body><iframe title="Angebotsauswahl" id="widget" sandbox="allow-scripts allow-same-origin"></iframe></body></html>');
  await page.evaluate(html => {
    const frame = document.getElementById("widget");
    const png = color => {
      const canvas = document.createElement("canvas");
      canvas.width = 24;
      canvas.height = 16;
      const context = canvas.getContext("2d");
      context.fillStyle = color;
      context.fillRect(0, 0, 24, 16);
      return canvas.toDataURL("image/png").split(",")[1];
    };
    const photos = { red: png("#a83838"), blue: png("#2859a8"), green: png("#3a8758") };
    const fixture = {
      structuredContent: {
        source: "live", title: "Lampen für das Wohnzimmer", summary: "Drei ausgewählte Angebote mit ihren offenen Anforderungen.", requestedCount: 4, shownCount: 3,
        cards: [
          { id: "101", rank: 1, title: 'Lampe <img src="x" onerror="window.fixtureXss=1">', url: "https://www.willhaben.at/iad/kaufen-und-verkaufen/d/lampe-101/", price: 120, priceType: "asking", location: "Wien", condition: "used", status: "active", sellerType: "private", quantity: 2, unitPrice: 60, shipping: "shipping", shippingCost: 5, totalPrice: 125, observedAt: "2026-11-06T20:00:00Z", cacheAgeSeconds: 90, imageCount: 6, galleryComplete: true,
            image: { index: 1, url: "https://cache.willhaben.at/mmo/fixtures/101-1.jpg", status: "ready", size: "full" },
            assessment: { reason: "Passende Form und dokumentierte Abmessungen.", cautions: ["Herstellerangabe offen", "Eine Nahaufnahme der Fassung fehlt"], evaluation: { status: "unknown", criteria: [{ key: "diameterMm", expected: { min: 55, max: 65 }, actual: 60, status: "confirmed" }, { key: "openingMm", expected: 24, actual: null, status: "unknown" }] } } },
          { id: "202", rank: 2, title: "Kleine Tischlampe", url: "https://willhaben.at/iad/kaufen-und-verkaufen/d/tischlampe-202/", price: 40, priceType: "negotiable", location: "Graz", condition: "used", status: "active", observedAt: "2026-11-06T19:30:00Z", cacheAgeSeconds: 1800, imageCount: 1, galleryComplete: true,
            image: { index: 0, url: "https://cache.willhaben.at/mmo/fixtures/202-0.jpg", status: "ready", size: "full" }, assessment: { reason: "Niedriger Angebotspreis.", cautions: [], evaluation: null } },
          { id: "303", rank: 3, title: "Stehlampe ohne Preisangabe", url: "https://www.willhaben.at/iad/kaufen-und-verkaufen/d/stehlampe-303/", price: null, status: "unknown", observedAt: null, cacheAgeSeconds: null, imageCount: 2, galleryComplete: false,
            image: { index: 4, url: null, status: "failed", error: { code: "photo_index_unavailable", availableIndices: [0, 1] } }, assessment: { reason: null, cautions: ["Preis offen"], evaluation: null } },
        ], missingIds: ["404"], errors: [],
      },
      _meta: { listingImages: [
        { id: "101", index: 0, mimeType: "image/png", data: photos.green },
        { id: "202", index: 0, mimeType: "image/png", data: photos.blue },
        { id: "101", index: 1, mimeType: "image/png", data: photos.red },
      ] },
    };
    const attempts = new Map();
    window.calls = [];
    window.fixture = fixture;
    window.fixturePhotos = photos;
    const send = message => frame.contentWindow.postMessage({ jsonrpc: "2.0", ...message }, "*");
    window.sendToWidget = send;
    window.galleryResponse = (id, indices, total, nextIndex, errors = []) => ({
      structuredContent: { id, galleryTotal: total, galleryComplete: true, results: indices.map((index, offset) => ({ id, index, url: "https://cache.willhaben.at/mmo/fixtures/" + id + "-" + index + ".png", size: "full", mimeType: "image/png", imageContentIndex: offset + 1 })), errors, nextIndex, stopReason: errors.length ? errors[0].code : nextIndex === null ? null : "batch_size" },
      content: [{ type: "text", text: "Gallery results" }, ...indices.map(index => ({ type: "image", mimeType: "image/png", data: [photos.red, photos.blue, photos.green][index % 3] }))],
    });
    window.addEventListener("message", event => {
      if (event.source !== frame.contentWindow || event.data?.jsonrpc !== "2.0") return;
      const message = event.data;
      window.calls.push(message);
      if (message.method === "ui/initialize") send({ id: message.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "fixture", version: "1" }, hostCapabilities: { openLinks: {}, serverTools: {}, updateModelContext: {} }, hostContext: { theme: "dark", locale: "de-AT", availableDisplayModes: ["inline", "fullscreen"], displayMode: "inline" } } });
      if (message.method === "ui/update-model-context") send({ id: message.id, result: {} });
      if (message.method === "ui/notifications/initialized") send({ method: "ui/notifications/tool-result", params: fixture });
      if (message.method === "ui/open-link") send({ id: message.id, result: {} });
      if (message.method === "ui/request-display-mode") send({ id: message.id, result: { mode: message.params.mode } });
      if (message.method === "tools/call") {
        const { id, start, indices } = message.params.arguments;
        const key = id + ":" + (indices ? indices.join(",") : start);
        const attempt = (attempts.get(key) || 0) + 1;
        attempts.set(key, attempt);
        let result;
        if (id === "101" && start === 0) result = window.galleryResponse(id, [0, 1], 6, 2);
        if (id === "101" && start === 2 && attempt === 1) result = window.galleryResponse(id, [], 6, 2, [{ id, index: 2, code: "upstream_cooldown", message: "Kurze Wartezeit", retryAt: new Date(Date.now() + 300).toISOString() }]);
        if (id === "101" && start === 2 && attempt > 1) result = window.galleryResponse(id, [2, 3], 6, 4);
        if (id === "101" && start === 4) {
          result = window.galleryResponse(id, [4], 6, null);
          result.structuredContent.remainingIndices = [5];
        }
        if (id === "101" && indices?.length === 1 && indices[0] === 5) {
          result = window.galleryResponse(id, [5], 6, null);
          result.structuredContent.remainingIndices = [];
        }
        if (id === "202" && attempt === 1) result = window.galleryResponse("999", [0], 1, null);
        if (id === "202" && attempt === 2) {
          result = window.galleryResponse(id, [0], 1, null);
          result.content[1].mimeType = "image/svg+xml";
        }
        if (id === "202" && attempt > 2) result = window.galleryResponse(id, [0], 1, null);
        if (id === "303") result = { isError: true, structuredContent: { error: { code: "upstream_cooldown", message: "Zeitweilige Wartezeit", retryAt: new Date(Date.now() + 300).toISOString() } }, content: [] };
        setTimeout(() => send({ id: message.id, result: result || { isError: true, structuredContent: { error: { message: "Unexpected fixture request" } } } }), 30);
      }
    });
    frame.srcdoc = html;
  }, PRESENTATION_HTML);

  const frame = page.frameLocator("#widget");
  await frame.locator(".offer").last().waitFor();
  await page.waitForFunction(() => window.calls.some(call => call.method === "ui/notifications/initialized"));
  const initialization = await page.evaluate(() => window.calls.find(call => call.method === "ui/initialize"));
  assert.equal(initialization.params.protocolVersion, "2026-01-26");
  assert.equal(initialization.params.appInfo.version, "1.5.0");
  assert.equal(await frame.locator(".offer").count(), 3);
  assert.equal(await frame.locator('.brand-title img[alt="willhaben"]').evaluate(image => image.naturalWidth), 192);
  pass("MCP Apps initializes before receiving the presentation");

  const first = frame.locator('.offer[data-id="101"]');
  const second = frame.locator('.offer[data-id="202"]');
  const third = frame.locator('.offer[data-id="303"]');
  const expectedImage = await page.evaluate(() => "data:image/png;base64," + window.fixturePhotos.red);
  assert.equal(await first.locator(".cover img").getAttribute("src"), expectedImage);
  assert.equal(await first.locator(".cover img").evaluate(image => image.naturalWidth), 24);
  assert.equal(await first.locator(".cover img").evaluate(image => getComputedStyle(image).objectFit), "contain");
  assert.equal(await third.locator(".cover img").count(), 0);
  assert.match(await third.locator(".photo-placeholder").textContent(), /Verfügbare Fotos 1, 2/);
  assert.equal(await third.locator(".photo-count").textContent(), "2 bekannte Fotos");
  assert.doesNotMatch(await third.textContent(), /Händler|Gratis|Bestätigt/);
  assert.equal(await first.locator(".offer-title img").count(), 0);
  assert.match(await first.locator(".criterion-list").textContent(), /Durchmesser · Bestätigt · Gesucht 55–65 mm · Angabe 60 mm/);
  assert.match(await first.locator(".criterion-list").textContent(), /Öffnungsdurchmesser · Offen · Gesucht 24 mm/);
  assert.match(await first.locator(".offer-title").textContent(), /<img src=/);
  assert.equal(await frame.locator("body").evaluate(() => window.fixtureXss), undefined);
  assert.equal(await frame.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await frame.locator("html").getAttribute("data-theme"), "dark");
  pass("360-pixel dark layout preserves image identity, unknown facts and literal hostile text");

  const beforeSort = await page.evaluate(() => window.calls.filter(call => call.method === "tools/call").length);
  await frame.getByLabel("Sortieren", { exact: true }).selectOption("price_asc");
  assert.deepEqual(await frame.locator(".offer").evaluateAll(cards => cards.map(card => card.dataset.id)), ["202", "101", "303"]);
  await frame.getByLabel("Sortieren", { exact: true }).selectOption("price_desc");
  assert.deepEqual(await frame.locator(".offer").evaluateAll(cards => cards.map(card => card.dataset.id)), ["101", "202", "303"]);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === "tools/call").length), beforeSort);
  await frame.getByLabel("Sortieren", { exact: true }).selectOption("rank");
  await frame.getByRole("button", { name: "Nächstes Angebot", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.getElementById("pager").dataset.position === "1");
  assert.match(await frame.locator("#position").textContent(), /2 von 3/);
  pass("local sorting makes unknown prices last and mobile navigation reaches later cards");

  await first.getByRole("button", { name: "Inserat öffnen", exact: true }).click();
  await page.waitForFunction(() => window.calls.some(call => call.method === "ui/open-link" && call.params.url === "https://www.willhaben.at/iad/kaufen-und-verkaufen/d/lampe-101/"));
  const link = await page.evaluate(() => window.calls.find(call => call.method === "ui/open-link"));
  assert.equal(link.params.url, "https://www.willhaben.at/iad/kaufen-und-verkaufen/d/lampe-101/");
  await second.getByRole("button", { name: "Inserat öffnen", exact: true }).click();
  await page.waitForFunction(() => window.calls.some(call => call.method === "ui/open-link" && call.params.url === "https://willhaben.at/iad/kaufen-und-verkaufen/d/tischlampe-202/"));
  const secondLink = await page.evaluate(() => window.calls.filter(call => call.method === "ui/open-link").at(-1));
  assert.equal(secondLink.params.url, "https://willhaben.at/iad/kaufen-und-verkaufen/d/tischlampe-202/");
  pass("the original listing opens through the host bridge");

  await first.getByRole("button", { name: "Fotos ansehen", exact: true }).click();
  await first.locator(".thumbnail").nth(1).waitFor();
  assert.equal(await first.locator(".thumbnail").count(), 2);
  await first.getByRole("button", { name: "Foto 2", exact: true }).click();
  assert.match(await first.locator(".gallery-caption").textContent(), /Foto 2 von 6/);
  await frame.getByLabel("Sortieren", { exact: true }).selectOption("price_asc");
  assert.equal(await first.locator(".thumbnail").count(), 2);
  assert.match(await first.locator(".gallery-caption").textContent(), /Foto 2 von 6/);
  await first.getByRole("button", { name: "Weitere Fotos", exact: true }).click();
  await first.locator(".gallery-status").filter({ hasText: "Kurze Wartezeit" }).waitFor();
  assert.equal(await first.locator(".thumbnail").count(), 2);
  assert.match(await first.locator(".gallery-status").textContent(), /Erneut abrufbar ab/);
  await first.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
  await first.locator(".thumbnail").nth(3).waitFor();
  await first.getByRole("button", { name: "Weitere Fotos", exact: true }).click();
  await first.locator(".thumbnail").nth(4).waitFor();
  await first.getByRole("button", { name: "Weitere Fotos", exact: true }).click();
  await first.locator(".thumbnail").nth(5).waitFor();
  assert.equal(await first.locator(".thumbnail").count(), 6);
  assert.equal(await first.locator(".more").isVisible(), false);
  const firstCalls = await page.evaluate(() => window.calls.filter(call => call.method === "tools/call" && call.params.arguments.id === "101"));
  assert.deepEqual(firstCalls.map(call => call.params.arguments.indices ?? call.params.arguments.start), [0, 2, 2, 4, [5]]);
  assert.equal(firstCalls.at(-1).params.arguments.start, undefined);
  assert(firstCalls.every(call => call.params.name === "inspect_listing_images" && call.params.arguments.mode === "images"));
  pass("gallery continuation reaches every index and preserves earlier photos through cooldown and sorting");

  await second.getByRole("button", { name: "Fotos ansehen", exact: true }).click();
  await second.locator(".gallery-status").filter({ hasText: "nicht sicher zugeordnet" }).waitFor();
  assert.equal(await second.locator(".thumbnail").count(), 0);
  await second.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
  await second.locator(".gallery-status").filter({ hasText: "nicht sicher zugeordnet" }).waitFor();
  assert.equal(await second.locator(".thumbnail").count(), 0);
  await second.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
  await second.locator(".thumbnail").first().waitFor();
  assert.equal(await second.locator(".thumbnail").count(), 1);
  pass("wrong-listing and unsupported image responses are rejected and can be retried");

  await third.getByRole("button", { name: "Fotos ansehen", exact: true }).click();
  await third.locator(".gallery-status").filter({ hasText: "Zeitweilige Wartezeit" }).waitFor();
  assert.match(await third.locator(".gallery-status").textContent(), /Erneut abrufbar ab/);
  pass("a top-level tool cooldown keeps the card visible and carries its retry time");

  await frame.locator("body").evaluate(() => window.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { source: "live", title: "Untrusted", cards: [] } } }, "*"));
  await page.evaluate(() => window.sendToWidget({ method: "ui/notifications/tool-result", params: { isError: true } }));
  await frame.locator("#notice").filter({ hasText: "nicht aktualisiert" }).waitFor();
  assert.equal(await frame.locator(".offer").count(), 3);
  assert.equal(await frame.locator("#title").textContent(), "Lampen für das Wohnzimmer");
  pass("untrusted messages and failed refreshes preserve existing results");

  await page.evaluate(() => {
    const fixture = structuredClone(window.fixture);
    fixture.structuredContent.cards[2].image = { index: 0, status: "pending", url: null, error: { code: "upstream_cooldown", retryAt: new Date(Date.now() + 1000).toISOString() } };
    window.sendToWidget({ method: "ui/notifications/tool-result", params: fixture });
  });
  await third.locator(".photo-placeholder").filter({ hasText: "Erneut abrufbar ab" }).waitFor();
  const beforeCooldown = await page.evaluate(() => window.calls.filter(call => call.method === "tools/call").length);
  await third.getByRole("button", { name: "Fotos ansehen", exact: true }).click();
  assert.equal(await third.locator(".more").isDisabled(), true);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === "tools/call").length), beforeCooldown);
  assert.match(await third.locator(".gallery-status").textContent(), /Erneut abrufbar ab/);
  await third.getByRole("button", { name: "Weitere Fotos", exact: true }).click();
  await third.locator(".gallery-status").filter({ hasText: "Zeitweilige Wartezeit" }).waitFor();
  pass("an initial photo cooldown is visible and blocks gallery requests until its retry time");

  await page.evaluate(() => window.sendToWidget({ method: "ui/notifications/host-context-changed", params: { theme: "light", availableDisplayModes: ["inline"] } }));
  assert.equal(await frame.locator("#fullscreen").isVisible(), false);
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(await frame.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await frame.locator("html").getAttribute("data-theme"), "light");
  await page.evaluate(() => window.sendToWidget({ method: "ui/notifications/host-context-changed", params: { availableDisplayModes: ["inline", "fullscreen"], locale: "en-GB" } }));
  await frame.getByLabel("Sort", { exact: true }).waitFor();
  assert.equal(await frame.locator("html").getAttribute("lang"), "en");
  assert.match(await third.locator(".price").textContent(), /Price unknown/);
  pass("320-pixel layout, host theme, locale and optional capabilities adapt correctly");

  await frame.getByRole("button", { name: "Larger view", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.documentElement.dataset.mode === "fullscreen");
  assert.equal(await frame.locator("#fullscreen").isVisible(), true);
  assert.equal(await frame.locator("#fullscreen").textContent(), "Back to chat");
  assert.equal(await frame.locator("#pager").isVisible(), false);
  await page.setViewportSize({ width: 1040, height: 1000 });
  assert.equal(await frame.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  pass("fullscreen is requested only when the host advertises support");

  await page.evaluate(() => {
    const fixture = structuredClone(window.fixture);
    fixture.structuredContent.cards[2].imageCount = 0;
    fixture.structuredContent.cards[2].galleryComplete = false;
    window.sendToWidget({ method: "ui/notifications/tool-result", params: fixture });
  });
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.querySelector('[data-id="303"] .photo-count') === null);
  assert.equal(await third.getByRole("button", { name: "View photos", exact: true }).isEnabled(), true);
  pass("a zero-photo partial observation can still request the listing gallery");

  if (process.env.UI_SCREENSHOT_DIR) {
    const directory = resolve(process.env.UI_SCREENSHOT_DIR);
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, "presentation-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 360, height: 900 });
    await page.evaluate(() => window.sendToWidget({ method: "ui/notifications/host-context-changed", params: { theme: "dark", displayMode: "inline", locale: "de-AT" } }));
    await frame.getByLabel("Sortieren", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(directory, "presentation-mobile.png"), fullPage: true });
  }
  await page.evaluate(() => window.sendToWidget({ id: "host-teardown", method: "ui/resource-teardown", params: {} }));
  await page.waitForFunction(() => window.calls.some(call => call.id === "host-teardown" && call.result));
  const teardown = await page.evaluate(() => window.calls.find(call => call.id === "host-teardown"));
  assert.deepEqual(teardown, { jsonrpc: "2.0", id: "host-teardown", result: {} });
  pass("the UI acknowledges a host teardown request before the host unmounts it");

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  pass("the self-contained UI performs no direct external requests and raises no browser exceptions");
  console.log("All presentation browser checks passed against the simulated MCP Apps host");
} catch (error) {
  console.error(JSON.stringify({ browserErrors: pageErrors, frames: page.frames().map(frame => frame.url()) }));
  throw error;
} finally {
  await browser.close();
}
