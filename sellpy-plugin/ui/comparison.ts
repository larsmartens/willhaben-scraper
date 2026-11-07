import type { GalleryCard } from '../src/domain.js';
import { normalizeEvidenceKey } from '../src/evidence.js';
import { projectCardFacts, type CardEvidence, type CardFact } from '../src/card-facts.js';

export type GalleryFilter = 'all' | 'shortlist' | 'reviewed' | 'unassessed' | 'available' | 'rejected';
export type ComparisonCell = { text: string; tone?: 'positive' | 'warning' | 'muted' };
export type ComparisonRow = { label: string; cells: ComparisonCell[] };

/** Legacy helpers remain pure; global gallery controls use server collections. */
export function filterCards(cards: readonly GalleryCard[], filter: string): GalleryCard[] {
  return cards.filter(card => filter === 'shortlist' ? card.feedback?.decision === 'shortlist'
    : filter === 'rejected' ? card.feedback?.decision === 'reject'
      : filter === 'reviewed' ? card.assessment !== null
        : filter === 'unassessed' ? card.assessment === null
          : filter === 'available' ? card.item.availability === 'available' : true);
}
export function selectedCards(cards: readonly GalleryCard[], selected: ReadonlySet<string>): GalleryCard[] {
  return cards.filter(card => selected.has(card.item.id));
}

export function evidenceCell(evidence: CardEvidence | undefined, language: string): ComparisonCell {
  const labels = language.toLowerCase().startsWith('de')
    ? { confirmed: 'Bestätigt', contradicted: 'Widersprochen', unknown: 'Offen', conflict: 'Widersprüchliche Bildbelege' }
    : { confirmed: 'Confirmed', contradicted: 'Contradicted', unknown: 'Unknown', conflict: 'Conflicting visual evidence' };
  if (!evidence) return { text: labels.unknown, tone: 'muted' };
  const detail = evidence.status === 'conflicting' ? `${labels.conflict}${evidence.evidence ? ` · ${evidence.evidence}` : ''}` : evidence.evidence;
  return { text: `${labels[evidence.verdict]}${detail ? `: ${detail}` : ''}`,
    tone: evidence.verdict === 'confirmed' ? 'positive' : evidence.verdict === 'contradicted' ? 'warning' : 'muted' };
}
export function requirementCell(card: GalleryCard, requirement: string, language: string): ComparisonCell {
  return evidenceCell(projectCardFacts(card, language).evidence.find(row => row.key === normalizeEvidenceKey(requirement)), language);
}

/** The table consumes the same canonical fragments as cards; each criterion appears once. */
export function comparisonRows(cards: readonly GalleryCard[], language: string, unknownAssessments: ReadonlySet<string> = new Set()): ComparisonRow[] {
  const de = language.toLowerCase().startsWith('de'), projections = cards.map(card => projectCardFacts(card, language));
  const unknown = de ? 'Keine Angabe' : 'Not stated';
  const rows: ComparisonRow[] = [];
  const facts = new Map<string, CardFact>();
  for (const projection of projections) for (const fact of [...projection.summary, ...projection.details, ...projection.legacy_evidence]) {
    if (fact.key !== 'brand' && !facts.has(fact.key)) facts.set(fact.key, fact);
  }
  for (const [key, fact] of facts) {
    const label = key === 'availability' ? (de ? 'Verfügbarkeit' : 'Availability')
      : key === 'size' ? (de ? 'Größe laut Shop' : 'Shop size')
        : key === 'condition' ? (de ? 'Zustand laut Shop' : 'Shop condition') : fact.label;
    rows.push({ label, cells: projections.map(projection => {
      const match = [...projection.summary, ...projection.details, ...projection.legacy_evidence].find(value => value.key === key);
      return match ? { text: match.value, ...(match.tone ? { tone: match.tone } : {}) } : { text: unknown, tone: 'muted' as const };
    }) });
  }
  rows.push({ label: de ? 'Geprüfte Fotos' : 'Assessed photos', cells: projections.map((projection, index) => unknownAssessments.has(cards[index]!.item.id)
    ? { text: de ? 'Bewertungsstatus offen' : 'Assessment status unknown', tone: 'muted' }
    : projection.assessment.recorded
    ? { text: `${projection.assessment.checked} / ${projection.assessment.available}`, tone: 'positive' }
    : { text: de ? 'Keine Bildbewertung' : 'No photo assessment', tone: 'muted' }) });
  const requirements = new Map<string, string>();
  for (const projection of projections) for (const row of projection.evidence) if (!requirements.has(row.key)) requirements.set(row.key, row.requirement);
  for (const [key, label] of requirements) rows.push({ label,
    cells: projections.map(projection => evidenceCell(projection.evidence.find(row => row.key === key), language)) });
  rows.push({ label: de ? 'Abrufzeit der Shop-Angaben' : 'Shop data observed at', cells: cards.map(card => {
    const timestamp = Date.parse(card.item.observed_at);
    if (!Number.isFinite(timestamp)) return { text: unknown, tone: 'muted' };
    return { text: new Intl.DateTimeFormat(de ? 'de-AT' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit' }).format(timestamp) };
  }) });
  return rows;
}
