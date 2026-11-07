import type { ItemObservation, SearchPlan } from './domain.js';
import { effectiveFilters } from './sellpy/normalize.js';
import type { CriterionEvidence } from './refinement.js';

/** Only constraints applied to every retrieval arm become inherited hard criteria.
 * Comparing whole OR sets avoids turning alternate retrieval arms into an AND.
 * Effective filters preserve deliberate category/style recovery in the plan. */
export function commonSourceFacets(plan: SearchPlan): Record<string, string[]> {
  const arms = plan.arms.map(arm => effectiveFilters(arm.filters, arm.category_relaxed).facets ?? {});
  if (!arms.length) return {};
  const signature = (values: string[]): string => JSON.stringify([...new Set(values)].sort());
  return Object.fromEntries(Object.entries(arms[0]!).filter(([name, values]) =>
    arms.every(facets => facets[name] !== undefined && signature(facets[name]!) === signature(values))));
}

function sourceValues(item: ItemObservation, field: string): string[] {
  switch (field) {
    case 'metadata.size': return item.size ? [item.size] : [];
    case 'metadata.brand': return item.brand ? [item.brand] : [];
    case 'metadata.color': return item.colors;
    case 'metadata.material': return item.materials;
    case 'metadata.condition': return item.condition ? [item.condition] : [];
    // Normalization retains category paths verbatim; a path is not a visual label.
    case 'categories.lvl0': case 'categories.lvl1': case 'categories.lvl2': case 'categories.lvl3': return item.categories;
    // These raw facets have no lossless normalized field. Missing is unknown.
    case 'metadata.defects.type': case 'searchableExternalCategory': return [];
    default: {
      const value = item.attributes[field.startsWith('metadata.') ? field.slice(9) : field];
      return typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
    }
  }
}

/** Match native labels exactly, including positive OR and negative exclusion. */
export function sourceFacetEvidence(item: ItemObservation, facets: Record<string, string[]> = {}): CriterionEvidence[] {
  const evidence: CriterionEvidence[] = [];
  for (const [field, requested] of Object.entries(facets)) {
    const actual = sourceValues(item, field);
    for (const priority of ['require', 'avoid'] as const) {
      const desired = requested.filter(value => value.startsWith('-') === (priority === 'avoid'))
        .map(value => priority === 'avoid' ? value.slice(1) : value);
      if (!desired.length) continue;
      evidence.push({ criterion: `source_facet:${field}:${priority}`, priority,
        verdict: !actual.length ? 'unknown' : desired.some(value => actual.includes(value)) ? 'confirmed' : 'contradicted',
        source: actual.length ? 'catalog' : 'none',
        evidence: actual.length ? `Exact source labels: ${actual.join(', ')}. Requested labels: ${desired.join(', ')}.`
          : 'No lossless normalized source value is available for this native facet; absence is not proof.' });
    }
  }
  return evidence;
}
