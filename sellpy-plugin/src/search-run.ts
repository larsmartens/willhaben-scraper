import { DurableObject } from 'cloudflare:workers';
import { type Candidate, type ItemFeedback, type ItemObservation, type SearchPage, type SearchPlan, type VisualAssessment } from './domain.js';
import { createSellpyProvider } from './sellpy/client.js';
import { SearchStore, parseSearchCursor, type Bookmark, type PresentationRecord, type StoredReference } from './search-store.js';
import { createProviderContext } from './traffic.js';
import { ResearchStore, type PreferenceProfile, type RefinementPage } from './research-store.js';
import type { RankingPreferences } from './refinement.js';
import { CollectionStore, type OpenCollectionInput, type PageCollectionInput } from './collection-store.js';
import type { CollectionView } from './collection-contract.js';
import type { ObservedItemChange } from './observations.js';

export class SearchRun extends DurableObject<Env> {
  private readonly state: SearchStore;
  private readonly research: ResearchStore;
  private readonly collections: CollectionStore;
  private readonly provider = createSellpyProvider();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = new SearchStore(ctx.storage.sql, operation => ctx.storage.transactionSync(operation));
    this.research = new ResearchStore(ctx.storage.sql, operation => ctx.storage.transactionSync(operation), this.state);
    this.collections = new CollectionStore(ctx.storage.sql, operation => ctx.storage.transactionSync(operation), this.state, this.research);
  }

  private context(deadline?: number) {
    return { ...createProviderContext(this.env, Math.min(deadline ?? Infinity, Date.now() + 30_000)),
      read_reference: async (reference: { file_id: string }) => this.state.getReference(reference.file_id) };
  }

  async start(plan: SearchPlan, runId: string, deadline?: number): Promise<SearchPage> {
    this.state.initialize(plan, runId);
    return this.state.advance(0, this.provider, this.context(deadline));
  }

  async continue(cursor: string, deadline?: number): Promise<SearchPage> {
    const value = parseSearchCursor(cursor);
    const { plan } = this.state.status();
    this.state.initialize(plan, value.run_id);
    return this.state.advance(value.step, this.provider, this.context(deadline));
  }

  async getCandidates(ids: string[]): Promise<Candidate[]> { return this.state.getCandidates(ids); }
  async updateItems(items: ItemObservation[]): Promise<ObservedItemChange[]> { return this.state.updateItems(items); }
  async recordAssessment(assessment: VisualAssessment): Promise<void> { this.state.recordAssessment(assessment); }
  async markWidgetImagesDelivered(itemId: string, imageIds: string[]): Promise<void> { this.state.markWidgetImagesDelivered(itemId, imageIds); }
  async markModelItemsDelivered(values: { item_id: string; description: boolean }[]): Promise<void> { this.state.markModelItemsDelivered(values); }
  async markImagesDelivered(itemId: string, imageIds: string[]): Promise<void> { this.state.markImagesDelivered(itemId, imageIds); }
  async status(): Promise<{ plan: SearchPlan; coverage: SearchPage['coverage'] }> { return this.state.status(); }
  async listCandidates(offset: number, limit: number): Promise<{ items: Candidate[]; next_offset: number | null }> { return this.state.listCandidates(offset, limit); }

  async storeReference(fileId: string, bytes: Uint8Array, mimeType: string, fileName: string): Promise<void> {
    await this.state.storeReference(fileId, bytes, mimeType, fileName);
  }
  async getReference(fileId: string): Promise<StoredReference | null> { return this.state.getReference(fileId); }
  async storePresentation(id: string, value: PresentationRecord): Promise<void> { this.state.storePresentation(id, value); }
  async getPresentation(id: string): Promise<PresentationRecord | null> { return this.state.getPresentation(id); }
  async saveBookmark(value: Bookmark): Promise<void> { this.state.saveBookmark(value); }
  async listBookmarks(offset: number, limit: number): Promise<{ items: Bookmark[]; next_offset: number | null }> { return this.state.listBookmarks(offset, limit); }
  async removeBookmark(runId: string): Promise<void> { this.state.removeBookmark(runId); }
  async getProfile(name: string): Promise<PreferenceProfile | null> { this.state.assertActive(); return this.research.getProfile(name); }
  async setProfile(name: string, preferences: RankingPreferences): Promise<PreferenceProfile> { this.state.assertActive(); return this.research.setProfile(name, preferences); }
  async setFeedback(itemId: string, decision: ItemFeedback['decision'], reason?: string): Promise<ItemFeedback> {
    this.state.status(); return this.research.setFeedback(itemId, decision, reason);
  }
  async getFeedback(ids: string[]): Promise<Record<string, ItemFeedback>> { this.state.assertActive(); return this.research.getFeedback(ids); }
  async inheritFeedback(values: ItemFeedback[]): Promise<void> { this.state.status(); this.research.inheritFeedback(values); }
  async responseNotes(step: number): Promise<Record<string, unknown> | null> { this.state.status(); return this.research.responseNotes(step); }
  async saveResponseNotes(step: number, value: Record<string, unknown>): Promise<Record<string, unknown>> { this.state.status(); return this.research.saveResponseNotes(step, value); }
  async listFeedback(decision: ItemFeedback['decision'] | 'all', after: number, limit: number) {
    this.state.status(); return this.research.listFeedback(decision, after, limit);
  }
  async refine(runId: string, preferences: RankingPreferences, pageSize: number): Promise<RefinementPage> {
    const { plan } = this.state.status(); this.state.initialize(plan, runId);
    const id = this.research.createRefinement(runId, preferences, pageSize);
    return this.research.advanceRefinement(id, 0);
  }
  async continueRefinement(id: string, step: number): Promise<RefinementPage> {
    this.state.status(); return this.research.advanceRefinement(id, step);
  }
  async openCollection(input: OpenCollectionInput) { return this.collections.open(input); }
  async pageCollection(id: string, input: PageCollectionInput = {}) { return this.collections.page(id, input); }
  async deriveCollection(id: string, view: CollectionView, requestId?: string, pageSize = 12) { return this.collections.derive(id, view, requestId, pageSize); }
  async legacyCollection(id: string, offset: number, requestId?: string) { return this.collections.legacy(id, offset, requestId); }
  async collectionDetail(id: string, itemId: string) { return this.collections.detail(id, itemId); }
  async collectionScope(id: string) { return this.collections.scope(id); }
  async itemHistory(itemId: string, after: number, limit: number) { return this.state.itemHistory(itemId, after, limit); }
  async forget(): Promise<{ deleted: true }> {
    this.ctx.storage.transactionSync(() => { this.collections.erase(); this.research.erase(); this.state.erase(); });
    return { deleted: true };
  }
}
