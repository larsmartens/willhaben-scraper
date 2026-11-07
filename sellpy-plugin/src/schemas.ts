import { z } from 'zod';

const itemId = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const runId = z.string().uuid();
const text = z.string().trim().min(1).max(4000);
const optionalText = z.string().trim().max(4000).optional();
const cursor = z.string().min(1).max(32000);
const ids = z.array(itemId).min(1);
const imageId = z.string().min(1).max(250);
const profileName = z.string().trim().min(1).max(100);
const labels = z.array(z.string().trim().min(1).max(300));
export const rankingPreferencesSchema = z.strictObject({
  mode: z.enum(['balanced', 'relevance', 'price_low', 'diverse']).optional(),
  diversity: z.number().finite().min(0).max(1).optional(),
  price_min: z.number().finite().nonnegative().optional(), price_max: z.number().finite().nonnegative().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(), sizes: labels.optional(),
  source_facets: z.record(z.string().min(1).max(200), labels).optional(),
  excluded_brands: labels.optional(), preferred_brands: labels.optional(), required_materials: labels.optional(),
  excluded_materials: labels.optional(), preferred_materials: labels.optional(),
  measurements: z.record(z.string().min(1).max(200), z.strictObject({ min: z.number().finite().nonnegative().optional(), max: z.number().finite().nonnegative().optional() })).optional(),
  requirements: z.array(z.strictObject({ requirement: text, priority: z.enum(['require', 'avoid', 'prefer']) })).optional(),
  unknown_policy: z.enum(['keep', 'exclude']).optional(), include_reserved: z.boolean().optional()
});
export const filtersSchema = z.strictObject({
  facets: z.record(z.string().min(1).max(200), z.array(z.string().max(300)).min(1)).optional(),
  price_min: z.number().finite().nonnegative().optional(),
  price_max: z.number().finite().nonnegative().optional(),
  measurements: z.record(z.string().min(1).max(200), z.strictObject({ min: z.number().finite().optional(), max: z.number().finite().optional() })).optional(),
  include_reserved: z.boolean().optional()
});

export const referenceSchema = z.strictObject({
  download_url: z.string().url().max(16000),
  file_id: z.string().min(1).max(250),
  mime_type: z.string().max(100).optional(),
  file_name: z.string().max(300).optional()
});

const common = {
  market: z.string().regex(/^[A-Z]{2}$/).default('AT'),
  language: z.string().regex(/^[a-z]{2}$/).default('de'),
  page_size: z.number().int().min(1).max(200).default(50).describe('Per-call result budget. All remaining results stay reachable through continuation; no cumulative cap.'),
  filters: filtersSchema.optional()
};

export const inputSchemas = {
  get_capabilities: z.strictObject({}),
  discover_filters: z.strictObject({ ...common, query: z.string().max(4000).default('') }),
  search_items: z.strictObject({ ...common, query: z.string().max(4000).default(''), sort: z.enum(['relevance','newest','price_asc','price_desc']).default('relevance') }),
  search_style: z.strictObject({ ...common, query: text, style: text, desired_type: optionalText,
    attribute_queries: z.array(text).min(1).describe('English descriptions of visible style features, tailored to the user.'),
    relaxed_queries: z.array(text).min(1).describe('Visible-attribute descriptions that do not require the desired garment category or its name. Enables discovery of mislabeled items.'),
    include: z.array(text).optional(), exclude: z.array(text).optional(), seed_ids: ids.optional() }),
  find_similar: z.strictObject({ ...common, seed_ids: ids, relax_categories: z.boolean().default(true), query: optionalText }),
  search_url: z.strictObject({ url: z.string().url().max(16000), market: z.string().regex(/^[A-Z]{2}$/).optional(), language: z.string().regex(/^[a-z]{2}$/).optional(), page_size: common.page_size }),
  search_similar_brands: z.strictObject({ market: common.market, language: common.language, brands: z.array(z.string().trim().min(1).max(300)).min(1).max(20), limit: z.number().int().min(1).max(100).default(12) }),
  search_by_image: z.strictObject({ ...common, reference: referenceSchema.optional(), image_url: z.string().url().max(16000).optional(),
    public_image_url: z.string().url().max(16000).optional(),
    item_image: z.strictObject({ run_id: runId, item_id: itemId, image_index: z.number().int().nonnegative().default(0) }).optional(),
    modification: optionalText, attribute_queries: z.array(text).optional(), exclude: z.array(text).optional(), desired_type: optionalText }),
  find_outfit: z.strictObject({ ...common, item_id: itemId }),
  continue_search: z.strictObject({ cursor }),
  get_search_status: z.strictObject({ run_id: runId }),
  list_search_items: z.strictObject({ run_id: runId, offset: z.number().int().nonnegative().default(0), page_size: common.page_size }),
  get_items: z.strictObject({ run_id: runId.optional(), ids, start_index: z.number().int().nonnegative().default(0),
    batch_size: z.number().int().min(1).max(20).default(8), for_model: z.boolean().default(true), market: common.market, language: common.language }),
  get_item_images: z.strictObject({ run_id: runId, item_id: itemId, start_index: z.number().int().nonnegative().default(0),
    batch_size: z.number().int().min(1).max(20).default(4), for_model: z.boolean().default(true), refresh_details: z.boolean().default(true) }),
  record_visual_assessment: z.strictObject({ run_id: runId, item_id: itemId, checked_image_ids: z.array(imageId).min(1),
    observed_type: z.string().max(300).nullable(), matching_features: z.array(text), mismatches: z.array(text), uncertainties: z.array(text),
    requirement_results: z.array(z.strictObject({ requirement: text, verdict: z.enum(['confirmed','contradicted','unknown']), evidence: text })) }),
  present_items: z.strictObject({ run_id: runId, for_model: z.boolean().default(true), title: z.string().max(300).default('Sellpy Auswahl'),
    selection: z.array(z.strictObject({ item_id: itemId, reason: z.string().max(2000), cautions: z.array(text).optional() })).min(1).optional(),
    source: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('observed') }), z.strictObject({ kind: z.literal('arm'), arm_id: z.string().min(1).max(300) }),
      z.strictObject({ kind: z.literal('refinement'), refinement_id: runId }), z.strictObject({ kind: z.literal('shortlist') })]).optional(),
    request_id: z.string().min(1).max(200).optional(), cursor: cursor.optional(), page_size: z.number().int().min(1).max(24).default(12) }),
  browse_collection: z.strictObject({ run_id: runId, collection_id: runId, cursor: cursor.optional(), page_size: z.number().int().min(1).max(24).default(12),
    action: z.enum(['page','derive','details','coverage']).default('page'), request_id: z.string().min(1).max(200).optional(),
    view: z.strictObject({ kind: z.enum(['shortlist','available','assessed','unassessed','price_asc','price_desc','source_order']) }).optional(), item_id: itemId.optional() }),
  save_search: z.strictObject({ run_id: runId, label: z.string().min(1).max(200), note: z.string().max(4000).default('') }),
  list_saved_searches: z.strictObject({ offset: z.number().int().nonnegative().default(0), page_size: z.number().int().min(1).max(100).default(20) }),
  get_preferences: z.strictObject({ profile: profileName.default('default') }),
  set_preferences: z.strictObject({ profile: profileName.default('default'), preferences: rankingPreferencesSchema }),
  set_item_feedback: z.strictObject({ run_id: runId, item_id: itemId, decision: z.enum(['shortlist', 'reject', 'neutral']), reason: z.string().max(2000).optional() }),
  list_item_feedback: z.strictObject({ run_id: runId, decision: z.enum(['shortlist', 'reject', 'neutral', 'all']).default('shortlist'), after: z.number().int().nonnegative().default(0), page_size: common.page_size }),
  refine_search: z.strictObject({ run_id: runId, preferences: rankingPreferencesSchema.optional(), profile: profileName.optional(), use_profile: z.boolean().default(true), cursor: cursor.optional(), page_size: common.page_size }),
  get_item_history: z.strictObject({ run_id: runId, item_id: itemId, for_model: z.boolean().default(true), after: z.number().int().nonnegative().default(0), page_size: common.page_size }),
  refresh_search: z.strictObject({ run_id: runId, page_size: z.number().int().min(1).max(200).optional() }),
  forget_search: z.strictObject({ run_id: runId })
};

export type ToolName = keyof typeof inputSchemas;

export const toolDescriptions: Record<ToolName,string> = {
  get_capabilities: 'Read current Sellpy markets and native catalog, semantic, similarity, image-upload and outfit capabilities. No shopping account required.',
  discover_filters: 'Discover actual native Sellpy facets and measurement ranges before applying unfamiliar filters. Prices are market currency major units.',
  search_url: 'Import a Sellpy search URL with exact supported native shopper filters. Starts from the first provider page; URL page numbers are not plugin cursors. Unknown shopper restrictions are rejected explicitly.',
  search_similar_brands: 'Discover Sellpy native similar brand names and brand object identifiers. This is brand discovery only: it does not search inventory or return item IDs. Search returned brand names separately to check current items.',
  search_items: 'Search current Sellpy inventory. Read one page, then follow next_cursor as needed. Each item includes its own image references, price and observation time. No cumulative page limit.',
  search_style: 'Discover clothing by visible style features using catalog, native semantic and category-relaxed search arms. Supply concrete English attribute_queries plus relaxed_queries without the garment type. Inspect actual images before visual claims.',
  find_similar: 'Use Sellpy native item-similarity to expand from known item IDs. Category relaxation helps find mislabeled garments. Continue using next_cursor.',
  search_by_image: 'Use Sellpy native image search with exactly one ChatGPT reference file, Sellpy image URL, stored item_image, or public_image_url. Public references are safely downloaded, retained privately and uploaded to the native image route. Uploaded files are retained privately with this search for continuation. Include English attribute_queries that express desired changes, then inspect actual candidate images.',
  find_outfit: 'Find native complementary outfit pieces for a known Sellpy item. Provider recommendation windows are reported honestly.',
  continue_search: 'Continue a search without a cumulative page or item cap. Repeating the same cursor replays its result. For a paused page use its new next_cursor after any retry_at.',
  get_search_status: 'Read search criteria, per-route progress, source windows, errors, unique candidates and actual model-visible image assessments.',
  list_search_items: 'Page through all already discovered candidates without refetching Sellpy. Useful for a wider visual review or a changed selection.',
  get_items: 'Fetch current canonical details and complete image references for selected Sellpy IDs. Follow next_index with the same IDs until all requested items are reached.',
  get_item_images: 'Fetch actual original image pixels for visual inspection. All available image indices remain reachable. Set for_model true for model image evidence, false for widget-only hydration. Preserve item-to-image identity.',
  record_visual_assessment: 'Record an assistant visual assessment only after actual image content was fetched for the model. Preserve source categories, include examined image IDs, concrete evidence and uncertainty; do not invent material or dimensions.',
  present_items: 'Present stored Sellpy results in a stable collection: omit selection for all observed candidates, choose an arm/refinement/shortlist source, or supply an intentional ordered selection. Default 12 cards, optional 24. Every discovered result remains reachable in the app without a model ID list. Browsing does not refresh source details.',
  browse_collection: 'App-only stable collection navigation, stored details, coverage and derived shortlist/filter/sort views. Follow returned cursors; preparing views resume bounded work. No provider search or detail refresh is performed.',
  save_search: 'Save an existing search under a user-requested label for later reuse. The search remains private to this connection; no automatic expiry.',
  list_saved_searches: 'List this connection’s saved searches with pagination. Follow offsets for all saved entries.',
  get_preferences: 'Read a named private preference profile. The default profile is applied by refine_search unless use_profile is false. This does not infer body measurements or clothing fit.',
  set_preferences: 'Replace a named private preference profile only when the user asks to remember these criteria. Use exact source size/material labels and measurement keys; prices need currency. An empty preferences object clears its criteria.',
  set_item_feedback: 'Set an explicit user decision for a known item: shortlist to favor it, reject to hide it from future refinements, neutral to clear. This is user preference, never visual evidence. Existing refinement cursors stay immutable; start a new refinement for the changed decision.',
  list_item_feedback: 'List this search’s shortlist or other explicit user decisions with current stored item facts. Follow next_after for all entries. It does not refresh source prices.',
  refine_search: 'Rerank all discovered candidates using hard constraints, soft preferences, recorded image evidence and explicit user feedback. Unknown is distinct from confirmed or contradicted. The default saved profile applies unless disabled; supplied preference fields override it. Visual requirements match exact recorded requirement text. Uses a bounded metadata-diversity window and durable immutable continuation without a total candidate cap. Follow this tool’s next_cursor with refine_search, not continue_search.',
  get_item_history: 'Read this run’s actually observed price, availability and attribute snapshots with pagination. No historical prices before observation, retail value, future discounts or continuous monitoring are inferred.',
  refresh_search: 'Start a fresh inventory search from an existing run’s exact criteria, retaining the old run. Reuses privately stored reference images and identifies newly encountered IDs versus that old run on each returned page. It does not schedule background monitoring.',
  forget_search: 'Permanently delete the specified private search, its retained reference images, candidates, assessments, feedback, histories and saved bookmark. Use only when the user explicitly requests deletion. Other searches and preference profiles remain separate.'
};
