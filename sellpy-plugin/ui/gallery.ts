import { App } from '@modelcontextprotocol/ext-apps';
import type { GalleryCard, GalleryData, ItemFeedback, ItemImage, ItemObservation } from '../src/domain.js';
import { requirementLabels } from '../src/evidence.js';
import { assessmentStillApplies } from '../src/ranking.js';
import { errorMessage, feedbackFromResult, formatMoney, galleryFromResult, hydrationFromResult, mergeAppendedCard, parseItem, record, retryTime, safeItemUrl } from './data.js';
import { comparisonRows, filterCards, requirementCell, selectedCards, type GalleryFilter } from './comparison.js';

const language = {
  de: {
    eyebrow: 'Sellpy Auswahl', title: 'Stücke zum Vergleichen', count: 'Artikel in dieser Auswahl',
    sort: 'Sortieren', recommended: 'Empfehlung', ascending: 'Preis aufsteigend', descending: 'Preis absteigend',
    previous: 'Vorherige Artikel', next: 'Nächste Artikel', fullscreen: 'Größer ansehen', inline: 'Zurück zum Chat',
    available: 'Verfügbar', reserved: 'Reserviert', sold: 'Verkauft', unknown: 'Status offen',
    size: 'Größe', condition: 'Zustand offen', details: 'Details und Einschätzung', category: 'Shop-Kategorie',
    material: 'Material laut Shop', measurements: 'Maße laut Shop', defects: 'Hinweise zum Zustand',
    description: 'Beschreibung laut Shop', visual: 'Visuelle Einschätzung', actualType: 'Erkannter Artikeltyp',
    matching: 'Passende Merkmale', mismatches: 'Abweichungen', uncertain: 'Noch offen',
    checked: 'Geprüfte Ansichten', unreviewed: 'Visuelle Passung noch nicht geprüft.', observed: 'Stand',
    reasonMissing: 'Passung noch zu prüfen.', open: 'Bei Sellpy ansehen', refresh: 'Preis und Status aktualisieren',
    refreshed: 'Preis und Status aktualisiert.', refreshFailed: 'Aktualisierung fehlgeschlagen. Die bisherigen Angaben bleiben sichtbar.',
    photographs: 'Fotos', photograph: 'Foto', close: 'Fotogalerie schließen', previousPhoto: 'Vorheriges Foto', nextPhoto: 'Nächstes Foto',
    noImage: 'Kein Produktfoto verfügbar.', loadingImage: 'Foto wird geladen.', imageFailed: 'Foto konnte nicht geladen werden.',
    pendingImage: 'Dieses Foto wurde noch nicht geladen.', retry: 'Foto erneut laden', waitUntil: 'Erneut möglich ab',
    originalImage: 'Originalfoto öffnen', galleryHint: 'Originalfotos von Sellpy. Vergleiche Schnitt, Details und Zustand in allen Ansichten.',
    morePhotos: 'Weitere Fotos laden', loadMore: 'Weitere Auswahl anzeigen', loading: 'Wird geladen.',
    noCards: 'Noch keine Artikel für diese Auswahl verfügbar.', notConnected: 'Interaktive Funktionen sind hier nicht verfügbar. Die Originalangebote bleiben verlinkt.',
    toolFailed: 'Der Aufruf konnte nicht abgeschlossen werden. Die bisherigen Ergebnisse bleiben sichtbar.',
    invalidResult: 'Die Antwort passt nicht zu diesem Artikel. Das vorhandene Foto bleibt erhalten.',
    linkFailed: 'Der Link konnte hier nicht geöffnet werden. Du kannst den Angebotslink direkt verwenden.',
    footer: 'Preise und Verfügbarkeit können sich ändern. Originalangaben und eigene Einschätzungen sind getrennt dargestellt.',
    unavailableLink: 'Angebotslink nicht verfügbar', warnings: 'Hinweise zur Auswahl', photoCount: 'von',
    confirmed: 'bestätigt', contradicted: 'widersprochen',
    filter: 'Anzeigen', all: 'Alle geladenen', shortlistFilter: 'Gemerkt', reviewedFilter: 'Fotos geprüft', availableFilter: 'Verfügbar', rejectedFilter: 'Passt nicht',
    shortlist: 'Merken', shortlisted: 'Gemerkt', reject: 'Passt nicht', feedbackSaved: 'Deine Auswahl wurde gespeichert.',
    feedbackFailed: 'Die Auswahl konnte nicht gespeichert werden. Der bisherige Stand bleibt erhalten.',
    compare: 'Vergleichen', comparing: 'Vergleich', selected: 'ausgewählt', clearSelection: 'Vergleichsauswahl leeren', backToCards: 'Zur Auswahl',
    comparisonHint: 'Shop-Angaben und geprüfte Bildmerkmale. Fehlende Angaben bleiben offen. Seitlich wischen für weitere Artikel.',
    compareRemove: 'Aus Vergleich entfernen', compareAttribute: 'Merkmal', noFiltered: 'Keine geladenen Artikel entsprechen diesem Filter.',
    evidenceChecked: 'Fotos geprüft', evidenceUnchecked: 'Fotos ungeprüft', discuss: 'Im Chat besprechen',
    discussDone: 'Die Auswahl wurde an diesen Chat übergeben.', discussFailed: 'Die Auswahl konnte nicht an den Chat übergeben werden.',
    discussPrompt: 'Vergleiche meine ausgewählten Sellpy-Artikel. Prüfe die aktuellen Angaben und die Originalfotos, berücksichtige meine bisherigen Kriterien und erkläre die wichtigsten Unterschiede und offenen Fragen.',
  },
  en: {
    eyebrow: 'Sellpy selection', title: 'Pieces to compare', count: 'items in this selection',
    sort: 'Sort', recommended: 'Recommended', ascending: 'Price low to high', descending: 'Price high to low',
    previous: 'Previous items', next: 'Next items', fullscreen: 'Larger view', inline: 'Back to chat',
    available: 'Available', reserved: 'Reserved', sold: 'Sold', unknown: 'Status unknown',
    size: 'Size', condition: 'Condition unknown', details: 'Details and assessment', category: 'Shop category',
    material: 'Material stated by shop', measurements: 'Measurements stated by shop', defects: 'Condition notes',
    description: 'Shop description', visual: 'Visual assessment', actualType: 'Observed garment type',
    matching: 'Matching features', mismatches: 'Differences', uncertain: 'Still uncertain',
    checked: 'Examined views', unreviewed: 'Visual suitability has not been assessed yet.', observed: 'Observed',
    reasonMissing: 'Suitability still needs checking.', open: 'View on Sellpy', refresh: 'Refresh price and status',
    refreshed: 'Price and status refreshed.', refreshFailed: 'Refresh failed. The previous observations remain visible.',
    photographs: 'photos', photograph: 'Photo', close: 'Close photo gallery', previousPhoto: 'Previous photo', nextPhoto: 'Next photo',
    noImage: 'No product photo available.', loadingImage: 'Loading photo.', imageFailed: 'The photo could not be loaded.',
    pendingImage: 'This photo has not been loaded yet.', retry: 'Reload photo', waitUntil: 'Try again after',
    originalImage: 'Open original photo', galleryHint: 'Original Sellpy photos. Compare the cut, details and condition across all views.',
    morePhotos: 'Load more photos', loadMore: 'Show more selected items', loading: 'Loading.',
    noCards: 'No items are available for this selection yet.', notConnected: 'Interactive controls are unavailable here. Original listings remain linked.',
    toolFailed: 'The request could not be completed. Previous results remain visible.',
    invalidResult: 'The response does not match this item. The existing photo is preserved.',
    linkFailed: 'The link could not be opened here. You can use the listing link directly.',
    footer: 'Prices and availability can change. Original shop information is separate from the assistant’s assessment.',
    unavailableLink: 'Listing link unavailable', warnings: 'Selection notes', photoCount: 'of',
    confirmed: 'confirmed', contradicted: 'contradicted',
    filter: 'Show', all: 'All loaded', shortlistFilter: 'Shortlisted', reviewedFilter: 'Photos examined', availableFilter: 'Available', rejectedFilter: 'Not for me',
    shortlist: 'Shortlist', shortlisted: 'Shortlisted', reject: 'Not for me', feedbackSaved: 'Your selection has been saved.',
    feedbackFailed: 'Your selection could not be saved. The previous decision is unchanged.',
    compare: 'Compare', comparing: 'Comparison', selected: 'selected', clearSelection: 'Clear comparison selection', backToCards: 'Back to selection',
    comparisonHint: 'Shop facts and examined visual features. Missing information stays unknown. Scroll sideways for more items.',
    compareRemove: 'Remove from comparison', compareAttribute: 'Attribute', noFiltered: 'No loaded items match this filter.',
    evidenceChecked: 'Photos examined', evidenceUnchecked: 'Photos unexamined', discuss: 'Discuss in chat',
    discussDone: 'The selection was sent to this chat.', discussFailed: 'The selection could not be sent to this chat.',
    discussPrompt: 'Compare my selected Sellpy items. Check current details and original photographs, consider my earlier criteria, and explain the main differences and remaining uncertainties.',
  },
};
type Label = keyof typeof language.de;
type PhotoState = { status: 'loading' | 'ready' | 'error'; source?: string; message?: string; retry_at?: number };
const state = {
  gallery: null as GalleryData | null,
  generation: 0,
  photos: new Map<string, PhotoState>(),
  pending: new Set<string>(),
  nextImage: new Map<string, number | null>(),
  cardMessages: new Map<string, { text: string; error: boolean }>(),
  coverAttempts: new Set<string>(),
  sort: 'recommended', connected: false, busyMore: false,
  filter: 'all' as GalleryFilter,
  selected: new Set<string>(), view: 'cards' as 'cards' | 'comparison', busyChat: false,
  viewerId: null as string | null, viewerPosition: 0,
  status: '', statusError: false,
};
const app = new App({ name: 'Sellpy selection', version: '1.1.0' }, { availableDisplayModes: ['inline', 'fullscreen'] });
const root = document.getElementById('app')!;
const dialog = document.createElement('dialog');
dialog.className = 'viewer';
dialog.setAttribute('aria-labelledby', 'viewer-title');
document.body.append(dialog);
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function de(): boolean { return (state.gallery?.language ?? 'de').toLowerCase().startsWith('de'); }
function t(key: Label): string { return language[de() ? 'de' : 'en'][key]; }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text: string, className = '', label?: string): HTMLButtonElement {
  const node = element('button', className, text);
  node.type = 'button';
  if (label) { node.setAttribute('aria-label', label); node.title = label; }
  return node;
}
function photoKey(item: ItemObservation, image: ItemImage): string { return `${item.id}|${image.id}|${image.url}`; }
function pendingKey(kind: string, id: string): string { return `${state.gallery?.run_id ?? ''}:${state.generation}:${kind}:${id}`; }
function canCallTools(): boolean { return state.connected && Boolean(app.getHostCapabilities()?.serverTools); }
function cardById(id: string | null): GalleryCard | undefined { return state.gallery?.cards.find(card => card.item.id === id); }
function dateText(value: string, timeOnly = false): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return value;
  return new Intl.DateTimeFormat(de() ? 'de-AT' : 'en-GB', timeOnly
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
function setStatus(text: string, error = false): void {
  state.status = text;
  state.statusError = error;
  const target = document.getElementById('page-status');
  if (target) { target.textContent = text; target.className = `status${error ? ' error' : ''}`; }
}
function setHostTheme(): void {
  const context = app.getHostContext();
  if (context?.theme === 'dark' || context?.theme === 'light') document.documentElement.dataset.theme = context.theme;
  document.body.dataset.display = context?.displayMode ?? 'inline';
  const expand = document.getElementById('expand');
  if (expand instanceof HTMLButtonElement) {
    const mode = context?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
    expand.hidden = !context?.availableDisplayModes?.includes(mode);
    expand.textContent = t(mode === 'fullscreen' ? 'fullscreen' : 'inline');
    expand.setAttribute('aria-label', expand.textContent);
  }
}
function labelValue(label: string, text: string): HTMLElement {
  const block = element('div');
  block.append(element('span', 'label', label), element('p', '', text));
  return block;
}
function detailList(label: string, values: string[]): HTMLElement | null {
  if (!values.length) return null;
  const block = element('div'), list = element('ul', 'detail-list');
  block.append(element('span', 'label', label), list);
  values.forEach(value => list.append(element('li', '', value)));
  return block;
}

function photoView(item: ItemObservation, image: ItemImage | undefined, viewer = false): HTMLElement {
  const box = element('div', viewer ? 'viewer-stage' : 'photo-frame');
  if (!image) { box.append(element('span', viewer ? 'viewer-photo-status' : 'photo-state', t('noImage'))); return box; }
  const key = photoKey(item, image), current = state.photos.get(key), runId = state.gallery?.run_id, generation = state.generation;
  const img = element('img');
  img.alt = `${item.title} · ${t('photograph')} ${image.index + 1}`;
  img.loading = viewer ? 'eager' : 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.dataset.photoKey = key;
  const status = element('span', viewer ? 'viewer-photo-status' : 'photo-state', current?.message ?? t('loadingImage'));
  status.setAttribute('role', 'status');
  const source = current?.source ?? image.url;
  if (current?.status === 'error' && !current.source) {
    img.hidden = true;
    status.textContent = current.message ?? t('imageFailed');
  } else {
    img.src = source;
    status.hidden = current?.status === 'ready';
    img.onload = () => {
      if (state.gallery?.run_id !== runId || state.generation !== generation) return;
      const latest = state.photos.get(key);
      if (latest?.source && latest.source !== source) return;
      state.photos.set(key, { ...latest, status: 'ready', source });
      img.hidden = false;
      status.hidden = true;
    };
    img.onerror = () => {
      if (state.gallery?.run_id !== runId || state.generation !== generation) return;
      const latest = state.photos.get(key);
      if (latest?.source && latest.source !== source) return;
      state.photos.set(key, { status: 'error', message: t('imageFailed'), ...(latest?.retry_at ? { retry_at: latest.retry_at } : {}) });
      img.hidden = true;
      status.hidden = false;
      status.textContent = t('imageFailed');
      if (viewer) renderViewerActions();
      else {
        const card = cardById(item.id), attempt = pendingKey('cover', item.id);
        if (card && canCallTools() && !state.coverAttempts.has(attempt)) {
          state.coverAttempts.add(attempt);
          void loadPhotos(card, image.index, 1);
        }
      }
    };
  }
  box.append(img, status);
  return box;
}

function detailsView(card: GalleryCard): HTMLElement {
  const item = card.item, details = element('details'), body = element('div', 'details-body');
  details.append(element('summary', '', t('details')), body);
  if (item.categories.length) body.append(labelValue(t('category'), item.categories.join(' › ')));
  if (item.materials.length) body.append(labelValue(t('material'), item.materials.join(', ')));
  if (Object.keys(item.measurements).length) {
    const block = element('div'), list = element('dl', 'measurements');
    block.append(element('span', 'label', t('measurements')), list);
    for (const [key, value] of Object.entries(item.measurements)) list.append(element('dt', '', key), element('dd', '', String(value)));
    body.append(block);
  }
  const defects = detailList(t('defects'), item.defects);
  if (defects) body.append(defects);
  if (item.description) body.append(labelValue(t('description'), item.description));
  if (card.assessment) {
    const assessment = element('div', 'assessment');
    assessment.append(element('span', 'label', t('visual')));
    if (card.assessment.observed_type) assessment.append(labelValue(t('actualType'), card.assessment.observed_type));
    for (const [label, values] of [[t('matching'), card.assessment.matching_features], [t('mismatches'), card.assessment.mismatches],
      [t('uncertain'), card.assessment.uncertainties]] as const) {
      const list = detailList(label, values);
      if (list) assessment.append(list);
    }
    for (const requirement of requirementLabels([card.assessment])) {
      assessment.append(element('p', 'evidence', `${requirement}: ${requirementCell(card, requirement, state.gallery?.language ?? 'de').text}`));
    }
    const checked = card.assessment.checked_image_ids.map(id => item.images.find(image => image.id === id)?.index)
      .filter((index): index is number => index !== undefined).map(index => index + 1);
    assessment.append(element('p', 'evidence', `${t('checked')}: ${checked.join(', ')}`));
    body.append(assessment);
  } else body.append(element('p', 'evidence', t('unreviewed')));
  body.append(element('p', 'evidence', `${t('observed')}: ${dateText(item.observed_at)} · ${item.market} · ${item.id}`));
  return details;
}

function itemLink(item: ItemObservation, className: string, label: string): HTMLElement {
  const url = safeItemUrl(item.url);
  if (!url) return element('span', 'evidence', t('unavailableLink'));
  const link = element('a', className, label);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.addEventListener('click', event => {
    if (!state.connected || !app.getHostCapabilities()?.openLinks) return;
    event.preventDefault();
    void app.openLink({ url }).then(result => {
      if (result.isError) setStatus(t('linkFailed'), true);
    }).catch(() => setStatus(t('linkFailed'), true));
  });
  return link;
}

function evidenceBadge(card: GalleryCard): HTMLElement {
  const checked = card.assessment?.checked_image_ids.length ?? 0;
  return element('span', `inspection ${checked ? 'checked' : 'unchecked'}`, checked
    ? `${t('evidenceChecked')} · ${checked}/${card.item.images.length}` : t('evidenceUnchecked'));
}

function selectionControls(card: GalleryCard): HTMLElement {
  const controls = element('div', 'selection-controls'), decision = card.feedback?.decision ?? 'neutral';
  const shortlist = button(t(decision === 'shortlist' ? 'shortlisted' : 'shortlist'), 'shortlist-button');
  shortlist.dataset.action = 'shortlist';
  shortlist.setAttribute('aria-pressed', String(decision === 'shortlist'));
  shortlist.disabled = !canCallTools() || state.pending.has(pendingKey('feedback', card.item.id));
  shortlist.onclick = () => { void setFeedback(card.item.id, decision === 'shortlist' ? 'neutral' : 'shortlist'); };
  const reject = button(t('reject'), 'reject-button');
  reject.dataset.action = 'reject';
  reject.setAttribute('aria-pressed', String(decision === 'reject'));
  reject.disabled = shortlist.disabled;
  reject.onclick = () => { void setFeedback(card.item.id, decision === 'reject' ? 'neutral' : 'reject'); };
  const label = element('label', 'compare-toggle'), input = element('input');
  input.type = 'checkbox';
  input.dataset.action = 'compare';
  input.checked = state.selected.has(card.item.id);
  input.setAttribute('aria-label', `${t('compare')}: ${card.item.title}`);
  input.onchange = () => {
    if (input.checked) state.selected.add(card.item.id); else state.selected.delete(card.item.id);
    renderSelectionBar();
  };
  label.append(input, element('span', '', t('compare')));
  controls.append(shortlist, reject, label);
  return controls;
}

function cardView(card: GalleryCard, rank: number): HTMLElement {
  const item = card.item, article = element('article', 'card');
  article.dataset.itemId = item.id;
  article.dataset.decision = card.feedback?.decision ?? 'neutral';
  const cover = button('', 'photo-open', `${item.title} · ${item.images.length} ${t('photographs')}`);
  cover.dataset.itemId = item.id;
  cover.dataset.action = 'photo';
  cover.append(photoView(item, item.images[0]), element('span', 'rank', `#${rank}`));
  if (item.images.length) cover.append(element('span', 'photo-count', `${item.images.length} ${t('photographs')}`));
  cover.onclick = () => openViewer(item.id);
  article.append(cover);
  const body = element('div', 'body');
  if (item.brand) body.append(element('p', 'brand', item.brand));
  body.append(element('h3', '', item.title));
  const priceLine = element('div', 'price-line'), price = element('div');
  price.append(element('span', 'price', formatMoney(item.price, state.gallery?.language)));
  if (item.original_price && item.price && item.original_price.currency === item.price.currency && item.original_price.amount_minor > item.price.amount_minor) {
    price.append(element('span', 'original-price', formatMoney(item.original_price, state.gallery?.language)));
  }
  priceLine.append(price, element('span', `availability ${item.availability}`, t(item.availability)));
  body.append(priceLine);
  const facts = element('div', 'facts');
  facts.append(element('span', 'fact', `${t('size')} ${item.size ?? '?'}`), element('span', 'fact', item.condition ?? t('condition')));
  body.append(facts, evidenceBadge(card), element('p', 'reason', card.reason || t('reasonMissing')));
  if (card.cautions.length) {
    const list = element('ul', 'cautions');
    card.cautions.forEach(caution => list.append(element('li', '', caution)));
    body.append(list);
  }
  body.append(selectionControls(card), detailsView(card));
  const message = state.cardMessages.get(item.id);
  if (message) body.append(element('p', message.error ? 'status error' : 'status', message.text));
  const actions = element('div', 'actions'), refresh = button('↻', 'refresh', t('refresh'));
  refresh.dataset.action = 'refresh';
  refresh.disabled = !canCallTools() || state.pending.has(pendingKey('refresh', item.id));
  refresh.onclick = () => { void refreshItem(item.id); };
  actions.append(itemLink(item, 'item-link', t('open')), refresh);
  body.append(actions);
  article.append(body);
  return article;
}

function orderedCards(): GalleryCard[] {
  const cards = filterCards(state.gallery?.cards ?? [], state.filter);
  if (state.sort === 'recommended') return cards;
  const direction = state.sort === 'ascending' ? 1 : -1;
  return cards.sort((a, b) => {
    if (!a.item.price) return b.item.price ? 1 : 0;
    if (!b.item.price) return -1;
    if (a.item.price.currency !== b.item.price.currency) return a.item.price.currency.localeCompare(b.item.price.currency);
    return direction * (a.item.price.amount_minor - b.item.price.amount_minor);
  });
}

function comparisonHeader(card: GalleryCard): HTMLElement {
  const header = element('th', 'compare-item');
  header.scope = 'col';
  header.dataset.comparisonItemId = card.item.id;
  const photo = button('', 'photo-open', `${card.item.title} · ${card.item.images.length} ${t('photographs')}`);
  photo.dataset.itemId = card.item.id;
  photo.dataset.action = 'photo';
  photo.append(photoView(card.item, card.item.images[0]));
  photo.onclick = () => openViewer(card.item.id);
  const title = element('h3', '', card.item.title), remove = button(t('compareRemove'), 'compare-remove');
  remove.dataset.action = 'remove';
  remove.onclick = () => {
    state.selected.delete(card.item.id);
    if (state.selected.size < 2) state.view = 'cards';
    render();
  };
  header.append(photo, title, itemLink(card.item, 'comparison-link', t('open')), remove);
  return header;
}

function comparisonView(): HTMLElement {
  const cards = selectedCards(state.gallery?.cards ?? [], state.selected);
  const section = element('section', 'comparison');
  section.append(element('p', 'comparison-hint', t('comparisonHint')));
  const scroll = element('div', 'comparison-scroll'), table = element('table', 'comparison-table');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', `${t('comparing')} · ${cards.length} ${t('count')}`);
  const caption = element('caption', 'visually-hidden', `${t('comparing')} · ${cards.length} ${t('count')}`);
  const head = element('thead'), headings = element('tr'), first = element('th', 'comparison-label', t('compareAttribute'));
  first.scope = 'col';
  headings.append(first, ...cards.map(comparisonHeader));
  head.append(headings);
  const body = element('tbody');
  for (const row of comparisonRows(cards, state.gallery?.language ?? 'de')) {
    const line = element('tr'), label = element('th', 'comparison-label', row.label);
    label.scope = 'row';
    line.append(label);
    for (const value of row.cells) line.append(element('td', value.tone ?? '', value.text));
    body.append(line);
  }
  table.append(caption, head, body);
  scroll.append(table);
  section.append(scroll);
  return section;
}

function renderSelectionBar(): void {
  const target = document.getElementById('selection-bar');
  if (!target) return;
  const count = state.selected.size;
  const chosen = element('span', 'selection-count', `${count} ${t('selected')}`);
  const compare = button(state.view === 'comparison' ? t('backToCards') : `${t('compare')} (${count})`, 'compare-button');
  compare.disabled = state.view !== 'comparison' && count < 2;
  compare.onclick = () => { state.view = state.view === 'comparison' ? 'cards' : 'comparison'; render(); document.getElementById('selection-bar')?.querySelector<HTMLButtonElement>('.compare-button')?.focus(); };
  const clear = button(t('clearSelection'), 'clear-selection');
  clear.disabled = !count;
  clear.onclick = () => { state.selected.clear(); state.view = 'cards'; render(); };
  target.replaceChildren(chosen, compare, clear);
  if (app.getHostCapabilities()?.message?.text) {
    const discuss = button(state.busyChat ? t('loading') : t('discuss'), 'discuss-selection');
    const saved = state.gallery?.cards.some(card => card.feedback?.decision === 'shortlist');
    discuss.disabled = !state.connected || state.busyChat || (!count && !saved);
    discuss.onclick = () => { void discussSelection(); };
    target.append(discuss);
  }
}

function renderAffectedItem(id: string): void {
  const card = cardById(id);
  if (!card || !state.gallery) return;
  const existing = [...root.querySelectorAll<HTMLElement>('[data-item-id]')].find(node => node.classList.contains('card') && node.dataset.itemId === id);
  const comparison = [...root.querySelectorAll<HTMLTableCellElement>('[data-comparison-item-id]')].find(node => node.dataset.comparisonItemId === id);
  const container = existing ?? comparison;
  if (!container) return;
  const focused = container.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.action : undefined;
  const replacement = existing ? cardView(card, state.gallery.cards.indexOf(card) + 1) : comparisonHeader(card);
  container.replaceWith(replacement);
  if (focused) [...replacement.querySelectorAll<HTMLElement>('[data-action]')].find(node => node.dataset.action === focused)?.focus();
}

function render(): void {
  const data = state.gallery;
  if (!data) return;
  const priorScroll = document.getElementById('cards')?.scrollLeft ?? 0;
  document.documentElement.lang = de() ? 'de' : 'en';
  const shell = element('section', 'shell'), header = element('header', 'heading'), heading = element('div');
  heading.append(element('p', 'eyebrow', t('eyebrow')), element('h2', '', data.title || t('title')),
    element('p', 'subhead', `${data.cards.length} ${t('count')}`));
  const expand = button(t('fullscreen'), 'expand');
  expand.id = 'expand';
  expand.hidden = true;
  expand.onclick = () => {
    const mode = app.getHostContext()?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
    if (!app.getHostContext()?.availableDisplayModes?.includes(mode)) return;
    void app.requestDisplayMode({ mode }).then(result => { document.body.dataset.display = result.mode; setHostTheme(); })
      .catch(() => setStatus(t('toolFailed'), true));
  };
  header.append(heading, expand);
  const toolbar = element('div', 'toolbar'), sorting = element('label', 'sorting', t('sort'));
  const select = element('select');
  select.id = 'sort';
  select.setAttribute('aria-label', t('sort'));
  for (const key of ['recommended', 'ascending', 'descending'] as const) {
    const option = element('option', '', t(key));
    option.value = key;
    select.append(option);
  }
  select.value = state.sort;
  select.onchange = () => { state.sort = select.value; render(); document.getElementById('sort')?.focus(); };
  sorting.append(select);
  const filtering = element('label', 'sorting', t('filter')), filter = element('select');
  filter.id = 'filter';
  filter.setAttribute('aria-label', t('filter'));
  const filters: [GalleryFilter, Label][] = [['all', 'all'], ['shortlist', 'shortlistFilter'], ['reviewed', 'reviewedFilter'],
    ['available', 'availableFilter'], ['rejected', 'rejectedFilter']];
  for (const [value, label] of filters) {
    const option = element('option', '', t(label));
    option.value = value;
    filter.append(option);
  }
  filter.value = state.filter;
  filter.onchange = () => { state.filter = filter.value as GalleryFilter; render(); document.getElementById('filter')?.focus(); };
  filtering.append(filter);
  const nav = element('div', 'nav'), previous = button('‹', 'icon-button', t('previous')), next = button('›', 'icon-button', t('next'));
  for (const [node, direction] of [[previous, -1], [next, 1]] as const) node.onclick = () => {
    const track = document.getElementById('cards');
    track?.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  nav.append(previous, next);
  toolbar.append(sorting, filtering, nav);
  toolbar.hidden = state.view === 'comparison';
  const selection = element('div', 'selection-bar');
  selection.id = 'selection-bar';
  selection.setAttribute('aria-label', t('comparing'));
  const status = element('p', `status${state.statusError ? ' error' : ''}`, state.status);
  status.id = 'page-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const cards = element('div', 'cards');
  cards.id = 'cards';
  cards.setAttribute('aria-label', data.title || t('title'));
  const ranks = new Map(data.cards.map((card, index) => [card.item.id, index + 1]));
  const visibleCards = orderedCards();
  visibleCards.forEach(card => cards.append(cardView(card, ranks.get(card.item.id)!)));
  if (!visibleCards.length) cards.append(element('p', 'empty', t(data.cards.length ? 'noFiltered' : 'noCards')));
  const footer = element('footer', 'footer');
  footer.append(element('p', 'footnote', t('footer')));
  if (data.next_cursor) {
    const more = button(state.busyMore ? t('loading') : t('loadMore'), 'load-more');
    more.disabled = state.busyMore || !canCallTools();
    more.onclick = () => { void loadMore(); };
    footer.append(more);
  }
  shell.append(header, toolbar, selection, status, state.view === 'comparison' ? comparisonView() : cards);
  if (data.warnings.length) {
    const note = element('details', 'notice'), list = element('ul');
    note.append(element('summary', '', t('warnings')), list);
    data.warnings.forEach(warning => list.append(element('li', '', warning)));
    shell.append(note);
  }
  shell.append(footer);
  root.replaceChildren(shell);
  root.setAttribute('aria-busy', 'false');
  cards.scrollLeft = priorScroll;
  previous.disabled = cards.scrollWidth <= cards.clientWidth;
  next.disabled = previous.disabled;
  renderSelectionBar();
  setHostTheme();
}

function acceptGallery(result: unknown, append = false): boolean {
  const next = galleryFromResult(result);
  if (!next) return false;
  const sameRun = state.gallery?.run_id === next.run_id;
  if (!append) {
    state.generation++; state.busyMore = false; state.busyChat = false;
    state.pending.clear(); state.cardMessages.clear(); state.coverAttempts.clear();
  }
  if (!sameRun) {
    state.photos.clear(); state.cardMessages.clear(); state.nextImage.clear(); state.coverAttempts.clear();
    state.sort = 'recommended'; state.filter = 'all'; state.busyMore = false; state.selected.clear(); state.view = 'cards';
  }
  const hydration = hydrationFromResult(result, next.cards);
  for (const card of next.cards) for (const image of card.item.images) {
    const source = hydration.get(image.id);
    if (source) state.photos.set(photoKey(card.item, image), { status: 'ready', source });
  }
  if (append && sameRun && state.gallery) {
    const combined = new Map(state.gallery.cards.map(card => [card.item.id, card]));
    next.cards.forEach(card => combined.set(card.item.id, mergeAppendedCard(combined.get(card.item.id), card)));
    next.cards = [...combined.values()];
    next.warnings = [...new Set([...state.gallery.warnings, ...next.warnings])];
  }
  state.gallery = next;
  const currentPhotos = new Set(next.cards.flatMap(card => card.item.images.map(image => photoKey(card.item, image))));
  for (const key of state.photos.keys()) if (!currentPhotos.has(key)) state.photos.delete(key);
  for (const id of state.nextImage.keys()) if (!next.cards.some(card => card.item.id === id)) state.nextImage.delete(id);
  state.selected = new Set([...state.selected].filter(id => next.cards.some(card => card.item.id === id)));
  if (state.selected.size < 2) state.view = 'cards';
  state.status = '';
  state.statusError = false;
  render();
  if (dialog.open) renderViewer();
  return true;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!canCallTools()) throw new Error(t('notConnected'));
  return app.callServerTool({ name, arguments: args }, { timeout: 60000 });
}

async function loadMore(): Promise<void> {
  const data = state.gallery;
  if (!data?.next_cursor || state.busyMore) return;
  const runId = data.run_id, generation = state.generation;
  state.busyMore = true;
  render();
  try {
    const result = await callTool('present_items', { run_id: runId, cursor: data.next_cursor });
    if (state.gallery?.run_id !== runId || state.generation !== generation) return;
    const next = galleryFromResult(result);
    if (!next || next.run_id !== runId || record(result)?.isError) throw new Error(errorMessage(record(result)?.structuredContent, t('toolFailed')));
    acceptGallery(result, true);
  } catch (error) { if (state.gallery?.run_id === runId && state.generation === generation) setStatus(error instanceof Error ? error.message : t('toolFailed'), true); }
  finally { if (state.gallery?.run_id === runId && state.generation === generation) { state.busyMore = false; render(); } }
}

async function refreshItem(id: string): Promise<void> {
  const data = state.gallery, key = pendingKey('refresh', id), generation = state.generation;
  if (!data || state.pending.has(key)) return;
  state.pending.add(key);
  renderAffectedItem(id);
  try {
    const result = await callTool('get_items', { run_id: data.run_id, ids: [id] });
    if (state.gallery?.run_id !== data.run_id || state.generation !== generation) return;
    const output = record(record(result)?.structuredContent), items = Array.isArray(output?.items) ? output.items : [];
    const refreshed = items.map(parseItem).find(item => item?.id === id);
    const card = cardById(id);
    if (!refreshed || !card || record(result)?.isError) throw new Error(t('refreshFailed'));
    if (Date.parse(refreshed.observed_at) < Date.parse(card.item.observed_at)) throw new Error(t('refreshFailed'));
    if (!assessmentStillApplies(card, refreshed)) card.assessment = null;
    card.item = refreshed;
    state.cardMessages.set(id, { text: t('refreshed'), error: false });
    if (state.viewerId === id) state.viewerPosition = Math.min(state.viewerPosition, Math.max(0, refreshed.images.length - 1));
  } catch { if (state.gallery?.run_id === data.run_id && state.generation === generation) state.cardMessages.set(id, { text: t('refreshFailed'), error: true }); }
  finally {
    state.pending.delete(key);
    if (state.gallery?.run_id === data.run_id && state.generation === generation) {
      if (state.sort !== 'recommended' || state.filter !== 'all' || state.view === 'comparison') render(); else renderAffectedItem(id);
      if (dialog.open) renderViewer();
    }
  }
}

async function setFeedback(id: string, decision: ItemFeedback['decision']): Promise<void> {
  const data = state.gallery, key = pendingKey('feedback', id), generation = state.generation;
  if (!data || !cardById(id) || state.pending.has(key)) return;
  state.pending.add(key);
  renderAffectedItem(id);
  try {
    const result = await callTool('set_item_feedback', { run_id: data.run_id, item_id: id, decision });
    if (state.gallery?.run_id !== data.run_id || state.generation !== generation) return;
    const feedback = feedbackFromResult(result, data.run_id, id), card = cardById(id);
    if (!feedback || !card || feedback.decision !== decision) throw new Error(t('feedbackFailed'));
    card.feedback = feedback;
    state.cardMessages.set(id, { text: t('feedbackSaved'), error: false });
  } catch {
    if (state.gallery?.run_id === data.run_id && state.generation === generation) {
      state.cardMessages.set(id, { text: t('feedbackFailed'), error: true });
    }
  } finally {
    state.pending.delete(key);
    if (state.gallery?.run_id === data.run_id && state.generation === generation) {
      if (state.filter !== 'all') render(); else { renderAffectedItem(id); renderSelectionBar(); }
    }
  }
}

async function discussSelection(): Promise<void> {
  const data = state.gallery, capabilities = app.getHostCapabilities(), generation = state.generation;
  if (!data || !state.connected || !capabilities?.message?.text || state.busyChat) return;
  const cards = state.selected.size ? selectedCards(data.cards, state.selected) : data.cards.filter(card => card.feedback?.decision === 'shortlist');
  if (!cards.length) return;
  const context = { run_id: data.run_id, item_ids: cards.map(card => card.item.id),
    decisions: cards.flatMap(card => card.feedback ? [{ item_id: card.item.id, decision: card.feedback.decision }] : []) };
  state.busyChat = true;
  renderSelectionBar();
  try {
    if (capabilities.updateModelContext?.structuredContent || capabilities.updateModelContext?.text) {
      try {
        await app.updateModelContext(capabilities.updateModelContext.structuredContent ? { structuredContent: context }
          : { content: [{ type: 'text', text: JSON.stringify(context) }] });
      } catch { /* The explicit message carries the same exact run/item identities. */ }
    }
    if (state.gallery?.run_id !== data.run_id || state.generation !== generation) return;
    const response = await app.sendMessage({ role: 'user', content: [{ type: 'text', text: `${t('discussPrompt')}\n${JSON.stringify(context)}` }] });
    if (state.gallery?.run_id !== data.run_id || state.generation !== generation) return;
    if (response.isError) throw new Error(t('discussFailed'));
    setStatus(t('discussDone'));
  } catch {
    if (state.gallery?.run_id === data.run_id && state.generation === generation) setStatus(t('discussFailed'), true);
  } finally {
    if (state.gallery?.run_id === data.run_id && state.generation === generation) { state.busyChat = false; renderSelectionBar(); }
  }
}

function openViewer(id: string): void {
  const card = cardById(id);
  if (!card) return;
  state.viewerId = id;
  state.viewerPosition = 0;
  renderViewer();
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('.close-viewer')?.focus();
  ensureCurrentPhoto();
}

function changePhoto(delta: number): void {
  const card = cardById(state.viewerId);
  if (!card) return;
  state.viewerPosition = Math.max(0, Math.min(state.viewerPosition + delta, card.item.images.length - 1));
  renderViewer();
  ensureCurrentPhoto();
}

function ensureCurrentPhoto(): void {
  const card = cardById(state.viewerId), image = card?.item.images[state.viewerPosition];
  if (!card || !image || !canCallTools()) return;
  const photo = state.photos.get(photoKey(card.item, image));
  if (photo?.source?.startsWith('data:') || (photo?.retry_at && photo.retry_at > Date.now())) return;
  void loadPhotos(card, image.index);
}

function renderViewer(): void {
  const card = cardById(state.viewerId);
  if (!card) { if (dialog.open) dialog.close(); return; }
  const image = card.item.images[state.viewerPosition];
  const inner = element('div', 'viewer-inner'), header = element('div', 'viewer-head');
  const title = element('p', 'viewer-title', card.item.title);
  title.id = 'viewer-title';
  const close = button('×', 'icon-button close-viewer', t('close'));
  close.onclick = () => dialog.close();
  header.append(title, close);
  const controls = element('div', 'viewer-controls');
  const prev = button('‹', 'icon-button previous-photo', t('previousPhoto')), next = button('›', 'icon-button next-photo', t('nextPhoto'));
  prev.disabled = state.viewerPosition <= 0;
  next.disabled = state.viewerPosition >= card.item.images.length - 1;
  prev.onclick = () => { changePhoto(-1); dialog.querySelector<HTMLButtonElement>('.previous-photo')?.focus(); };
  next.onclick = () => { changePhoto(1); dialog.querySelector<HTMLButtonElement>('.next-photo')?.focus(); };
  controls.append(prev, element('span', 'photo-position', `${card.item.images.length ? state.viewerPosition + 1 : 0} ${t('photoCount')} ${card.item.images.length}`), next);
  const thumbnails = element('div', 'thumbnails');
  thumbnails.setAttribute('aria-label', t('photographs'));
  card.item.images.forEach((photo, position) => {
    const thumbnail = button('', 'thumbnail', `${t('photograph')} ${position + 1}`);
    thumbnail.setAttribute('aria-current', String(position === state.viewerPosition));
    const known = state.photos.get(photoKey(card.item, photo));
    if (known?.status === 'ready' && known.source) {
      const img = element('img');
      img.src = known.source;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      thumbnail.append(img);
    } else thumbnail.append(element('span', 'thumbnail-index', String(position + 1)));
    thumbnail.onclick = () => { state.viewerPosition = position; renderViewer(); ensureCurrentPhoto(); };
    thumbnails.append(thumbnail);
  });
  const status = element('p', 'viewer-status');
  status.id = 'viewer-status';
  status.setAttribute('aria-live', 'polite');
  const actions = element('div', 'viewer-actions');
  actions.id = 'viewer-actions';
  inner.append(header, photoView(card.item, image, true), controls, thumbnails, status, actions, element('p', 'evidence', t('galleryHint')));
  const focusedLabel = dialog.contains(document.activeElement) ? document.activeElement?.getAttribute('aria-label') : null;
  dialog.replaceChildren(inner);
  renderViewerActions();
  if (focusedLabel) [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === focusedLabel && !node.disabled)?.focus();
}

function renderViewerActions(): void {
  const card = cardById(state.viewerId), image = card?.item.images[state.viewerPosition];
  const actions = document.getElementById('viewer-actions'), status = document.getElementById('viewer-status');
  if (!card || !actions || !status) return;
  clearTimeout(retryTimer);
  actions.replaceChildren();
  const photo = image ? state.photos.get(photoKey(card.item, image)) : undefined;
  status.textContent = photo?.message ?? (photo?.status === 'error' ? t('imageFailed') : '');
  status.className = `viewer-status${photo?.message || photo?.status === 'error' ? ' error' : ''}`;
  const pending = [...state.pending].some(key => key.startsWith(pendingKey('photos', `${card.item.id}:`)));
  if (image) {
    const retry = button(pending ? t('loading') : t('retry'), 'retry');
    const cooldown = photo?.retry_at && photo.retry_at > Date.now() ? photo.retry_at : null;
    retry.disabled = !canCallTools() || pending || cooldown !== null;
    if (cooldown !== null) {
      retry.textContent = `${t('waitUntil')} ${dateText(new Date(cooldown).toISOString(), true)}`;
      retryTimer = setTimeout(renderViewerActions, Math.min(60000, Math.max(1, cooldown - Date.now() + 10)));
    }
    retry.onclick = () => { void loadPhotos(card, image.index); };
    actions.append(retry);
    const link = element('a', '', t('originalImage'));
    link.href = image.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.append(link);
  }
  const nextIndex = state.nextImage.get(card.item.id);
  if (typeof nextIndex === 'number' && card.item.images.some(photo => photo.index >= nextIndex)) {
    const more = button(t('morePhotos'), 'retry');
    const nextPhoto = card.item.images.find(photo => photo.index >= nextIndex);
    const nextState = nextPhoto ? state.photos.get(photoKey(card.item, nextPhoto)) : undefined;
    more.disabled = !canCallTools() || pending || Boolean(nextState?.retry_at && nextState.retry_at > Date.now());
    more.onclick = () => { void loadPhotos(card, nextIndex); };
    actions.append(more);
  }
}

async function loadPhotos(card: GalleryCard, startIndex: number, batchSize = 4): Promise<void> {
  const data = state.gallery;
  if (!data) return;
  const key = pendingKey('photos', `${card.item.id}:${startIndex}`), generation = state.generation;
  if (state.pending.has(key)) return;
  const requested = card.item.images.filter(image => image.index >= startIndex).slice(0, batchSize);
  const startPhoto = requested[0], prior = startPhoto ? state.photos.get(photoKey(card.item, startPhoto)) : undefined;
  if (prior?.retry_at && prior.retry_at > Date.now()) { renderViewerActions(); return; }
  state.pending.add(key);
  renderViewerActions();
  let failureRetryAt: number | null = null;
  try {
    const result = await callTool('get_item_images', { run_id: data.run_id, item_id: card.item.id,
      start_index: startIndex, batch_size: batchSize, for_model: false });
    if (state.gallery?.run_id !== data.run_id || state.generation !== generation) return;
    const body = record(record(result)?.structuredContent);
    failureRetryAt = retryTime(body);
    if (!body || body.item_id !== card.item.id || !Array.isArray(body.images)) {
      throw new Error(errorMessage(body, t('invalidResult')));
    }
    const hydrated = hydrationFromResult(result, [card]);
    const received = new Set<string>();
    for (const value of body.images) {
      const entry = record(value);
      const known = card.item.images.find(image => image.id === entry?.id && image.index === entry.index && image.url === entry.url);
      if (!entry || !known) continue;
      received.add(known.id);
      const source = hydrated.get(known.id), current = state.photos.get(photoKey(card.item, known));
      if (source) state.photos.set(photoKey(card.item, known), { status: 'ready', source });
      else if (entry.status === 'ready' || entry.status === 'reference') {
        state.photos.set(photoKey(card.item, known), { status: 'loading', source: known.url });
      } else {
        const retryAt = retryTime(entry) ?? retryTime(body);
        state.photos.set(photoKey(card.item, known), { ...(current?.status === 'ready' ? current : { status: 'error' as const }), message: errorMessage(entry, t('imageFailed')),
          ...(retryAt !== null ? { retry_at: retryAt } : {}) });
      }
    }
    for (const photo of requested) {
      if (received.has(photo.id) || state.photos.get(photoKey(card.item, photo))?.status === 'ready') continue;
      const retryAt = retryTime(body);
      state.photos.set(photoKey(card.item, photo), { status: 'error', message: errorMessage(body, t('pendingImage')),
        ...(retryAt !== null ? { retry_at: retryAt } : {}) });
    }
    const nextIndex = body.next_index;
    state.nextImage.set(card.item.id, Number.isSafeInteger(nextIndex) && (nextIndex as number) >= 0 ? nextIndex as number : null);
  } catch (error) {
    if (state.gallery?.run_id !== data.run_id || state.generation !== generation) return;
    for (const photo of requested) {
      const current = state.photos.get(photoKey(card.item, photo));
      state.photos.set(photoKey(card.item, photo), { ...(current?.status === 'ready' ? current : { status: 'error' as const }),
        message: error instanceof Error ? error.message : t('imageFailed'), ...(failureRetryAt !== null ? { retry_at: failureRetryAt } : {}) });
    }
  } finally {
    state.pending.delete(key);
    if (state.gallery?.run_id === data.run_id && state.generation === generation) {
      renderAffectedItem(card.item.id);
      if (dialog.open) renderViewer();
    }
  }
}

dialog.addEventListener('close', () => {
  clearTimeout(retryTimer);
  const id = state.viewerId;
  state.viewerId = null;
  if (id) [...document.querySelectorAll<HTMLButtonElement>('.photo-open')].find(node => node.dataset.itemId === id)?.focus();
});
dialog.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') { event.preventDefault(); changePhoto(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); changePhoto(1); }
});
app.addEventListener('toolresult', result => {
  if (!acceptGallery(result) && result.isError) setStatus(errorMessage(result.structuredContent, t('toolFailed')), true);
});
app.addEventListener('hostcontextchanged', setHostTheme);
app.addEventListener('toolcancelled', () => setStatus(t('toolFailed'), true));
app.onteardown = async () => { clearTimeout(retryTimer); return {}; };
void app.connect(undefined, { timeout: 15000 }).then(() => {
  state.connected = true;
  setHostTheme();
  render();
}).catch(() => {
  state.connected = false;
  if (state.gallery) { setStatus(t('notConnected'), true); render(); }
  else { root.replaceChildren(element('p', 'empty', t('notConnected'))); root.setAttribute('aria-busy', 'false'); }
});
