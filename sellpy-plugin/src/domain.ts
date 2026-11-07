export type Market = string;
export type Language = string;
export type Route = 'catalog' | 'semantic' | 'similar' | 'image' | 'upload' | 'outfit';
export type Sort = 'relevance' | 'newest' | 'price_asc' | 'price_desc';

export interface Money {
  amount_minor: number;
  currency: string;
}

export interface ItemImage {
  id: string;
  index: number;
  url: string;
  role?: string;
}

export interface ItemObservation {
  id: string;
  market: Market;
  language: Language;
  url: string;
  title: string;
  brand: string | null;
  price: Money | null;
  original_price: Money | null;
  size: string | null;
  size_system: string | null;
  condition: string | null;
  categories: string[];
  colors: string[];
  materials: string[];
  measurements: Record<string, string | number>;
  description: string | null;
  defects: string[];
  images: ItemImage[];
  availability: 'available' | 'reserved' | 'sold' | 'unknown';
  observed_at: string;
  source: 'catalog' | 'detail';
  attributes: Record<string, string | string[] | number | boolean | null>;
}

export interface SearchFilters {
  facets?: Record<string, string[]>;
  price_min?: number;
  price_max?: number;
  measurements?: Record<string, { min?: number; max?: number }>;
  include_reserved?: boolean;
}

export interface ReferenceImage {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

export interface SearchArm {
  id: string;
  route: Route;
  query?: string;
  seed_ids?: string[];
  image_url?: string;
  reference?: ReferenceImage;
  filters?: SearchFilters;
  sort?: Sort;
  category_relaxed?: boolean;
  weight?: number;
}

export interface SearchIntent {
  query: string;
  desired_type?: string;
  style?: string;
  include?: string[];
  exclude?: string[];
  modification?: string;
}

export interface SearchPlan {
  market: Market;
  language: Language;
  intent: SearchIntent;
  arms: SearchArm[];
  page_size: number;
  refresh_of?: string;
}

export interface ProviderPageRequest {
  market: Market;
  language: Language;
  arm: SearchArm;
  offset: number;
  page_size: number;
}

export interface ProviderPage {
  items: ItemObservation[];
  ranks?: Record<string, number>;
  scores?: Record<string, number>;
  next_offset: number | null;
  total: number | null;
  window: number | null;
  end_reason: 'source_exhausted' | 'upstream_window' | null;
  applied_filters: SearchFilters;
  warnings: string[];
  observed_at: string;
}

export interface ProviderError {
  code: string;
  message: string;
  retry_at?: string;
  retryable: boolean;
  next_action: string;
}

export interface DetailBatch {
  items: ItemObservation[];
  failures: { id: string; error: ProviderError }[];
  remaining_ids: string[];
}

export interface FacetResult {
  market: Market;
  language: Language;
  facets: Record<string, Record<string, number>>;
  numeric_facets: Record<string, { min: number; max: number }>;
  total: number | null;
  observed_at: string;
}

export interface ProviderCapabilities {
  markets: string[];
  languages: string[];
  routes: Record<Route, { available: boolean; evidence: string; limitation?: string }>;
  source_version: string | null;
  observed_at: string;
}

export interface RequestContext {
  deadline: number;
  signal?: AbortSignal;
  fetch: typeof fetch;
  read_reference?: (reference: ReferenceImage) => Promise<{ bytes: Uint8Array; mime_type: string; file_name: string } | null>;
}

export interface SellpyProvider {
  capabilities(context: RequestContext): Promise<ProviderCapabilities>;
  search(request: ProviderPageRequest, context: RequestContext): Promise<ProviderPage>;
  details(ids: string[], market: Market, language: Language, context: RequestContext): Promise<DetailBatch>;
  facets(query: string, filters: SearchFilters, market: Market, language: Language, context: RequestContext): Promise<FacetResult>;
}

export interface RetrievalPath {
  arm_id: string;
  route: Route;
  rank: number;
  score?: number;
  observed_at: string;
}

export interface VisualAssessment {
  item_id: string;
  checked_image_ids: string[];
  observed_type: string | null;
  matching_features: string[];
  mismatches: string[];
  uncertainties: string[];
  requirement_results: { requirement: string; verdict: 'confirmed' | 'contradicted' | 'unknown'; evidence: string }[];
  assessed_at: string;
  author: 'assistant';
}

export interface Candidate {
  item: ItemObservation;
  paths: RetrievalPath[];
  fusion_score: number;
  assessment: VisualAssessment | null;
}

export interface ArmProgress {
  id: string;
  route: Route;
  offset: number;
  pages_read: number;
  status: 'ready' | 'paused' | 'exhausted' | 'window' | 'failed';
  total: number | null;
  window: number | null;
  error: ProviderError | null;
}

export interface SearchPage {
  run_id: string;
  items: Candidate[];
  next_cursor: string | null;
  status: 'ready' | 'paused' | 'ended';
  end_reason: 'source_exhausted' | 'upstream_window' | 'time_budget' | 'rate_limited' | 'source_error' | null;
  coverage: { unique_items: number; returned_items: number; visually_assessed_items: number; pages_read: number; arms: ArmProgress[] };
  warnings: string[];
  observed_at: string;
}

export interface SelectionEntry {
  item_id: string;
  reason: string;
  cautions?: string[];
}

export interface ItemFeedback {
  item_id: string;
  decision: 'shortlist' | 'reject' | 'neutral';
  reason?: string;
  updated_at: string;
}

export interface GalleryCard {
  item: ItemObservation;
  reason: string;
  cautions: string[];
  assessment: VisualAssessment | null;
  paths: RetrievalPath[];
  feedback?: ItemFeedback;
}

export interface GalleryData {
  run_id: string;
  language: string;
  title: string;
  cards: GalleryCard[];
  next_cursor: string | null;
  warnings: string[];
}

export class ToolError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retry_at: string | undefined;
  readonly next_action: string;

  constructor(code: string, message: string, options: { retryable?: boolean; retry_at?: string; next_action?: string } = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.retry_at = options.retry_at;
    this.next_action = options.next_action ?? 'Check the input and retry the affected operation.';
  }

  toJSON(): ProviderError {
    return { code: this.code, message: this.message, retryable: this.retryable, next_action: this.next_action,
      ...(this.retry_at ? { retry_at: this.retry_at } : {}) };
  }
}
