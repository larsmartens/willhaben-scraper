import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ItemObservation } from '../src/domain.js';
import { commonSourceFacets, sourceFacetEvidence } from '../src/facet-evidence.js';
import { stylePlan } from '../src/planning.js';

test('inherits common effective facets without undoing category and style recovery', () => {
  const plan = stylePlan({ market: 'AT', language: 'de', page_size: 20, query: 'dress', style: 'cottagecore',
    attribute_queries: ['floral dress'], relaxed_queries: ['floral lace'], filters: { facets: {
      'metadata.size': ['WMN-INT-M', 'WMN-INT-S'], 'metadata.type': ['Dress'], 'metadata.demography': ['Woman'],
      'categories.lvl1': ['Clothing > Dresses'], style: ['Boho'], 'metadata.material': ['Cotton'],
    } } });
  assert.deepEqual(commonSourceFacets(plan), { 'metadata.size': ['WMN-INT-M', 'WMN-INT-S'], 'metadata.material': ['Cotton'] });
  plan.arms[1]!.filters!.facets!['metadata.size'] = ['WMN-INT-L'];
  assert.deepEqual(commonSourceFacets(plan), { 'metadata.material': ['Cotton'] });
});

test('native positive OR, negative exclusion, exact spelling and missing evidence remain distinct', () => {
  const item = { size: 'WMN-INT-M', materials: ['Cotton'], attributes: { pattern: 'Floral' }, categories: [] } as unknown as ItemObservation;
  const evidence = sourceFacetEvidence(item, { 'metadata.size': ['WMN-INT-S', 'WMN-INT-M'],
    'metadata.material': ['Cotton', '-Wool'], 'metadata.pattern': ['floral'], 'metadata.defects.type': ['-Hole'] });
  assert.deepEqual(evidence.map(({ criterion, verdict }) => [criterion, verdict]), [
    ['source_facet:metadata.size:require', 'confirmed'], ['source_facet:metadata.material:require', 'confirmed'],
    ['source_facet:metadata.material:avoid', 'contradicted'], ['source_facet:metadata.pattern:require', 'contradicted'],
    ['source_facet:metadata.defects.type:avoid', 'unknown'],
  ]);
});
