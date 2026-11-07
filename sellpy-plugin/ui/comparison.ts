import type { GalleryCard } from '../src/domain.js';
import { requirementLabels, resolveVisualRequirement } from '../src/evidence.js';
import { formatMoney } from './data.js';

export type GalleryFilter = 'all' | 'shortlist' | 'reviewed' | 'available' | 'rejected';
export type ComparisonCell = { text: string; tone?: 'positive' | 'warning' | 'muted' };
export type ComparisonRow = { label: string; cells: ComparisonCell[] };

export function filterCards(cards: readonly GalleryCard[], filter: string): GalleryCard[] {
  return cards.filter(card => filter === 'shortlist' ? card.feedback?.decision === 'shortlist'
    : filter === 'rejected' ? card.feedback?.decision === 'reject'
      : filter === 'reviewed' ? card.assessment !== null
        : filter === 'available' ? card.item.availability === 'available' : true);
}

export function selectedCards(cards: readonly GalleryCard[], selected: ReadonlySet<string>): GalleryCard[] {
  return cards.filter(card => selected.has(card.item.id));
}

export function requirementCell(card: GalleryCard, requirement: string, language: string): ComparisonCell {
  const labels = language.toLowerCase().startsWith('de')
    ? { confirmed: 'Bestätigt', contradicted: 'Widersprochen', unknown: 'Offen', conflict: 'Widersprüchliche Bildbelege; Artikel erneut prüfen.' }
    : { confirmed: 'Confirmed', contradicted: 'Contradicted', unknown: 'Unknown', conflict: 'Conflicting visual evidence; inspect the item again.' };
  const result = resolveVisualRequirement(card, requirement);
  if (result.source === 'none') return { text: labels.unknown, tone: 'muted' };
  return { text: `${labels[result.verdict]}: ${result.status === 'conflicting' ? labels.conflict : result.evidence}`,
    tone: result.verdict === 'confirmed' ? 'positive' : result.verdict === 'contradicted' ? 'warning' : 'muted' };
}

export function comparisonRows(cards: readonly GalleryCard[], language: string): ComparisonRow[] {
  const de = language.toLowerCase().startsWith('de');
  const labels = de ? {
    unknown: 'Keine Angabe', price: 'Preis', availability: 'Verfügbarkeit', available: 'Verfügbar', reserved: 'Reserviert', sold: 'Verkauft',
    statusUnknown: 'Status offen', size: 'Größe laut Shop', condition: 'Zustand laut Shop', material: 'Material laut Shop',
    colors: 'Farben laut Shop', category: 'Kategorie laut Shop', defects: 'Zustandshinweise', visual: 'Geprüfte Fotos',
    unchecked: 'Keine aktuelle Bildbewertung gespeichert', kind: 'Visuell erkannter Artikeltyp', matching: 'Sichtbare passende Merkmale',
    mismatches: 'Dokumentierte Abweichungen', uncertain: 'Offene Fragen', observed: 'Abrufzeit der Shop-Angaben',
    noRecord: 'Keine dokumentiert', measurement: 'Maß laut Shop',
    reason: 'Begründung der Auswahl', cautions: 'Weitere Hinweise',
  } : {
    unknown: 'Not stated', price: 'Price', availability: 'Availability', available: 'Available', reserved: 'Reserved', sold: 'Sold',
    statusUnknown: 'Status unknown', size: 'Shop size', condition: 'Shop condition', material: 'Shop material',
    colors: 'Shop colors', category: 'Shop category', defects: 'Condition notes', visual: 'Examined photos',
    unchecked: 'No current visual assessment is saved', kind: 'Visually observed garment type', matching: 'Visible matching features',
    mismatches: 'Recorded differences', uncertain: 'Open questions', observed: 'Shop data observed at',
    noRecord: 'None recorded', measurement: 'Shop measurement',
    reason: 'Selection reason', cautions: 'Further notes',
  };
  const plain = (value: string | null | undefined): ComparisonCell => value ? { text: value } : { text: labels.unknown, tone: 'muted' };
  const values = (value: readonly string[] | undefined): ComparisonCell => plain(value?.length ? value.join(', ') : null);
  const row = (label: string, value: (card: GalleryCard) => ComparisonCell): ComparisonRow => ({ label, cells: cards.map(value) });
  const rows: ComparisonRow[] = [
    row(labels.price, card => ({ text: formatMoney(card.item.price, language), ...(card.item.price ? {} : { tone: 'muted' as const }) })),
    row(labels.availability, card => ({ text: card.item.availability === 'unknown' ? labels.statusUnknown : labels[card.item.availability],
      tone: card.item.availability === 'available' ? 'positive' : card.item.availability === 'reserved' ? 'warning' : 'muted' })),
    row(labels.size, card => plain(card.item.size ? `${card.item.size}${card.item.size_system ? ` (${card.item.size_system})` : ''}` : null)),
    row(labels.condition, card => plain(card.item.condition)),
    row(labels.material, card => values(card.item.materials)),
    row(labels.colors, card => values(card.item.colors)),
  ];
  const measurementKeys = [...new Set(cards.flatMap(card => Object.keys(card.item.measurements)))];
  for (const key of measurementKeys) rows.push(row(`${labels.measurement}: ${key}`, card => {
    const value = card.item.measurements[key];
    return plain(value === undefined ? null : String(value));
  }));
  rows.push(row(labels.category, card => values(card.item.categories)), row(labels.defects, card => values(card.item.defects)),
    row(labels.reason, card => plain(card.reason)), row(labels.cautions, card => values(card.cautions)),
    row(labels.visual, card => card.assessment ? { text: `${card.assessment.checked_image_ids.length} / ${card.item.images.length}`, tone: 'positive' }
      : { text: labels.unchecked, tone: 'muted' }),
    row(labels.kind, card => plain(card.assessment?.observed_type)),
    row(labels.matching, card => values(card.assessment?.matching_features)),
    row(labels.mismatches, card => !card.assessment ? { text: labels.unchecked, tone: 'muted' }
      : { text: card.assessment.mismatches.join(', ') || labels.noRecord, ...(card.assessment.mismatches.length ? { tone: 'warning' as const } : {}) }),
    row(labels.uncertain, card => !card.assessment ? { text: labels.unchecked, tone: 'muted' }
      : { text: card.assessment.uncertainties.join(', ') || labels.noRecord, ...(card.assessment.uncertainties.length ? { tone: 'warning' as const } : {}) }));
  const requirements = requirementLabels(cards.map(card => card.assessment));
  for (const requirement of requirements) rows.push(row(requirement, card => requirementCell(card, requirement, language)));
  rows.push(row(labels.observed, card => {
    const timestamp = Date.parse(card.item.observed_at);
    if (!Number.isFinite(timestamp)) return { text: labels.unknown, tone: 'muted' };
    return { text: new Intl.DateTimeFormat(de ? 'de-AT' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit' }).format(timestamp) };
  }));
  return rows;
}
