import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { PRESENTATION_HTML } from "../src/presentation-ui.mjs";
import { listingCard } from "../src/presentation.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const configuration = process.env.PLAYWRIGHT_BROWSER_CONFIG
  ? JSON.parse(await readFile(process.env.PLAYWRIGHT_BROWSER_CONFIG, "utf8")) : {};
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || configuration.executablePath;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}),
  args: configuration.args || ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 360, height: 1000 }, colorScheme: "dark", reducedMotion: "reduce" });
const errors = [], requests = [];
const pass = name => console.log("PASS " + name);

async function createScene(capabilities = { message: { text: {} }, updateModelContext: { structuredContent: {} } }) {
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#171717}iframe{display:block;width:100%;height:980px;border:0}</style></head><body><iframe id="widget" title="willhaben" sandbox="allow-scripts allow-same-origin"></iframe></body></html>');
  await page.evaluate(({ html, capabilities }) => {
    const frame = document.getElementById("widget");
    const researchId = "wr_" + "a".repeat(32), collectionId = "wc_" + "b".repeat(32);
    const photo = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    const state = { calls: [], pending: [], held: {}, feedbackFault: null, contextFailure: false, messageFailure: false,
      revision: 0, feedback: new Map(), reviewUpdates: new Map(), pageCard: null, detailCard: null };
    const send = message => frame.contentWindow.postMessage({ jsonrpc: "2.0", ...message }, "*");
    const result = data => ({ content: [{ type: "text", text: "Fixture metadata" }], structuredContent: data });
    const feedback = id => state.feedback.get(id) ?? { decision: "neutral", revision: 0, updatedAt: null };
    const review = id => {
      if (state.reviewUpdates.has(id)) return state.reviewUpdates.get(id);
      const assessed = ["1001", "1013"].includes(id);
      return { status: assessed ? "current" : id === "1003" ? "stale" : "unreviewed", evidenceType: "agent-reported",
        observedAt: "2026-11-07T10:00:00Z", reviewedAt: assessed ? "2026-11-07T10:01:00Z" : null,
        checkedPhotoIds: assessed ? ["photo-" + id + "-0", "photo-" + id + "-1"] : [], checkedPhotoIndices: assessed ? [0, 1] : [],
        findings: assessed ? [id === "1001" ? "Grünes Glas an zwei Ansichten sichtbar." : "Der Schirm ist aus Metall."] : [],
        staleRequirements: id === "1003" ? ["Grüner Glasschirm"] : [], requirementsTotal: id === "1001" ? 4 : assessed ? 2 : 0,
        requirementsTruncated: id === "1001", requirements: assessed ? [
          { requirement: id === "1001" ? "Grüner Glasschirm" : "  GRÜNER   Glasschirm  ",
            verdict: id === "1001" ? "confirmed" : "contradicted", evidence: id === "1001" ? "Grünes durchscheinendes Glas." : "Undurchsichtiger Metallschirm.",
            photoIds: ["photo-" + id + "-0"], photoIndices: [0], reviewedAt: "2026-11-07T10:01:00Z" },
          { requirement: "Kein grüner Glasschirm", verdict: id === "1001" ? "contradicted" : "confirmed", evidence: "Eigenständiges negiertes Kriterium.",
            photoIds: ["photo-" + id + "-1"], photoIndices: [1], reviewedAt: "2026-11-07T10:01:00Z" },
        ] : [] };
    };
    const makePage = (offset = 0, options = {}) => {
      const cards = Array.from({ length: 12 }, (_, index) => {
        const id = String(1001 + offset + index);
        if (state.pageCard?.id === id) return { ...state.pageCard, rank: offset + index + 1, review: review(id), feedback: feedback(id) };
        return { id, rank: offset + index + 1, title: "Lampe " + id,
          url: "https://www.willhaben.at/iad/kaufen-und-verkaufen/d/lampe-" + id + "/",
          price: id === "1001" ? 120 : 20 + offset + index, priceType: "asking", location: "Wien", condition: "used", status: "active",
          quantity: id === "1001" ? 2 : 1, unitPrice: id === "1001" ? 60 : 20 + offset + index,
          shipping: "both", shippingCost: 5, totalPrice: id === "1001" ? 125 : 25 + offset + index,
          observedAt: "2026-11-07T10:00:00Z", imageCount: 6, galleryComplete: true,
          image: { index: 0, status: index < 2 ? "ready" : "missing", size: "full",
            url: index < 2 ? "https://cache.willhaben.at/mmo/fixtures/" + id + ".png" : null },
          assessment: { reason: "Kandidat aus der Lampenrecherche.", cautions: ["Herstellungsjahr offen."], evaluation: null },
          feedback: options.oldFeedback || options.otherResearch ? { decision: "neutral", revision: 0, updatedAt: null } : feedback(id), review: review(id) };
      });
      return { ...result({ source: "live", title: "Lampenübersicht", researchId: options.otherResearch ? "wr_" + "c".repeat(32) : researchId,
        collectionId, cards, requestedCount: 24, pageSize: 12, offset, total: 24, pageRequestedCount: 12,
        nextCursor: offset === 0 ? "page-12" : null, previousCursor: offset === 12 ? "page-0" : null,
        missingIds: [], errors: [] }),
      _meta: { listingImages: cards.filter(card => card.image.status === "ready").slice(0, 2).map(card => ({ id: card.id, index: 0, mimeType: "image/png", data: photo })) } };
    };
    const action = message => message.method === "tools/call" ? message.params.arguments.action ?? message.params.name : message.method;
    const respond = message => {
      if (message.method === "ui/update-model-context") return state.contextFailure
        ? { error: { code: -32603, message: "Fixture context failure" } } : { result: {} };
      if (message.method === "ui/message") return { result: state.messageFailure ? { isError: true } : {} };
      if (message.method === "ui/open-link") return { result: {} };
      if (message.method === "ui/request-display-mode") return { result: { mode: message.params.mode } };
      const args = message.params.arguments;
      if (message.params.name === "set_listing_feedback") {
        if (state.feedbackFault === "error") return { result: { ...result({ error: { message: "Fixture write failed" } }), isError: true } };
        const saved = { decision: args.decision, revision: ++state.revision, updatedAt: "2026-11-07T10:02:00Z" };
        const response = { researchId: state.feedbackFault === "research" ? "wr_" + "f".repeat(32) : args.researchId,
          id: state.feedbackFault === "identity" ? "9999" : args.id, feedback: saved };
        if (!state.feedbackFault) state.feedback.set(args.id, saved);
        return { result: result(response) };
      }
      if (args.action === "page") return { result: makePage(Number(args.cursor.split("-").at(-1))) };
      if (args.action === "details") {
        const changed = { ...review(args.id), status: "stale", observedAt: state.detailReviewObservedAt ?? state.detailCard?.observedAt ?? "2026-11-07T10:05:00Z", checkedPhotoIds: [], checkedPhotoIndices: [],
          requirements: [], requirementsTotal: 0, findings: [], staleRequirements: ["Grüner Glasschirm"], requirementsTruncated: false };
        state.reviewUpdates.set(args.id, changed);
        return { result: result({ researchId, collectionId, results: [{ id: args.id, observedAt: state.detailCard?.observedAt ?? changed.observedAt,
          listing: { description: "Neue Inseratangaben erfordern eine erneute Bildprüfung.", attributes: { Material: "Metall" } },
          ...(state.detailCard ? { card: state.detailCard } : {}),
          review: changed, feedback: feedback(args.id) }] }) };
      }
      if (args.action === "covers") return { result: { ...result({ researchId, collectionId, results: args.ids.map(id => ({ id, index: 0 })), errors: [] }),
        _meta: { listingImages: args.ids.map(id => ({ id, index: 0, mimeType: "image/png", data: photo })) } } };
      if (args.action === "photos") {
        const indices = [0, 1];
        return { result: { ...result({ researchId, collectionId, id: args.id, galleryTotal: 6, galleryComplete: true,
          results: indices.map((index, i) => ({ id: args.id, index, mimeType: "image/png", size: "full", imageContentIndex: i + 1 })),
          errors: [], nextIndex: null }),
        _meta: { listingImages: indices.map(index => ({ id: args.id, index, mimeType: "image/png", data: photo })) } } };
      }
      return { result: { ...result({ error: { message: "Unexpected fixture request" } }), isError: true } };
    };
    state.release = kind => {
      state.held[kind] = false;
      const pending = state.pending.filter(item => action(item.message) === kind);
      state.pending = state.pending.filter(item => action(item.message) !== kind);
      for (const item of pending) send({ id: item.message.id, ...item.response });
    };
    state.publish = (offset = 0, options = {}) => send({ method: "ui/notifications/tool-result", params: makePage(offset, options) });
    state.publishPartialReviews = () => {
      const current = review("1001");
      state.reviewUpdates.set("1001", { ...current, status: "stale", observedAt: "2026-11-07T10:03:00Z",
        requirements: current.requirements.slice(0, 1), requirementsTotal: 1, requirementsTruncated: false,
        staleRequirements: ["  ORIGINALE   Elektrik  "] });
      state.reviewUpdates.set("1002", { status: "stale", observedAt: "2026-11-07T10:03:00Z", reviewedAt: current.reviewedAt,
        findings: ["Legacy finding with unresolved validity."], requirements: current.requirements });
      state.publish();
    };
    state.publishOldReview = () => {
      const changed = state.reviewUpdates.get("1001");
      state.reviewUpdates.delete("1001");
      const old = makePage();
      state.reviewUpdates.set("1001", changed);
      send({ method: "ui/notifications/tool-result", params: old });
    };
    state.send = send;
    window.researchFixture = state;
    window.addEventListener("message", event => {
      if (event.source !== frame.contentWindow || event.data?.jsonrpc !== "2.0") return;
      const message = event.data;
      state.calls.push(structuredClone(message));
      if (message.method === "ui/initialize") send({ id: message.id, result: { protocolVersion: "2026-01-26",
        hostInfo: { name: "research-fixture", version: "1" }, hostCapabilities: { serverTools: {}, openLinks: {}, ...capabilities },
        hostContext: { theme: "dark", locale: "de-AT", availableDisplayModes: ["inline", "fullscreen"], displayMode: "inline" } } });
      else if (message.method === "ui/notifications/initialized") state.publish();
      else if (message.id !== undefined) {
        const response = respond(message);
        if (state.held[action(message)]) state.pending.push({ message, response });
        else send({ id: message.id, ...response });
      }
    });
    frame.srcdoc = html;
  }, { html: PRESENTATION_HTML, capabilities });
  const frame = page.frameLocator("#widget");
  await frame.locator('.offer[data-id="1012"]').waitFor();
  await page.waitForFunction(() => !document.getElementById("widget").contentDocument.querySelector(".shortlist-button").disabled);
  return { page, frame };
}

function detailCard(overrides = {}) {
  const row = { id: "1001", title: "Aktualisierte Lampe", url: "https://www.willhaben.at/iad/kaufen-und-verkaufen/d/lampe-1001/",
    price: 75, priceType: "fixed", status: "sold", condition: "used", quantity: 1, shipping: "shipping", shippingCost: 10,
    observedAt: "2026-11-07T10:05:00Z", imageCount: 6, galleryComplete: true,
    gallery: [{ index: 0, url: "https://cache.willhaben.at/mmo/fixtures/1001.png" }], ...overrides };
  return listingCard(row, { id: row.id }, 1, "live", [{ key: "price", value: { max: 100 } }]).card;
}

async function comparedFacts(frame) {
  return frame.locator(".comparison-table").evaluate(table => Object.fromEntries([...table.querySelectorAll("tbody tr")]
    .map(row => [row.firstElementChild.textContent, row.querySelector("td").textContent])));
}

try {
  const { page, frame } = await createScene();
  const first = () => frame.locator('.offer[data-id="1001"]');
  const second = () => frame.locator('.offer[data-id="1002"]');
  const nextFirst = () => frame.locator('.offer[data-id="1013"]');
  const calls = method => page.evaluate(method => window.researchFixture.calls.filter(call => call.method === method), method);
  const waitFeedback = text => page.waitForFunction(text => document.getElementById("widget").contentDocument.querySelector('.offer[data-id="1013"] .action-status').textContent === text, text);

  assert.equal(await first().locator(".review-badge").textContent(), "Bildprüfung dokumentiert · 2/6 Fotos");
  assert.equal(await second().locator(".review-badge").textContent(), "Bildbewertung offen");
  await first().locator(".review-badge").click();
  assert.match(await first().locator(".visual-review").textContent(), /Grüner Glasschirm · Bestätigt/);
  assert.match(await first().locator(".visual-review").textContent(), /Kein grüner Glasschirm · Widersprochen/);
  assert.match(await first().locator(".visual-review").textContent(), /\+2 weitere Befunde im Rechercheprotokoll/);
  await second().getByRole("button", { name: "Fotos ansehen", exact: true }).click();
  await second().locator(".thumbnail").nth(1).waitFor();
  assert.equal(await second().locator(".review-badge").textContent(), "Bildbewertung offen");
  assert.equal((await calls("ui/update-model-context")).length, 0);
  assert.equal((await calls("ui/message")).length, 0);
  pass("saved visual requirements are visible while app photos keep unreviewed items open without publishing chat context");

  await first().locator(".compare-toggle input").check();
  await second().locator(".compare-toggle input").check();
  await frame.locator("#compare-selection").click();
  assert.equal(await frame.locator(".comparison-offer").count(), 2);
  const comparisonRow = label => frame.locator(".comparison-table tbody tr").filter({ has: frame.locator("th", { hasText: label }) });
  assert.match(await comparisonRow("Stückpreis").textContent(), /60,00/);
  assert.match(await comparisonRow("Gesamtpreis mit Versand").textContent(), /125,00/);
  await page.evaluate(() => window.researchFixture.publishPartialReviews());
  await first().locator(".review-badge").filter({ hasText: "Bildprüfung erneuern" }).waitFor();
  const partialEvidence = await frame.locator("body").evaluate(() => {
    const normalize = text => text.trim().replace(/\s+/g, " ").toLowerCase();
    const rows = [...document.querySelectorAll(".comparison-table tbody tr")];
    const cells = label => rows.find(row => normalize(row.firstElementChild.textContent) === label)?.querySelectorAll("td");
    const card = document.querySelector('.offer[data-id="1001"] .visual-review').textContent;
    return {
      findingPreserved: card.includes("Grünes Glas an zwei Ansichten sichtbar."),
      greenRequirementPreserved: card.includes("Grüner Glasschirm · Bestätigt"),
      staleWarningVisible: card.includes("Neue Fotos oder Inseratangaben erfordern eine erneute Prüfung."),
      staleLabelVisible: normalize(card).includes("originale elektrik"),
      greenComparison: [...(cells("grüner glasschirm") ?? [])].map(cell => cell.textContent),
      staleComparison: [...(cells("originale elektrik") ?? [])].map(cell => cell.textContent),
      legacyFindingHidden: !document.querySelector('.offer[data-id="1002"] .visual-review').textContent.includes("Legacy finding"),
    };
  });
  assert.deepEqual(partialEvidence, {
    findingPreserved: true, greenRequirementPreserved: true, staleWarningVisible: true, staleLabelVisible: true,
    greenComparison: ["Bestätigt · Grünes durchscheinendes Glas.", "Offen"], staleComparison: ["Offen", "Offen"], legacyFindingHidden: true,
  });
  pass("partially stale reviews retain applicable findings and green-glass confirmation while stale and legacy criteria stay unknown");
  await frame.locator("#sort").selectOption("price_asc");
  assert.equal(await first().locator(".compare-toggle input").isChecked(), true);
  await frame.locator("#page-next").click();
  await nextFirst().waitFor();
  await nextFirst().locator(".compare-toggle input").check();
  assert.equal(await frame.locator(".comparison-offer").count(), 3);
  assert.deepEqual(await frame.locator(".comparison-id").allTextContents(), ["1001", "1002", "1013"]);
  assert.equal(await frame.locator(".offer").count(), 12);
  assert.equal((await calls("ui/update-model-context")).length, 0);
  assert.equal((await calls("ui/message")).length, 0);
  const requirementRows = await frame.locator(".comparison-table tbody th").allTextContents();
  assert.equal(requirementRows.filter(label => label.trim().replace(/\s+/g, " ").toLowerCase() === "grüner glasschirm").length, 1);
  assert.equal(requirementRows.filter(label => label === "Kein grüner Glasschirm").length, 1);
  const greenCells = await frame.locator(".comparison-table tbody tr").evaluateAll(rows => rows.find(row => row.firstElementChild.textContent.trim().replace(/\s+/g, " ").toLowerCase() === "grüner glasschirm").textContent);
  assert.match(greenCells, /Bestätigt.*Offen.*Widersprochen/);
  pass("comparison preserves exact selected IDs across pages and sorting with factual cost rows and distinct negated criteria");

  await nextFirst().locator(".cover img").evaluate(image => {
    window.coverBeforeFeedback = image;
    window.cardBeforeFeedback = image.closest(".offer");
  });
  for (const fault of ["identity", "research", "error"]) {
    await page.evaluate(fault => { window.researchFixture.feedbackFault = fault; }, fault);
    await nextFirst().locator(".shortlist-button").click();
    await waitFeedback("Die Entscheidung konnte nicht gespeichert werden.");
    assert.equal(await nextFirst().locator(".shortlist-button").getAttribute("aria-pressed"), "false");
  }
  await page.evaluate(() => { window.researchFixture.feedbackFault = null; window.researchFixture.held.set_listing_feedback = true; });
  await nextFirst().locator(".shortlist-button").click();
  await page.waitForFunction(() => window.researchFixture.pending.length > 0);
  assert.equal(await nextFirst().locator(".shortlist-button").getAttribute("aria-pressed"), "false");
  await page.evaluate(() => window.researchFixture.release("set_listing_feedback"));
  await waitFeedback("Entscheidung gespeichert.");
  assert.equal(await nextFirst().locator(".shortlist-button").getAttribute("aria-pressed"), "true");
  assert.equal(await nextFirst().locator(".cover img").evaluate(image => image === window.coverBeforeFeedback && image.closest(".offer") === window.cardBeforeFeedback), true);
  await page.evaluate(() => window.researchFixture.publish(12, { oldFeedback: true }));
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.querySelector('.offer[data-id="1013"] .shortlist-button').getAttribute("aria-pressed") === "true");
  await nextFirst().locator(".shortlist-button").click();
  await waitFeedback("Entscheidung gespeichert.");
  assert.equal(await nextFirst().locator(".shortlist-button").getAttribute("aria-pressed"), "false");
  assert.equal(await nextFirst().locator(".review-badge").textContent(), "Bildprüfung dokumentiert · 2/6 Fotos");
  pass("feedback waits for an identity-matched acknowledgement, survives stale pages and toggles to neutral without replacing photos or evidence");

  await page.evaluate(() => { window.researchFixture.contextFailure = true; });
  await frame.locator("#discuss-selection").click();
  await frame.locator("#selection-status").filter({ hasText: "Auswahl an den Chat übergeben." }).waitFor();
  let messages = await calls("ui/message");
  assert.equal(messages.length, 1);
  const handoff = JSON.parse(messages[0].params.content[0].text.split("\n").at(-1));
  assert.equal(handoff.researchId, "wr_" + "a".repeat(32));
  assert.equal(handoff.collectionId, "wc_" + "b".repeat(32));
  assert.deepEqual(handoff.ids, ["1001", "1002", "1013"]);
  assert(!JSON.stringify(handoff).includes("data:image"));
  assert(!JSON.stringify(handoff).includes("iVBOR"));
  assert.equal((await calls("ui/update-model-context")).length, 1);
  pass("only an explicit chat handoff sends exact research, collection and selected IDs even when optional context publication fails");

  await page.evaluate(() => { window.researchFixture.contextFailure = false; window.researchFixture.held["ui/update-model-context"] = true; });
  await frame.locator("#discuss-selection").click();
  await page.waitForFunction(() => window.researchFixture.pending.some(entry => entry.message.method === "ui/update-model-context"));
  await nextFirst().locator(".compare-toggle input").uncheck();
  await page.evaluate(() => window.researchFixture.release("ui/update-model-context"));
  await page.waitForFunction(() => !document.getElementById("widget").contentDocument.getElementById("discuss-selection").disabled);
  assert.equal((await calls("ui/message")).length, 1);
  await page.evaluate(() => { window.researchFixture.messageFailure = true; });
  await frame.locator("#discuss-selection").click();
  await frame.locator("#selection-status").filter({ hasText: "Die Auswahl konnte nicht an den Chat übergeben werden." }).waitFor();
  assert.equal(await frame.locator("#discuss-selection").isEnabled(), true);
  await page.evaluate(() => { window.researchFixture.messageFailure = false; });
  pass("a changed selection cancels a delayed handoff and a rejected chat message leaves the selection retryable");

  await frame.locator("#page-previous").click();
  await first().waitFor();
  await first().locator(".cover img").evaluate(image => { window.coverBeforeDetail = image; });
  await first().getByRole("button", { name: "Details lesen", exact: true }).click();
  await first().locator(".review-badge").filter({ hasText: "Bildprüfung erneuern" }).waitFor();
  assert.equal(await first().locator(".cover img").evaluate(image => image === window.coverBeforeDetail), true);
  await page.evaluate(() => window.researchFixture.publishOldReview());
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.querySelector('.offer[data-id="1001"] .review-badge').textContent === "Bildprüfung erneuern");
  assert.doesNotMatch(await first().locator(".visual-review").textContent(), /Grüner Glasschirm · Bestätigt/);
  assert.equal((await calls("ui/message")).length, 2);
  pass("detail-triggered evidence invalidation reaches cards and comparison and an older page cannot resurrect the old finding");

  await frame.locator("#fullscreen").click();
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.documentElement.dataset.mode === "fullscreen");
  assert.equal(await frame.locator("#fullscreen").textContent(), "Zurück zum Chat");
  await frame.locator("#fullscreen").click();
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.documentElement.dataset.mode === "inline");
  assert.deepEqual((await calls("ui/request-display-mode")).map(call => call.params.mode), ["fullscreen", "inline"]);
  for (const width of [320, 360, 900]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await frame.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.evaluate(() => { window.researchFixture.held.set_listing_feedback = true; });
  await first().locator(".reject-button").click();
  await page.waitForFunction(() => window.researchFixture.pending.some(entry => entry.message.params.name === "set_listing_feedback"));
  await page.evaluate(() => window.researchFixture.publish(0, { otherResearch: true }));
  await page.waitForFunction(() => document.getElementById("widget").contentDocument.getElementById("selection-bar").hidden);
  await page.evaluate(() => window.researchFixture.release("set_listing_feedback"));
  await page.waitForTimeout(50);
  assert.equal(await frame.locator(".compare-toggle input:checked").count(), 0);
  assert.equal(await frame.locator("#comparison").isVisible(), false);
  assert.equal(await first().locator(".reject-button").getAttribute("aria-pressed"), "false");
  pass("fullscreen returns to inline mode, comparison fits narrow screens and another research rejects late feedback and clears local selection");

  for (const variant of ["newer", "sparse", "older", "foreign"]) {
    const scene = await createScene();
    const offer = scene.frame.locator('.offer[data-id="1001"]');
    const update = detailCard(variant === "sparse" ? { quantity: undefined, shipping: undefined, shippingCost: undefined }
      : variant === "older" ? { observedAt: "2026-11-07T09:55:00Z" } : variant === "foreign" ? { id: "9999" } : {});
    await scene.page.evaluate(({ update, variant }) => {
      window.researchFixture.detailCard = update;
      if (variant === "older") window.researchFixture.detailReviewObservedAt = "2026-11-07T10:30:00Z";
    }, { update, variant });
    await offer.locator(".compare-toggle input").check();
    await scene.frame.locator('.offer[data-id="1002"] .compare-toggle input').check();
    await scene.frame.locator("#compare-selection").click();
    await offer.locator(".cover img").evaluate(image => { window.coverBeforeDetail = image; });
    const original = await comparedFacts(scene.frame);
    await offer.getByRole("button", { name: "Details lesen", exact: true }).click();
    await offer.locator(".detail-content").filter({ hasText: variant === "foreign" ? "sicher zugeordnet" : "Material" }).waitFor();
    const actual = await comparedFacts(scene.frame);
    if (["newer", "sparse"].includes(variant)) {
      assert.match(actual.Angebotspreis, /75,00/);
      assert.equal(actual.Verfügbarkeit, "Verkauft");
      assert.notEqual(actual.Beobachtet, original.Beobachtet);
      assert.match(await offer.locator(".price").textContent(), /75,00/);
      assert.equal(await offer.locator(".offer-title").textContent(), "Aktualisierte Lampe");
      assert.match(await offer.locator(".requirements").textContent(), /Bestätigt.*75/);
      assert.doesNotMatch(await offer.locator(".facts").textContent(), /Wien/);
      assert.doesNotMatch((await offer.locator(".costs").allTextContents()).join(" "), /60,00|125,00/);
      if (variant === "newer") {
        assert.equal(actual.Stückzahl, "1");
        assert.match(actual.Stückpreis, /75,00/);
        assert.match(actual.Versandkosten, /10,00/);
        assert.match(actual["Gesamtpreis mit Versand"], /85,00/);
      } else for (const label of ["Stückzahl", "Stückpreis", "Versand", "Versandkosten", "Gesamtpreis mit Versand"])
        assert.equal(actual[label], "Keine Angabe", label);
      assert.equal(await offer.locator(".cover img").evaluate(image => image === window.coverBeforeDetail), true);
      await scene.page.evaluate(() => window.researchFixture.publish());
      await scene.page.waitForFunction(() => !document.getElementById("widget").contentWindow.coverBeforeDetail.isConnected);
      await offer.locator(".offer-title").filter({ hasText: "Aktualisierte Lampe" }).waitFor();
      assert.match((await comparedFacts(scene.frame)).Angebotspreis, /75,00/);
    } else {
      for (const label of ["Angebotspreis", "Stückzahl", "Stückpreis", "Versandkosten", "Gesamtpreis mit Versand", "Verfügbarkeit", "Beobachtet"])
        assert.equal(actual[label], original[label], label);
      assert.match(await offer.locator(".price").textContent(), /120,00/);
    }
    if (!["newer", "sparse"].includes(variant))
      assert.equal(await offer.locator(".cover img").evaluate(image => image === window.coverBeforeDetail), true);
    assert.equal(await offer.locator(".compare-toggle input").isChecked(), true);
    await scene.page.close();
    pass("complete detail observation handles " + variant + " facts, derived costs, original source time and comparison selection");
  }

  const coverScene = await createScene();
  const coverOffer = coverScene.frame.locator('.offer[data-id="1001"]');
  const pendingCover = detailCard({ observedAt: "2026-11-07T10:00:00Z", price: 120 });
  const changedCover = detailCard({ gallery: [{ index: 0, url: "https://cache.willhaben.at/mmo/fixtures/1001-new.png" }] });
  await coverScene.page.evaluate(({ pendingCover, changedCover }) => {
    const state = window.researchFixture;
    state.held.covers = true;
    state.pageCard = pendingCover;
    state.detailCard = changedCover;
    state.publish();
  }, { pendingCover, changedCover });
  await coverScene.page.waitForFunction(() => window.researchFixture.pending.some(item => item.message.params.arguments.action === "covers"));
  await coverOffer.getByRole("button", { name: "Fotos ansehen", exact: true }).click();
  await coverOffer.locator(".thumbnail").nth(1).waitFor();
  await coverOffer.getByRole("button", { name: "Details lesen", exact: true }).click();
  await coverOffer.locator(".detail-content").filter({ hasText: "Material" }).waitFor();
  assert.equal(await coverOffer.locator(".thumbnail").count(), 0, "changed photo identity clears the previous gallery");
  assert.equal(await coverOffer.locator(".gallery-main img").count(), 0);
  await coverScene.page.evaluate(() => {
    const state = window.researchFixture;
    const index = state.pending.findIndex(item => item.message.params.arguments.action === "covers");
    const old = state.pending.splice(index, 1)[0];
    state.send({ id: old.message.id, ...old.response });
  });
  await coverScene.page.waitForFunction(() => window.researchFixture.pending.some(item => item.message.params.arguments.action === "covers"));
  assert.equal(await coverOffer.locator(".cover img").count(), 0, "an old URL at the same index must not hydrate the replacement cover");
  await coverScene.page.evaluate(() => window.researchFixture.release("covers"));
  await coverOffer.locator(".cover img").waitFor();
  pass("a changed original photo clears the old gallery, rejects in-flight cover bytes and queues the replacement cover");
  await coverOffer.locator(".cover img").evaluate(image => { window.coverBeforeNewPage = image; });
  await coverScene.page.evaluate(card => {
    window.researchFixture.pageCard = { ...card, observedAt: "2026-11-07T10:10:00Z", image: { ...card.image, status: "ready" } };
    window.researchFixture.publish();
  }, changedCover);
  await coverScene.page.waitForFunction(() => !document.getElementById("widget").contentWindow.coverBeforeNewPage.isConnected);
  await coverOffer.locator(".cover img").evaluate(image => { window.coverBeforeOldPage = image; });
  await coverScene.page.evaluate(() => {
    window.researchFixture.pageCard = null;
    window.researchFixture.held.covers = true;
    window.researchFixture.publish();
  });
  await coverScene.page.waitForFunction(() => !document.getElementById("widget").contentWindow.coverBeforeOldPage.isConnected);
  assert.equal(await coverOffer.locator(".photo-placeholder").textContent(), "Fotoabruf noch offen");
  await coverScene.page.waitForFunction(() => window.researchFixture.pending.some(item => item.message.params.arguments.action === "covers"));
  assert.equal(await coverOffer.locator(".cover img").count(), 0);
  await coverScene.page.evaluate(() => window.researchFixture.release("covers"));
  await coverOffer.locator(".cover img").waitFor();
  await coverScene.page.close();
  pass("a retained newer ready cover is rehydrated when an old page supplies bytes for another original photo");

  const unsupported = await createScene({});
  await unsupported.frame.locator('.offer[data-id="1001"] .compare-toggle input').check();
  assert.equal(await unsupported.frame.locator("#discuss-selection").isVisible(), false);
  assert.equal(await unsupported.page.evaluate(() => window.researchFixture.calls.filter(call => ["ui/message", "ui/update-model-context"].includes(call.method)).length), 0);
  await unsupported.page.close();
  await page.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  pass("hosts without text-message capability retain comparison and feedback with no hidden chat calls or external requests");
} catch (error) {
  console.error(JSON.stringify({ browserErrors: errors, externalRequests: requests }));
  throw error;
} finally {
  await browser.close();
}
