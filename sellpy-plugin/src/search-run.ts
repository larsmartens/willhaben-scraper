import { DurableObject } from 'cloudflare:workers';
import { type Candidate, type ItemObservation, type SearchPage, type SearchPlan, type VisualAssessment } from './domain.js';
import { createSellpyProvider } from './sellpy/client.js';
import { SearchStore, parseSearchCursor, type Bookmark, type PresentationRecord, type StoredReference } from './search-store.js';
import { createProviderContext } from './traffic.js';

export class SearchRun extends DurableObject<Env> {
  private readonly state: SearchStore;
  private readonly provider = createSellpyProvider();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = new SearchStore(ctx.storage.sql, operation => ctx.storage.transactionSync(operation));
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
  async updateItems(items: ItemObservation[]): Promise<void> { this.state.updateItems(items); }
  async recordAssessment(assessment: VisualAssessment): Promise<void> { this.state.recordAssessment(assessment); }
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
}
