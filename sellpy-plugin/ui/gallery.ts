import { App } from '@modelcontextprotocol/ext-apps';
import type { GalleryCard, GalleryData, ItemFeedback, ItemImage, ItemObservation, Money } from '../src/domain.js';
import type { CollectionScope, CollectionView } from '../src/collection-contract.js';
import { projectCardFacts, priceSubtotal, type CardEvidence, type CardFact } from '../src/card-facts.js';
import { assessmentStillApplies } from '../src/ranking.js';
import { BoundedCache, detailFromResult, errorMessage, feedbackFromResult, formatMoney, galleryFromResult,
  hydrationFromResult, mergeAppendedCard, parseItem, parseScope, record, retryTime, safeItemUrl } from './data.js';
import { comparisonRows } from './comparison.js';

const language = {
  de: {
    eyebrow: 'Sellpy Studio', title: 'Suchergebnisse', items: 'Artikel', sourceOrder: 'Fundreihenfolge',
    view: 'Sammlung', shortlistView: 'Gemerkt', availableView: 'Verfügbar', assessedView: 'Bewertung gespeichert', unassessedView: 'Bewertung offen',
    priceAsc: 'Preis aufsteigend', priceDesc: 'Preis absteigend', pageSize: 'Pro Seite', previous: 'Vorherige Seite', next: 'Nächste Seite',
    fullscreen: 'Größer ansehen', inline: 'Zurück zum Chat', membership: 'Zusammengestellt',
    available: 'Verfügbar', reserved: 'Reserviert', sold: 'Verkauft', unknown: 'Offen',
    details: 'Shop-Details und Notizen', description: 'Vollständige Shop-Beschreibung', noDescription: 'Keine Beschreibung gespeichert.',
    detailLoad: 'Gespeicherte Details laden', selectionNote: 'Notiz zur Auswahl', cautions: 'Weitere Hinweise',
    assessed: 'Bildbewertung', unassessed: 'Bildbewertung offen', evidenceMore: 'weitere Befunde', legacyEvidence: 'Gespeicherte Bildnotizen', evidenceAvailable: 'Bewertung gespeichert · Details laden',
    assessmentChecking: 'Bewertungsstatus wird geladen', assessmentUnknown: 'Bewertungsstatus offen', refreshAssessmentUnknown: 'Shop-Angaben aktualisiert · Bewertungsstatus nicht geladen',
    confirmed: 'Bestätigt', contradicted: 'Widersprochen', uncertain: 'Offen', conflicting: 'Widersprüchliche Belege',
    evidenceImages: 'Bewertete Bild-IDs', evidenceWhen: 'Bewertung vom', observed: 'Shop-Stand',
    open: 'Bei Sellpy ansehen', refresh: 'Preis und Status aktualisieren', refreshed: 'Shop-Angaben aktualisiert.',
    refreshFailed: 'Aktualisierung fehlgeschlagen. Die bisherigen Angaben bleiben sichtbar.',
    photographs: 'Fotos', photograph: 'Foto', close: 'Fotogalerie schließen', previousPhoto: 'Vorheriges Foto', nextPhoto: 'Nächstes Foto',
    noImage: 'Kein Produktfoto verfügbar.', loadingImage: 'Foto wird geladen.', imageFailed: 'Foto konnte nicht geladen werden.',
    pendingImage: 'Foto noch nicht geladen.', retry: 'Foto erneut laden', waitUntil: 'Erneut möglich ab', originalImage: 'Originalfoto öffnen',
    galleryHint: 'Hier angezeigte Fotos sind keine gespeicherte Bildbewertung.', morePhotos: 'Weitere Fotos laden', photoCount: 'von',
    loading: 'Wird geladen …', noCards: 'Keine Artikel in dieser Sammlung.', notConnected: 'Interaktive Funktionen sind hier nicht verfügbar. Originalangebote bleiben verlinkt.',
    toolFailed: 'Der Aufruf konnte nicht abgeschlossen werden. Die bisherigen Ergebnisse bleiben sichtbar.',
    invalidResult: 'Die Antwort passt nicht zur aktuellen Ansicht.', linkFailed: 'Der Link konnte hier nicht geöffnet werden. Nutze den Angebotslink direkt.',
    footer: 'Shop-Angaben behalten ihren Abrufzeitpunkt. Bildbefunde stammen nur aus gespeicherten Bewertungen.',
    unavailableLink: 'Angebotslink nicht verfügbar', warnings: 'Hinweise', shortlist: 'Merken', shortlisted: 'Gemerkt', reject: 'Passt nicht',
    feedbackSaved: 'Deine Auswahl wurde gespeichert.', feedbackFailed: 'Die Auswahl konnte nicht gespeichert werden. Der gespeicherte Stand bleibt erhalten.',
    compare: 'Vergleichen', comparing: 'Vergleich', selected: 'ausgewählt', clearSelection: 'Leeren', backToCards: 'Zur Sammlung',
    comparisonHint: 'Shop-Fakten und gespeicherte Bildbefunde. Fehlende Angaben bleiben offen.', compareRemove: 'Aus Vergleich entfernen', compareAttribute: 'Merkmal',
    compareLimit: 'Bis zu vier Artikel vergleichen. Entferne zuerst einen Artikel.', subtotal: 'Preissumme', missingPrices: 'Preisangaben fehlen', mixedCurrencies: 'Getrennte Währungen; keine Umrechnung.',
    discuss: 'Im Chat besprechen', discussDone: 'Die Auswahl wurde an diesen Chat übergeben.', discussFailed: 'Die Auswahl konnte nicht an den Chat übergeben werden.',
    discussPrompt: 'Vergleiche diese Sellpy-Artikel. Prüfe aktuelle Shop-Angaben und die Originalfotos anhand meiner Kriterien. Speichere tatsächlich geprüfte Bildbefunde mit den genauen Kriterien; halte offene Fragen offen.',
    scope: 'Rechercheumfang', candidates: 'Kandidaten beobachtet', pages: 'Quellseiten', detailsCount: 'Detailbeobachtungen', descriptions: 'Beschreibungen gespeichert',
    modelFacts: 'Artikelfakten an Modell geliefert', modelDescriptions: 'Beschreibungen an Modell geliefert', modelPhotos: 'Fotos an Modell geliefert',
    widgetPhotos: 'Fotos an Galerie geliefert', assessments: 'Bewertungen gespeichert', scopeUnknown: 'Nicht erfasst', scopeRefresh: 'Rechercheumfang aktualisieren',
    scopeHint: 'Geliefert bedeutet nicht gelesen oder geprüft. Native Trefferzahlen verschiedener Sucharme können sich überschneiden.',
    query: 'Suchtext', filters: 'Filter', nativeTotal: 'Native Trefferzahl', nativeWindow: 'Quellfenster', route: 'Route', relaxed: 'Kategorie erweitert',
    preparing: 'Sammlung wird vorbereitet', pause: 'Pausieren', resume: 'Fortsetzen', prepared: 'ausgewertet',
    history: 'Beobachtete Änderungen', historyLoad: 'Beobachtungsverlauf laden', historyNext: 'Weitere Beobachtungen', historyFirst: 'Erste Beobachtungen',
    historyHint: 'Nur in dieser Suche tatsächlich beobachtete Stände; keine historische Preisentwicklung vor dem ersten Abruf.', historyEmpty: 'Keine Beobachtungen gespeichert.',
  },
  en: {
    eyebrow: 'Sellpy Studio', title: 'Search results', items: 'items', sourceOrder: 'Discovery order',
    view: 'Collection', shortlistView: 'Shortlisted', availableView: 'Available', assessedView: 'Assessment saved', unassessedView: 'Assessment pending',
    priceAsc: 'Price low to high', priceDesc: 'Price high to low', pageSize: 'Per page', previous: 'Previous page', next: 'Next page',
    fullscreen: 'Larger view', inline: 'Back to chat', membership: 'Collected',
    available: 'Available', reserved: 'Reserved', sold: 'Sold', unknown: 'Unknown',
    details: 'Shop details and notes', description: 'Full shop description', noDescription: 'No description is stored.',
    detailLoad: 'Load stored details', selectionNote: 'Selection note', cautions: 'Further notes',
    assessed: 'Photo assessment', unassessed: 'Assessment pending', evidenceMore: 'more findings', legacyEvidence: 'Saved photo notes', evidenceAvailable: 'Assessment saved · load details',
    assessmentChecking: 'Checking assessment status', assessmentUnknown: 'Assessment status unknown', refreshAssessmentUnknown: 'Shop facts refreshed · assessment status unavailable',
    confirmed: 'Confirmed', contradicted: 'Contradicted', uncertain: 'Unknown', conflicting: 'Conflicting evidence',
    evidenceImages: 'Assessed image IDs', evidenceWhen: 'Assessment saved', observed: 'Shop observation',
    open: 'View on Sellpy', refresh: 'Refresh price and status', refreshed: 'Shop facts refreshed.',
    refreshFailed: 'Refresh failed. The previous observations remain visible.',
    photographs: 'photos', photograph: 'Photo', close: 'Close photo gallery', previousPhoto: 'Previous photo', nextPhoto: 'Next photo',
    noImage: 'No product photo available.', loadingImage: 'Loading photo.', imageFailed: 'The photo could not be loaded.',
    pendingImage: 'Photo not loaded yet.', retry: 'Reload photo', waitUntil: 'Try again after', originalImage: 'Open original photo',
    galleryHint: 'Displaying photos here does not create a saved photo assessment.', morePhotos: 'Load more photos', photoCount: 'of',
    loading: 'Loading …', noCards: 'No items in this collection.', notConnected: 'Interactive controls are unavailable here. Original listings remain linked.',
    toolFailed: 'The request could not be completed. Previous results remain visible.',
    invalidResult: 'The response does not match the current view.', linkFailed: 'The link could not be opened here. Use the listing link directly.',
    footer: 'Shop facts retain their observation time. Photo findings come only from saved assessments.',
    unavailableLink: 'Listing link unavailable', warnings: 'Notes', shortlist: 'Shortlist', shortlisted: 'Shortlisted', reject: 'Not for me',
    feedbackSaved: 'Your selection has been saved.', feedbackFailed: 'Your decision could not be saved. The stored decision is unchanged.',
    compare: 'Compare', comparing: 'Comparison', selected: 'selected', clearSelection: 'Clear', backToCards: 'Back to collection',
    comparisonHint: 'Shop facts and saved photo findings. Missing information stays unknown.', compareRemove: 'Remove from comparison', compareAttribute: 'Attribute',
    compareLimit: 'Compare up to four items. Remove an item first.', subtotal: 'Price subtotal', missingPrices: 'prices missing', mixedCurrencies: 'Separate currencies; no conversion.',
    discuss: 'Discuss in chat', discussDone: 'The selection was sent to this chat.', discussFailed: 'The selection could not be sent to this chat.',
    discussPrompt: 'Compare these Sellpy items. Check current shop facts and original photos against my criteria. Save findings only for images actually examined, using the exact criteria; keep unknowns explicit.',
    scope: 'Research scope', candidates: 'Candidates observed', pages: 'Source pages', detailsCount: 'Detail observations', descriptions: 'Descriptions stored',
    modelFacts: 'Item facts delivered to model', modelDescriptions: 'Descriptions delivered to model', modelPhotos: 'Photos delivered to model',
    widgetPhotos: 'Photos delivered to gallery', assessments: 'Assessments saved', scopeUnknown: 'Not recorded', scopeRefresh: 'Refresh research scope',
    scopeHint: 'Delivered does not mean read or assessed. Native totals from different search arms can overlap.',
    query: 'Query', filters: 'Filters', nativeTotal: 'Native total', nativeWindow: 'Source window', route: 'Route', relaxed: 'Category relaxed',
    preparing: 'Preparing collection', pause: 'Pause', resume: 'Continue', prepared: 'evaluated',
    history: 'Observed changes', historyLoad: 'Load observation history', historyNext: 'More observations', historyFirst: 'First observations',
    historyHint: 'Only snapshots actually observed in this search; no price history before the first observation.', historyEmpty: 'No observations recorded.',
  },
};
type Label = keyof typeof language.de;
type PhotoState = { status: 'loading' | 'ready' | 'error'; source?: string; message?: string; retry_at?: number };
type RequestToken = { run_id: string; collection_id: string | null; generation: number; request_id: string };
type CoverJob = { token: RequestToken; item_id: string; image: ItemImage; key: string };
type HistoryRow = { sequence: number; observed_at: string; price: Money | null; availability: ItemObservation['availability']; fields: Record<string, unknown> };
type HistoryPage = { rows: HistoryRow[]; after: number; next_after: number | null };
const MAX_CARDS = 24, MAX_COMPARISON = 4, MAX_COVER_REQUESTS = 4;
const state = {
  gallery: null as GalleryData | null, generation: 0, requestSequence: 0,
  photos: new BoundedCache<string, PhotoState>(48, 12 * 1024 * 1024, value => (value.source?.length ?? 0) * 2 + 512),
  pages: new BoundedCache<string, GalleryData>(3, 4 * 1024 * 1024, value => JSON.stringify(value).length * 2),
  pending: new Set<string>(), operations: new Map<string, string>(),
  nextImage: new Map<string, number | null>(), cardMessages: new Map<string, { text: string; error: boolean }>(),
  connected: false, connectionSettled: false, busyPage: false, busyChat: false,
  selected: new Map<string, GalleryCard>(), view: 'cards' as 'cards' | 'comparison',
  pageSize: 12, currentCursor: null as string | null, legacyPrevious: null as string | null, legacyBack: new Map<string, string | null>(),
  openDetails: new Set<string>(), detailsLoaded: new Set<string>(), detailsAttempted: new Set<string>(), histories: new Map<string, HistoryPage>(),
  assessmentStatus: new Map<string, { observed_at: string; status: 'checking' | 'unknown' }>(),
  feedbackIntents: new Map<string, { sequence: number; decision: ItemFeedback['decision']; request: RequestToken }>(),
  feedbackQueues: new Map<string, Promise<void>>(), mutationSequence: 0,
  visibleCovers: new Set<string>(), queuedCovers: new Set<string>(), coverQueue: [] as CoverJob[], coverRequests: 0,
  viewerId: null as string | null, viewerPosition: 0, scopeOpen: false, scopeAttempted: false, autoPrepare: true,
  status: '', statusError: false,
};
const app = new App({ name: 'Sellpy Studio', version: '1.2.0' }, { availableDisplayModes: ['inline', 'fullscreen'] });
const root = document.getElementById('app')!;
const dialog = document.createElement('dialog');
dialog.className = 'viewer'; dialog.setAttribute('aria-labelledby', 'viewer-title'); document.body.append(dialog);
let retryTimer: ReturnType<typeof setTimeout> | undefined, prepareTimer: ReturnType<typeof setTimeout> | undefined;
let coverObserver: IntersectionObserver | undefined;

function de(): boolean { return (state.gallery?.language ?? 'de').toLowerCase().startsWith('de'); }
function t(key: Label): string { return language[de() ? 'de' : 'en'][key]; }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
}
function button(text: string, className = '', label?: string): HTMLButtonElement {
  const node = element('button', className, text); node.type = 'button';
  if (label) { node.setAttribute('aria-label', label); node.title = label; } return node;
}
function canCallTools(): boolean { return state.connected && Boolean(app.getHostCapabilities()?.serverTools); }
function cardById(id: string | null): GalleryCard | undefined { return state.gallery?.cards.find(card => card.item.id === id) ?? (id ? state.selected.get(id) : undefined); }
function photoKey(item: ItemObservation, image: ItemImage): string { return `${item.id}|${image.id}|${image.url}`; }
function collectionId(): string | null { return state.gallery?.collection?.id ?? null; }
function token(): RequestToken {
  return { run_id: state.gallery!.run_id, collection_id: collectionId(), generation: state.generation,
    request_id: `ui-${Date.now().toString(36)}-${++state.requestSequence}` };
}
function current(request: RequestToken): boolean {
  return state.gallery?.run_id === request.run_id && collectionId() === request.collection_id && state.generation === request.generation;
}
function beginOperation(key: string): RequestToken { const request = token(); state.operations.set(key, request.request_id); return request; }
function currentOperation(key: string, request: RequestToken): boolean { return current(request) && state.operations.get(key) === request.request_id; }
function pageKey(data: GalleryData, cursor = data.page?.cursor ?? null, size = data.page?.size ?? state.pageSize): string {
  return JSON.stringify([data.run_id, data.collection?.id ?? null, cursor, size]);
}
function debugBounds(): void {
  root.dataset.cachedPages = String(state.pages.size); root.dataset.cachedPhotos = String(state.photos.size);
  root.dataset.photoBytes = String(state.photos.bytes); root.dataset.coverRequests = String(state.coverRequests);
  root.dataset.generation = String(state.generation);
}
function putPhoto(key: string, value: PhotoState): void {
  if (!state.photos.set(key, value)) state.photos.set(key, { status: 'error', message: t('imageFailed') });
  // Evicted data URLs must not remain retained by offscreen DOM or viewer thumbnails.
  for (const img of document.querySelectorAll<HTMLImageElement>('img[data-photo-key][src]')) {
    if (img.dataset.photoKey && !state.photos.has(img.dataset.photoKey)) { img.removeAttribute('src'); img.hidden = true; }
  }
  debugBounds();
}
function dateText(value: string, timeOnly = false): string {
  const date = new Date(value); if (!Number.isFinite(date.valueOf())) return value;
  return new Intl.DateTimeFormat(de() ? 'de-AT' : 'en-GB', timeOnly ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
function setStatus(text: string, error = false): void {
  state.status = text; state.statusError = error; const target = document.getElementById('page-status');
  if (target) { target.textContent = text; target.className = `status${error ? ' error' : ''}`; }
}
function setHostTheme(): void {
  const context = app.getHostContext();
  if (context?.theme === 'dark' || context?.theme === 'light') document.documentElement.dataset.theme = context.theme;
  document.body.dataset.display = context?.displayMode ?? 'inline';
  const expand = document.getElementById('expand');
  if (expand instanceof HTMLButtonElement) {
    const mode = context?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
    expand.hidden = !context?.availableDisplayModes?.includes(mode); expand.textContent = t(mode === 'fullscreen' ? 'fullscreen' : 'inline');
    expand.setAttribute('aria-label', expand.textContent);
  }
}
function labelValue(label: string, value: string, className = ''): HTMLElement {
  const block = element('div', className); block.append(element('span', 'label', label), element('p', '', value)); return block;
}
function factView(fact: CardFact): HTMLElement {
  const fragment = element('div', `fact ${fact.tone ?? ''}`); fragment.dataset.fact = fact.key;
  fragment.append(element('span', 'fact-label', fact.label), element('span', fact.key === 'price' ? 'price' : 'fact-value', fact.value));
  if (fact.key === 'availability') fragment.classList.add('availability'); return fragment;
}

function photoView(item: ItemObservation, image: ItemImage | undefined, viewer = false): HTMLElement {
  const box = element('div', viewer ? 'viewer-stage' : 'photo-frame');
  if (!image) { box.append(element('span', viewer ? 'viewer-photo-status' : 'photo-state', t('noImage'))); return box; }
  const key = photoKey(item, image), img = element('img');
  img.alt = `${item.title} · ${t('photograph')} ${image.index + 1}`; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
  img.loading = viewer ? 'eager' : 'lazy'; img.dataset.photoKey = key; img.hidden = true;
  const status = element('span', viewer ? 'viewer-photo-status' : 'photo-state', t('pendingImage'));
  status.setAttribute('role', 'status'); box.dataset.photoKey = key; box.dataset.itemId = item.id; box.dataset.imageId = image.id;
  if (viewer) box.dataset.visible = 'true'; else box.dataset.cover = 'true';
  box.append(img, status);
  if (viewer) paintPhoto(box); return box;
}

function paintPhoto(box: HTMLElement): void {
  if (box.dataset.visible !== 'true') return;
  const key = box.dataset.photoKey, card = cardById(box.dataset.itemId ?? null);
  const image = card?.item.images.find(value => value.id === box.dataset.imageId);
  const img = box.querySelector('img'), status = box.querySelector<HTMLElement>('[role="status"]');
  if (!key || !card || !image || !img || !status || photoKey(card.item, image) !== key || !state.gallery) return;
  const known = state.photos.get(key), request = token();
  status.textContent = known?.message ?? (known?.status === 'loading' ? t('loadingImage') : t('pendingImage'));
  if (!known?.source) { img.hidden = true; status.hidden = false; return; }
  const source = known.source;
  status.hidden = known.status === 'ready'; img.hidden = false;
  if (img.getAttribute('src') === source) return;
  img.onload = () => {
    if (!current(request) || !box.isConnected || photoKey(card.item, image) !== key) return;
    const latest = state.photos.peek(key); if (latest?.source !== source) return;
    putPhoto(key, { ...latest, status: 'ready', source }); img.hidden = false; status.hidden = true;
  };
  img.onerror = () => {
    if (!current(request) || !box.isConnected) return;
    const latest = state.photos.peek(key); if (latest?.source !== source) return;
    putPhoto(key, { status: 'error', message: t('imageFailed'), ...(latest?.retry_at ? { retry_at: latest.retry_at } : {}) });
    img.hidden = true; status.hidden = false; status.textContent = t('imageFailed');
    if (dialog.open) renderViewerActions();
  };
  img.src = source;
}
function paintPhotoKey(key: string): void {
  for (const box of document.querySelectorAll<HTMLElement>('[data-photo-key][data-item-id]')) if (box.dataset.photoKey === key) paintPhoto(box);
}
function observeCovers(container: ParentNode = root): void {
  for (const box of container.querySelectorAll<HTMLElement>('[data-cover]')) {
    if (coverObserver) coverObserver.observe(box);
    else { box.dataset.visible = 'true'; if (box.dataset.photoKey) state.visibleCovers.add(box.dataset.photoKey); queueCover(box); }
  }
}
function installCoverObserver(): void {
  coverObserver?.disconnect(); state.visibleCovers.clear();
  if (typeof IntersectionObserver !== 'undefined') {
    coverObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const box = entry.target as HTMLElement, key = box.dataset.photoKey;
        if (!key || !box.isConnected) continue;
        box.dataset.visible = String(entry.isIntersecting);
        if (entry.isIntersecting) { state.visibleCovers.add(key); queueCover(box); }
        else state.visibleCovers.delete(key);
      }
      pumpCovers();
    }, { root: state.view === 'cards' ? document.getElementById('cards') : null, rootMargin: '0px', threshold: 0.01 });
  }
  observeCovers();
}
function queueCover(box: HTMLElement): void {
  const card = cardById(box.dataset.itemId ?? null), image = card?.item.images.find(value => value.id === box.dataset.imageId);
  if (!card || !image || !state.gallery) return;
  const key = photoKey(card.item, image), known = state.photos.get(key);
  if (known?.source || known?.status === 'error') { paintPhoto(box); return; }
  const queuedKey = `${state.generation}:${key}`;
  if (!state.queuedCovers.has(queuedKey)) {
    state.queuedCovers.add(queuedKey); state.coverQueue.push({ token: token(), item_id: card.item.id, image, key });
  }
  pumpCovers();
}
function pumpCovers(): void {
  if (!state.connectionSettled) return;
  while (state.coverRequests < MAX_COVER_REQUESTS && state.coverQueue.length) {
    const job = state.coverQueue.shift()!; state.queuedCovers.delete(`${job.token.generation}:${job.key}`);
    const card = cardById(job.item_id);
    if (!current(job.token) || !state.visibleCovers.has(job.key) || !card
      || !card.item.images.some(image => photoKey(card.item, image) === job.key) || state.photos.peek(job.key)?.source) continue;
    const pending = `${job.token.generation}:photos:${job.key}`;
    if (state.pending.has(pending)) continue;
    state.coverRequests++; debugBounds();
    const work = canCallTools() ? loadPhotos(card, job.image.index, 1, true) : loadDirectCover(job);
    void work.finally(() => { state.coverRequests--; debugBounds(); pumpCovers(); });
  }
}
async function loadDirectCover(job: CoverJob): Promise<void> {
  if (!current(job.token)) return;
  const image = new Image(); image.referrerPolicy = 'no-referrer';
  const loaded = new Promise<boolean>(resolve => { image.onload = () => resolve(true); image.onerror = () => resolve(false); });
  image.src = job.image.url;
  const ok = await loaded;
  if (!current(job.token)) return;
  putPhoto(job.key, ok ? { status: 'ready', source: job.image.url } : { status: 'error', message: t('imageFailed') }); paintPhotoKey(job.key);
}

function evidenceRow(row: CardEvidence): HTMLElement {
  const line = element('details', `evidence-row ${row.verdict}`), summary = element('summary'); line.dataset.criterion = row.key;
  summary.append(element('span', 'evidence-label', row.requirement), element('span', 'verdict', t(row.verdict === 'unknown' ? 'uncertain' : row.verdict)),
    element('span', 'evidence-text', `${row.status === 'conflicting' ? `${t('conflicting')} · ` : ''}${row.evidence}`));
  line.append(summary);
  return line;
}
function evidenceView(card: GalleryCard): HTMLElement {
  const facts = projectCardFacts(card, state.gallery?.language), section = element('section', 'card-evidence');
  const pending = state.assessmentStatus.get(card.item.id);
  if (pending?.observed_at === card.item.observed_at) {
    section.append(element('span', 'inspection unknown', t(pending.status === 'checking' ? 'assessmentChecking' : 'assessmentUnknown')));
    const load = button(t('detailLoad'), 'evidence-load'); load.disabled = !canCallTools() || pending.status === 'checking';
    load.onclick = () => { void loadDetails(card.item.id); }; section.append(load); return section;
  }
  const badge = element('span', `inspection ${facts.assessment.recorded ? 'checked' : 'unchecked'}`, facts.assessment.recorded
    ? `${t('assessed')} · ${facts.assessment.checked}/${facts.assessment.available}` : t('unassessed'));
  section.append(badge);
  if (facts.assessment.details_available) {
    const details = button(t('evidenceAvailable'), 'evidence-load'); details.disabled = !canCallTools() || state.operations.has(`details:${card.item.id}`);
    details.onclick = () => { state.openDetails.add(card.item.id); void loadDetails(card.item.id); }; section.append(details);
  }
  facts.evidence.slice(0, 2).forEach(row => section.append(evidenceRow(row)));
  const remaining = facts.evidence.slice(2), legacy = facts.legacy_evidence;
  if (remaining.length || legacy.length || (card.assessment && facts.assessment.recorded)) {
    const more = element('details', 'evidence-more'), content = element('div', 'evidence-expanded');
    more.append(element('summary', '', remaining.length + legacy.length ? `${remaining.length + legacy.length} ${t('evidenceMore')}` : t('legacyEvidence')), content);
    remaining.forEach(row => content.append(evidenceRow(row))); legacy.forEach(fact => content.append(labelValue(fact.label, fact.value, 'legacy-evidence')));
    if (card.assessment && facts.assessment.recorded) {
      content.append(element('p', 'evidence', `${t('evidenceImages')}: ${card.assessment.checked_image_ids.join(', ')}`),
        element('p', 'evidence', `${t('evidenceWhen')}: ${dateText(card.assessment.assessed_at)}`));
    }
    section.append(more);
  }
  return section;
}
function detailsView(card: GalleryCard): HTMLElement {
  const facts = projectCardFacts(card, state.gallery?.language), details = element('details', 'item-details'), body = element('div', 'details-body');
  details.dataset.detailId = card.item.id; details.open = state.openDetails.has(card.item.id);
  details.append(element('summary', '', t('details')), body);
  facts.details.forEach(fact => body.append(labelValue(fact.label, fact.value, 'detail-fact')));
  if (facts.selection_note) {
    const note = element('section', 'selection-note');
    if (facts.selection_note.reason) note.append(labelValue(t('selectionNote'), facts.selection_note.reason));
    if (facts.selection_note.cautions.length) {
      const list = element('ul', 'detail-list'); facts.selection_note.cautions.forEach(value => list.append(element('li', '', value)));
      note.append(element('span', 'label', t('cautions')), list);
    }
    body.append(note);
  }
  if (card.item.description) {
    const description = element('details', 'source-description');
    description.append(element('summary', '', t('description')), element('p', 'description-text', card.item.description)); body.append(description);
  } else if (!state.gallery?.collection || state.detailsLoaded.has(card.item.id)) body.append(element('p', 'evidence', t('noDescription')));
  else {
    const load = button(t(state.operations.has(`details:${card.item.id}`) ? 'loading' : 'detailLoad'), 'details-load');
    load.disabled = !canCallTools() || state.operations.has(`details:${card.item.id}`); load.onclick = () => { void loadDetails(card.item.id); }; body.append(load);
  }
  body.append(element('p', 'evidence observation', `${t('observed')}: ${dateText(card.item.observed_at)} · ${card.item.source} · ${card.item.market} · ${card.item.id}`), historyView(card.item.id));
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    if (details.open) { state.openDetails.add(card.item.id); if (state.gallery?.collection && !state.detailsAttempted.has(card.item.id)) void loadDetails(card.item.id); }
    else state.openDetails.delete(card.item.id);
  });
  return details;
}
function historyView(id: string): HTMLElement {
  const section = element('section', 'history'), history = state.histories.get(id);
  const busy = state.operations.has(`history:${id}`);
  if (!history) {
    const load = button(t(busy ? 'loading' : 'historyLoad'), 'history-load'); load.disabled = busy || !canCallTools();
    load.onclick = () => { void loadHistory(id); }; section.append(load); return section;
  }
  section.append(element('h4', '', t('history')), element('p', 'evidence', t('historyHint')));
  if (!history.rows.length) section.append(element('p', 'evidence', t('historyEmpty')));
  for (const row of history.rows) {
    const snapshot = element('details', 'history-snapshot'); snapshot.dataset.sequence = String(row.sequence);
    snapshot.append(element('summary', '', `${dateText(row.observed_at)} · ${formatMoney(row.price, state.gallery?.language)} · ${t(row.availability)}`));
    for (const [key, value] of Object.entries(row.fields)) if (!['sequence', 'id', 'observed_at', 'price', 'availability'].includes(key) && value !== null) {
      snapshot.append(labelValue(key, typeof value === 'string' ? value : JSON.stringify(value)));
    }
    section.append(snapshot);
  }
  const nav = element('div', 'history-nav');
  if (history.after > 0) { const first = button(t('historyFirst')); first.disabled = busy; first.onclick = () => { void loadHistory(id); }; nav.append(first); }
  if (history.next_after !== null) { const next = button(t('historyNext')); next.disabled = busy; next.onclick = () => { void loadHistory(id, history.next_after!); }; nav.append(next); }
  section.append(nav); return section;
}
function itemLink(item: ItemObservation, className: string, label: string): HTMLElement {
  const url = safeItemUrl(item.url); if (!url) return element('span', 'evidence', t('unavailableLink'));
  const link = element('a', className, label); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.addEventListener('click', event => {
    if (!state.connected || !app.getHostCapabilities()?.openLinks) return;
    event.preventDefault(); const request = token();
    void app.openLink({ url }).then(result => { if (result.isError && current(request)) setStatus(t('linkFailed'), true); })
      .catch(() => { if (current(request)) setStatus(t('linkFailed'), true); });
  }); return link;
}
function selectionControls(card: GalleryCard): HTMLElement {
  const controls = element('div', 'selection-controls'), pendingIntent = state.feedbackIntents.get(`${state.gallery?.run_id}:${card.item.id}`);
  const intent = pendingIntent && current(pendingIntent.request) ? pendingIntent : undefined;
  const decision = intent?.decision ?? card.feedback?.decision ?? 'neutral';
  const shortlist = button(t(decision === 'shortlist' ? 'shortlisted' : 'shortlist'), 'shortlist-button');
  shortlist.dataset.action = 'shortlist'; shortlist.setAttribute('aria-pressed', String(decision === 'shortlist')); shortlist.disabled = !canCallTools();
  shortlist.onclick = () => { setFeedback(card.item.id, decision === 'shortlist' ? 'neutral' : 'shortlist'); };
  const reject = button(t('reject'), 'reject-button'); reject.dataset.action = 'reject';
  reject.setAttribute('aria-pressed', String(decision === 'reject')); reject.disabled = !canCallTools();
  reject.onclick = () => { setFeedback(card.item.id, decision === 'reject' ? 'neutral' : 'reject'); };
  const label = element('label', 'compare-toggle'), input = element('input'); input.type = 'checkbox'; input.dataset.action = 'compare';
  input.checked = state.selected.has(card.item.id); input.setAttribute('aria-label', `${t('compare')}: ${card.item.title}`);
  input.onchange = () => {
    if (input.checked && !state.selected.has(card.item.id) && state.selected.size >= MAX_COMPARISON) { input.checked = false; setStatus(t('compareLimit'), true); return; }
    if (input.checked) state.selected.set(card.item.id, card); else state.selected.delete(card.item.id);
    renderSelectionBar();
  };
  label.append(input, element('span', '', t('compare'))); controls.append(shortlist, reject, label);
  controls.setAttribute('aria-busy', String(Boolean(intent))); return controls;
}
function cardView(card: GalleryCard, rank: number): HTMLElement {
  const item = card.item, facts = projectCardFacts(card, state.gallery?.language), article = element('article', 'card');
  article.dataset.itemId = item.id; article.dataset.decision = card.feedback?.decision ?? 'neutral';
  const cover = button('', 'photo-open', `${item.title} · ${item.images.length} ${t('photographs')}`);
  cover.dataset.itemId = item.id; cover.dataset.action = 'photo';
  cover.append(photoView(item, item.images[0]), element('span', 'rank', `#${rank}`));
  if (facts.assessment.available) cover.append(element('span', 'photo-count', `${facts.assessment.available} ${t('photographs')}`));
  cover.onclick = () => openViewer(item.id); article.append(cover);
  const body = element('div', 'body'); body.append(element('h3', '', facts.title));
  const fragments = element('div', 'facts'); facts.summary.forEach(fact => fragments.append(factView(fact)));
  body.append(fragments, evidenceView(card), selectionControls(card), detailsView(card));
  const message = state.cardMessages.get(item.id); if (message) body.append(element('p', message.error ? 'status error' : 'status', message.text));
  const actions = element('div', 'actions'), refresh = button('↻', 'refresh', t('refresh'));
  refresh.dataset.action = 'refresh'; refresh.disabled = !canCallTools() || state.operations.has(`refresh:${item.id}`);
  refresh.onclick = () => { void refreshItem(item.id); }; actions.append(itemLink(item, 'item-link', t('open')), refresh);
  body.append(actions); article.append(body); return article;
}

function comparisonHeader(card: GalleryCard): HTMLElement {
  const header = element('th', 'compare-item'); header.scope = 'col'; header.dataset.comparisonItemId = card.item.id;
  const photo = button('', 'photo-open', `${card.item.title} · ${card.item.images.length} ${t('photographs')}`);
  photo.dataset.itemId = card.item.id; photo.dataset.action = 'photo'; photo.append(photoView(card.item, card.item.images[0])); photo.onclick = () => openViewer(card.item.id);
  const remove = button(t('compareRemove'), 'compare-remove'); remove.onclick = () => { state.selected.delete(card.item.id); if (state.selected.size < 2) state.view = 'cards'; render(); };
  header.append(photo, element('h3', '', projectCardFacts(card, state.gallery?.language).title), itemLink(card.item, 'comparison-link', t('open')), remove); return header;
}
function comparisonView(): HTMLElement {
  const cards = [...state.selected.values()].slice(0, MAX_COMPARISON), section = element('section', 'comparison');
  section.append(element('p', 'comparison-hint', t('comparisonHint')));
  const subtotal = priceSubtotal(cards), amount = subtotal.amounts.map(value => formatMoney(value, state.gallery?.language)).join(' + ');
  section.append(element('p', 'subtotal', `${t('subtotal')}: ${amount || '—'}${subtotal.missing_items ? ` · ${subtotal.missing_items} ${t('missingPrices')}` : ''}${subtotal.mixed_currencies ? ` · ${t('mixedCurrencies')}` : ''}`));
  const scroll = element('div', 'comparison-scroll'), table = element('table', 'comparison-table');
  scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', `${t('comparing')} · ${cards.length} ${t('items')}`);
  const head = element('thead'), headings = element('tr'), first = element('th', 'comparison-label', t('compareAttribute')); first.scope = 'col';
  headings.append(first, ...cards.map(comparisonHeader)); head.append(headings);
  const body = element('tbody');
  const unknownAssessments = new Set(cards.filter(card => state.assessmentStatus.get(card.item.id)?.observed_at === card.item.observed_at).map(card => card.item.id));
  for (const row of comparisonRows(cards, state.gallery?.language ?? 'de', unknownAssessments)) {
    const line = element('tr'), label = element('th', 'comparison-label', row.label); label.scope = 'row'; line.append(label);
    row.cells.forEach(value => line.append(element('td', value.tone ?? '', value.text))); body.append(line);
  }
  table.append(head, body); scroll.append(table); section.append(scroll); return section;
}
function renderSelectionBar(): void {
  const target = document.getElementById('selection-bar'); if (!target) return;
  const count = state.selected.size, compare = button(state.view === 'comparison' ? t('backToCards') : `${t('compare')} (${count})`, 'compare-button');
  compare.disabled = state.view !== 'comparison' && count < 2;
  compare.onclick = () => { state.view = state.view === 'comparison' ? 'cards' : 'comparison'; render(); document.querySelector<HTMLButtonElement>('.compare-button')?.focus(); };
  const clear = button(t('clearSelection'), 'clear-selection'); clear.disabled = !count; clear.onclick = () => { state.selected.clear(); state.view = 'cards'; render(); };
  target.replaceChildren(element('span', 'selection-count', `${count}/${MAX_COMPARISON} ${t('selected')}`), compare, clear);
  if (app.getHostCapabilities()?.message?.text) {
    const discuss = button(t(state.busyChat ? 'loading' : 'discuss'), 'discuss-selection'); discuss.disabled = !state.connected || state.busyChat || !count;
    discuss.onclick = () => { void discussSelection(); }; target.append(discuss);
  }
}
function renderAffectedItem(id: string): void {
  const card = cardById(id); if (!card || !state.gallery) return;
  if (state.view === 'comparison' && state.selected.has(id)) { render(); return; }
  const existing = [...root.querySelectorAll<HTMLElement>('.card')].find(node => node.dataset.itemId === id); if (!existing) return;
  const focused = existing.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.action : undefined;
  for (const box of existing.querySelectorAll('[data-cover]')) coverObserver?.unobserve(box);
  const replacement = cardView(card, (state.gallery.page?.start ?? 1) + state.gallery.cards.findIndex(value => value.item.id === id)); existing.replaceWith(replacement);
  observeCovers(replacement); if (focused) [...replacement.querySelectorAll<HTMLElement>('[data-action]')].find(node => node.dataset.action === focused)?.focus();
}

function scopeView(scope: CollectionScope | undefined): HTMLElement {
  const section = element('details', 'scope'); section.open = state.scopeOpen;
  section.append(element('summary', '', scope ? `${t('scope')} · ${scope.candidates} ${t('candidates')} · ${scope.recorded_assessments} ${t('assessments')}` : t('scope')));
  const body = element('div', 'scope-body'); section.append(body);
  if (scope) {
    const counters = element('dl', 'scope-counters');
    const entries: [Label, number | null][] = [['pages', scope.search_pages], ['detailsCount', scope.detail_observations], ['descriptions', scope.stored_descriptions],
      ['modelFacts', scope.model_delivered_fact_items], ['modelDescriptions', scope.model_delivered_description_items], ['modelPhotos', scope.model_delivered_photos],
      ['widgetPhotos', scope.widget_delivered_photos], ['assessments', scope.recorded_assessments]];
    for (const [label, value] of entries) counters.append(element('dt', '', t(label)), element('dd', '', value === null || value === undefined ? t('scopeUnknown') : String(value)));
    body.append(counters, element('p', 'evidence', t('scopeHint')));
    for (const arm of scope.arms) {
      const block = element('section', 'scope-arm'); block.append(element('h4', '', `${arm.arm_id} · ${arm.route}`));
      if (arm.query !== null) block.append(labelValue(t('query'), arm.query));
      block.append(labelValue(t('filters'), Object.keys(arm.filters).length ? JSON.stringify(arm.filters) : '—'),
        element('p', 'evidence', `${t('pages')}: ${arm.pages} · ${t('nativeTotal')}: ${arm.native_total ?? t('scopeUnknown')} · ${t('nativeWindow')}: ${arm.native_window ?? t('scopeUnknown')} · ${arm.status}`));
      if (arm.candidates !== null) block.append(element('p', 'evidence', `${t('candidates')}: ${arm.candidates}`));
      if (arm.category_relaxed) block.append(element('p', 'evidence', t('relaxed')));
      if (arm.observed_at) block.append(element('p', 'evidence', `${t('observed')}: ${dateText(arm.observed_at)}`)); body.append(block);
    }
    scope.notes.forEach(note => body.append(element('p', 'evidence', note)));
    body.append(element('p', 'evidence', `${t('observed')}: ${dateText(scope.observed_at)}`));
  }
  const refresh = button(t('scopeRefresh'), 'scope-refresh'); refresh.disabled = !canCallTools() || state.operations.has('scope');
  refresh.onclick = () => { void loadScope(); }; body.append(refresh);
  section.addEventListener('toggle', () => { if (!section.isConnected) return; state.scopeOpen = section.open; if (section.open && !scope && !state.scopeAttempted) void loadScope(); });
  return section;
}
function render(): void {
  const data = state.gallery; if (!data) return;
  const scroll = document.getElementById('cards')?.scrollTop ?? 0; document.documentElement.lang = de() ? 'de' : 'en';
  const shell = element('section', 'shell'), header = element('header', 'heading'), heading = element('div');
  const range = data.page ? `${data.page.start}–${data.page.end} / ${data.collection?.total ?? '…'}` : String(data.cards.length);
  const subhead = element('p', 'subhead', `${range} ${t('items')}`); subhead.id = 'page-range';
  heading.append(element('p', 'eyebrow', t('eyebrow')), element('h2', '', data.title || t('title')), subhead);
  if (data.collection) heading.append(element('p', 'snapshot-time', `${t('membership')}: ${dateText(data.collection.membership_as_of)}`));
  const expand = button(t('fullscreen'), 'expand'); expand.id = 'expand'; expand.hidden = true;
  expand.onclick = () => {
    const mode = app.getHostContext()?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
    if (!app.getHostContext()?.availableDisplayModes?.includes(mode)) return;
    const request = token(); void app.requestDisplayMode({ mode }).then(result => { if (current(request)) { document.body.dataset.display = result.mode; setHostTheme(); } })
      .catch(() => { if (current(request)) setStatus(t('toolFailed'), true); });
  };
  header.append(heading, expand); shell.append(header);
  if (data.collection) {
    const toolbar = element('div', 'toolbar'), viewing = element('label', 'sorting', t('view')), view = element('select');
    view.id = 'collection-view'; view.setAttribute('aria-label', t('view'));
    const options: [CollectionView['kind'], Label][] = [['source_order', 'sourceOrder'], ['shortlist', 'shortlistView'], ['available', 'availableView'],
      ['assessed', 'assessedView'], ['unassessed', 'unassessedView'], ['price_asc', 'priceAsc'], ['price_desc', 'priceDesc']];
    for (const [value, label] of options) { const option = element('option', '', t(label)); option.value = value; view.append(option); }
    view.value = data.collection.source.view ?? (data.collection.source.kind === 'shortlist' ? 'shortlist' : 'source_order');
    view.disabled = !canCallTools() || state.busyPage;
    view.onchange = () => { void navigatePage(null, state.pageSize, { kind: view.value as CollectionView['kind'] }); }; viewing.append(view);
    const sizing = element('label', 'sorting', t('pageSize')), size = element('select'); size.id = 'page-size'; size.setAttribute('aria-label', t('pageSize'));
    for (const value of [12, 24]) { const option = element('option', '', String(value)); option.value = String(value); size.append(option); }
    size.value = String(state.pageSize); size.disabled = !canCallTools() || state.busyPage;
    size.onchange = () => { void navigatePage(data.page?.cursor ?? null, Number(size.value)); }; sizing.append(size); toolbar.append(viewing, sizing);
    toolbar.hidden = state.view === 'comparison'; shell.append(toolbar, scopeView(data.scope));
  }
  const selection = element('div', 'selection-bar'); selection.id = 'selection-bar'; selection.setAttribute('aria-label', t('comparing'));
  const status = element('p', `status${state.statusError ? ' error' : ''}`, state.status); status.id = 'page-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  shell.append(selection, status);
  if (data.collection?.status === 'preparing') {
    const preparation = element('div', 'preparation'), progress = data.collection.progress;
    preparation.append(element('p', '', t('preparing')), element('p', 'evidence', progress ? `${progress.scanned} / ${progress.cohort} ${t('prepared')}` : t('loading')));
    const pause = button(t(state.autoPrepare ? 'pause' : 'resume')); pause.id = 'prepare-control';
    pause.onclick = () => { state.autoPrepare = !state.autoPrepare; clearTimeout(prepareTimer); if (state.autoPrepare) schedulePreparation(); render(); }; preparation.append(pause); shell.append(preparation);
  } else if (state.view === 'comparison') shell.append(comparisonView());
  else {
    const cards = element('div', 'cards'); cards.id = 'cards'; cards.setAttribute('aria-label', data.title || t('title')); cards.tabIndex = 0;
    data.cards.forEach((card, index) => cards.append(cardView(card, (data.page?.start ?? 1) + index)));
    if (!data.cards.length) cards.append(element('p', 'empty', t('noCards'))); shell.append(cards);
  }
  if (data.warnings.length) {
    const notes = element('details', 'notice'), list = element('ul'); notes.append(element('summary', '', t('warnings')), list);
    [...new Set(data.warnings)].forEach(warning => list.append(element('li', '', warning))); shell.append(notes);
  }
  const footer = element('footer', 'footer'), nav = element('nav', 'page-navigation'); nav.setAttribute('aria-label', de() ? 'Seiten' : 'Pages');
  const previous = button(`‹ ${t('previous')}`, 'page-previous'), next = button(`${t('next')} ›`, 'page-next'); previous.id = 'previous-page'; next.id = 'next-page';
  const previousCursor = data.page?.previous_cursor ?? state.legacyPrevious, nextCursor = data.page?.next_cursor ?? data.next_cursor;
  previous.disabled = state.busyPage || !canCallTools() || previousCursor === null; next.disabled = state.busyPage || !canCallTools() || !nextCursor;
  previous.onclick = () => { if (previousCursor !== null) void navigatePage(previousCursor); }; next.onclick = () => { if (nextCursor) void navigatePage(nextCursor); };
  nav.append(previous, next); footer.append(nav, element('p', 'footnote', t('footer'))); shell.append(footer);
  root.replaceChildren(shell); root.setAttribute('aria-busy', String(state.busyPage));
  const cards = document.getElementById('cards'); if (cards) cards.scrollTop = scroll;
  renderSelectionBar(); setHostTheme(); installCoverObserver(); debugBounds();
}

function acceptGallery(result: unknown, requestedCursor: string | null = null, pageSize?: number, cached = false): boolean {
  const next = galleryFromResult(result); if (!next || next.cards.length > MAX_CARDS) return false;
  const previous = state.gallery, sameRun = previous?.run_id === next.run_id;
  // Check the raw delivery before merging: an old page can lose the fact merge and
  // must not then clear an unresolved assessment for the newer retained observation.
  const authoritativeAssessments = new Set(next.cards.filter(card => {
    const pending = state.assessmentStatus.get(card.item.id);
    return !cached && sameRun && pending && Date.parse(card.item.observed_at) >= Date.parse(pending.observed_at)
      && !card.summary?.omitted_fields.includes('assessment') && (card.assessment !== null || !card.summary?.assessment_recorded);
  }).map(card => card.item.id));
  const existing = new Map<string, GalleryCard>();
  if (sameRun) {
    for (const page of state.pages.values()) for (const card of page.cards) existing.set(card.item.id, mergeAppendedCard(existing.get(card.item.id), card));
    for (const card of previous?.cards ?? []) existing.set(card.item.id, mergeAppendedCard(existing.get(card.item.id), card));
    for (const card of state.selected.values()) existing.set(card.item.id, mergeAppendedCard(existing.get(card.item.id), card));
    next.cards = next.cards.map(card => mergeAppendedCard(existing.get(card.item.id), card));
  }
  clearTimeout(prepareTimer); state.generation++; state.busyPage = false; state.busyChat = false;
  state.pending.clear(); state.operations.clear(); state.cardMessages.clear(); state.openDetails.clear(); state.detailsLoaded.clear(); state.detailsAttempted.clear(); state.histories.clear();
  state.scopeAttempted = false;
  state.coverQueue = []; state.queuedCovers.clear(); state.visibleCovers.clear(); state.nextImage.clear();
  if (!sameRun) { state.photos.clear(); state.pages.clear(); state.legacyBack.clear(); state.selected.clear(); state.assessmentStatus.clear(); state.scopeOpen = false; }
  if (dialog.open) dialog.close(); state.viewerId = null; state.view = 'cards';
  for (const card of next.cards) if (state.selected.has(card.item.id)) state.selected.set(card.item.id, card);
  const hydration = hydrationFromResult(result, next.cards);
  for (const card of next.cards) for (const image of card.item.images) {
    const source = hydration.get(image.id); if (source) putPhoto(photoKey(card.item, image), { status: 'ready', source });
  }
  const previousLegacyCursor = state.currentCursor;
  state.currentCursor = next.page?.cursor ?? requestedCursor; state.pageSize = pageSize ?? (next.page?.size === 24 ? 24 : 12);
  const cacheKey = pageKey(next, state.currentCursor, state.pageSize);
  state.legacyPrevious = !next.collection && state.legacyBack.has(cacheKey) ? state.legacyBack.get(cacheKey)!
    : !next.collection && sameRun && requestedCursor ? previousLegacyCursor ?? '' : null;
  state.gallery = next; state.pages.set(cacheKey, next);
  for (const id of authoritativeAssessments) state.assessmentStatus.delete(id);
  const retainedIds = new Set([...state.pages.values()].flatMap(page => page.cards.map(card => card.item.id)).concat([...state.selected.keys()]));
  for (const [id, pending] of state.assessmentStatus) {
    if (!retainedIds.has(id)) state.assessmentStatus.delete(id); else if (pending.status === 'checking') pending.status = 'unknown';
  }
  if (!next.collection) state.legacyBack.set(cacheKey, state.legacyPrevious);
  for (const key of state.legacyBack.keys()) if (!state.pages.has(key)) state.legacyBack.delete(key);
  state.status = ''; state.statusError = false;
  render(); const cards = document.getElementById('cards'); if (cards) cards.scrollTop = 0; schedulePreparation(); return true;
}
function schedulePreparation(): void {
  clearTimeout(prepareTimer);
  const data = state.gallery;
  if (!state.autoPrepare || data?.collection?.status !== 'preparing' || !canCallTools() || state.busyPage) return;
  const request = token(); prepareTimer = setTimeout(() => { if (current(request) && state.autoPrepare) void navigatePage(data.page?.next_cursor ?? data.page?.cursor ?? null); }, 100);
}
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!canCallTools()) throw new Error(t('notConnected')); return app.callServerTool({ name, arguments: args }, { timeout: 60000 });
}
async function navigatePage(cursor: string | null, pageSize = state.pageSize, view?: CollectionView): Promise<void> {
  const data = state.gallery; if (!data || state.busyPage) return;
  const request = beginOperation('page'), cacheCursor = !data.collection && cursor === '' ? null : cursor;
  const cached = !view && data.collection?.status !== 'preparing' ? state.pages.get(pageKey(data, cacheCursor, pageSize)) : undefined;
  if (cached && (!cached.collection || cached.collection.status === 'ready')) { acceptGallery({ _meta: { gallery: cached } }, cacheCursor, pageSize, true); return; }
  state.busyPage = true; if (view) state.autoPrepare = true; render();
  try {
    const result = data.collection
      ? await callTool('browse_collection', { run_id: data.run_id, collection_id: data.collection.id, ...(cursor ? { cursor } : {}),
        page_size: pageSize, action: view ? 'derive' : 'page', ...(view ? { view } : {}), request_id: request.request_id })
      : await callTool('present_items', { run_id: data.run_id, for_model: false, ...(cursor ? { cursor } : {}), ...(cursor ? {} : { selection: data.cards.map(card => ({ item_id: card.item.id, reason: card.reason, cautions: card.cautions })) }) });
    if (!currentOperation('page', request)) return;
    const next = galleryFromResult(result);
    if (record(result)?.isError || !next || next.run_id !== request.run_id
      || (data.collection && (next.request_id !== request.request_id || (!view && next.collection?.id !== data.collection.id)))) {
      throw new Error(errorMessage(record(result)?.structuredContent, t('invalidResult')));
    }
    if (!acceptGallery(result, cursor, pageSize)) throw new Error(t('invalidResult'));
  } catch (error) {
    if (currentOperation('page', request)) { state.autoPrepare = false; setStatus(error instanceof Error ? error.message : t('toolFailed'), true); }
  } finally {
    if (currentOperation('page', request)) { state.operations.delete('page'); state.busyPage = false; render(); }
  }
}
function replaceCard(id: string, incoming: GalleryCard, complete = false): void {
  const currentCard = cardById(id); if (!currentCard || !state.gallery) return;
  const merged = mergeAppendedCard(currentCard, incoming);
  if (complete && Date.parse(incoming.item.observed_at) >= Date.parse(currentCard.item.observed_at)) {
    merged.item = incoming.item; merged.assessment = incoming.assessment; delete merged.summary;
  }
  state.gallery.cards = state.gallery.cards.map(card => card.item.id === id ? merged : card);
  if (state.selected.has(id)) state.selected.set(id, merged);
  for (const key of [...state.pages.keys()]) {
    const page = state.pages.peek(key); if (!page) continue;
    page.cards = page.cards.map(card => card.item.id === id
      ? complete && Date.parse(merged.item.observed_at) >= Date.parse(card.item.observed_at) ? merged : mergeAppendedCard(card, merged) : card);
    state.pages.set(key, page); // Re-account explicit full descriptions against the byte budget.
  }
  debugBounds();
}
async function loadDetails(id: string): Promise<boolean> {
  const data = state.gallery, key = `details:${id}`;
  if (!data?.collection || state.operations.has(key) || !canCallTools()) return false;
  if (state.detailsLoaded.has(id) && !state.assessmentStatus.has(id)) return true;
  const pendingAssessment = state.assessmentStatus.get(id); if (pendingAssessment) pendingAssessment.status = 'checking';
  const request = beginOperation(key); state.detailsAttempted.add(id); renderAffectedItem(id);
  try {
    const result = await callTool('browse_collection', { run_id: data.run_id, collection_id: data.collection.id, action: 'details', item_id: id, request_id: request.request_id });
    if (!currentOperation(key, request)) return false;
    const detail = detailFromResult(result);
    if (!detail || detail.run_id !== request.run_id || detail.collection_id !== request.collection_id || detail.request_id !== request.request_id || detail.card.item.id !== id
      || Date.parse(detail.card.item.observed_at) < Date.parse(cardById(id)?.item.observed_at ?? '')) throw new Error(t('invalidResult'));
    replaceCard(id, detail.card, true); state.detailsLoaded.add(id); state.assessmentStatus.delete(id);
    if (state.cardMessages.get(id)?.error) state.cardMessages.delete(id);
    return true;
  } catch (error) {
    if (currentOperation(key, request)) {
      state.cardMessages.set(id, { text: error instanceof Error ? error.message : t('toolFailed'), error: true });
      if (pendingAssessment) pendingAssessment.status = 'unknown';
    }
    return false;
  }
  finally { if (currentOperation(key, request)) { state.operations.delete(key); renderAffectedItem(id); } }
}
async function refreshItem(id: string, silent = false): Promise<void> {
  const data = state.gallery, key = `refresh:${id}`; if (!data || state.operations.has(key)) return;
  const request = beginOperation(key); renderAffectedItem(id);
  try {
    const result = await callTool('get_items', { run_id: data.run_id, ids: [id], for_model: false });
    if (!currentOperation(key, request)) return;
    const output = record(record(result)?.structuredContent), items = Array.isArray(output?.items) ? output.items : [];
    const refreshed = items.map(parseItem).find(item => item?.id === id), card = cardById(id);
    if (!refreshed || !card || record(result)?.isError || (output?.run_id && output.run_id !== data.run_id)
      || Date.parse(refreshed.observed_at) < Date.parse(card.item.observed_at)) throw new Error(t('refreshFailed'));
    const needsStoredAssessment = card.summary?.assessment_recorded && !card.assessment;
    if (needsStoredAssessment) state.assessmentStatus.set(id, { observed_at: refreshed.observed_at, status: 'checking' });
    replaceCard(id, { ...card, item: refreshed, assessment: assessmentStillApplies(card, refreshed) ? card.assessment : null }, true);
    let assessmentKnown = true;
    if (needsStoredAssessment && data.collection) {
      state.operations.delete(`details:${id}`); state.detailsLoaded.delete(id); assessmentKnown = await loadDetails(id);
    } else state.detailsLoaded.add(id);
    if (!currentOperation(key, request)) return;
    if (!assessmentKnown) state.cardMessages.set(id, { text: t('refreshAssessmentUnknown'), error: true });
    else if (!silent) state.cardMessages.set(id, { text: t('refreshed'), error: false });
    if (state.viewerId === id) state.viewerPosition = Math.min(state.viewerPosition, Math.max(0, refreshed.images.length - 1));
  } catch { if (currentOperation(key, request) && !silent) state.cardMessages.set(id, { text: t('refreshFailed'), error: true }); }
  finally { if (currentOperation(key, request)) { state.operations.delete(key); renderAffectedItem(id); if (dialog.open) renderViewer(); } }
}
function setFeedback(id: string, decision: ItemFeedback['decision']): void {
  const data = state.gallery; if (!data || !cardById(id)) return;
  const request = token(), queueKey = `${data.run_id}:${id}`, sequence = ++state.mutationSequence;
  state.feedbackIntents.set(queueKey, { sequence, decision, request }); renderAffectedItem(id);
  const previous = state.feedbackQueues.get(queueKey) ?? Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    try {
      const result = await callTool('set_item_feedback', { run_id: request.run_id, item_id: id, decision });
      if (!current(request) || state.feedbackIntents.get(queueKey)?.sequence !== sequence) return;
      const feedback = feedbackFromResult(result, request.run_id, id), card = cardById(id);
      if (!feedback || !card || feedback.decision !== decision) throw new Error(t('feedbackFailed'));
      replaceCard(id, { ...card, feedback }); state.cardMessages.set(id, { text: t('feedbackSaved'), error: false });
    } catch { if (current(request) && state.feedbackIntents.get(queueKey)?.sequence === sequence) state.cardMessages.set(id, { text: t('feedbackFailed'), error: true }); }
    finally {
      if (state.feedbackIntents.get(queueKey)?.sequence === sequence) state.feedbackIntents.delete(queueKey);
      if (current(request)) { renderAffectedItem(id); renderSelectionBar(); }
    }
  });
  state.feedbackQueues.set(queueKey, work);
  void work.finally(() => { if (state.feedbackQueues.get(queueKey) === work) state.feedbackQueues.delete(queueKey); });
}
async function loadScope(): Promise<void> {
  const data = state.gallery; if (!data?.collection || state.operations.has('scope')) return;
  const request = beginOperation('scope'); state.scopeAttempted = true;
  try {
    const result = await callTool('browse_collection', { run_id: data.run_id, collection_id: data.collection.id, action: 'coverage', request_id: request.request_id });
    if (!currentOperation('scope', request)) return;
    const body = record(record(record(result)?._meta)?.collection_scope), scope = parseScope(body?.scope);
    if (record(result)?.isError || !body || body.run_id !== request.run_id || body.collection_id !== request.collection_id || body.request_id !== request.request_id || !scope) throw new Error(t('invalidResult'));
    state.gallery!.scope = scope;
  } catch (error) { if (currentOperation('scope', request)) setStatus(error instanceof Error ? error.message : t('toolFailed'), true); }
  finally { if (currentOperation('scope', request)) { state.operations.delete('scope'); render(); } }
}
async function loadHistory(id: string, after = 0): Promise<void> {
  const data = state.gallery, key = `history:${id}`; if (!data || state.operations.has(key)) return;
  const request = beginOperation(key); renderAffectedItem(id);
  try {
    const result = await callTool('get_item_history', { run_id: data.run_id, item_id: id, after, page_size: 12, for_model: false });
    if (!currentOperation(key, request)) return;
    const body = record(record(result)?.structuredContent);
    if (record(result)?.isError || body?.run_id !== request.run_id || body.item_id !== id || !Array.isArray(body.observations)) throw new Error(t('invalidResult'));
    const rows: HistoryRow[] = [];
    for (const value of body.observations.slice(0, 12)) {
      const row = record(value), price = record(row?.price);
      if (!row || row.id !== id || !Number.isSafeInteger(row.sequence) || typeof row.observed_at !== 'string') continue;
      rows.push({ sequence: row.sequence as number, observed_at: row.observed_at,
        price: price && Number.isSafeInteger(price.amount_minor) && (price.amount_minor as number) >= 0 && typeof price.currency === 'string' && /^[A-Z]{3}$/.test(price.currency)
          ? { amount_minor: price.amount_minor as number, currency: price.currency } : null,
        availability: ['available', 'reserved', 'sold'].includes(String(row.availability)) ? row.availability as ItemObservation['availability'] : 'unknown', fields: row });
    }
    state.histories.set(id, { rows, after, next_after: Number.isSafeInteger(body.next_after) && (body.next_after as number) > after ? body.next_after as number : null });
  } catch (error) { if (currentOperation(key, request)) state.cardMessages.set(id, { text: error instanceof Error ? error.message : t('toolFailed'), error: true }); }
  finally { if (currentOperation(key, request)) { state.operations.delete(key); renderAffectedItem(id); } }
}
async function discussSelection(): Promise<void> {
  const data = state.gallery, capabilities = app.getHostCapabilities(); if (!data || !state.connected || !capabilities?.message?.text || state.busyChat || !state.selected.size) return;
  const request = token(), cards = [...state.selected.values()].slice(0, MAX_COMPARISON);
  const context = { run_id: data.run_id, collection_id: data.collection?.id, item_ids: cards.map(card => card.item.id),
    decisions: cards.flatMap(card => card.feedback ? [{ item_id: card.item.id, decision: card.feedback.decision }] : []) };
  state.busyChat = true; renderSelectionBar();
  try {
    if (capabilities.updateModelContext?.structuredContent || capabilities.updateModelContext?.text) {
      try { await app.updateModelContext(capabilities.updateModelContext.structuredContent ? { structuredContent: context }
        : { content: [{ type: 'text', text: JSON.stringify(context) }] }); } catch { /* The explicit message carries the same identities. */ }
    }
    if (!current(request)) return;
    const response = await app.sendMessage({ role: 'user', content: [{ type: 'text', text: `${t('discussPrompt')}\n${JSON.stringify(context)}` }] });
    if (!current(request)) return; if (response.isError) throw new Error(t('discussFailed')); setStatus(t('discussDone'));
  } catch { if (current(request)) setStatus(t('discussFailed'), true); }
  finally { if (current(request)) { state.busyChat = false; renderSelectionBar(); } }
}

function openViewer(id: string): void {
  const card = cardById(id); if (!card) return;
  state.viewerId = id; state.viewerPosition = 0; renderViewer(); if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('.close-viewer')?.focus(); ensureCurrentPhoto();
  if (card.summary?.omitted_fields.includes('item.images') && state.gallery?.collection && canCallTools()) {
    const request = token(); void loadDetails(id).then(() => { if (current(request) && state.viewerId === id && dialog.open) { renderViewer(); ensureCurrentPhoto(); } });
  }
  if (card.item.source === 'catalog' && canCallTools()) {
    const request = token(); void refreshItem(id, true).then(() => { if (current(request) && state.viewerId === id && dialog.open) { renderViewer(); ensureCurrentPhoto(); } });
  }
}
function changePhoto(delta: number): void {
  const card = cardById(state.viewerId); if (!card) return;
  state.viewerPosition = Math.max(0, Math.min(state.viewerPosition + delta, card.item.images.length - 1)); renderViewer(); ensureCurrentPhoto();
}
function ensureCurrentPhoto(): void {
  const card = cardById(state.viewerId), image = card?.item.images[state.viewerPosition]; if (!card || !image) return;
  const photo = state.photos.get(photoKey(card.item, image));
  if (photo?.source || (photo?.retry_at && photo.retry_at > Date.now())) return;
  if (canCallTools()) void loadPhotos(card, image.index);
  else { putPhoto(photoKey(card.item, image), { status: 'loading', source: image.url }); paintPhotoKey(photoKey(card.item, image)); }
}
function renderViewer(): void {
  const card = cardById(state.viewerId); if (!card) { if (dialog.open) dialog.close(); return; }
  const image = card.item.images[state.viewerPosition], inner = element('div', 'viewer-inner'), header = element('div', 'viewer-head');
  const title = element('p', 'viewer-title', card.item.title); title.id = 'viewer-title';
  const close = button('×', 'icon-button close-viewer', t('close')); close.onclick = () => dialog.close(); header.append(title, close);
  const controls = element('div', 'viewer-controls'), previous = button('‹', 'icon-button previous-photo', t('previousPhoto')), next = button('›', 'icon-button next-photo', t('nextPhoto'));
  previous.disabled = state.viewerPosition <= 0; next.disabled = state.viewerPosition >= card.item.images.length - 1;
  previous.onclick = () => changePhoto(-1); next.onclick = () => changePhoto(1);
  controls.append(previous, element('span', 'photo-position', `${card.item.images.length ? state.viewerPosition + 1 : 0} ${t('photoCount')} ${card.item.images.length}`), next);
  const thumbnails = element('div', 'thumbnails'); thumbnails.setAttribute('aria-label', t('photographs'));
  const first = Math.max(0, Math.min(state.viewerPosition - 8, card.item.images.length - 24));
  card.item.images.slice(first, first + 24).forEach((photo, offset) => {
    const position = first + offset, thumbnail = button('', 'thumbnail', `${t('photograph')} ${position + 1}`); thumbnail.setAttribute('aria-current', String(position === state.viewerPosition));
    const known = state.photos.get(photoKey(card.item, photo));
    if (known?.status === 'ready' && known.source?.startsWith('data:')) {
      const img = element('img'); img.src = known.source; img.alt = ''; img.loading = 'lazy'; img.dataset.photoKey = photoKey(card.item, photo); thumbnail.append(img);
    } else thumbnail.append(element('span', 'thumbnail-index', String(position + 1)));
    thumbnail.onclick = () => { state.viewerPosition = position; renderViewer(); ensureCurrentPhoto(); }; thumbnails.append(thumbnail);
  });
  const status = element('p', 'viewer-status'); status.id = 'viewer-status'; status.setAttribute('aria-live', 'polite');
  const actions = element('div', 'viewer-actions'); actions.id = 'viewer-actions';
  inner.append(header, photoView(card.item, image, true), controls, thumbnails, status, actions, element('p', 'evidence', t('galleryHint')));
  const focused = dialog.contains(document.activeElement) ? document.activeElement?.getAttribute('aria-label') : null;
  dialog.replaceChildren(inner); paintPhotoKey(image ? photoKey(card.item, image) : ''); renderViewerActions();
  if (focused) [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === focused && !node.disabled)?.focus();
}
function renderViewerActions(): void {
  const card = cardById(state.viewerId), image = card?.item.images[state.viewerPosition];
  const actions = document.getElementById('viewer-actions'), status = document.getElementById('viewer-status'); if (!card || !actions || !status) return;
  clearTimeout(retryTimer); actions.replaceChildren();
  const photo = image ? state.photos.get(photoKey(card.item, image)) : undefined;
  status.textContent = photo?.message ?? ''; status.className = `viewer-status${photo?.message ? ' error' : ''}`;
  const pending = [...state.pending].some(key => key.startsWith(`${state.generation}:photos:${card.item.id}|`));
  if (image) {
    const retry = button(t(pending ? 'loading' : 'retry'), 'retry'), cooldown = photo?.retry_at && photo.retry_at > Date.now() ? photo.retry_at : null;
    retry.disabled = !canCallTools() || pending || cooldown !== null;
    if (cooldown !== null) { retry.textContent = `${t('waitUntil')} ${dateText(new Date(cooldown).toISOString(), true)}`;
      retryTimer = setTimeout(renderViewerActions, Math.min(60000, Math.max(1, cooldown - Date.now() + 10))); }
    retry.onclick = () => { void loadPhotos(card, image.index); }; actions.append(retry);
    const link = element('a', '', t('originalImage')); link.href = image.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link);
  }
  const nextIndex = state.nextImage.get(card.item.id);
  if (typeof nextIndex === 'number' && card.item.images.some(photo => photo.index >= nextIndex)) {
    const more = button(t('morePhotos'), 'more-photos'); more.disabled = !canCallTools() || pending;
    more.onclick = () => { void loadPhotos(card, nextIndex); }; actions.append(more);
  }
}
async function loadPhotos(card: GalleryCard, startIndex: number, batchSize = 4, cover = false): Promise<void> {
  if (!state.gallery) return;
  const request = token(), requested = card.item.images.filter(image => image.index >= startIndex).slice(0, batchSize), start = requested[0]; if (!start) return;
  const key = `${request.generation}:photos:${photoKey(card.item, start)}`; if (state.pending.has(key)) return;
  const prior = state.photos.get(photoKey(card.item, start)); if (prior?.retry_at && prior.retry_at > Date.now()) { renderViewerActions(); return; }
  state.pending.add(key); renderViewerActions(); let failureRetryAt: number | null = null;
  for (const image of requested) if (!state.photos.peek(photoKey(card.item, image))?.source) putPhoto(photoKey(card.item, image), { status: 'loading' });
  try {
    const result = await callTool('get_item_images', { run_id: request.run_id, item_id: card.item.id,
      start_index: startIndex, batch_size: batchSize, for_model: false, ...(cover ? { refresh_details: false } : {}) });
    if (!current(request)) return;
    const activeCard = cardById(card.item.id), body = record(record(result)?.structuredContent); failureRetryAt = retryTime(body);
    if (!activeCard || !body || body.item_id !== card.item.id || !Array.isArray(body.images) || record(result)?.isError) throw new Error(errorMessage(body, t('invalidResult')));
    const hydrated = hydrationFromResult(result, [activeCard]), received = new Set<string>();
    for (const value of body.images) {
      const entry = record(value), known = activeCard.item.images.find(image => image.id === entry?.id && image.index === entry.index && image.url === entry.url
        && requested.some(requestedImage => requestedImage.id === image.id && requestedImage.url === image.url));
      if (!entry || !known) continue; received.add(known.id);
      const cacheKey = photoKey(activeCard.item, known), source = hydrated.get(known.id), currentPhoto = state.photos.get(cacheKey);
      if (source) putPhoto(cacheKey, { status: 'ready', source });
      else if (entry.status === 'ready' || entry.status === 'reference') putPhoto(cacheKey, { status: 'loading', source: known.url });
      else { const retryAt = retryTime(entry) ?? retryTime(body); putPhoto(cacheKey, { ...(currentPhoto?.source ? currentPhoto : { status: 'error' as const }),
        message: errorMessage(entry, t('imageFailed')), ...(retryAt !== null ? { retry_at: retryAt } : {}) }); }
    }
    for (const image of requested) {
      if (!activeCard.item.images.some(value => value.id === image.id && value.url === image.url) || received.has(image.id) || state.photos.peek(photoKey(activeCard.item, image))?.source) continue;
      putPhoto(photoKey(activeCard.item, image), { status: 'error', message: errorMessage(body, t('pendingImage')),
        ...(failureRetryAt !== null ? { retry_at: failureRetryAt } : {}) });
    }
    // Cover hydration must not move the explicit full-photo browser's continuation.
    if (!cover) state.nextImage.set(card.item.id, Number.isSafeInteger(body.next_index) && (body.next_index as number) >= 0 ? body.next_index as number : null);
  } catch (error) {
    if (!current(request)) return;
    const activeCard = cardById(card.item.id);
    for (const image of requested) {
      if (!activeCard?.item.images.some(value => value.id === image.id && value.url === image.url)) continue;
      const cacheKey = photoKey(activeCard.item, image), currentPhoto = state.photos.get(cacheKey);
      putPhoto(cacheKey, { ...(currentPhoto?.source ? currentPhoto : { status: 'error' as const }),
        message: error instanceof Error ? error.message : t('imageFailed'), ...(failureRetryAt !== null ? { retry_at: failureRetryAt } : {}) });
    }
  } finally {
    state.pending.delete(key);
    if (current(request)) { for (const image of requested) paintPhotoKey(photoKey(card.item, image)); if (dialog.open && state.viewerId === card.item.id) renderViewer(); }
  }
}

dialog.addEventListener('close', () => {
  clearTimeout(retryTimer); const id = state.viewerId; state.viewerId = null;
  if (id) [...document.querySelectorAll<HTMLButtonElement>('.photo-open')].find(node => node.dataset.itemId === id)?.focus();
});
dialog.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') { event.preventDefault(); changePhoto(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); changePhoto(1); }
});
app.addEventListener('toolresult', result => {
  state.autoPrepare = true;
  if (!acceptGallery(result) && result.isError) setStatus(errorMessage(result.structuredContent, t('toolFailed')), true);
});
app.addEventListener('hostcontextchanged', setHostTheme);
app.addEventListener('toolcancelled', () => { state.autoPrepare = false; clearTimeout(prepareTimer); setStatus(t('toolFailed'), true); });
app.onteardown = async () => { clearTimeout(retryTimer); clearTimeout(prepareTimer); coverObserver?.disconnect(); state.generation++; state.coverQueue = []; return {}; };
void app.connect(undefined, { timeout: 15000 }).then(() => {
  state.connected = true; state.connectionSettled = true; setHostTheme(); render(); pumpCovers(); schedulePreparation();
}).catch(() => {
  state.connected = false; state.connectionSettled = true;
  if (state.gallery) { setStatus(t('notConnected'), true); render(); pumpCovers(); }
  else { root.replaceChildren(element('p', 'empty', t('notConnected'))); root.setAttribute('aria-busy', 'false'); }
});
