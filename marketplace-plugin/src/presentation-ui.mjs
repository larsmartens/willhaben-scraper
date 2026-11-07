import { PRESENTATION_BRIDGE_SOURCE } from "./generated/presentation-bridge.mjs";
import { ICON_BASE64 } from "./branding.mjs";

export const PRESENTATION_URI = "ui://marktplatz/listings-v2.html";

export const PRESENTATION_RESOURCE_META = {
  ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
  "openai/widgetDescription": "willhaben result overview with 12 offers per page, photos, facts and original links, plus galleries, research coverage and further pages on demand. For a request to show offers, finish with one plain-text sentence pointing to the app cards. For advice or a study, add the requested decision analysis.",
  "openai/widgetPrefersBorder": true,
  "openai/widgetCSP": { connect_domains: [], resource_domains: [], redirect_domains: ["https://www.willhaben.at", "https://willhaben.at"] },
  "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
};

function mountPresentation() {
  const words = {
    de: {
      queryMore: "Weitere Suchanfragen", detailCount: "Detailseiten abgerufen", coverage: "Rechercheumfang", queries: "Suchanfragen", fetched: "geladene Inserate", descriptions: "Beschreibungen an ChatGPT", modelPhotos: "Fotos an ChatGPT", reviews: "Fotoprüfungen dokumentiert", uiPhotos: "Fotos für die Ansicht", found: "gefunden", loaded: "geladen", pages: "Seiten", details: "Details lesen", closeDetails: "Details schließen", detailLoading: "Details werden geladen", pageNext: "Weitere Angebote", pagePrevious: "Vorherige Seite", pageLoading: "Angebote werden geladen", audit: "Einzelnachweise", auditMore: "Weitere Nachweise", coverRetry: "Foto laden", emptyAudit: "Bisher wurden Suchtreffer abgerufen.", fields: "Übergebene Felder", chars: "Zeichen", modelIndices: "Fotoindizes an ChatGPT", agentReview: "Dokumentierter Modellbefund",
      title: "Angebotsübersicht", waiting: "Angebote werden geladen", source: { live: "willhaben", provided: "Bereitgestellte Angebote", demo: "Synthetische Demoangebote" },
      sort: "Sortieren", recommendation: "Empfehlung", priceUp: "Preis aufsteigend", priceDown: "Preis absteigend", fullscreen: "Größere Ansicht",
      previous: "Vorheriges Angebot", next: "Nächstes Angebot", of: "von", open: "Inserat öffnen", photos: "Fotos ansehen", closePhotos: "Fotos schließen",
      photo: "Foto", more: "Weitere Fotos", retry: "Erneut versuchen", loading: "Fotos werden geladen", gallery: "Inseratgalerie", photoCount: "Fotos", knownPhotos: "bekannte Fotos",
      noPhoto: "Kein Inseratfoto vorhanden", photoUnavailable: "Foto derzeit nicht verfügbar", photoPending: "Fotoabruf noch offen", photoDisabled: "Foto als Link verfügbar",
      missingImageData: "Bilddaten fehlen", availablePhotos: "Verfügbare Fotos", galleryUnavailable: "Weitere Fotos sind über das Originalinserat verfügbar.", noGalleryPhotos: "Keine weiteren Fotos verfügbar.",
      unknownPrice: "Preis unbekannt", onRequest: "Preis auf Anfrage", free: "Gratis", negotiable: "VB", unknownLocation: "Ort offen",
      shipping: "Versand", shippingOpen: "Versandkosten offen", pickup: "Abholung", inclShipping: "inkl. Versand", pieces: "Stück", perPiece: "pro Stück",
      assessment: "Einordnung", questions: "Offene Punkte", requirements: "Anforderungen", observed: "Beobachtet", unknownObservation: "Beobachtungszeit unbekannt",
      confirmed: "Bestätigt", contradicted: "Widersprochen", unknown: "Offen", expected: "Gesucht", actual: "Angabe", private: "Privat", dealer: "Händler",
      criterionLabels: { diameterMm: "Durchmesser", diameter_mm: "Durchmesser", openingMm: "Öffnungsdurchmesser", opening_mm: "Öffnungsdurchmesser", storageGb: "Speicher", shape: "Form", finish: "Oberfläche" },
      filterLabels: { priceMin: "Preis ab (€)", priceMax: "Preis bis (€)", condition: "Zustand", categoryId: "Kategorie", areaId: "Region", sellerType: "Anbieter", paylivery: "PayLivery", shipping: "Übergabe", recent48h: "Letzte 48 Stunden", sort: "Sortierung", attributeIds: "Merkmale", requireTerms: "Enthaltene Begriffe", excludeTerms: "Ausgeschlossene Begriffe", titleOnly: "Textprüfung im Titel" },
      fieldLabels: { title: "Titel", url: "Original-Link", price: "Preis", priceType: "Preisart", location: "Ort", condition: "Zustand", status: "Status", model: "Modell", category: "Kategorie", categoryId: "Kategorie", areaId: "Region", sellerType: "Anbietertyp", seller: "Anbieterinformationen", paylivery: "PayLivery", shipping: "Übergabe", shippingCost: "Versandkosten", imageCount: "Fotoanzahl", hasPhotos: "Fotos vorhanden", thumbnailUrl: "Vorschaubild-Link", galleryComplete: "Galerieumfang", gallery: "Galerie-Links", publishedAt: "Veröffentlichung", description: "Beschreibung", attributes: "Merkmale", quantity: "Stückzahl" },
      filterValues: { newest: "Neueste zuerst", price_asc: "Preis aufsteigend", price_desc: "Preis absteigend", relevance: "Relevanz", shipping: "Versand", pickup: "Abholung", private: "Privat", dealer: "Händler" },
      memberSince: "Mitglied seit", activeListings: "Aktive Inserate", queryDetails: "Details an ChatGPT", queryPhotos: "Fotos an ChatGPT", queryFindings: "Fotos mit dokumentiertem Befund",
      traitLabels: { round: "rund", spherical: "kugelförmig", cylinder: "zylindrisch", rectangular: "rechteckig", matte: "matt", glossy: "glänzend", clear: "klar" },
      conditions: { new: "Neu", as_new: "Neuwertig", refurbished: "Generalüberholt", used: "Gebraucht", defective: "Defekt", display_item: "Ausstellungsstück" },
      statuses: { reserved: "Reserviert", sold: "Verkauft", inactive: "Inaktiv", expired: "Abgelaufen", deleted: "Entfernt" },
      unavailable: "Angebote brauchen eine neue Detailprüfung", empty: "Diese Auswahl enthält derzeit keine darstellbaren Angebote.",
      connection: "Die Verbindung ist noch nicht bereit. Bitte erneut versuchen.", timeout: "Der Aufruf hat zu lange gedauert. Bitte erneut versuchen.",
      loadError: "Die Fotos konnten nicht vollständig geladen werden.", linkError: "Das Inserat konnte nicht geöffnet werden.", linkUnsupported: "Dieser Chat unterstützt das Öffnen des Inserats hier nicht.",
      formatError: "Die Antwort konnte diesem Angebot nicht sicher zugeordnet werden.", waitUntil: "Erneut abrufbar ab", incompleteGallery: "Die vollständige Galerie ist noch offen.",
      selectionError: "Die Auswahl konnte nicht aktualisiert werden.", booleanTrue: "Ja", booleanFalse: "Nein",
    },
    en: {
      queryMore: "More queries", detailCount: "detail pages retrieved", coverage: "Research coverage", queries: "queries", fetched: "retrieved listings", descriptions: "descriptions sent to ChatGPT", modelPhotos: "photos sent to ChatGPT", reviews: "documented photo reviews", uiPhotos: "photos for this view", found: "found", loaded: "retrieved", pages: "pages", details: "Read details", closeDetails: "Close details", detailLoading: "Loading details", pageNext: "More offers", pagePrevious: "Previous page", pageLoading: "Loading offers", audit: "Individual records", auditMore: "More records", coverRetry: "Load photo", emptyAudit: "Search summaries have been retrieved so far.", fields: "Delivered fields", chars: "characters", modelIndices: "Photo indices sent to ChatGPT", agentReview: "Agent-reported finding",
      title: "Offer overview", waiting: "Loading listings", source: { live: "willhaben", provided: "Provided listings", demo: "Synthetic demo listings" },
      sort: "Sort", recommendation: "Recommended order", priceUp: "Price low to high", priceDown: "Price high to low", fullscreen: "Larger view",
      previous: "Previous listing", next: "Next listing", of: "of", open: "Open listing", photos: "View photos", closePhotos: "Close photos",
      photo: "Photo", more: "More photos", retry: "Try again", loading: "Loading photos", gallery: "Listing gallery", photoCount: "photos", knownPhotos: "known photos",
      noPhoto: "No listing photo available", photoUnavailable: "Photo currently unavailable", photoPending: "Photo retrieval pending", photoDisabled: "Photo available as a link",
      missingImageData: "Image data unavailable", availablePhotos: "Available photos", galleryUnavailable: "More photos are available in the original listing.", noGalleryPhotos: "No more photos available.",
      unknownPrice: "Price unknown", onRequest: "Price on request", free: "Free", negotiable: "Negotiable", unknownLocation: "Location unknown",
      shipping: "Shipping", shippingOpen: "Shipping cost unknown", pickup: "Collection", inclShipping: "including shipping", pieces: "items", perPiece: "per item",
      assessment: "Assessment", questions: "Open questions", requirements: "Requirements", observed: "Observed", unknownObservation: "Observation time unknown",
      confirmed: "Confirmed", contradicted: "Contradicted", unknown: "Unknown", expected: "Wanted", actual: "Listed", private: "Private seller", dealer: "Dealer",
      criterionLabels: { diameterMm: "Diameter", diameter_mm: "Diameter", openingMm: "Opening diameter", opening_mm: "Opening diameter", storageGb: "Storage", shape: "Shape", finish: "Finish" },
      filterLabels: { priceMin: "Price from (€)", priceMax: "Price to (€)", condition: "Condition", categoryId: "Category", areaId: "Area", sellerType: "Seller", paylivery: "PayLivery", shipping: "Handover", recent48h: "Last 48 hours", sort: "Order", attributeIds: "Attributes", requireTerms: "Required terms", excludeTerms: "Excluded terms", titleOnly: "Text match in title" },
      fieldLabels: { title: "Title", url: "Original link", price: "Price", priceType: "Price type", location: "Location", condition: "Condition", status: "Status", model: "Model", category: "Category", categoryId: "Category", areaId: "Area", sellerType: "Seller type", seller: "Seller information", paylivery: "PayLivery", shipping: "Handover", shippingCost: "Shipping cost", imageCount: "Photo count", hasPhotos: "Has photos", thumbnailUrl: "Cover link", galleryComplete: "Gallery coverage", gallery: "Gallery links", publishedAt: "Publication", description: "Description", attributes: "Attributes", quantity: "Quantity" },
      filterValues: { newest: "Newest first", price_asc: "Price low to high", price_desc: "Price high to low", relevance: "Relevance", shipping: "Shipping", pickup: "Collection", private: "Private", dealer: "Dealer" },
      memberSince: "Member since", activeListings: "Active listings", queryDetails: "details sent to ChatGPT", queryPhotos: "photos sent to ChatGPT", queryFindings: "photos with recorded findings",
      traitLabels: { round: "round", spherical: "spherical", cylinder: "cylindrical", rectangular: "rectangular", matte: "matte", glossy: "glossy", clear: "clear" },
      conditions: { new: "New", as_new: "Like new", refurbished: "Refurbished", used: "Used", defective: "Defective", display_item: "Display item" },
      statuses: { reserved: "Reserved", sold: "Sold", inactive: "Inactive", expired: "Expired", deleted: "Removed" },
      unavailable: "Listings need another detail check", empty: "No listings in this selection can currently be displayed.",
      connection: "The connection is not ready. Please try again.", timeout: "The request took too long. Please try again.",
      loadError: "The photos could not be loaded completely.", linkError: "The listing could not be opened.", linkUnsupported: "This chat cannot open the listing from this view.",
      formatError: "The response could not be matched safely to this listing.", waitUntil: "Available again after", incompleteGallery: "The full gallery is still unverified.",
      selectionError: "The selection could not be updated.", booleanTrue: "Yes", booleanFalse: "No",
    },
  };
  const elements = Object.fromEntries(["title", "summary", "source", "notice", "toolbar", "sort-label", "sort", "fullscreen", "cards", "pager", "previous", "position", "next", "coverage", "coverage-label", "coverage-counts", "coverage-queries", "queries-more", "audit", "audit-records", "audit-more", "page-nav", "page-previous", "page-label", "page-next"]
    .map(id => [id, document.getElementById(id)]));
  const views = new Map();
  let generation = 0;
  let connection = "connecting";
  let hostCapabilities = {};
  let hostContext = {};
  let payload = null;
  let lastEnvelope = null;
  let receivedStandardResult = false;
  let locale = "de-AT";
  let language = "de";
  let resizeFrame = null;
  let lastHeight = 0;
  let disposed = false;
  let coverBusy = false;
  let coverTimer;
  let coverObserver;
  let pageBusy = false;
  let auditCursor;
  let queryCursor;
  let queryVersion;
  const coverQueue = new Set();
  const app = new window.WillhabenMcpApps.App({ name: "willhaben", version: "1.4.1" }, {}, { autoResize: false });

  const t = key => words[language][key];
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const valueText = value => typeof value === "boolean" ? t(value ? "booleanTrue" : "booleanFalse") : String(value ?? "");
  const money = value => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);
  const canOpenLinks = () => (connection === "ready" && object(hostCapabilities.openLinks)) || typeof window.openai?.openExternal === "function";

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  async function callTool(name, args) {
    if (connection === "ready") return app.callServerTool({ name, arguments: args }, { timeout: 45000 });
    if (typeof window.openai?.callTool === "function") return window.openai.callTool(name, args);
    throw new Error(t("connection"));
  }

  function shareSelection(view) {
    const state = { researchId: payload?.researchId, collectionId: payload?.collectionId,
      offset: payload?.offset ?? 0, visibleIds: [...views.keys()],
      ...(view ? { selectedId: view.card.id, photoIndex: view.gallery.selected } : {}) };
    if (connection === "ready" && hostCapabilities.updateModelContext) {
      app.updateModelContext({ content: [{ type: "text", text: JSON.stringify(state) }] }).catch(() => {});
    }
  }

  function imageData(image) {
    if (!image || !["image/jpeg", "image/png", "image/webp"].includes(image.mimeType) ||
        typeof image.data !== "string" || image.data.length > 6 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return null;
    return "data:" + image.mimeType + ";base64," + image.data;
  }

  function listingUrl(value) {
    try {
      const url = new URL(value);
      if (!["https://www.willhaben.at", "https://willhaben.at"].includes(url.origin) || url.username || url.password || url.port || url.hash) return null;
      const listing = /^\/iad\/kaufen-und-verkaufen\/d\/[^/]+-\d+\/?$/.test(url.pathname);
      const objectId = url.pathname === "/iad/object" && /^\d{1,20}$/.test(url.searchParams.get("adId") ?? "");
      return listing || objectId ? url.href : null;
    } catch { return null; }
  }

  function time(value) {
    if (!Number.isFinite(Date.parse(value))) return null;
    return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function reportSize() {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      const height = Math.ceil(document.body.getBoundingClientRect().height);
      if (height === lastHeight) return;
      lastHeight = height;
      if (connection === "ready") app.sendSizeChanged({ height }).catch(() => {});
      else window.openai?.notifyIntrinsicHeight?.(height);
    });
  }

  function notice(message) {
    elements.notice.textContent = message;
    elements.notice.hidden = !message;
  }

  function priceLabel(card) {
    if (card.priceType === "on_request") return t("onRequest");
    if (!Number.isFinite(card.price)) return t("unknownPrice");
    if (card.priceType === "free" && card.price === 0) return t("free");
    return money(card.price) + (card.priceType === "negotiable" ? " · " + t("negotiable") : "");
  }

  function updateLabels() {
    document.documentElement.lang = language;
    elements["sort-label"].textContent = t("sort");
    elements.sort.options[0].textContent = t("recommendation");
    elements.sort.options[1].textContent = t("priceUp");
    elements.sort.options[2].textContent = t("priceDown");
    elements.fullscreen.textContent = t("fullscreen");
    elements.previous.setAttribute("aria-label", t("previous"));
    elements.next.setAttribute("aria-label", t("next"));
    elements.cards.setAttribute("aria-label", payload?.title || t("title"));
    if (!payload) elements.title.textContent = t("waiting");
  }

  function applyHostContext(context) {
    if (!object(context)) return;
    const previousLanguage = language;
    const previousLocale = locale;
    const previousMode = hostContext.displayMode;
    hostContext = { ...hostContext, ...context };
    if (["light", "dark"].includes(hostContext.theme)) document.documentElement.dataset.theme = hostContext.theme;
    if (["inline", "fullscreen", "pip"].includes(hostContext.displayMode)) document.documentElement.dataset.mode = hostContext.displayMode;
    try {
      const requested = typeof hostContext.locale === "string" ? hostContext.locale : locale;
      locale = Intl.getCanonicalLocales(requested)[0] || "de-AT";
    } catch { locale = "de-AT"; }
    language = locale.toLowerCase().startsWith("de") ? "de" : "en";
    elements.fullscreen.hidden = !hostContext.availableDisplayModes?.includes("fullscreen") || hostContext.displayMode === "fullscreen";
    updateLabels();
    if (lastEnvelope && (language !== previousLanguage || locale !== previousLocale)) render(lastEnvelope);
    if (hostContext.displayMode !== previousMode) observeCovers();
    updatePosition();
    reportSize();
  }

  function updatePosition() {
    const cards = [...elements.cards.children];
    elements.pager.hidden = cards.length < 2 || hostContext.displayMode === "fullscreen" || window.innerWidth >= 640;
    if (!cards.length) return;
    const left = elements.cards.getBoundingClientRect().left;
    let current = 0;
    let distance = Infinity;
    cards.forEach((card, index) => {
      const candidate = Math.abs(card.getBoundingClientRect().left - left);
      if (candidate < distance) { current = index; distance = candidate; }
    });
    elements.position.textContent = (current + 1) + " " + t("of") + " " + cards.length;
    elements.previous.disabled = current === 0;
    elements.next.disabled = current === cards.length - 1;
    elements.pager.dataset.position = String(current);
  }

  function sortCards() {
    const direction = elements.sort.value === "price_desc" ? -1 : 1;
    const ordered = [...views.values()].sort((a, b) => {
      if (elements.sort.value === "rank") return a.card.rank - b.card.rank;
      const aKnown = Number.isFinite(a.card.price) && a.card.priceType !== "on_request";
      const bKnown = Number.isFinite(b.card.price) && b.card.priceType !== "on_request";
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      return aKnown && a.card.price !== b.card.price ? direction * (a.card.price - b.card.price) : a.card.rank - b.card.rank;
    });
    elements.cards.append(...ordered.map(view => view.element));
    elements.cards.scrollLeft = 0;
    updatePosition();
    reportSize();
  }

  function makePhoto(dataUrl, title, index, onFailure) {
    const image = node("img", "product-photo");
    image.alt = title + " · " + t("photo") + " " + (index + 1);
    image.decoding = "async";
    image.src = dataUrl;
    image.addEventListener("error", onFailure, { once: true });
    return image;
  }

  function imagePlaceholder(card) {
    const labels = { missing: "noPhoto", not_enabled: "photoDisabled", pending: "photoPending", failed: "photoUnavailable" };
    let label = t(labels[card.image?.status] || "missingImageData");
    const error = card.image?.error;
    if (error?.code === "photo_index_unavailable" && Array.isArray(error.availableIndices)) {
      const indices = error.availableIndices.filter(index => Number.isSafeInteger(index) && index >= 0);
      if (indices.length) label += ". " + t("availablePhotos") + " " + indices.slice(0, 8).map(index => index + 1).join(", ") + (indices.length > 8 ? " …" : "");
    }
    if (Date.parse(error?.retryAt) > Date.now()) label += ". " + t("waitUntil") + " " + time(error.retryAt) + ".";
    return node("p", "photo-placeholder", label);
  }

  function addFact(container, value) {
    if (value) container.append(node("span", "fact", value));
  }

  function criterionValue(key, value) {
    const unit = ["diameterMm", "diameter_mm", "openingMm", "opening_mm"].includes(key) ? " mm" : key === "storageGb" ? " GB" : "";
    const number = value => new Intl.NumberFormat(locale).format(value);
    if (Number.isFinite(value)) return number(value) + unit;
    if (object(value)) {
      if (Number.isFinite(value.min) && Number.isFinite(value.max)) return number(value.min) + "–" + number(value.max) + unit;
      if (Number.isFinite(value.min)) return "≥ " + number(value.min) + unit;
      if (Number.isFinite(value.max)) return "≤ " + number(value.max) + unit;
    }
    return ["shape", "finish"].includes(key) && typeof value === "string" ? t("traitLabels")[value] || value : valueText(value);
  }

  function assessment(card, container) {
    if (card.assessment?.reason) {
      const block = node("section", "assessment");
      block.append(node("h4", "section-label", t("assessment")), node("p", "", card.assessment.reason));
      container.append(block);
    }
    if (Array.isArray(card.assessment?.cautions) && card.assessment.cautions.length) {
      const block = node("section", "questions");
      const list = node("ul", "question-list");
      card.assessment.cautions.slice(0, 3).forEach(item => list.append(node("li", "", String(item))));
      block.append(node("h4", "section-label", t("questions")), list);
      container.append(block);
    }
    const evaluation = card.assessment?.evaluation;
    if (evaluation && ["confirmed", "contradicted", "unknown"].includes(evaluation.status)) {
      const details = node("details", "requirements");
      const summary = node("summary", "", t("requirements") + " · " + t(evaluation.status));
      const list = node("ul", "criterion-list");
      for (const criterion of (evaluation.criteria ?? []).slice(0, 12)) {
        if (!["confirmed", "contradicted", "unknown"].includes(criterion.status)) continue;
        const name = t("criterionLabels")[criterion.key] || String(criterion.key);
        const actual = criterion.actual == null ? valueText(criterion.sourceValue) : criterionValue(criterion.key, criterion.actual);
        const expected = criterion.expected == null ? "" : " · " + t("expected") + " " + criterionValue(criterion.key, criterion.expected);
        const label = name + " · " + t(criterion.status) + expected + (actual ? " · " + t("actual") + " " + actual : "");
        list.append(node("li", "", label));
      }
      details.append(summary, list);
      details.addEventListener("toggle", reportSize);
      container.append(details);
    }
  }

  async function openListing(view) {
    const url = listingUrl(view.card.url);
    if (!url) return;
    view.openButton.disabled = true;
    view.actionStatus.textContent = "";
    try {
      if (connection === "ready" && object(hostCapabilities.openLinks)) {
        const response = await app.openLink({ url });
        if (response.isError) throw new Error(t("linkUnsupported"));
      }
      else if (typeof window.openai?.openExternal === "function") await window.openai.openExternal({ href: url });
      else throw new Error(t("connection"));
    } catch (error) {
      view.actionStatus.textContent = t("linkError") + " " + (error.message || "");
    } finally {
      view.openButton.disabled = !canOpenLinks();
      reportSize();
    }
  }

  function galleryResult(response, id) {
    if (!object(response) || response.isError) {
      const error = response?.structuredContent?.error;
      throw Object.assign(new Error(error?.message || t("loadError")), { retryAt: error?.retryAt });
    }
    const data = response.structuredContent;
    if (!object(data) || data.id !== id || !Array.isArray(data.results) || !Array.isArray(response.content)) throw new Error(t("formatError"));
    if (!Number.isSafeInteger(data.galleryTotal) || data.galleryTotal < 0 || data.results.length > 8 ||
        new Set(data.results.map(result => result.index)).size !== data.results.length ||
        new Set(data.results.map(result => result.imageContentIndex)).size !== data.results.length) throw new Error(t("formatError"));
    const images = [];
    for (const result of data.results) {
      if (result.id !== id || !Number.isSafeInteger(result.index) || result.index < 0 ||
          result.index >= data.galleryTotal || !Number.isSafeInteger(result.imageContentIndex) || result.imageContentIndex < 1) throw new Error(t("formatError"));
      const hydrated = response._meta?.listingImages?.find(image => image.id === id && image.index === result.index);
      const block = hydrated ?? response.content[result.imageContentIndex];
      if ((!hydrated && block?.type !== "image") || block.mimeType !== result.mimeType) throw new Error(t("formatError"));
      const url = imageData(block);
      if (!url) throw new Error(t("formatError"));
      images.push({ index: result.index, dataUrl: url });
    }
    if (data.nextIndex !== null && (!Number.isSafeInteger(data.nextIndex) || data.nextIndex < 0)) throw new Error(t("formatError"));
    if (data.remainingIndices !== undefined && (!Array.isArray(data.remainingIndices) || data.remainingIndices.length > 8 ||
        new Set(data.remainingIndices).size !== data.remainingIndices.length ||
        data.remainingIndices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= data.galleryTotal))) throw new Error(t("formatError"));
    return { data, images };
  }

  function drawGallery(view) {
    const gallery = view.gallery;
    view.gallerySection.hidden = !gallery.open;
    view.photoButton.textContent = t(gallery.open ? "closePhotos" : "photos");
    view.photoButton.setAttribute("aria-expanded", String(gallery.open));
    if (!gallery.open) return;
    view.galleryMain.replaceChildren();
    view.thumbnails.replaceChildren();
    const entries = [...gallery.images.entries()].sort((a, b) => a[0] - b[0]);
    if (!gallery.images.has(gallery.selected)) gallery.selected = entries[0]?.[0] ?? null;
    if (gallery.selected !== null) {
      const dataUrl = gallery.images.get(gallery.selected);
      view.galleryMain.append(makePhoto(dataUrl, view.card.title, gallery.selected, () => {
        view.galleryMain.replaceChildren(node("p", "photo-placeholder", t("photoUnavailable")));
      }));
      view.galleryCaption.textContent = t("photo") + " " + (gallery.selected + 1) + (Number.isSafeInteger(gallery.total) ? " " + t("of") + " " + gallery.total + (gallery.complete === false ? " " + t("knownPhotos") : "") : "");
    } else {
      view.galleryMain.append(node("p", "photo-placeholder", t(gallery.loading ? "loading" : "noGalleryPhotos")));
      view.galleryCaption.textContent = "";
    }
    for (const [index, dataUrl] of entries) {
      const button = node("button", "thumbnail");
      button.type = "button";
      button.setAttribute("aria-label", t("photo") + " " + (index + 1));
      button.setAttribute("aria-pressed", String(index === gallery.selected));
      button.append(makePhoto(dataUrl, view.card.title, index, () => button.replaceChildren(node("span", "", String(index + 1)))));
      button.addEventListener("click", () => { gallery.selected = index; drawGallery(view); shareSelection(view); });
      view.thumbnails.append(button);
    }
    const wait = gallery.retryAt && Date.parse(gallery.retryAt) > Date.now();
    const waitLabel = wait ? " " + t("waitUntil") + " " + time(gallery.retryAt) + "." : "";
    view.galleryStatus.textContent = gallery.loading ? t("loading") : (gallery.error || "") + waitLabel;
    const hasMore = gallery.remainingIndices.length > 0 || gallery.nextIndex !== null;
    if (!gallery.loading && !gallery.error && !hasMore && gallery.complete === false)
      view.galleryStatus.textContent = t("incompleteGallery");
    view.moreButton.hidden = !gallery.loading && !hasMore && !gallery.error;
    view.moreButton.disabled = gallery.loading || Boolean(wait);
    view.moreButton.textContent = t(gallery.error ? "retry" : "more");
    clearTimeout(gallery.retryTimer);
    if (wait) gallery.retryTimer = setTimeout(() => drawGallery(view), Math.min(Date.parse(gallery.retryAt) - Date.now() + 50, 2147483647));
    reportSize();
  }

  async function loadGallery(view) {
    const gallery = view.gallery;
    if (gallery.loading || (gallery.retryAt && Date.parse(gallery.retryAt) > Date.now()) || !gallery.open) return;
    const callGeneration = generation;
    const start = gallery.nextIndex ?? 0;
    gallery.loading = true;
    gallery.error = "";
    drawGallery(view);
    try {
      const selection = gallery.remainingIndices.length ? { indices: gallery.remainingIndices } : { start, count: 4 };
      const args = { id: view.card.id, ...selection, size: "full", mode: "images" };
      const response = payload.collectionId
        ? await callTool("browse_collection", { researchId: payload.researchId, collectionId: payload.collectionId,
          action: "photos", id: view.card.id, ...selection })
        : await callTool("inspect_listing_images", { ...args, ...(payload.researchId ? { researchId: payload.researchId } : {}) });
      if (generation !== callGeneration) return;
      const { data, images } = galleryResult(response, view.card.id);
      if (data.research) renderCoverage(data.research);
      for (const image of images) gallery.images.set(image.index, image.dataUrl);
      gallery.total = data.galleryTotal;
      gallery.complete = data.galleryComplete;
      gallery.nextIndex = data.nextIndex;
      gallery.remainingIndices = data.remainingIndices ?? [];
      gallery.initialized = true;
      const issue = data.errors?.[0];
      gallery.retryAt = issue?.retryAt ?? null;
      if (issue) {
        gallery.error = t("loadError") + " " + String(issue.message || "");
        if (gallery.nextIndex === null && Number.isSafeInteger(issue.index)) gallery.nextIndex = issue.index;
      }
      if (!issue && !images.length && data.nextIndex !== null && data.nextIndex <= start) {
        gallery.error = t("loadError");
        gallery.nextIndex = start;
      }
    } catch (error) {
      if (generation !== callGeneration) return;
      gallery.error = error.message || t("loadError");
      gallery.nextIndex = start;
      gallery.retryAt = Number.isFinite(Date.parse(error.retryAt)) ? error.retryAt : null;
    } finally {
      if (generation === callGeneration) { gallery.loading = false; drawGallery(view); shareSelection(view); }
    }
  }

  function createCard(card, hydration) {
    const element = node("li", "offer");
    element.dataset.id = card.id;
    const figure = node("div", "cover");
    const body = node("div", "offer-body");
    const dataUrl = imageData(hydration);
    if (card.image?.status === "ready" && dataUrl) {
      figure.append(makePhoto(dataUrl, card.title, card.image.index, () => figure.replaceChildren(imagePlaceholder({ image: { status: "failed" } }))));
    } else figure.append(imagePlaceholder(card));
    if (Number.isSafeInteger(card.imageCount) && card.imageCount > 0) figure.append(node("span", "photo-count", card.imageCount + " " + t(card.galleryComplete === false ? "knownPhotos" : "photoCount")));
    body.append(node("p", "price", priceLabel(card)), node("h3", "offer-title", card.title));
    const facts = node("div", "facts");
    addFact(facts, card.location || t("unknownLocation"));
    addFact(facts, t("conditions")[card.condition]);
    addFact(facts, ["private", "dealer"].includes(card.sellerType) ? t(card.sellerType) : null);
    addFact(facts, t("statuses")[card.status]);
    body.append(facts);
    const costs = node("div", "costs");
    if (Number.isSafeInteger(card.quantity) && card.quantity > 0) {
      const unit = Number.isFinite(card.unitPrice) && card.quantity > 1 ? " · " + money(card.unitPrice) + " " + t("perPiece") : "";
      costs.append(node("p", "", card.quantity + " " + t("pieces") + unit));
    }
    if (Number.isFinite(card.shippingCost)) costs.append(node("p", "", t("shipping") + " " + money(card.shippingCost)));
    else if (["shipping", "both"].includes(card.shipping)) costs.append(node("p", "", t("shippingOpen")));
    if (card.shipping === "pickup") costs.append(node("p", "", t("pickup")));
    if (Number.isFinite(card.totalPrice) && Number.isFinite(card.shippingCost)) costs.append(node("p", "total", money(card.totalPrice) + " " + t("inclShipping")));
    if (costs.children.length) body.append(costs);
    assessment(card, body);
    const observed = time(card.observedAt);
    body.append(node("p", "observed", observed ? t("observed") + " " + observed : t("unknownObservation")));
    const actions = node("div", "actions");
    const openButton = node("button", "button primary", t("open"));
    openButton.type = "button";
    openButton.disabled = !listingUrl(card.url) || !canOpenLinks();
    if (!canOpenLinks()) openButton.title = t("linkUnsupported");
    const photoButton = node("button", "button", t("photos"));
    photoButton.type = "button";
    photoButton.setAttribute("aria-expanded", "false");
    photoButton.disabled = payload.source !== "live" || !/^\d{1,20}$/.test(card.id) || (card.imageCount === 0 && card.galleryComplete === true);
    if (payload.source !== "live") photoButton.title = t("galleryUnavailable");
    actions.append(openButton, photoButton);
    const actionStatus = node("p", "action-status");
    actionStatus.setAttribute("role", "status");
    const gallerySection = node("section", "gallery");
    gallerySection.hidden = true;
    gallerySection.setAttribute("aria-label", t("gallery"));
    const galleryMain = node("div", "gallery-main");
    const galleryCaption = node("p", "gallery-caption");
    const thumbnails = node("div", "thumbnails");
    thumbnails.setAttribute("role", "group");
    thumbnails.setAttribute("aria-label", t("gallery"));
    const galleryStatus = node("p", "gallery-status");
    galleryStatus.setAttribute("role", "status");
    const moreButton = node("button", "button more", t("more"));
    moreButton.type = "button";
    gallerySection.append(galleryMain, galleryCaption, thumbnails, galleryStatus, moreButton);
    body.append(actions, actionStatus, gallerySection);
    element.append(figure, body);
    const view = { card, element, figure, openButton, photoButton, actionStatus, gallerySection, galleryMain, galleryCaption, thumbnails, galleryStatus, moreButton,
      gallery: { open: false, loading: false, initialized: false, images: new Map(), selected: null, total: card.imageCount, complete: card.galleryComplete, nextIndex: 0, remainingIndices: [], retryAt: card.image?.error?.retryAt ?? null, error: "", retryTimer: null } };
    openButton.addEventListener("click", () => openListing(view));
    photoButton.addEventListener("click", () => {
      view.gallery.open = !view.gallery.open;
      drawGallery(view);
      if (view.gallery.open && !view.gallery.initialized) loadGallery(view);
    });
    moreButton.addEventListener("click", () => loadGallery(view));
    if (payload.collectionId) {
      const detailButton = node("button", "button", t("details"));
      detailButton.type = "button";
      const detailSection = node("section", "detail-content");
      detailSection.hidden = true;
      actions.append(detailButton);
      body.append(detailSection);
      view.detailButton = detailButton;
      view.detailSection = detailSection;
      detailButton.addEventListener("click", () => loadDetails(view));
      if (!dataUrl && card.image?.status === "pending") {
        const retry = node("button", "button cover-retry", t("coverRetry"));
        retry.addEventListener("click", () => queueCover(view.card.id));
        figure.append(retry);
      }
    }
    return view;
  }

  function render(envelope) {
    const data = envelope?.structuredContent;
    if (envelope?.isError || !object(data) || !Array.isArray(data.cards) || data.cards.length > 24 ||
        !["live", "provided", "demo"].includes(data.source) ||
        data.cards.some(card => !object(card) || typeof card.id !== "string" || typeof card.title !== "string") ||
        new Set(data.cards.map(card => card.id)).size !== data.cards.length) {
      notice(t("selectionError"));
      return;
    }
    generation++;
    pageBusy = false;
    elements["queries-more"].disabled = false;
    elements.audit.disabled = false;
    elements["audit-more"].disabled = false;
    queryVersion = undefined;
    coverObserver?.disconnect();
    coverQueue.clear();
    clearTimeout(coverTimer);
    payload = data;
    lastEnvelope = envelope;
    for (const view of views.values()) clearTimeout(view.gallery.retryTimer);
    views.clear();
    elements.cards.replaceChildren();
    const images = Array.isArray(envelope._meta?.listingImages) ? envelope._meta.listingImages : [];
    data.cards.forEach((card, index) => {
      const hydration = images.find(image => image.id === card.id && image.index === card.image?.index);
      const view = createCard({ ...card, rank: Number.isFinite(card.rank) ? card.rank : index + 1 }, hydration);
      views.set(card.id, view);
    });
    elements.title.textContent = data.title || t("title");
    elements.summary.textContent = data.summary || "";
    elements.summary.hidden = !data.summary;
    elements.source.textContent = t("source")[data.source] + " · " + data.cards.length + " " + t("of") + " " + (data.requestedCount ?? data.cards.length);
    elements.toolbar.hidden = !data.cards.length;
    const missing = Array.isArray(data.missingIds) ? data.missingIds.length : 0;
    notice(missing ? missing + " " + t("unavailable") + "." : data.cards.length ? "" : t("empty"));
    updateLabels();
    sortCards();
    renderCoverage(data.research);
    elements["page-nav"].hidden = !data.collectionId;
    elements["page-previous"].textContent = t("pagePrevious");
    elements["page-next"].textContent = t("pageNext");
    elements["page-previous"].disabled = !data.previousCursor;
    elements["page-next"].disabled = !data.nextCursor;
    elements["page-label"].textContent = ((data.offset ?? 0) + 1) + "–" + ((data.offset ?? 0) + data.cards.length) + " " + t("of") + " " + data.requestedCount;
    elements["audit-records"].replaceChildren();
    elements["audit-more"].hidden = true;
    auditCursor = undefined;
    observeCovers();
    shareSelection();
  }

  function observeCovers() {
    coverObserver?.disconnect();
    coverQueue.clear();
    clearTimeout(coverTimer);
    if (payload?.collectionId && typeof IntersectionObserver === "function") {
      coverObserver = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) queueCover(entry.target.dataset.id);
      }, { root: hostContext.displayMode === "fullscreen" ? null : elements.cards, rootMargin: "240px" });
      for (const view of views.values()) if (view.card.image?.status === "pending") coverObserver.observe(view.element);
    }
  }

  function renderCoverage(research) {
    elements.coverage.hidden = !research?.counts;
    if (!research?.counts) return;
    if (payload) payload.research = research;
    const counts = research.counts;
    elements["coverage-label"].textContent = t("coverage") + " · " + research.queryCount + " " + t("queries") + " · " + counts.uniqueSearchListings + " " + t("fetched");
    elements["coverage-counts"].textContent = [
      [counts.detailRecordsRetrieved, "detailCount"], [counts.descriptionsDeliveredToModel, "descriptions"], [counts.uniqueModelPhotoIndices, "modelPhotos"],
      [counts.visualFindingsRecorded, "reviews"], [counts.uiPhotosLoaded, "uiPhotos"],
    ].map(([count, label]) => (count ?? 0) + " " + t(label)).join(" · ");
    const version = JSON.stringify([research.queries, locale]);
    if (queryVersion !== version) {
      queryVersion = version;
      queryCursor = research.queriesNextCursor;
      elements["coverage-queries"].replaceChildren();
      drawQueries(research.queries ?? []);
      elements["queries-more"].hidden = !queryCursor;
    }
    elements["queries-more"].textContent = t("queryMore");
    elements.audit.textContent = t("audit");
    elements["audit-more"].textContent = t("auditMore");
    reportSize();
  }

  function drawQueries(queries) {
    for (const query of queries) {
      const row = node("div", "query-row");
      row.append(node("p", "query-name", query.query || "∅"),
        node("p", "", (query.reportedTotal ?? "?") + " " + t("found") + " · " + query.uniqueListings + " " + t("loaded") + " · " + query.pagesFetched + " " + t("pages")));
      if (query.filteredOutCount) row.append(node("p", "", (language === "de" ? "Textfilter" : "Text filters") + " · " + query.filteredOutCount));
      if (query.counts) row.append(node("p", "", [
        [query.counts.detailRecordsDeliveredToModel, "queryDetails"],
        [query.counts.uniqueModelPhotoIndices, "queryPhotos"],
        [query.counts.photosWithRecordedFindings, "queryFindings"],
      ].map(([count, label]) => (count ?? 0) + " " + t(label)).join(" · ")));
      const filters = Object.entries(query.filters ?? {}).map(([key, value]) => {
        const label = words[language].filterLabels[key] ?? key;
        const display = Array.isArray(value) ? value.join(", ")
          : words[language].conditions[value] ?? words[language].filterValues[value] ?? valueText(value);
        return label + " · " + display;
      });
      if (filters.length) row.append(node("p", "", filters.join(" · ")));
      elements["coverage-queries"].append(row);
    }
  }

  async function loadQueries() {
    if (!queryCursor || !payload?.researchId) return;
    const callGeneration = generation;
    const callVersion = queryVersion;
    elements["queries-more"].disabled = true;
    try {
      const response = await callTool("get_research", { researchId: payload.researchId, section: "queries", limit: 8, cursor: queryCursor });
      if (generation !== callGeneration || queryVersion !== callVersion) return;
      if (response.isError) throw new Error(response.structuredContent?.error?.message || t("loadError"));
      drawQueries(response.structuredContent?.queries ?? []);
      queryCursor = response.structuredContent?.nextCursor;
      elements["queries-more"].hidden = !queryCursor;
    } catch (error) { if (generation === callGeneration) notice(error.message || t("loadError")); }
    finally { if (generation === callGeneration) { elements["queries-more"].disabled = false; reportSize(); } }
  }

  async function loadAudit(cursor) {
    if (!payload?.researchId) return;
    const callGeneration = generation;
    elements.audit.disabled = true;
    elements["audit-more"].disabled = true;
    try {
      const response = await callTool("get_research", { researchId: payload.researchId, section: "listings", limit: 12, ...(cursor ? { cursor } : {}) });
      if (generation !== callGeneration) return;
      if (response.isError) throw new Error(response.structuredContent?.error?.message || t("loadError"));
      if (!cursor) elements["audit-records"].replaceChildren();
      for (const record of response.structuredContent?.listings ?? []) {
        const row = node("div", "audit-row");
        row.append(node("strong", "", record.id));
        if (record.deliveredFields?.length) row.append(node("p", "", t("fields") + " · " + record.deliveredFields.map(field => words[language].fieldLabels[field] ?? field).join(", ")));
        if (record.description) row.append(node("p", "", record.description.deliveredChars + " / " + record.description.totalChars + " " + t("chars")));
        if (record.modelPhotos?.length) row.append(node("p", "", t("modelIndices") + " · " + record.modelPhotos.map(photo => photo.index + " (" + photo.size + ")").join(", ")));
        for (const review of record.findings ?? []) row.append(node("p", "", t("agentReview") + " · " + review.findings));
        if (!record.deliveredFields?.length && !record.modelPhotos?.length) row.append(node("p", "", t("emptyAudit")));
        elements["audit-records"].append(row);
      }
      auditCursor = response.structuredContent?.nextCursor;
      elements["audit-more"].hidden = !auditCursor;
    } catch (error) { if (generation === callGeneration) notice(error.message || t("loadError")); }
    finally { if (generation === callGeneration) { elements.audit.disabled = false; elements["audit-more"].disabled = false; reportSize(); } }
  }

  async function loadDetails(view) {
    if (view.detailLoading) return;
    view.detailSection.hidden = !view.detailSection.hidden;
    view.detailButton.textContent = t(view.detailSection.hidden ? "details" : "closeDetails");
    if (view.detailSection.hidden || view.detailLoaded) { reportSize(); return; }
    view.detailLoading = true;
    view.detailSection.textContent = t("detailLoading");
    const callGeneration = generation;
    try {
      const response = await callTool("browse_collection", { researchId: payload.researchId, collectionId: payload.collectionId, action: "details", id: view.card.id });
      if (generation !== callGeneration) return;
      if (response.isError) throw new Error(response.structuredContent?.error?.message || t("loadError"));
      const record = response.structuredContent?.results?.find(result => result.id === view.card.id)?.listing;
      if (!record) throw new Error(t("unavailable"));
      view.detailSection.replaceChildren(node("p", "", record.description || ""));
      for (const [key, value] of Object.entries(record.attributes ?? {})) view.detailSection.append(node("p", "", key + " · " + valueText(value)));
      if (record.seller?.memberSince) view.detailSection.append(node("p", "", t("memberSince") + " · " + record.seller.memberSince));
      if (Number.isFinite(record.seller?.activeListingCount)) view.detailSection.append(node("p", "", t("activeListings") + " · " + record.seller.activeListingCount));
      view.detailLoaded = true;
      renderCoverage(response.structuredContent.research);
      shareSelection(view);
    } catch (error) {
      if (generation === callGeneration) { view.detailSection.textContent = error.message || t("loadError"); view.detailSection.hidden = false; }
    } finally { view.detailLoading = false; reportSize(); }
  }

  async function loadPage(cursor) {
    if (!cursor || pageBusy || !payload?.collectionId) return;
    const callGeneration = generation;
    pageBusy = true;
    elements["page-next"].disabled = true;
    elements["page-previous"].disabled = true;
    elements["page-label"].textContent = t("pageLoading");
    try {
      const response = await callTool("browse_collection", { researchId: payload.researchId,
        collectionId: payload.collectionId, action: "page", cursor, pageSize: payload.pageSize ?? 12 });
      if (generation !== callGeneration) return;
      if (response.isError) throw new Error(response.structuredContent?.error?.message || t("selectionError"));
      render(response);
      elements.cards.scrollTop = 0;
    } catch (error) {
      if (generation !== callGeneration) return;
      notice(error.message || t("selectionError"));
      elements["page-next"].disabled = !payload.nextCursor;
      elements["page-previous"].disabled = !payload.previousCursor;
    } finally { if (generation === callGeneration) pageBusy = false; }
  }

  function queueCover(id) {
    const view = views.get(id);
    if (disposed || !payload?.collectionId || !view || view.coverLoading || view.card.image?.status === "ready" || view.card.image?.status === "missing") return;
    if (Date.parse(view.card.image?.error?.retryAt) > Date.now()) return;
    coverQueue.add(id);
    clearTimeout(coverTimer);
    coverTimer = setTimeout(flushCovers, 30);
  }

  async function flushCovers() {
    if (disposed || coverBusy || !coverQueue.size || !payload?.collectionId || (connection !== "ready" && !window.openai?.callTool)) return;
    const ids = [...coverQueue].slice(0, 4);
    const callGeneration = generation;
    const researchId = payload.researchId, collectionId = payload.collectionId;
    for (const id of ids) { coverQueue.delete(id); const view = views.get(id); if (view) view.coverLoading = true; }
    coverBusy = true;
    try {
      const response = await callTool("browse_collection", { researchId, collectionId, action: "covers", ids });
      if (generation !== callGeneration) return;
      if (response.isError) throw new Error(response.structuredContent?.error?.message || t("loadError"));
      const data = response.structuredContent;
      for (const id of ids) {
        const view = views.get(id);
        if (!view) continue;
        const photo = response._meta?.listingImages?.find(image => image.id === id && image.index === view.card.image.index);
        const dataUrl = imageData(photo);
        const error = data?.errors?.find(error => error.id === id);
        if (dataUrl) {
          view.card.image.status = "ready";
          view.figure.replaceChildren(makePhoto(dataUrl, view.card.title, photo.index, () => view.figure.replaceChildren(imagePlaceholder({ image: { status: "failed" } }))));
          if (view.card.imageCount > 0) view.figure.append(node("span", "photo-count", view.card.imageCount + " " + t("photoCount")));
          coverObserver?.unobserve(view.element);
        } else {
          view.card.image.status = data?.missingIds?.includes(id) ? "missing" : "failed";
          view.card.image.error = error;
          view.figure.replaceChildren(imagePlaceholder(view.card));
          if (view.card.image.status !== "missing") {
            const retry = node("button", "button cover-retry", t("coverRetry"));
            retry.addEventListener("click", () => queueCover(id));
            view.figure.append(retry);
          }
        }
      }
      renderCoverage(data?.research);
    } catch (error) {
      if (generation === callGeneration) for (const id of ids) {
        const view = views.get(id);
        if (view) view.actionStatus.textContent = error.message || t("loadError");
      }
    } finally {
      if (generation === callGeneration) for (const id of ids) { const view = views.get(id); if (view) view.coverLoading = false; }
      coverBusy = false;
      if (!disposed && coverQueue.size) coverTimer = setTimeout(flushCovers, 30);
      reportSize();
    }
  }

  function legacyResult(globals = window.openai) {
    if (receivedStandardResult || !object(globals?.toolOutput)) return;
    const metadata = globals.toolResponseMetadata ?? window.openai?.toolResponseMetadata;
    const envelope = metadata?.mcp_tool_result ?? metadata?.call_tool_result ?? metadata;
    render({ structuredContent: globals.toolOutput, _meta: envelope?._meta ?? metadata });
  }

  app.addEventListener("toolresult", result => {
    receivedStandardResult = true;
    render(result);
  });
  app.addEventListener("hostcontextchanged", context => applyHostContext(context.hostContext ?? context));
  app.onteardown = async () => {
    disposed = true;
    generation++;
    clearTimeout(coverTimer);
    coverObserver?.disconnect();
    resizeObserver?.disconnect();
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    for (const view of views.values()) clearTimeout(view.gallery.retryTimer);
    coverQueue.clear();
    return {};
  };
  window.addEventListener("openai:set_globals", event => {
    const globals = event.detail?.globals;
    if (!object(globals)) return;
    applyHostContext(globals);
    legacyResult({ ...window.openai, ...globals });
  });
  elements.sort.addEventListener("change", sortCards);
  elements.cards.addEventListener("scroll", updatePosition, { passive: true });
  elements.previous.addEventListener("click", () => {
    const current = Number(elements.pager.dataset.position ?? 0);
    elements.cards.children[Math.max(0, current - 1)]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  });
  elements.next.addEventListener("click", () => {
    const current = Number(elements.pager.dataset.position ?? 0);
    elements.cards.children[Math.min(views.size - 1, current + 1)]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  });
  elements.fullscreen.addEventListener("click", async () => {
    try {
      const result = connection === "ready" ? await app.requestDisplayMode({ mode: "fullscreen" }) : await window.openai?.requestDisplayMode?.({ mode: "fullscreen" });
      if (result?.mode) applyHostContext({ displayMode: result.mode });
    } catch (error) { notice(error.message || t("connection")); }
  });
  elements["page-next"].addEventListener("click", () => loadPage(payload?.nextCursor));
  elements["page-previous"].addEventListener("click", () => loadPage(payload?.previousCursor));
  elements["queries-more"].addEventListener("click", loadQueries);
  elements.audit.addEventListener("click", () => loadAudit());
  elements["audit-more"].addEventListener("click", () => loadAudit(auditCursor));
  elements.coverage.addEventListener("toggle", reportSize);
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(reportSize) : null;
  resizeObserver?.observe(document.body);
  window.addEventListener("resize", () => { updatePosition(); reportSize(); });
  updateLabels();
  if (window.openai) { applyHostContext(window.openai); legacyResult(); }
  app.connect(undefined, { timeout: 10000 }).then(() => {
    connection = "ready";
    hostCapabilities = app.getHostCapabilities() ?? {};
    applyHostContext(app.getHostContext());
    for (const view of views.values()) view.openButton.disabled = !listingUrl(view.card.url) || !canOpenLinks();
    lastHeight = 0;
    reportSize();
    flushCovers();
    shareSelection();
  }).catch(() => {
    connection = "fallback";
    if (!payload) notice(t("connection"));
    flushCovers();
  });
}

export const PRESENTATION_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>willhaben</title>
<style>
  :root { color-scheme: light dark; --page: light-dark(#ffffff,#171717); --card: light-dark(#ffffff,#222222); --ink: light-dark(#202020,#f1f1f1); --muted: light-dark(#616161,#b8b8b8); --line: light-dark(#dcdcdc,#494949); --soft: light-dark(#f5f5f5,#292929); --image: light-dark(#f7f7f7,#ededed); --accent: light-dark(#202020,#eeeeee); --accent-ink: light-dark(#ffffff,#202020); }
  :root[data-theme="light"] { color-scheme: light; }
  :root[data-theme="dark"] { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; color: var(--ink); background: transparent; font: 14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  [hidden] { display: none !important; }
  button,select { font: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: default; opacity: .5; }
  button:focus-visible,select:focus-visible,summary:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
  p,h2,h3,h4,ol,ul { margin: 0; }
  h2 { font-size: 20px; line-height: 1.3; font-weight: 650; overflow-wrap: anywhere; }
  header { display: grid; gap: 6px; margin-bottom: 14px; }
  .brand-title { display: flex; align-items: center; gap: 10px; }
  .brand-title img { width: 32px; height: 32px; flex-shrink: 0; object-fit: contain; }
  #summary { color: var(--muted); max-width: 70ch; overflow-wrap: anywhere; }
  #source { color: var(--muted); font-size: 12px; }
  #notice { padding: 10px 12px; background: var(--soft); border-radius: 8px; margin: 0 0 12px; }
  #toolbar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin: 0 0 12px; }
  .sort-control { display: flex; align-items: center; gap: 8px; min-width: 0; }
  select { max-width: 100%; min-height: 42px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--ink); padding: 7px 28px 7px 10px; }
  #fullscreen { margin-left: auto; }
  .button { min-height: 44px; border: 1px solid var(--line); border-radius: 8px; padding: 9px 11px; background: var(--card); color: var(--ink); font-weight: 550; }
  .button:hover:not(:disabled) { background: var(--soft); }
  .primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .primary:hover:not(:disabled) { background: var(--accent); opacity: .85; }
  #cards { display: grid; grid-auto-flow: column; grid-auto-columns: min(330px,calc(100% - 16px)); gap: 12px; align-items: start; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; list-style: none; padding: 2px 2px 12px; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
  .offer { scroll-snap-align: start; min-width: 0; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--card); }
  .cover,.gallery-main { position: relative; display: grid; place-items: center; aspect-ratio: 4/3; background: var(--image); overflow: hidden; color: #444; }
  .product-photo { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: contain; }
  .photo-placeholder { padding: 20px; text-align: center; color: #555; font-size: 13px; }
  .photo-count { position: absolute; bottom: 9px; right: 9px; padding: 3px 7px; border-radius: 6px; background: #ffffffeb; color: #333; font-size: 12px; }
  .offer-body { padding: 14px; }
  .price { font-size: 21px; font-weight: 650; line-height: 1.3; font-variant-numeric: tabular-nums; }
  .offer-title { margin-top: 7px; font-size: 16px; line-height: 1.4; font-weight: 600; overflow-wrap: anywhere; }
  .facts { display: flex; flex-wrap: wrap; gap: 4px 0; margin-top: 8px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
  .fact + .fact::before { content: "·"; padding: 0 6px; }
  .costs { margin-top: 9px; font-size: 13px; color: var(--muted); }
  .total { color: var(--ink); font-weight: 550; }
  .assessment,.questions { margin-top: 13px; }
  .section-label { font-size: 12px; font-weight: 650; color: var(--muted); margin-bottom: 3px; }
  .assessment p,.question-list,.criterion-list { overflow-wrap: anywhere; }
  .question-list,.criterion-list { padding-left: 18px; }
  .question-list li + li,.criterion-list li + li { margin-top: 3px; }
  .requirements { margin-top: 12px; font-size: 13px; }
  .requirements summary { cursor: pointer; padding: 4px 0; }
  .criterion-list { color: var(--muted); margin-top: 5px; }
  .observed { margin-top: 13px; color: var(--muted); font-size: 12px; }
  .actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 13px; }
  .actions .button { flex: 1 1 auto; }
  .action-status,.gallery-status { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
  .action-status:not(:empty) { margin-top: 7px; }
  .gallery { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 13px; }
  .gallery-main { border-radius: 8px; }
  .gallery-caption { margin-top: 5px; font-size: 12px; color: var(--muted); }
  .thumbnails { display: flex; gap: 6px; overflow-x: auto; margin: 9px 0; padding: 3px; scrollbar-width: thin; }
  .thumbnail { width: 54px; height: 54px; flex: 0 0 54px; padding: 2px; border: 1px solid var(--line); border-radius: 6px; background: var(--image); overflow: hidden; }
  .thumbnail[aria-pressed="true"] { outline: 2px solid var(--ink); outline-offset: 1px; }
  .more { width: 100%; margin-top: 9px; }
  #pager { display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 2px; }
  #pager .button { width: 44px; font-size: 22px; padding: 2px; }
  #position { font-size: 12px; color: var(--muted); min-width: 50px; text-align: center; font-variant-numeric: tabular-nums; }
  :root[data-mode="fullscreen"] body { max-width: 1260px; margin: auto; padding: 24px; }
  :root[data-mode="fullscreen"] #cards { grid-auto-flow: row; grid-template-columns: repeat(auto-fit,minmax(min(100%,290px),1fr)); grid-auto-columns: auto; overflow: visible; scroll-snap-type: none; }
  #coverage { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; color: var(--muted); font-size: 12px; }
  #coverage summary { cursor: pointer; color: var(--ink); font-weight: 550; }
  #coverage-counts { margin: 9px 0; line-height: 1.7; }
  .query-row,.audit-row { border-top: 1px solid var(--line); padding: 8px 0; overflow-wrap: anywhere; }
  .query-name { font-weight: 600; color: var(--ink); }
  #audit { margin-top: 8px; }
  #audit-more { width: 100%; }
  #page-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; }
  #page-label { color: var(--muted); font-size: 12px; }
  .detail-content { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 440px; overflow: auto; font-size: 13px; margin-top: 12px; }
  .cover-retry { position: absolute; bottom: 12px; left: 12px; }
  @media (min-width: 640px) { :root:not([data-mode="fullscreen"]) #cards { grid-auto-flow: row; grid-template-columns: repeat(2,minmax(0,1fr)); grid-auto-columns: auto; max-height: 760px; overflow: auto; scroll-snap-type: none; } }
  @media (max-width: 380px) { body { padding: 12px; } .offer-body { padding: 12px; } .sort-control { flex: 1 1 100%; } select { flex: 1; min-width: 0; } #fullscreen { margin-left: 0; } }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>
</head>
<body>
<main aria-label="willhaben Angebote">
  <header><div class="brand-title"><img src="data:image/png;base64,${ICON_BASE64}" width="32" height="32" alt="willhaben"><h2 id="title">Angebote werden geladen</h2></div><p id="summary" hidden></p><p id="source"></p></header>
  <details id="coverage" hidden><summary id="coverage-label">Rechercheumfang</summary><p id="coverage-counts"></p><div id="coverage-queries"></div><button id="queries-more" class="button" type="button" hidden>Weitere Suchanfragen</button><button id="audit" class="button" type="button">Einzelnachweise</button><div id="audit-records"></div><button id="audit-more" class="button" type="button" hidden>Weitere Nachweise</button></details>
  <p id="notice" role="status" hidden></p>
  <div id="toolbar" hidden><label class="sort-control"><span id="sort-label">Sortieren</span><select id="sort" aria-labelledby="sort-label"><option value="rank">Empfehlung</option><option value="price_asc">Preis aufsteigend</option><option value="price_desc">Preis absteigend</option></select></label><button id="fullscreen" class="button" type="button" hidden>Größere Ansicht</button></div>
  <ol id="cards"></ol>
  <nav id="pager" aria-label="Angebote durchblättern" hidden><button id="previous" class="button" type="button" aria-label="Vorheriges Angebot">‹</button><span id="position" aria-live="polite"></span><button id="next" class="button" type="button" aria-label="Nächstes Angebot">›</button></nav>
  <nav id="page-nav" aria-label="Ergebnisseiten" hidden><button id="page-previous" class="button" type="button">Vorherige Seite</button><span id="page-label" aria-live="polite"></span><button id="page-next" class="button" type="button">Weitere Angebote</button></nav>
</main>
<script>${PRESENTATION_BRIDGE_SOURCE.replace(/<\/script/gi, "<\\/script")}</script>
<script>(${mountPresentation.toString()})();</script>
</body>
</html>`;
