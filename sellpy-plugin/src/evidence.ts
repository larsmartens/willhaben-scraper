import type { Candidate, VisualAssessment } from './domain.js';

type EvidenceSubject = Pick<Candidate, 'item' | 'assessment'>;
type RequirementVerdict = VisualAssessment['requirement_results'][number]['verdict'];

export interface VisualRequirementEvidence {
  verdict: RequirementVerdict;
  source: 'visual_assessment' | 'none';
  status: 'assessed' | 'unavailable' | 'unassessed' | 'conflicting';
  evidence: string;
  checked_image_ids?: string[];
}

/** Exact label matching, preserving negation and all substantive words. */
export function normalizeEvidenceKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function requirementLabels(assessments: readonly (VisualAssessment | null)[]): string[] {
  const labels = new Map<string, string>();
  for (const assessment of assessments) for (const result of assessment?.requirement_results ?? []) {
    const key = normalizeEvidenceKey(result.requirement);
    if (key && !labels.has(key)) labels.set(key, result.requirement);
  }
  return [...labels.values()];
}

/** Every matching record contributes; a first positive record cannot hide uncertainty or a conflict. */
export function resolveVisualRequirement(subject: EvidenceSubject, requirement: string): VisualRequirementEvidence {
  const assessment = subject.assessment;
  const knownImages = new Set(subject.item.images.map(image => image.id));
  if (!assessment || assessment.item_id !== subject.item.id || !assessment.checked_image_ids.length
    || assessment.checked_image_ids.some(id => !knownImages.has(id))) {
    return { verdict: 'unknown', source: 'none', status: 'unavailable', evidence: '' };
  }
  const key = normalizeEvidenceKey(requirement);
  const matches = assessment.requirement_results.filter(result => normalizeEvidenceKey(result.requirement) === key);
  if (!matches.length) return { verdict: 'unknown', source: 'none', status: 'unassessed', evidence: '' };
  const verdicts = new Set(matches.map(result => result.verdict));
  const conflict = verdicts.has('confirmed') && verdicts.has('contradicted');
  return {
    verdict: conflict || verdicts.has('unknown') ? 'unknown' : matches[0]!.verdict,
    source: 'visual_assessment', status: conflict ? 'conflicting' : 'assessed',
    evidence: matches.map(result => result.evidence).filter(Boolean).join(' | '),
    checked_image_ids: [...assessment.checked_image_ids],
  };
}
