import type { ItemObservation } from './domain.js';

export const OBSERVED_FIELDS = ['price', 'availability', 'size', 'size_system', 'condition', 'materials', 'measurements', 'defects'] as const;
type ObservedField = typeof OBSERVED_FIELDS[number];
export type ItemSnapshot = Pick<ItemObservation, ObservedField | 'id' | 'market' | 'observed_at' | 'source'>;
export interface ObservedItemChange {
  item_id: string;
  market: string;
  previous_observed_at: string;
  observed_at: string;
  changes: { field: ObservedField; previous: ItemSnapshot[ObservedField]; current: ItemSnapshot[ObservedField] }[];
}

export function itemSnapshot(item: ItemObservation): ItemSnapshot {
  return { id: item.id, market: item.market, observed_at: item.observed_at, source: item.source,
    price: item.price, availability: item.availability, size: item.size, size_system: item.size_system,
    condition: item.condition, materials: item.materials, measurements: item.measurements, defects: item.defects };
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => nested && typeof nested === 'object' && !Array.isArray(nested)
    ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested);
}

export function observationChanges(before: ItemSnapshot, after: ItemSnapshot): ObservedItemChange | null {
  if (before.id !== after.id || before.market !== after.market || Date.parse(after.observed_at) < Date.parse(before.observed_at)) return null;
  const changes = OBSERVED_FIELDS.filter(field => canonical(before[field]) !== canonical(after[field]))
    .map(field => ({ field, previous: before[field], current: after[field] }));
  return changes.length ? { item_id: after.id, market: after.market, previous_observed_at: before.observed_at,
    observed_at: after.observed_at, changes } : null;
}
