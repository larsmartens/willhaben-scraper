export const PRESENTATION_URI = "ui://marktplatz/listings-v1.html";

export const PRESENTATION_RESOURCE_META = {
  ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
  "openai/widgetDescription": "Ausgewählte willhaben-Angebote mit Inseratfoto, Preis, Einordnung, offenen Anforderungen und Galerie.",
  "openai/widgetPrefersBorder": true,
  "openai/widgetCSP": { connect_domains: [], resource_domains: [], redirect_domains: ["https://www.willhaben.at", "https://willhaben.at"] },
  "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
};

function mountPresentation() {
  const words = {
    de: {
      title: "Ausgewählte Angebote", waiting: "Angebote werden geladen", source: { live: "willhaben", provided: "Bereitgestellte Angebote", demo: "Synthetische Demoangebote" },
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
      title: "Selected listings", waiting: "Loading listings", source: { live: "willhaben", provided: "Provided listings", demo: "Synthetic demo listings" },
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
  const elements = Object.fromEntries(["title", "summary", "source", "notice", "toolbar", "sort-label", "sort", "fullscreen", "cards", "pager", "previous", "position", "next"]
    .map(id => [id, document.getElementById(id)]));
  const pending = new Map();
  const views = new Map();
  let sequence = 0;
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

  function post(message) {
    window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
  }

  function request(method, params, timeout = 45000) {
    const id = "market-ui-" + ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(t("timeout"))); }, timeout);
      pending.set(id, { resolve, reject, timer });
      post({ id, method, params });
    });
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
      if (connection === "ready") post({ method: "ui/notifications/size-changed", params: { height } });
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
    updatePosition();
    reportSize();
  }

  function updatePosition() {
    const cards = [...elements.cards.children];
    elements.pager.hidden = cards.length < 2 || hostContext.displayMode === "fullscreen";
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
      if (connection === "ready" && object(hostCapabilities.openLinks)) await request("ui/open-link", { url });
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
      const block = response.content[result.imageContentIndex];
      if (block?.type !== "image" || block.mimeType !== result.mimeType) throw new Error(t("formatError"));
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
      button.addEventListener("click", () => { gallery.selected = index; drawGallery(view); });
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
      let response;
      if (connection === "ready") response = await request("tools/call", { name: "inspect_listing_images", arguments: args });
      else if (typeof window.openai?.callTool === "function") response = await window.openai.callTool("inspect_listing_images", args);
      else throw new Error(t("connection"));
      if (generation !== callGeneration) return;
      const { data, images } = galleryResult(response, view.card.id);
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
      if (generation === callGeneration) { gallery.loading = false; drawGallery(view); }
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
    const view = { card, element, openButton, photoButton, actionStatus, gallerySection, galleryMain, galleryCaption, thumbnails, galleryStatus, moreButton,
      gallery: { open: false, loading: false, initialized: false, images: new Map(), selected: null, total: card.imageCount, complete: card.galleryComplete, nextIndex: 0, remainingIndices: [], retryAt: card.image?.error?.retryAt ?? null, error: "", retryTimer: null } };
    openButton.addEventListener("click", () => openListing(view));
    photoButton.addEventListener("click", () => {
      view.gallery.open = !view.gallery.open;
      drawGallery(view);
      if (view.gallery.open && !view.gallery.initialized) loadGallery(view);
    });
    moreButton.addEventListener("click", () => loadGallery(view));
    return view;
  }

  function render(envelope) {
    const data = envelope?.structuredContent;
    if (envelope?.isError || !object(data) || !Array.isArray(data.cards) || data.cards.length > 8 ||
        !["live", "provided", "demo"].includes(data.source) ||
        data.cards.some(card => !object(card) || typeof card.id !== "string" || typeof card.title !== "string") ||
        new Set(data.cards.map(card => card.id)).size !== data.cards.length) {
      notice(t("selectionError"));
      return;
    }
    generation++;
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
  }

  function legacyResult(globals = window.openai) {
    if (receivedStandardResult || !object(globals?.toolOutput)) return;
    const metadata = globals.toolResponseMetadata ?? window.openai?.toolResponseMetadata;
    const envelope = metadata?.mcp_tool_result ?? metadata?.call_tool_result ?? metadata;
    render({ structuredContent: globals.toolOutput, _meta: envelope?._meta ?? metadata });
  }

  window.addEventListener("message", event => {
    const message = event.data;
    if (event.source !== window.parent || !object(message) || message.jsonrpc !== "2.0") return;
    if (message.id !== undefined && !message.method && pending.has(message.id)) {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.error) waiting.reject(new Error(String(message.error.message || t("connection"))));
      else waiting.resolve(message.result);
      return;
    }
    if (message.method === "ui/notifications/tool-result") {
      receivedStandardResult = true;
      render(message.params);
    }
    if (message.method === "ui/notifications/host-context-changed") applyHostContext(message.params?.hostContext ?? message.params);
  });
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
      const result = await request("ui/request-display-mode", { mode: "fullscreen" });
      if (result?.mode) applyHostContext({ displayMode: result.mode });
    } catch (error) { notice(error.message || t("connection")); }
  });
  if (typeof ResizeObserver === "function") new ResizeObserver(reportSize).observe(document.body);
  window.addEventListener("resize", () => { updatePosition(); reportSize(); });
  updateLabels();
  if (window.openai) { applyHostContext(window.openai); legacyResult(); }
  request("ui/initialize", {
    appInfo: { name: "marktplatz-listings", version: "1.3.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    protocolVersion: "2026-01-26",
  }, 10000).then(result => {
    connection = "ready";
    hostCapabilities = object(result?.hostCapabilities) ? result.hostCapabilities : {};
    applyHostContext(result?.hostContext);
    for (const view of views.values()) view.openButton.disabled = !listingUrl(view.card.url) || !canOpenLinks();
    post({ method: "ui/notifications/initialized", params: {} });
    lastHeight = 0;
    reportSize();
  }).catch(() => {
    connection = "fallback";
    if (!payload) notice(t("connection"));
  });
}

export const PRESENTATION_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>Marktplatz-Auswahl</title>
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
  @media (max-width: 380px) { body { padding: 12px; } .offer-body { padding: 12px; } .sort-control { flex: 1 1 100%; } select { flex: 1; min-width: 0; } #fullscreen { margin-left: 0; } }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>
</head>
<body>
<main aria-label="Marktplatz-Auswahl">
  <header><h2 id="title">Angebote werden geladen</h2><p id="summary" hidden></p><p id="source"></p></header>
  <p id="notice" role="status" hidden></p>
  <div id="toolbar" hidden><label class="sort-control"><span id="sort-label">Sortieren</span><select id="sort" aria-labelledby="sort-label"><option value="rank">Empfehlung</option><option value="price_asc">Preis aufsteigend</option><option value="price_desc">Preis absteigend</option></select></label><button id="fullscreen" class="button" type="button" hidden>Größere Ansicht</button></div>
  <ol id="cards"></ol>
  <nav id="pager" aria-label="Angebote durchblättern" hidden><button id="previous" class="button" type="button" aria-label="Vorheriges Angebot">‹</button><span id="position" aria-live="polite"></span><button id="next" class="button" type="button" aria-label="Nächstes Angebot">›</button></nav>
</main>
<script>(${mountPresentation.toString()})();</script>
</body>
</html>`;
