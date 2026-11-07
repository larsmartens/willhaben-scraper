import type { GalleryCard, Money } from './domain.js';
import { normalizeEvidenceKey, requirementLabels, resolveVisualRequirement } from './evidence.js';

export type FactTone = 'positive' | 'warning' | 'muted';
export interface CardFact {
  key: string;
  label: string;
  value: string;
  source: 'shop' | 'assessment';
  tone?: FactTone;
}
export interface CardEvidence {
  key: string;
  requirement: string;
  verdict: 'confirmed' | 'contradicted' | 'unknown';
  status: 'assessed' | 'conflicting';
  evidence: string;
  checked_image_ids: string[];
  assessed_at: string;
}
export interface CardFacts {
  title: string;
  summary: CardFact[];
  details: CardFact[];
  evidence: CardEvidence[];
  legacy_evidence: CardFact[];
  selection_note: { reason: string; cautions: string[] } | null;
  assessment: { recorded: boolean; checked: number; available: number; details_available: boolean };
  observed_at: string;
}

export function formatMoney(value: Money | null, language = 'de'): string {
  if (!value) return language.toLowerCase().startsWith('de') ? 'Preis offen' : 'Price unknown';
  try { return new Intl.NumberFormat(language, { style: 'currency', currency: value.currency }).format(value.amount_minor / 100); }
  catch { return `${(value.amount_minor / 100).toFixed(2)} ${value.currency}`; }
}

function uniqueText(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = normalizeEvidenceKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleContainsBrand(title: string, brand: string): boolean {
  const words = (value: string) => normalizeEvidenceKey(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return ` ${words(title)} `.includes(` ${words(brand)} `);
}

/** Only standalone separator-delimited metadata tokens are removed from the display title. */
function displayTitle(card: GalleryCard): string {
  const tokens = new Set([card.item.size, card.item.size_system].filter((value): value is string => Boolean(value)).map(normalizeEvidenceKey));
  if (!tokens.size) return card.item.title;
  const parts = card.item.title.split(/\s*[·|]\s*|\s+[—–]\s+/u);
  if (parts.length < 2) return card.item.title;
  const retained = parts.filter(part => !tokens.has(normalizeEvidenceKey(part)));
  return retained.length && retained.length < parts.length ? retained.join(' · ') : card.item.title;
}

/** Exact category ancestry is structure, not prose to summarize. Independent paths remain. */
function categoryLeaves(categories: readonly string[]): string[] {
  const paths = uniqueText(categories).map(value => value.split(/\s*>\s*/u).filter(Boolean)
    .filter((part, index, parts) => index === 0 || normalizeEvidenceKey(part) !== normalizeEvidenceKey(parts[index - 1]!)));
  const unique = [...new Map(paths.map(path => [path.map(normalizeEvidenceKey).join(' > '), path])).values()];
  return unique.filter(path => !unique.some(other => other.length > path.length
    && path.every((part, index) => normalizeEvidenceKey(part) === normalizeEvidenceKey(other[index]!))))
    .map(path => path.join(' > '));
}

/** Pure projection: source facts and accepted assessments, never inferred prose or new evidence. */
export function projectCardFacts(card: GalleryCard, language = 'de'): CardFacts {
  const de = language.toLowerCase().startsWith('de'), item = card.item;
  const labels = de ? {
    brand: 'Marke', price: 'Preis', size: 'Größe', condition: 'Zustand', availability: 'Status',
    available: 'Verfügbar', reserved: 'Reserviert', sold: 'Verkauft', unknown: 'Offen', missing: 'Keine Angabe',
    material: 'Material laut Shop', colors: 'Farben laut Shop', category: 'Kategorie laut Shop',
    defects: 'Zustandshinweise', measurement: 'Maß laut Shop', kind: 'Visuell erkannter Artikeltyp',
    matching: 'Weitere sichtbare Merkmale', mismatches: 'Weitere Abweichungen', uncertain: 'Weitere offene Fragen',
  } : {
    brand: 'Brand', price: 'Price', size: 'Size', condition: 'Condition', availability: 'Status',
    available: 'Available', reserved: 'Reserved', sold: 'Sold', unknown: 'Unknown', missing: 'Not stated',
    material: 'Shop material', colors: 'Shop colors', category: 'Shop category',
    defects: 'Condition notes', measurement: 'Shop measurement', kind: 'Visually observed garment type',
    matching: 'Other visible features', mismatches: 'Other differences', uncertain: 'Other open questions',
  };
  const summary: CardFact[] = [
    { key: 'price', label: labels.price, value: formatMoney(item.price, language), source: 'shop', ...(!item.price ? { tone: 'muted' as const } : {}) },
    { key: 'availability', label: labels.availability, value: labels[item.availability], source: 'shop',
      tone: item.availability === 'available' ? 'positive' : item.availability === 'reserved' ? 'warning' : 'muted' },
    { key: 'size', label: labels.size, value: item.size ? `${item.size}${item.size_system ? ` (${item.size_system})` : ''}` : labels.missing,
      source: 'shop', ...(!item.size ? { tone: 'muted' as const } : {}) },
    { key: 'condition', label: labels.condition, value: item.condition || labels.missing, source: 'shop', ...(!item.condition ? { tone: 'muted' as const } : {}) },
  ];
  if (item.brand && !titleContainsBrand(item.title, item.brand)) summary.push({ key: 'brand', label: labels.brand, value: item.brand, source: 'shop' });
  const details: CardFact[] = [];
  const addDetail = (key: string, label: string, values: readonly string[]) => {
    const value = uniqueText(values).join(' · ');
    if (value) details.push({ key, label, value, source: 'shop' });
  };
  addDetail('material', labels.material, item.materials);
  addDetail('colors', labels.colors, item.colors);
  addDetail('category', labels.category, categoryLeaves(item.categories));
  for (const [key, value] of Object.entries(item.measurements)) details.push({ key: `measurement:${key}`,
    label: `${labels.measurement}: ${key}`, value: String(value), source: 'shop' });
  addDetail('defects', labels.defects, item.defects);

  const evidence: CardEvidence[] = [];
  for (const requirement of requirementLabels([card.assessment])) {
    const resolved = resolveVisualRequirement(card, requirement);
    if (resolved.source === 'none') continue;
    // Exact duplicate records can be collapsed; negation and different verdicts stay distinct.
    const records = card.assessment!.requirement_results.filter(entry => normalizeEvidenceKey(entry.requirement) === normalizeEvidenceKey(requirement));
    const texts = uniqueText(records.map(entry => entry.evidence));
    evidence.push({ key: normalizeEvidenceKey(requirement), requirement, verdict: resolved.verdict,
      status: resolved.status === 'conflicting' ? 'conflicting' : 'assessed', evidence: texts.join(' | '),
      checked_image_ids: [...(resolved.checked_image_ids ?? [])], assessed_at: card.assessment!.assessed_at });
  }
  const knownImages = new Set(item.images.map(image => image.id));
  const assessment = card.assessment && card.assessment.item_id === item.id && card.assessment.checked_image_ids.length > 0
    && card.assessment.checked_image_ids.every(id => knownImages.has(id)) ? card.assessment : null;
  const legacy_evidence: CardFact[] = [];
  if (assessment) {
    if (assessment.observed_type) legacy_evidence.push({ key: 'observed_type', label: labels.kind, value: assessment.observed_type, source: 'assessment' });
    for (const [key, label, verdict, values] of [
      ['matching', labels.matching, 'confirmed', assessment.matching_features],
      ['mismatches', labels.mismatches, 'contradicted', assessment.mismatches],
      ['uncertain', labels.uncertain, 'unknown', assessment.uncertainties],
    ] as const) {
      const represented = new Set(assessment.requirement_results.filter(row => row.verdict === verdict).map(row => normalizeEvidenceKey(row.evidence)));
      const retained = uniqueText(values).filter(value => !represented.has(normalizeEvidenceKey(value)));
      if (retained.length) legacy_evidence.push({ key, label, value: retained.join(' · '), source: 'assessment',
        ...(verdict === 'contradicted' ? { tone: 'warning' as const } : {}) });
    }
  }
  const reason = card.reason.trim();
  const cautions = uniqueText(card.cautions).filter(value => normalizeEvidenceKey(value) !== normalizeEvidenceKey(reason));
  return { title: displayTitle(card), summary, details, evidence, legacy_evidence,
    selection_note: reason || cautions.length ? { reason, cautions } : null,
    assessment: { recorded: Boolean(assessment) || card.summary?.assessment_recorded === true,
      checked: assessment ? new Set(assessment.checked_image_ids).size : card.summary?.checked_image_count ?? 0,
      available: card.summary?.image_count ?? item.images.length,
      details_available: !assessment && card.summary?.assessment_recorded === true },
    observed_at: item.observed_at };
}

export interface PriceSubtotal {
  amounts: Money[];
  priced_items: number;
  missing_items: number;
  mixed_currencies: boolean;
}

/** Separate currency subtotals; no exchange-rate or missing-price assumptions. */
export function priceSubtotal(cards: readonly GalleryCard[]): PriceSubtotal {
  const totals = new Map<string, number>();
  let missing = 0;
  for (const card of cards) {
    const price = card.item.price;
    if (!price) { missing++; continue; }
    totals.set(price.currency, (totals.get(price.currency) ?? 0) + price.amount_minor);
  }
  return { amounts: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount_minor]) => ({ currency, amount_minor })),
    priced_items: cards.length - missing, missing_items: missing, mixed_currencies: totals.size > 1 };
}
