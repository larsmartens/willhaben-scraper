import {
  ToolError,
  type ArmProgress,
  type Candidate,
  type ItemObservation,
  type ProviderError,
  type ProviderPage,
  type RequestContext,
  type RetrievalPath,
  type SearchArm,
  type SearchPage,
  type SearchPlan,
  type SelectionEntry,
  type SellpyProvider,
  type VisualAssessment,
} from './domain.js';
import { assessmentStillApplies, preferObservation, reciprocalRankScore } from './ranking.js';
import { itemSnapshot, observationChanges, type ItemSnapshot, type ObservedItemChange } from './observations.js';

type SqlValue = string | number | ArrayBuffer | null;
export interface SqlPort {
  exec<T extends Record<string, SqlValue>>(query: string, ...bindings: unknown[]): { toArray(): T[] };
}
export type Atomic = <T>(operation: () => T) => T;
export interface SearchCursor { v: 1; run_id: string; step: number }
export interface PresentationRecord { title: string; selection: SelectionEntry[]; page_size: number }
export interface Bookmark { run_id: string; label: string; note: string; saved_at: string }
export interface StoredReference { bytes: Uint8Array; mime_type: string; file_name: string }

type RunRow = { run_id: string; plan_json: string; next_step: number; arm_turn: number };
type ArmRow = { id: string; ordinal: number; spec_json: string; offset: number; pages_read: number; status: ArmProgress['status']; total: number | null; window_size: number | null; error_json: string | null };
type CandidateRow = { sequence: number; item_id: string; item_json: string; assessment_json: string | null; fusion_score: number; returned_step: number | null };
type PathRow = { arm_id: string; route: RetrievalPath['route']; source_rank: number; source_score: number | null; observed_at: string };
type OperationRow = { step: number; generation: number; nonce: string; lease_until: number; response_json: string | null };
type Lease = { step: number; generation: number; nonce: string };
type ReferenceRow = { mime_type: string; file_name: string; hash: string; byte_length: number };

const RESPONSE_BYTES = 1_250_000;
const WORK_PAGES = 8;
const SQL_CHUNK = 128;
const REFERENCE_CHUNK_BYTES = 256 * 1024;
const encoder = new TextEncoder();

const schema = [
  'CREATE TABLE IF NOT EXISTS lifecycle (id INTEGER PRIMARY KEY CHECK(id=1), deleted INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS run (id INTEGER PRIMARY KEY CHECK(id=1), run_id TEXT NOT NULL, plan_json TEXT NOT NULL, next_step INTEGER NOT NULL DEFAULT 0, arm_turn INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS arms (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, spec_json TEXT NOT NULL, offset INTEGER NOT NULL DEFAULT 0, pages_read INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT \'ready\', total INTEGER, window_size INTEGER, error_json TEXT)',
  'CREATE TABLE IF NOT EXISTS candidates (sequence INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL UNIQUE, item_json TEXT NOT NULL, assessment_json TEXT, fusion_score REAL NOT NULL DEFAULT 0, returned_step INTEGER)',
  'CREATE INDEX IF NOT EXISTS pending_candidates ON candidates(returned_step, fusion_score DESC, sequence)',
  'CREATE TABLE IF NOT EXISTS retrieval_paths (item_id TEXT NOT NULL, arm_id TEXT NOT NULL, route TEXT NOT NULL, source_rank INTEGER NOT NULL, source_score REAL, observed_at TEXT NOT NULL, PRIMARY KEY(item_id,arm_id))',
  'CREATE INDEX IF NOT EXISTS arm_candidates ON retrieval_paths(arm_id,source_rank,item_id)',
  'CREATE TABLE IF NOT EXISTS operations (step INTEGER PRIMARY KEY, generation INTEGER NOT NULL, nonce TEXT NOT NULL, lease_until REAL NOT NULL, response_json TEXT)',
  'CREATE TABLE IF NOT EXISTS warnings (message TEXT PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS image_evidence (item_id TEXT NOT NULL, image_id TEXT NOT NULL, delivered_at TEXT NOT NULL, PRIMARY KEY(item_id,image_id))',
  'CREATE TABLE IF NOT EXISTS reference_files (file_id TEXT PRIMARY KEY, mime_type TEXT NOT NULL, file_name TEXT NOT NULL, hash TEXT NOT NULL, byte_length INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS reference_chunks (file_id TEXT NOT NULL, ordinal INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(file_id,ordinal))',
  'CREATE TABLE IF NOT EXISTS presentations (id TEXT PRIMARY KEY, value_json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS bookmarks (sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL UNIQUE, value_json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS item_observations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, snapshot_json TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS item_observation_history ON item_observations(item_id,sequence)',
];

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, child: unknown) => {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      return Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)));
    }
    return child;
  });
}

export function encodeSearchCursor(runId: string, step: number): string {
  return btoa(JSON.stringify({ v: 1, run_id: runId, step })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function parseSearchCursor(cursor: string): SearchCursor {
  try {
    if (typeof cursor !== 'string' || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const parsed: unknown = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')));
    if (!parsed || typeof parsed !== 'object') throw new Error();
    const value = parsed as Record<string, unknown>;
    if (value.v !== 1 || typeof value.run_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.run_id) ||
        typeof value.step !== 'number' || !Number.isSafeInteger(value.step) || value.step < 0 ||
        Object.keys(value).some(key => !['v', 'run_id', 'step'].includes(key))) throw new Error();
    return { v: 1, run_id: value.run_id, step: value.step };
  } catch {
    throw new ToolError('invalid_cursor', 'This is not a valid search continuation cursor.', { next_action: 'Use the exact next_cursor returned by this search.' });
  }
}

function errorFor(cause: unknown): ProviderError {
  if (cause instanceof ToolError) return cause.toJSON();
  return { code: 'provider_failure', message: 'The provider request did not complete successfully.', retryable: true,
    next_action: 'Continue the search to retry this source without losing successful results.' };
}

function safeCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new ToolError('invalid_argument', `${name} must be a nonnegative safe integer.`);
}

export class SearchStore {
  constructor(private readonly sql: SqlPort, private readonly atomic: Atomic, private readonly now: () => number = Date.now) {
    for (const statement of schema) this.sql.exec(statement);
  }

  private rows<T extends Record<string, SqlValue>>(query: string, ...bindings: unknown[]): T[] {
    this.assertActive();
    return this.sql.exec<T>(query, ...bindings).toArray();
  }

  isForgotten(): boolean {
    return this.sql.exec<{ deleted: number }>('SELECT deleted FROM lifecycle WHERE id=1').toArray()[0]?.deleted === 1;
  }

  assertActive(): void {
    if (this.isForgotten()) throw new ToolError('search_forgotten', 'This search and its retained references were deleted.', { next_action: 'Start a new search. Deleted search identifiers cannot be reused.' });
  }

  private run(): RunRow {
    const row = this.rows<RunRow>('SELECT run_id,plan_json,next_step,arm_turn FROM run WHERE id=1')[0];
    if (!row) throw new ToolError('search_not_found', 'This search run has not been initialized.', { next_action: 'Start a new search or use an existing run_id.' });
    return row;
  }

  initialize(plan: SearchPlan, runId: string): void {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw new ToolError('invalid_run_id', 'The search identifier is invalid.');
    if (!Number.isSafeInteger(plan.page_size) || plan.page_size < 1) throw new ToolError('invalid_page_size', 'page_size must be a positive safe integer.');
    if (!plan.market || !plan.language || !Array.isArray(plan.arms)) throw new ToolError('invalid_plan', 'The search plan requires market, language and retrieval arms.');
    const ids = new Set<string>();
    for (const arm of plan.arms) {
      if (!arm.id || ids.has(arm.id) || (arm.weight !== undefined && (!Number.isFinite(arm.weight) || arm.weight <= 0))) {
        throw new ToolError('invalid_plan', 'Retrieval arms need unique IDs and positive finite weights.');
      }
      ids.add(arm.id);
    }
    const json = stable(plan);
    this.atomic(() => {
      const existing = this.rows<RunRow>('SELECT run_id,plan_json,next_step,arm_turn FROM run WHERE id=1')[0];
      if (existing) {
        if (existing.run_id !== runId || existing.plan_json !== json) throw new ToolError('search_conflict', 'This run already belongs to a different search plan.', { next_action: 'Start a new run for changed criteria; keep this cursor for the original plan.' });
        return;
      }
      this.sql.exec('INSERT INTO run(id,run_id,plan_json) VALUES(1,?,?)', runId, json);
      plan.arms.forEach((arm, ordinal) => this.sql.exec('INSERT INTO arms(id,ordinal,spec_json) VALUES(?,?,?)', arm.id, ordinal, JSON.stringify(arm)));
    });
  }

  private armRows(): ArmRow[] {
    return this.rows<ArmRow>('SELECT * FROM arms ORDER BY ordinal');
  }

  private progress(row: ArmRow): ArmProgress {
    const spec = JSON.parse(row.spec_json) as SearchArm;
    return { id: row.id, route: spec.route, offset: row.offset, pages_read: row.pages_read, status: row.status,
      total: row.total, window: row.window_size, error: row.error_json ? JSON.parse(row.error_json) as ProviderError : null };
  }

  coverage(): SearchPage['coverage'] {
    this.run();
    const counts = this.rows<{ unique_items: number; returned_items: number; visually_assessed_items: number }>(
      'SELECT COUNT(*) AS unique_items,COALESCE(SUM(returned_step IS NOT NULL),0) AS returned_items,COALESCE(SUM(assessment_json IS NOT NULL),0) AS visually_assessed_items FROM candidates')[0]!;
    const arms = this.armRows().map(row => this.progress(row));
    return { ...counts, pages_read: arms.reduce((sum, arm) => sum + arm.pages_read, 0), arms };
  }

  status(): { plan: SearchPlan; coverage: SearchPage['coverage'] } {
    return { plan: JSON.parse(this.run().plan_json) as SearchPlan, coverage: this.coverage() };
  }

  private candidate(row: CandidateRow): Candidate {
    const paths = this.rows<PathRow>('SELECT arm_id,route,source_rank,source_score,observed_at FROM retrieval_paths WHERE item_id=? ORDER BY arm_id', row.item_id)
      .map(path => ({ arm_id: path.arm_id, route: path.route, rank: path.source_rank,
        ...(path.source_score !== null ? { score: path.source_score } : {}), observed_at: path.observed_at }));
    return { item: JSON.parse(row.item_json) as ItemObservation, paths, fusion_score: row.fusion_score,
      assessment: row.assessment_json ? JSON.parse(row.assessment_json) as VisualAssessment : null };
  }

  getCandidates(ids: string[]): Candidate[] {
    const result: Candidate[] = [];
    for (const id of new Set(ids)) {
      const row = this.rows<CandidateRow>('SELECT * FROM candidates WHERE item_id=?', id)[0];
      if (row) result.push(this.candidate(row));
    }
    return result;
  }

  listCandidates(offset: number, limit: number): { items: Candidate[]; next_offset: number | null } {
    safeCount(offset, 'offset');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new ToolError('invalid_batch_size', 'Use 1 to 500 items per call and follow next_offset for further items.');
    const rows = this.rows<CandidateRow>('SELECT * FROM candidates ORDER BY sequence LIMIT ? OFFSET ?', limit + 1, offset);
    return { items: rows.slice(0, limit).map(row => this.candidate(row)), next_offset: rows.length > limit ? offset + limit : null };
  }

  snapshotCohort(): { max_sequence: number; total: number } {
    this.run();
    return this.rows<{ max_sequence: number; total: number }>('SELECT COALESCE(MAX(sequence),0) AS max_sequence,COUNT(*) AS total FROM candidates')[0]!;
  }

  scanCandidates(after: number, maximum: number, limit: number): { sequence: number; candidate: Candidate }[] {
    safeCount(after, 'after'); safeCount(maximum, 'maximum');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new ToolError('invalid_batch_size', 'Scan 1 to 500 candidates per call.');
    return this.rows<CandidateRow>('SELECT * FROM candidates WHERE sequence>? AND sequence<=? ORDER BY sequence LIMIT ?', after, maximum, limit)
      .map(row => ({ sequence: row.sequence, candidate: this.candidate(row) }));
  }

  private validateObservation(item: ItemObservation, plan: SearchPlan): void {
    if (!item.id || item.market.toUpperCase() !== plan.market.toUpperCase() || !Number.isFinite(Date.parse(item.observed_at))) {
      throw new ToolError('provider_contract', 'A product observation has an invalid identity, market or observation time.', { retryable: true });
    }
    if (item.price && (!Number.isSafeInteger(item.price.amount_minor) || item.price.amount_minor < 0 || !item.price.currency)) {
      throw new ToolError('provider_contract', 'A product price is not a valid amount in minor currency units.', { retryable: true });
    }
  }

  private putObservation(item: ItemObservation): ObservedItemChange | null {
    const row = this.rows<CandidateRow>('SELECT * FROM candidates WHERE item_id=?', item.id)[0];
    if (!row) {
      this.sql.exec('INSERT INTO candidates(item_id,item_json) VALUES(?,?)', item.id, JSON.stringify(item));
      this.sql.exec('INSERT INTO item_observations(item_id,snapshot_json) VALUES(?,?)', item.id, JSON.stringify(itemSnapshot(item)));
      return null;
    }
    const current = this.candidate(row);
    if (!preferObservation(current.item, item)) return null;
    const changes = observationChanges(itemSnapshot(current.item), itemSnapshot(item));
    this.ensureHistoryBaseline(current.item);
    this.sql.exec('UPDATE candidates SET item_json=?,assessment_json=? WHERE item_id=?', JSON.stringify(item),
      assessmentStillApplies(current, item) ? row.assessment_json : null, item.id);
    if (changes || current.item.source !== item.source) {
      this.sql.exec('INSERT INTO item_observations(item_id,snapshot_json) VALUES(?,?)', item.id, JSON.stringify(itemSnapshot(item)));
    }
    return changes;
  }

  private ensureHistoryBaseline(item: ItemObservation): void {
    if (!this.rows<{ sequence: number }>('SELECT sequence FROM item_observations WHERE item_id=? LIMIT 1', item.id).length) {
      this.sql.exec('INSERT INTO item_observations(item_id,snapshot_json) VALUES(?,?)', item.id, JSON.stringify(itemSnapshot(item)));
    }
  }

  updateItems(items: ItemObservation[]): ObservedItemChange[] {
    const plan = JSON.parse(this.run().plan_json) as SearchPlan;
    for (const item of items) this.validateObservation(item, plan);
    return this.atomic(() => items.flatMap(item => { const changes = this.putObservation(item); return changes ? [changes] : []; }));
  }

  itemHistory(itemId: string, after: number, limit: number): { observations: (ItemSnapshot & { sequence: number })[]; next_after: number | null } {
    this.run(); safeCount(after, 'after');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new ToolError('invalid_batch_size', 'Use 1 to 200 observations per call.');
    const current = this.getCandidates([itemId])[0];
    if (current) this.ensureHistoryBaseline(current.item);
    const rows = this.rows<{ sequence: number; snapshot_json: string }>('SELECT sequence,snapshot_json FROM item_observations WHERE item_id=? AND sequence>? ORDER BY sequence LIMIT ?', itemId, after, limit + 1);
    return { observations: rows.slice(0, limit).map(row => ({ ...JSON.parse(row.snapshot_json) as ItemSnapshot, sequence: row.sequence })),
      next_after: rows.length > limit ? rows[limit - 1]!.sequence : null };
  }

  markImagesDelivered(itemId: string, imageIds: string[]): void {
    const candidate = this.getCandidates([itemId])[0];
    if (!candidate) throw new ToolError('item_not_found', 'Load this item before recording delivered images.');
    const valid = new Set(candidate.item.images.map(image => image.id));
    if (!imageIds.length || imageIds.some(id => !valid.has(id))) throw new ToolError('image_identity_mismatch', 'Every delivered image must belong to this item.');
    const time = new Date(this.now()).toISOString();
    this.atomic(() => {
      for (const id of new Set(imageIds)) this.sql.exec('INSERT INTO image_evidence(item_id,image_id,delivered_at) VALUES(?,?,?) ON CONFLICT(item_id,image_id) DO UPDATE SET delivered_at=excluded.delivered_at', itemId, id, time);
    });
  }

  recordAssessment(assessment: VisualAssessment): void {
    const candidate = this.getCandidates([assessment.item_id])[0];
    if (!candidate) throw new ToolError('item_not_found', 'Load this item before recording an assessment.');
    const known = new Set(candidate.item.images.map(image => image.id));
    const delivered = new Set(this.rows<{ image_id: string }>('SELECT image_id FROM image_evidence WHERE item_id=?', assessment.item_id).map(row => row.image_id));
    if (assessment.author !== 'assistant' || !assessment.checked_image_ids.length ||
        assessment.checked_image_ids.some(id => !known.has(id) || !delivered.has(id))) {
      throw new ToolError('visual_evidence_missing', 'A visual assessment requires this item’s actual model-visible images.', { next_action: 'Use get_item_images and assess only the successfully returned image IDs.' });
    }
    if (!Number.isFinite(Date.parse(assessment.assessed_at))) throw new ToolError('invalid_assessment_time', 'Use a valid timestamp for the assessment.');
    this.sql.exec('UPDATE candidates SET assessment_json=? WHERE item_id=?', JSON.stringify(assessment), assessment.item_id);
  }

  async storeReference(fileId: string, bytes: Uint8Array, mimeType: string, fileName: string): Promise<void> {
    if (!fileId || !bytes.byteLength || !mimeType.startsWith('image/')) throw new ToolError('invalid_reference', 'A reference requires a file ID, image bytes and an image MIME type.');
    const copy = new Uint8Array(bytes);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
    const hash = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
    this.atomic(() => {
      const old = this.rows<ReferenceRow>('SELECT mime_type,file_name,hash,byte_length FROM reference_files WHERE file_id=?', fileId)[0];
      if (old) {
        if (old.hash !== hash || old.mime_type !== mimeType) throw new ToolError('reference_conflict', 'A different image already uses this file ID.');
        return;
      }
      this.sql.exec('INSERT INTO reference_files(file_id,mime_type,file_name,hash,byte_length) VALUES(?,?,?,?,?)', fileId, mimeType, fileName, hash, copy.byteLength);
      for (let offset = 0; offset < copy.byteLength; offset += REFERENCE_CHUNK_BYTES) {
        this.sql.exec('INSERT INTO reference_chunks(file_id,ordinal,bytes) VALUES(?,?,?)', fileId, offset / REFERENCE_CHUNK_BYTES, copy.slice(offset, offset + REFERENCE_CHUNK_BYTES).buffer);
      }
    });
  }

  getReference(fileId: string): StoredReference | null {
    const row = this.rows<ReferenceRow>('SELECT mime_type,file_name,hash,byte_length FROM reference_files WHERE file_id=?', fileId)[0];
    if (!row) return null;
    const chunks = this.rows<{ ordinal: number; bytes: ArrayBuffer }>('SELECT ordinal,bytes FROM reference_chunks WHERE file_id=? ORDER BY ordinal', fileId);
    const bytes = new Uint8Array(row.byte_length);
    let offset = 0;
    for (const [index, chunk] of chunks.entries()) {
      if (chunk.ordinal !== index || offset + chunk.bytes.byteLength > bytes.byteLength) throw new ToolError('reference_corrupt', 'The stored reference image is incomplete.');
      bytes.set(new Uint8Array(chunk.bytes), offset);
      offset += chunk.bytes.byteLength;
    }
    if (offset !== bytes.byteLength) throw new ToolError('reference_corrupt', 'The stored reference image is incomplete.');
    return { bytes, mime_type: row.mime_type, file_name: row.file_name };
  }

  storePresentation(id: string, value: PresentationRecord): void {
    const json = stable(value);
    this.atomic(() => {
      const existing = this.rows<{ value_json: string }>('SELECT value_json FROM presentations WHERE id=?', id)[0];
      if (existing && existing.value_json !== json) throw new ToolError('presentation_conflict', 'A presentation ID cannot be reused for a different selection.');
      if (!existing) this.sql.exec('INSERT INTO presentations(id,value_json) VALUES(?,?)', id, json);
    });
  }

  getPresentation(id: string): PresentationRecord | null {
    const row = this.rows<{ value_json: string }>('SELECT value_json FROM presentations WHERE id=?', id)[0];
    return row ? JSON.parse(row.value_json) as PresentationRecord : null;
  }

  saveBookmark(value: Bookmark): void {
    this.assertActive();
    if (!value.run_id || !Number.isFinite(Date.parse(value.saved_at))) throw new ToolError('invalid_bookmark', 'A bookmark requires a run ID and valid save time.');
    this.sql.exec('INSERT INTO bookmarks(run_id,value_json) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET value_json=excluded.value_json', value.run_id, JSON.stringify(value));
  }

  listBookmarks(offset: number, limit: number): { items: Bookmark[]; next_offset: number | null } {
    safeCount(offset, 'offset');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new ToolError('invalid_batch_size', 'Use 1 to 500 bookmarks per call and follow next_offset.');
    const rows = this.rows<{ value_json: string }>('SELECT value_json FROM bookmarks ORDER BY sequence LIMIT ? OFFSET ?', limit + 1, offset);
    return { items: rows.slice(0, limit).map(row => JSON.parse(row.value_json) as Bookmark), next_offset: rows.length > limit ? offset + limit : null };
  }

  removeBookmark(runId: string): void { this.sql.exec('DELETE FROM bookmarks WHERE run_id=?', runId); }

  erase(): void {
    for (const table of ['run', 'arms', 'candidates', 'retrieval_paths', 'operations', 'warnings', 'image_evidence', 'reference_files', 'reference_chunks', 'presentations', 'bookmarks', 'item_observations']) {
      this.sql.exec(`DELETE FROM ${table}`);
    }
    this.sql.exec('INSERT INTO lifecycle(id,deleted) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET deleted=1');
  }

  private begin(step: number): { receipt: SearchPage } | { lease: Lease } {
    return this.atomic(() => {
      const run = this.run();
      const existing = this.rows<OperationRow>('SELECT * FROM operations WHERE step=?', step)[0];
      if (existing?.response_json) return { receipt: JSON.parse(existing.response_json) as SearchPage };
      if (step !== run.next_step) throw new ToolError('invalid_cursor', 'The cursor does not identify a published continuation for this run.', { next_action: 'Use the exact next_cursor from the preceding result.' });
      if (existing && existing.lease_until > this.now()) throw new ToolError('search_busy', 'This continuation is already being processed.', {
        retryable: true, retry_at: new Date(existing.lease_until).toISOString(), next_action: 'Retry the same cursor; a completed retry returns the same recorded page.' });
      const lease = { step, generation: (existing?.generation ?? 0) + 1, nonce: crypto.randomUUID() };
      this.sql.exec('INSERT INTO operations(step,generation,nonce,lease_until,response_json) VALUES(?,?,?,?,NULL) ON CONFLICT(step) DO UPDATE SET generation=excluded.generation,nonce=excluded.nonce,lease_until=excluded.lease_until,response_json=NULL', step, lease.generation, lease.nonce, this.now() + 45_000);
      return { lease };
    });
  }

  private owns(lease: Lease): void {
    const row = this.rows<OperationRow>('SELECT * FROM operations WHERE step=?', lease.step)[0];
    if (!row || row.nonce !== lease.nonce || row.generation !== lease.generation || row.response_json !== null) {
      throw new ToolError('search_lease_lost', 'Another retry has taken over this continuation.', { retryable: true, next_action: 'Retry the same cursor to obtain the committed result.' });
    }
  }

  private pendingCount(): number {
    return this.rows<{ count: number }>('SELECT COUNT(*) AS count FROM candidates WHERE returned_step IS NULL')[0]!.count;
  }

  private eligible(row: ArmRow): boolean {
    if (row.status === 'exhausted' || row.status === 'window') return false;
    const error = row.error_json ? JSON.parse(row.error_json) as ProviderError : null;
    const retryAt = error?.retry_at ? Date.parse(error.retry_at) : 0;
    return !Number.isFinite(retryAt) || retryAt <= this.now();
  }

  private nextArms(lease: Lease, count: number, failed: Set<string>): ArmRow[] {
    return this.atomic(() => {
      this.owns(lease);
      const run = this.run();
      const arms = this.armRows();
      if (!arms.length) return [];
      const ordered = [...arms.slice(run.arm_turn), ...arms.slice(0, run.arm_turn)];
      const selected = ordered.filter(arm => !failed.has(arm.id) && this.eligible(arm)).slice(0, count);
      const last = selected.at(-1);
      if (last) this.sql.exec('UPDATE run SET arm_turn=? WHERE id=1', (last.ordinal + 1) % arms.length);
      return selected;
    });
  }

  private commitPage(lease: Lease, arm: ArmRow, page: ProviderPage, plan: SearchPlan): void {
    if (page.next_offset !== null && (!Number.isSafeInteger(page.next_offset) || page.next_offset <= arm.offset)) throw new ToolError('provider_nonadvancing_page', 'The provider returned a continuation that does not advance.', { retryable: true });
    if ((page.next_offset === null) === (page.end_reason === null)) throw new ToolError('provider_contract', 'The provider page needs either a next offset or an explicit end reason.', { retryable: true });
    for (const item of page.items) this.validateObservation(item, plan);
    this.atomic(() => {
      this.owns(lease);
      const spec = JSON.parse(arm.spec_json) as SearchArm;
      for (const [index, item] of page.items.entries()) {
        this.putObservation(item);
        const suppliedRank = page.ranks?.[item.id];
        const rank = suppliedRank !== undefined && Number.isSafeInteger(suppliedRank) && suppliedRank > 0 ? suppliedRank : arm.offset + index + 1;
        const suppliedScore = page.scores?.[item.id];
        const score = suppliedScore !== undefined && Number.isFinite(suppliedScore) ? suppliedScore : null;
        const old = this.rows<PathRow>('SELECT arm_id,route,source_rank,source_score,observed_at FROM retrieval_paths WHERE item_id=? AND arm_id=?', item.id, arm.id)[0];
        if (!old || rank < old.source_rank) this.sql.exec('INSERT INTO retrieval_paths(item_id,arm_id,route,source_rank,source_score,observed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(item_id,arm_id) DO UPDATE SET source_rank=excluded.source_rank,source_score=excluded.source_score,observed_at=excluded.observed_at', item.id, arm.id, spec.route, rank, score, page.observed_at);
        const candidate = this.getCandidates([item.id])[0]!;
        this.sql.exec('UPDATE candidates SET fusion_score=? WHERE item_id=?', reciprocalRankScore(candidate.paths, plan.arms), item.id);
      }
      const status = page.next_offset === null ? page.end_reason === 'upstream_window' ? 'window' : 'exhausted' : 'ready';
      this.sql.exec('UPDATE arms SET offset=?,pages_read=pages_read+1,status=?,total=?,window_size=?,error_json=NULL WHERE id=?', page.next_offset ?? arm.offset, status, page.total, page.window, arm.id);
      for (const warning of page.warnings) this.sql.exec('INSERT OR IGNORE INTO warnings(message) VALUES(?)', warning);
    });
  }

  private commitError(lease: Lease, arm: ArmRow, error: ProviderError): void {
    this.atomic(() => {
      this.owns(lease);
      this.sql.exec('UPDATE arms SET status=?,error_json=? WHERE id=?', error.retryable ? 'paused' : 'failed', JSON.stringify(error), arm.id);
    });
  }

  private selectPending(plan: SearchPlan, step: number): { items: Candidate[]; warnings: string[] } {
    const items: Candidate[] = [];
    const selected = new Set<string>();
    const warnings: string[] = [];
    let bytes = 0;
    let full = false;
    const add = (id: string): void => {
      if (full || selected.has(id)) return;
      let candidate = this.getCandidates([id])[0];
      if (!candidate) return;
      let size = encoder.encode(JSON.stringify(candidate)).byteLength;
      if (size > RESPONSE_BYTES && items.length === 0) {
        candidate = { ...candidate, item: { ...candidate.item, description: null, attributes: {}, images: candidate.item.images.slice(0, 1) } };
        size = encoder.encode(JSON.stringify(candidate)).byteLength;
        warnings.push(`Search summary shortened for ${id}; get_items and get_item_images retain the complete recorded details and gallery.`);
      }
      if (bytes + size > RESPONSE_BYTES) {
        if (!items.length) throw new ToolError('item_response_too_large', `The search summary for item ${id} exceeds the response byte budget.`, { next_action: 'Inspect this item directly; its stored observation has not been discarded.' });
        full = true;
        warnings.push('Response byte budget reached. Continue for the remaining recorded items.');
        return;
      }
      items.push(candidate);
      selected.add(id);
      bytes += size;
      if (items.length >= plan.page_size) full = true;
    };
    const arms = plan.arms.length ? [...plan.arms.slice(step % plan.arms.length), ...plan.arms.slice(0, step % plan.arms.length)] : [];
    const diversitySlots = Math.min(arms.length, Math.max(0, Math.floor(plan.page_size / 3)));
    for (const arm of arms.slice(0, diversitySlots)) {
      if (full) break;
      const rows = this.rows<{ item_id: string }>(`SELECT c.item_id FROM candidates c JOIN retrieval_paths p ON p.item_id=c.item_id
        WHERE c.returned_step IS NULL AND p.arm_id=?
        ORDER BY (SELECT COUNT(*) FROM retrieval_paths q WHERE q.item_id=c.item_id) ASC,p.source_rank ASC,c.sequence ASC LIMIT ?`, arm.id, selected.size + 1);
      const next = rows.find(row => !selected.has(row.item_id));
      if (next) add(next.item_id);
    }
    for (let offset = 0; !full; offset += SQL_CHUNK) {
      const rows = this.rows<{ item_id: string }>('SELECT item_id FROM candidates WHERE returned_step IS NULL ORDER BY fusion_score DESC,sequence ASC LIMIT ? OFFSET ?', SQL_CHUNK, offset);
      if (!rows.length) break;
      for (const row of rows) { add(row.item_id); if (full) break; }
      if (rows.length < SQL_CHUNK) break;
    }
    return { items, warnings };
  }

  async advance(step: number, provider: SellpyProvider, context: RequestContext): Promise<SearchPage> {
    safeCount(step, 'step');
    const begun = this.begin(step);
    if ('receipt' in begun) return begun.receipt;
    const lease = begun.lease;
    const run = this.run();
    const plan = JSON.parse(run.plan_json) as SearchPlan;
    const failed = new Set<string>();
    let calls = 0;
    const callWarnings: string[] = [];
    while (this.now() + 250 < context.deadline && calls < WORK_PAGES) {
      const untried = this.armRows().some(arm => arm.pages_read === 0 && this.eligible(arm) && !failed.has(arm.id));
      if (this.pendingCount() >= plan.page_size && !untried) break;
      const arms = this.nextArms(lease, Math.min(2, WORK_PAGES - calls), failed);
      if (!arms.length) break;
      const pageSize = Math.max(1, Math.min(100, Math.ceil(plan.page_size / Math.max(1, plan.arms.length))));
      const results = await Promise.allSettled(arms.map(async arm => provider.search({ market: plan.market, language: plan.language,
        arm: JSON.parse(arm.spec_json) as SearchArm, offset: arm.offset, page_size: pageSize }, context)));
      calls += arms.length;
      for (const [index, result] of results.entries()) {
        const arm = arms[index]!;
        try {
          if (result.status === 'rejected') throw result.reason;
          this.commitPage(lease, arm, result.value, plan);
        } catch (cause) {
          if (cause instanceof ToolError && cause.code === 'search_lease_lost') throw cause;
          this.commitError(lease, arm, errorFor(cause));
          failed.add(arm.id);
        }
      }
    }
    if (calls >= WORK_PAGES) callWarnings.push('Per-call provider work budget reached. Continue to read further source pages; there is no total page limit.');
    return this.atomic(() => {
      this.owns(lease);
      const selected = this.selectPending(plan, step);
      for (const candidate of selected.items) this.sql.exec('UPDATE candidates SET returned_step=? WHERE item_id=? AND returned_step IS NULL', step, candidate.item.id);
      const coverage = this.coverage();
      const pending = this.pendingCount();
      const unfinished = coverage.arms.filter(arm => arm.status !== 'exhausted' && arm.status !== 'window');
      let status: SearchPage['status'] = 'ready';
      let reason: SearchPage['end_reason'] = null;
      if (!pending && !unfinished.length) { status = 'ended'; reason = coverage.arms.some(arm => arm.status === 'window') ? 'upstream_window' : 'source_exhausted'; }
      else if (!pending && unfinished.every(arm => arm.error !== null)) {
        status = 'paused';
        reason = unfinished.some(arm => /rate|cooldown|throttl/.test(arm.error!.code)) ? 'rate_limited' : 'source_error';
      } else if (!pending && this.now() + 250 >= context.deadline) { status = 'paused'; reason = 'time_budget'; }
      const warnings = this.rows<{ message: string }>('SELECT message FROM warnings ORDER BY message').map(row => row.message);
      const response: SearchPage = { run_id: run.run_id, items: selected.items, next_cursor: status === 'ended' ? null : encodeSearchCursor(run.run_id, step + 1),
        status, end_reason: reason, coverage, warnings: [...warnings, ...callWarnings, ...selected.warnings], observed_at: new Date(this.now()).toISOString() };
      this.sql.exec('UPDATE operations SET response_json=?,lease_until=0 WHERE step=? AND generation=? AND nonce=?', JSON.stringify(response), step, lease.generation, lease.nonce);
      this.sql.exec('UPDATE run SET next_step=? WHERE id=1', step + 1);
      return response;
    });
  }
}
