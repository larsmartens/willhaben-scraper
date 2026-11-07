import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { PRESENTATION_HTML } from "../src/presentation-ui.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const configuration = process.env.PLAYWRIGHT_BROWSER_CONFIG
  ? JSON.parse(await readFile(process.env.PLAYWRIGHT_BROWSER_CONFIG, "utf8")) : {};
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || configuration.executablePath;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}),
  args: configuration.args || ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 360, height: 900 }, colorScheme: "dark", reducedMotion: "reduce" });
page.setDefaultTimeout(8000);
const pageErrors = [];
const externalRequests = [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("request", request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
const pass = name => console.log("PASS " + name);

try {
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#171717}iframe{display:block;width:100%;height:880px;border:0}</style></head><body><iframe id="widget" title="willhaben" sandbox="allow-scripts allow-same-origin"></iframe></body></html>');
  await page.evaluate(html => {
    const frame = document.getElementById("widget");
    const researchIds = ["wr_" + "a".repeat(32), "wr_" + "b".repeat(32)];
    const collectionIds = ["wc_" + "c".repeat(32), "wc_" + "d".repeat(32)];
    const photoData = id => {
      const canvas = document.createElement("canvas");
      canvas.width = 24;
      canvas.height = 16;
      const context = canvas.getContext("2d");
      context.fillStyle = `rgb(${Number(id) % 251},${Number(id) * 7 % 251},${Number(id) * 17 % 251})`;
      context.fillRect(0, 0, 24, 16);
      return canvas.toDataURL("image/png").split(",")[1];
    };
    const state = { calls: [], pending: [], held: { covers: true }, deliveredUiPhotos: [2, 2], detailReads: [0, 0] };
    const send = message => frame.contentWindow.postMessage({ jsonrpc: "2.0", ...message }, "*");
    const query = (scene, index) => ({ queryId: "q_" + scene + "_" + index, query: String.fromCharCode(65 + scene) + " Suchanfrage " + (index + 1),
      filters: { priceMax: 100 }, calls: 2, pagesFetched: 2, rowsReturned: 100, scannedCount: 120, filteredOutCount: 20,
      uniqueListings: 40, reportedTotal: 500, exhausted: false, nextCursor: "search-page-3" });
    const research = scene => ({ researchId: researchIds[scene], source: "live", queryCount: 17,
      counts: { uniqueSearchListings: 48, detailRecordsRetrieved: state.detailReads[scene], descriptionsDeliveredToModel: 0,
        uniqueModelPhotoIndices: 0, visualFindingsRecorded: 0, uiPhotosLoaded: state.deliveredUiPhotos[scene] },
      queries: Array.from({ length: 8 }, (_, i) => query(scene, i)), queriesNextCursor: "queries-8" });
    const makePage = (offset = 0, pageSize = 12, scene = 0, eager = 0) => {
      const cards = Array.from({ length: Math.min(pageSize, 48 - offset) }, (_, index) => {
        const id = String(1001 + scene * 1000 + offset + index);
        return { id, rank: offset + index + 1, title: String.fromCharCode(65 + scene) + " Lampe " + id,
          url: "https://www.willhaben.at/iad/kaufen-und-verkaufen/d/lampe-" + id + "/", price: 20 + offset + index,
          location: "Wien", condition: "used", status: "active", observedAt: "2026-11-07T10:00:00Z",
          imageCount: 6, galleryComplete: true, image: { index: 0, status: index < eager ? "ready" : "pending",
            size: "thumbnail", url: "https://cache.willhaben.at/mmo/fixtures/" + id + ".png" },
          assessment: { reason: null, cautions: [], evaluation: null } };
      });
      return { structuredContent: { source: "live", title: "Übersicht " + String.fromCharCode(65 + scene),
        researchId: researchIds[scene], collectionId: collectionIds[scene], requestedCount: 48, shownCount: cards.length,
        pageSize, offset, nextCursor: offset + pageSize < 48 ? "page-" + (offset + pageSize) : null,
        previousCursor: offset > 0 ? "page-" + Math.max(0, offset - pageSize) : null,
        cards, missingIds: [], errors: [], research: research(scene),
        listingImages: [{ id: cards[2]?.id, index: 0, mimeType: "image/png", data: photoData("9") }] },
      content: [{ type: "text", text: "Offer page" }, { type: "image", mimeType: "image/png", data: photoData("8") }],
      _meta: { listingImages: cards.slice(0, eager).map(card => ({ id: card.id, index: 0, mimeType: "image/png", data: photoData(card.id) })) } };
    };
    const actionOf = message => message.params.name === "get_research" ? message.params.arguments.section : message.params.arguments.action;
    const resultFor = message => {
      const args = message.params.arguments;
      const scene = Math.max(0, researchIds.indexOf(args.researchId));
      const action = actionOf(message);
      if (action === "page") return makePage(Number(args.cursor.split("-").at(-1)), args.pageSize, scene);
      if (action === "covers") {
        state.deliveredUiPhotos[scene] += args.ids.length;
        return { structuredContent: { researchId: researchIds[scene], collectionId: collectionIds[scene],
          results: args.ids.map(id => ({ id, index: 0, size: "thumbnail" })),
          missingIds: [], errors: [], research: research(scene) }, content: [{ type: "text", text: "Cover metadata" }],
        _meta: { listingImages: args.ids.map(id => ({ id, index: 0, mimeType: "image/png", data: photoData(id) })) } };
      }
      if (action === "photos") {
        const indices = args.indices ?? Array.from({ length: Math.min(args.count ?? 4, 6 - (args.start ?? 0)) }, (_, i) => (args.start ?? 0) + i);
        state.deliveredUiPhotos[scene] += indices.length;
        const nextIndex = indices.at(-1) + 1 < 6 ? indices.at(-1) + 1 : null;
        return { structuredContent: { researchId: researchIds[scene], collectionId: collectionIds[scene],
          id: args.id, galleryTotal: 6, galleryComplete: true, nextIndex, errors: [],
          results: indices.map((index, position) => ({ id: args.id, index, mimeType: "image/png", size: "full", imageContentIndex: position + 1 })),
          research: research(scene) }, content: [{ type: "text", text: "Gallery metadata" }],
        _meta: { listingImages: indices.map(index => ({ id: args.id, index, mimeType: "image/png", data: photoData(args.id) })) } };
      }
      if (action === "details") {
        state.detailReads[scene]++;
        return { structuredContent: { researchId: researchIds[scene], collectionId: collectionIds[scene],
          results: [{ id: args.id, listing: { description: "Beschreibung für " + args.id,
          attributes: { Material: "Glas", Zustand: "Gebraucht" } } }], research: research(scene) }, content: [{ type: "text", text: "Detail metadata" }] };
      }
      if (action === "queries") {
        const offset = Number(args.cursor.split("-").at(-1));
        return { structuredContent: { ...research(scene), queries: Array.from({ length: Math.min(args.limit, 17 - offset) }, (_, i) => query(scene, offset + i)),
          nextCursor: offset + args.limit < 17 ? "queries-" + (offset + args.limit) : null } };
      }
      if (action === "listings") {
        const offset = args.cursor ? Number(args.cursor.split("-").at(-1)) : 0;
        return { structuredContent: { ...research(scene), listings: Array.from({ length: Math.min(args.limit, 24 - offset) }, (_, i) => ({
          id: String(1001 + scene * 1000 + offset + i), deliveredFields: ["title", "price"], description: null, modelPhotos: [], findings: [],
        })), nextCursor: offset + args.limit < 24 ? "audit-" + (offset + args.limit) : null } };
      }
      return { isError: true, structuredContent: { error: { message: "Unexpected fixture tool call" } } };
    };
    state.release = action => {
      state.held[action] = false;
      const pending = state.pending.filter(item => actionOf(item) === action);
      state.pending = state.pending.filter(item => actionOf(item) !== action);
      for (const message of pending) send({ id: message.id, result: resultFor(message) });
    };
    state.publish = (scene = 0, pageSize = 12, eager = 2) => send({ method: "ui/notifications/tool-result", params: makePage(0, pageSize, scene, eager) });
    state.publishPartial = (offset = 0, total = 48) => {
      const result = makePage(offset, 12, 0, 2);
      const data = result.structuredContent;
      data.total = data.requestedCount = total;
      data.cards = data.cards.slice(0, Math.min(12, total - offset));
      data.missingIds = data.cards.splice(5).map(card => card.id);
      data.shownCount = data.cards.length;
      data.nextCursor = offset + 12 < total ? "page-" + (offset + 12) : null;
      send({ method: "ui/notifications/tool-result", params: result });
    };
    state.send = send;
    state.photoData = photoData;
    window.scaleFixture = state;
    window.addEventListener("message", event => {
      if (event.source !== frame.contentWindow || event.data?.jsonrpc !== "2.0") return;
      const message = event.data;
      const recorded = structuredClone(message);
      if (message.method === "tools/call") {
        const document = frame.contentDocument;
        recorded.displayMode = document.documentElement.dataset.mode;
        const root = document.getElementById("cards").getBoundingClientRect();
        recorded.geometry = [...document.querySelectorAll(".offer")].map(card => {
          const rect = card.getBoundingClientRect();
          return { id: card.dataset.id, nearRoot: rect.right >= root.left - 240 && rect.left <= root.right + 240 &&
            rect.bottom >= root.top - 240 && rect.top <= root.bottom + 240,
          nearViewport: rect.right >= -240 && rect.left <= frame.contentWindow.innerWidth + 240 &&
            rect.bottom >= -240 && rect.top <= frame.contentWindow.innerHeight + 240 };
        });
      }
      state.calls.push(recorded);
      if (message.method === "ui/initialize") send({ id: message.id, result: { protocolVersion: "2026-01-26",
        hostInfo: { name: "scale-fixture", version: "1" }, hostCapabilities: { serverTools: {}, openLinks: {}, updateModelContext: {} },
        hostContext: { theme: "dark", locale: "de-AT", availableDisplayModes: ["inline", "fullscreen"], displayMode: "inline" } } });
      if (message.method === "ui/notifications/initialized") state.publish();
      if (["ui/update-model-context", "ui/open-link"].includes(message.method)) send({ id: message.id, result: {} });
      if (message.method === "ui/request-display-mode") send({ id: message.id, result: { mode: message.params.mode } });
      if (message.method === "tools/call") {
        if (state.held[actionOf(message)]) state.pending.push(message);
        else setTimeout(() => send({ id: message.id, result: resultFor(message) }), 15);
      }
    });
    frame.srcdoc = html;
  }, PRESENTATION_HTML);

  const frame = page.frameLocator("#widget");
  const cards = frame.locator(".offer");
  const calls = action => page.evaluate(action => window.scaleFixture.calls.filter(call => call.method === "tools/call" &&
    (call.params.arguments.action === action || call.params.arguments.section === action)), action);
  const publish = async (scene = 0, pageSize = 12) => {
    await page.evaluate(({ scene, pageSize }) => window.scaleFixture.publish(scene, pageSize), { scene, pageSize });
    await frame.locator("#title").filter({ hasText: "Übersicht " + String.fromCharCode(65 + scene) }).waitFor();
    await page.waitForFunction(size => document.getElementById("widget").contentDocument.querySelectorAll(".offer").length === size, pageSize);
  };
  const settle = () => page.waitForTimeout(120);
  await cards.nth(11).waitFor();
  assert.equal(await cards.count(), 12);
  assert.equal(await frame.locator(".cover img").count(), 2);
  assert.equal(await frame.locator('.offer[data-id="1003"] .cover img').count(), 0);
  assert.equal(await frame.locator("body").evaluate(() => typeof window.WillhabenMcpApps.App), "function");
  assert.match(await frame.locator("#page-label").textContent(), /1–12 von 48/);
  pass("official Apps bridge renders twelve cards with only two metadata-hydrated covers");

  await frame.locator('.offer[data-id="1003"]').evaluate(card => card.scrollIntoView({ block: "nearest", inline: "start" }));
  await page.waitForFunction(() => window.scaleFixture.pending.some(call => call.params.arguments.action === "covers"));
  const initialCovers = await calls("covers");
  assert(initialCovers.every(call => call.params.name === "browse_collection" && call.params.arguments.ids.length <= 4));
  assert(initialCovers.every(call => call.params.arguments.ids.every(id => call.geometry.some(card => card.id === id && card.nearRoot))));
  assert(initialCovers.every(call => !call.params.arguments.ids.includes("1001") && !call.params.arguments.ids.includes("1002")));
  pass("visible cover loading requests precise IDs in batches of at most four");

  await frame.locator("#page-next").click();
  await frame.locator('.offer[data-id="1013"]').waitFor();
  assert.equal(await cards.count(), 12);
  await page.evaluate(() => window.scaleFixture.release("covers"));
  await frame.locator('.offer[data-id="1013"] .cover img').waitFor();
  assert.equal(await frame.locator('.offer[data-id="1003"]').count(), 0);
  const expected1013 = await page.evaluate(() => "data:image/png;base64," + window.scaleFixture.photoData("1013"));
  assert.equal(await frame.locator('.offer[data-id="1013"] .cover img').getAttribute("src"), expected1013);
  assert.match(await frame.locator("#page-label").textContent(), /13–24 von 48/);
  await frame.locator("#page-previous").click();
  await frame.locator('.offer[data-id="1001"]').waitFor();
  assert.equal(await cards.count(), 12);
  pass("late covers from an earlier page cannot replace photos on the current page");

  await frame.locator("#coverage").evaluate(element => { element.open = true; });
  assert.equal(await frame.locator(".query-row").count(), 8);
  await frame.locator("#queries-more").click();
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.querySelectorAll(".query-row").length === 16);
  await frame.locator("#queries-more").click();
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.querySelectorAll(".query-row").length === 17);
  assert.equal(await frame.locator("#queries-more").isVisible(), false);
  assert.deepEqual((await calls("queries")).map(call => call.params.arguments.cursor), ["queries-8", "queries-16"]);
  assert((await calls("queries")).every(call => call.params.name === "get_research" && call.params.arguments.limit === 8));
  await frame.locator("#audit").click();
  await frame.locator(".audit-row").nth(11).waitFor();
  await frame.locator("#audit-more").click();
  await frame.locator(".audit-row").nth(23).waitFor();
  assert.equal(await frame.locator("#audit-more").isVisible(), false);
  assert.deepEqual((await calls("listings")).map(call => call.params.arguments.cursor ?? null), [null, "audit-12"]);
  pass("query and listing evidence expands through bounded independent audit pages");

  await frame.locator("#coverage").evaluate(element => { element.open = false; });
  const first = frame.locator('.offer[data-id="1001"]');
  await first.getByRole("button", { name: "Details lesen", exact: true }).click();
  await first.locator(".detail-content").filter({ hasText: "Beschreibung für 1001" }).waitFor();
  await first.getByRole("button", { name: "Fotos ansehen", exact: true }).click();
  await first.locator(".thumbnail").nth(3).waitFor();
  await first.getByRole("button", { name: "Weitere Fotos", exact: true }).click();
  await first.locator(".thumbnail").nth(5).waitFor();
  assert.equal(await first.locator(".thumbnail").count(), 6);
  assert((await calls("photos")).every(call => call.params.name === "browse_collection" && call.params.arguments.id === "1001"));
  assert((await calls("details")).every(call => call.params.name === "browse_collection" && call.params.arguments.id === "1001"));
  assert.match(await frame.locator("#coverage-counts").textContent(), /0 Beschreibungen an ChatGPT/);
  assert.match(await frame.locator("#coverage-counts").textContent(), /0 Fotos an ChatGPT/);
  assert.match(await frame.locator("#coverage-counts").textContent(), /0 Fotoprüfungen dokumentiert/);
  pass("app-only details and complete galleries use metadata bytes without inflating model inspection counters");

  await publish(0, 24);
  assert.equal(await cards.count(), 24);
  await frame.locator("#page-next").click();
  await frame.locator('.offer[data-id="1025"]').waitFor();
  assert.equal(await cards.count(), 24);
  assert.equal(await frame.locator('.offer[data-id="1001"]').count(), 0);
  assert.equal(await frame.locator("#page-next").isDisabled(), true);
  await frame.locator("#page-previous").click();
  await frame.locator('.offer[data-id="1001"]').waitFor();
  assert((await calls("page")).some(call => call.params.arguments.pageSize === 24));
  pass("24-card pages replace the DOM page and preserve next and previous navigation");

  const detailCallsBeforePartial = (await calls("details")).length;
  await page.evaluate(() => window.scaleFixture.publishPartial());
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.querySelectorAll(".offer").length === 5);
  assert.equal(await frame.locator("#source").textContent(), "willhaben · 5 von 48");
  assert.equal(await frame.locator("#page-label").textContent(), "1–12 von 48");
  assert.equal(await frame.locator("#notice").isVisible(), true);
  assert.equal(await frame.locator("#notice").textContent(), "Angebote mit fehlenden Suchdaten · 7. Bitte die Suche im Chat aktualisieren.");
  await page.evaluate(() => window.scaleFixture.send({ method: "ui/notifications/host-context-changed", params: { locale: "en-GB" } }));
  await frame.locator("#notice").filter({ hasText: "Offers with missing search data" }).waitFor();
  assert.equal(await frame.locator("#notice").textContent(), "Offers with missing search data · 7. Please refresh the search in chat.");
  assert.equal(await frame.locator("#page-label").textContent(), "1–12 of 48");
  await page.evaluate(() => window.scaleFixture.send({ method: "ui/notifications/tool-result", params: { isError: true } }));
  await frame.locator("#notice").filter({ hasText: "The selection could not be updated." }).waitFor();
  assert.equal(await cards.count(), 5);
  await frame.locator("#page-next").click();
  await frame.locator('.offer[data-id="1013"]').waitFor();
  assert.equal(await frame.locator("#page-label").textContent(), "13–24 of 48");
  assert.equal(await frame.locator("#notice").isVisible(), false);
  await page.evaluate(() => window.scaleFixture.publishPartial(24, 26));
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.querySelectorAll(".offer").length === 2);
  assert.equal(await frame.locator("#page-label").textContent(), "25–26 of 26");
  assert.equal(await frame.locator("#page-next").isDisabled(), true);
  assert.equal((await calls("details")).length, detailCallsBeforePartial);
  await page.evaluate(() => window.scaleFixture.send({ method: "ui/notifications/host-context-changed", params: { locale: "de-AT" } }));
  await publish(0, 24);
  pass("partial legacy pages disclose missing search data in both locales and preserve collection slot ranges");

  for (const width of [320, 360, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await settle();
    assert.equal(await frame.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await cards.count(), 24);
  }
  assert.equal(await frame.locator("#cards").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length), 2);
  const queriesBeforeFullscreen = await frame.locator(".query-row").count();
  await frame.locator("#fullscreen").click();
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.documentElement.dataset.mode === "fullscreen");
  assert.equal(await frame.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await frame.locator("#pager").isVisible(), false);
  assert.equal(await frame.locator(".query-row").count(), queriesBeforeFullscreen);
  await frame.locator('.offer[data-id="1024"]').evaluate(card => card.scrollIntoView({ block: "nearest", inline: "nearest" }));
  await frame.locator('.offer[data-id="1024"] .cover img').waitFor();
  await page.waitForTimeout(300);
  const fullscreenCovers = (await calls("covers")).filter(call => call.displayMode === "fullscreen");
  assert(fullscreenCovers.every(call => call.params.arguments.ids.every(id => call.geometry.some(card => card.id === id && card.nearViewport))),
    "Fullscreen cover requests must remain within the visible viewport and its prefetch margin");
  pass("320/360-pixel mobile layouts and 700-pixel grid and fullscreen remain horizontally contained");

  await page.evaluate(() => window.scaleFixture.send({ method: "ui/notifications/host-context-changed", params: { displayMode: "inline" } }));
  await page.setViewportSize({ width: 360, height: 900 });
  await publish();
  await page.evaluate(() => { window.scaleFixture.held.page = true; });
  await frame.locator("#page-next").click();
  await page.waitForFunction(() => window.scaleFixture.pending.some(call => call.params.arguments.action === "page"));
  await publish(1);
  await page.evaluate(() => { window.scaleFixture.held.page = false; });
  await frame.locator("#page-next").click();
  await frame.locator('.offer[data-id="2013"]').waitFor();
  await page.evaluate(() => window.scaleFixture.release("page"));
  await settle();
  assert.equal(await frame.locator("#title").textContent(), "Übersicht B");
  assert.equal(await frame.locator('.offer[data-id="2013"]').count(), 1);
  pass("a newer collection can page immediately and a late prior response cannot replace it");

  await publish(0);
  await frame.locator("#coverage").evaluate(element => { element.open = true; });
  await page.evaluate(() => { window.scaleFixture.held.queries = true; window.scaleFixture.held.listings = true; });
  await frame.locator("#queries-more").click();
  await frame.locator("#audit").click();
  await page.waitForFunction(() => window.scaleFixture.pending.filter(call => call.params.name === "get_research").length === 2);
  await publish(1);
  assert.equal(await frame.locator("#queries-more").isDisabled(), false);
  assert.equal(await frame.locator("#audit").isDisabled(), false);
  await page.evaluate(() => { window.scaleFixture.held.queries = false; window.scaleFixture.held.listings = false; });
  await frame.locator("#queries-more").click();
  await frame.locator("#audit").click();
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.querySelectorAll(".query-row").length === 16);
  await frame.locator(".audit-row").nth(11).waitFor();
  await page.evaluate(() => { window.scaleFixture.release("queries"); window.scaleFixture.release("listings"); });
  await settle();
  assert.equal(await frame.locator(".query-row").count(), 16);
  assert((await frame.locator(".query-name").allTextContents()).every(name => name.startsWith("B ")));
  assert.equal(await frame.locator(".audit-row").count(), 12);
  assert((await frame.locator(".audit-row strong").allTextContents()).every(id => Number(id) >= 2001));
  pass("late query and audit responses cannot append evidence from another research session");

  await frame.locator("#coverage").evaluate(element => { element.open = false; });
  await page.evaluate(() => { window.scaleFixture.held.covers = true; });
  await frame.locator('.offer[data-id="2008"]').evaluate(card => card.scrollIntoView({ block: "nearest", inline: "start" }));
  await page.waitForFunction(() => window.scaleFixture.pending.some(call => call.params.arguments.action === "covers"));
  await page.evaluate(() => window.scaleFixture.send({ id: "scale-teardown", method: "ui/resource-teardown", params: {} }));
  await page.waitForFunction(() => window.scaleFixture.calls.some(call => call.id === "scale-teardown" && call.result));
  const beforeTeardownRelease = await page.evaluate(() => window.scaleFixture.calls.filter(call => call.method === "tools/call").length);
  await page.evaluate(() => window.scaleFixture.release("covers"));
  await frame.locator("#cards").evaluate(element => { element.scrollLeft = 0; });
  await settle();
  assert.equal(await page.evaluate(() => window.scaleFixture.calls.filter(call => call.method === "tools/call").length), beforeTeardownRelease);
  assert((await calls("covers")).every(call => call.params.arguments.ids.length <= 4));
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  pass("teardown cancels queued loading and the self-contained app makes no external requests");
  console.log("All presentation scaling browser checks passed against the simulated MCP Apps host");
} catch (error) {
  console.error(JSON.stringify({ browserErrors: pageErrors, externalRequests,
    state: await page.evaluate(() => ({ title: document.getElementById("widget")?.contentDocument?.getElementById("title")?.textContent,
      pending: window.scaleFixture?.pending.map(call => call.params), lastCalls: window.scaleFixture?.calls.slice(-8) })).catch(() => null) }));
  throw error;
} finally {
  await browser.close();
}
