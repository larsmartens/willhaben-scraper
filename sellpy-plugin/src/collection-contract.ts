import type { GalleryCard, SearchFilters } from './domain.js';

/** Stable membership/order. Card observations can be newer and keep their own timestamps. */
export interface CollectionDescriptor {
  id: string;
  source: { kind: 'observed' | 'arm' | 'selection' | 'shortlist' | 'refinement' | 'derived'; arm_id?: string; refinement_id?: string; base_collection_id?: string; view?: CollectionView['kind'] };
  created_at: string;
  membership_as_of: string;
  order: 'discovery' | 'arm_discovery' | 'selection' | 'shortlist' | 'refinement' | 'price_asc' | 'price_desc';
  total: number | null;
  status: 'ready' | 'preparing';
  progress?: { scanned: number; cohort: number };
  evaluation?: { started_at: string; completed_at: string | null; observations_from: string | null; observations_to: string | null };
}

export interface CollectionPageInfo {
  size: number;
  start: number;
  end: number;
  cursor: string | null;
  previous_cursor: string | null;
  next_cursor: string | null;
}

export interface CollectionArmScope {
  arm_id: string;
  route: string;
  query: string | null;
  filters: SearchFilters;
  category_relaxed: boolean;
  pages: number;
  candidates: number | null;
  native_total: number | null;
  native_window: number | null;
  status: string;
  observed_at: string | null;
}

export interface CollectionScope {
  observed_at: string;
  candidates: number;
  search_pages: number;
  detail_observations: number | null;
  stored_descriptions: number | null;
  model_delivered_photos: number;
  model_delivered_fact_items: number | null;
  model_delivered_description_items: number | null;
  widget_delivered_photos: number | null;
  recorded_assessments: number;
  collection_members: number | null;
  arms: CollectionArmScope[];
  notes: string[];
}

export type CollectionSource =
  | { kind: 'observed' }
  | { kind: 'arm'; arm_id: string }
  | { kind: 'shortlist' }
  | { kind: 'refinement'; refinement_id: string };

export type CollectionView = { kind: 'shortlist' | 'available' | 'assessed' | 'unassessed' | 'price_asc' | 'price_desc' | 'source_order' };

export interface CollectionBrowseInput {
  run_id: string;
  collection_id: string;
  cursor?: string;
  page_size?: number;
  action?: 'page' | 'derive' | 'details' | 'coverage';
  request_id?: string;
  view?: CollectionView;
  item_id?: string;
}

/** App metadata result for details; never implies source refresh or visual inspection. */
export interface CollectionDetail {
  run_id: string;
  collection_id: string;
  request_id?: string;
  card: GalleryCard;
}
