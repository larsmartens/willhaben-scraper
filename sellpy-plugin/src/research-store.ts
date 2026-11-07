import { ToolError, type Candidate, type ItemFeedback } from './domain.js';
import { evaluateCandidate, rankCandidates, validateRankingPreferences, type CandidateEvaluation, type RankedCandidate, type RankingPreferences } from './refinement.js';
import type { Atomic, SearchStore, SqlPort } from './search-store.js';

type SqlValue = string | number | ArrayBuffer | null;
type JobRow = { id: string; run_id: string; preferences_json: string; max_sequence: number; cohort_total: number;
  scanned_to: number; next_step: number; page_size: number; ready: number; created_at: string };
type CanonicalRow = { refinement_id: string; next_step: number; imported_step: number; position: number; evaluated: number; eligible: number; excluded: number; unknown: number; observations_from: string | null; observations_to: string | null; completed_at: string | null };
type StoredEvaluation = { candidate: Candidate; evaluation: CandidateEvaluation; feedback?: ItemFeedback };
export interface PreferenceProfile { name: string; preferences: RankingPreferences; updated_at: string }
export interface RefinementPage {
  run_id: string;
  refinement_id: string;
  preferences: RankingPreferences | null;
  items: RankedCandidate[];
  detail_only_items: { item_id: string; eligibility: CandidateEvaluation['eligibility']; score: number; reason: string; details_tool: string }[];
  response_omissions: { field: string; retained_in: string }[];
  next_cursor: string | null;
  status: 'scanning' | 'ready' | 'ended';
  coverage: { cohort_total: number; evaluated: number; eligible: number; excluded: number; unknown: number; returned: number; snapshot_max_sequence: number };
  excluded_examples: CandidateEvaluation[];
  warnings: string[];
  observed_at: string;
}

const TABLES = ['research_feedback', 'preference_profiles', 'refinement_jobs', 'refinement_items', 'refinement_feedback', 'refinement_receipts', 'search_response_notes', 'feedback_versions', 'feedback_clock', 'refinement_canonical', 'refinement_prepared', 'refinement_positions'];
const SCAN_WORK = 256;
const WINDOW_BYTES = 2_000_000;
const RESPONSE_BYTES = 1_250_000;
const encoder = new TextEncoder();

function cursorFor(runId: string, id: string, step: number): string {
  return btoa(JSON.stringify({ v: 1, kind: 'refinement', run_id: runId, refinement_id: id, step }))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function pageBounds(offset: number, limit: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new ToolError('invalid_pagination', 'Use a nonnegative offset and 1 to 200 entries per call.');
  }
}

function rankingSnapshot(candidate: Candidate): Candidate {
  return { ...candidate, item: { ...candidate.item, description: null } };
}

export class ResearchStore {
  constructor(private readonly sql: SqlPort, private readonly atomic: Atomic, private readonly candidates: SearchStore,
    private readonly now: () => number = Date.now) {
    const statements = [
      'CREATE TABLE IF NOT EXISTS research_feedback (sequence INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL UNIQUE, decision TEXT NOT NULL, value_json TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS research_feedback_decisions ON research_feedback(decision,sequence)',
      'CREATE TABLE IF NOT EXISTS preference_profiles (name TEXT PRIMARY KEY, value_json TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS refinement_jobs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, preferences_json TEXT NOT NULL, max_sequence INTEGER NOT NULL, cohort_total INTEGER NOT NULL, scanned_to INTEGER NOT NULL DEFAULT 0, next_step INTEGER NOT NULL DEFAULT 0, page_size INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS refinement_items (refinement_id TEXT NOT NULL, item_id TEXT NOT NULL, included INTEGER NOT NULL, unknown INTEGER NOT NULL, sort_primary REAL NOT NULL, sort_secondary REAL NOT NULL, byte_size INTEGER NOT NULL, entry_json TEXT NOT NULL, returned_step INTEGER, PRIMARY KEY(refinement_id,item_id))',
      'CREATE INDEX IF NOT EXISTS refinement_order ON refinement_items(refinement_id,included,returned_step,sort_primary DESC,sort_secondary DESC,item_id)',
      'CREATE TABLE IF NOT EXISTS refinement_feedback (refinement_id TEXT NOT NULL, item_id TEXT NOT NULL, value_json TEXT NOT NULL, PRIMARY KEY(refinement_id,item_id))',
      'CREATE TABLE IF NOT EXISTS refinement_receipts (refinement_id TEXT NOT NULL, step INTEGER NOT NULL, response_json TEXT NOT NULL, PRIMARY KEY(refinement_id,step))',
      'CREATE TABLE IF NOT EXISTS search_response_notes (step INTEGER PRIMARY KEY, value_json TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS feedback_clock (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL DEFAULT 0)',
      'INSERT OR IGNORE INTO feedback_clock(id,revision) VALUES(1,0)',
      'CREATE TABLE IF NOT EXISTS feedback_versions (item_id TEXT NOT NULL,revision INTEGER NOT NULL,value_json TEXT,PRIMARY KEY(item_id,revision))',
      'CREATE TABLE IF NOT EXISTS refinement_canonical (refinement_id TEXT PRIMARY KEY,next_step INTEGER NOT NULL DEFAULT 0,imported_step INTEGER NOT NULL DEFAULT -1,position INTEGER NOT NULL DEFAULT 0,evaluated INTEGER NOT NULL DEFAULT 0,eligible INTEGER NOT NULL DEFAULT 0,excluded INTEGER NOT NULL DEFAULT 0,unknown INTEGER NOT NULL DEFAULT 0,observations_from TEXT,observations_to TEXT,completed_at TEXT)',
      'CREATE TABLE IF NOT EXISTS refinement_prepared (refinement_id TEXT NOT NULL,step INTEGER NOT NULL,response_json TEXT NOT NULL,PRIMARY KEY(refinement_id,step))',
      'CREATE TABLE IF NOT EXISTS refinement_positions (refinement_id TEXT NOT NULL,position INTEGER NOT NULL,item_id TEXT NOT NULL,PRIMARY KEY(refinement_id,position),UNIQUE(refinement_id,item_id))',

    ];
    for (const statement of statements) this.sql.exec(statement);
    const columns = this.rows<{ name: string }>('PRAGMA table_info(refinement_items)');
    if (!columns.some(column => column.name === 'ordering_step')) this.sql.exec('ALTER TABLE refinement_items ADD COLUMN ordering_step INTEGER');
    this.sql.exec('CREATE INDEX IF NOT EXISTS refinement_unordered ON refinement_items(refinement_id,included,ordering_step,sort_primary DESC,sort_secondary DESC,item_id)');

  }

  private rows<T extends Record<string, SqlValue>>(query: string, ...bindings: unknown[]): T[] {
    return this.sql.exec<T>(query, ...bindings).toArray();
  }

  private time(): string { return new Date(this.now()).toISOString(); }

  getProfile(name: string): PreferenceProfile | null {
    const row = this.rows<{ value_json: string }>('SELECT value_json FROM preference_profiles WHERE name=?', name)[0];
    return row ? JSON.parse(row.value_json) as PreferenceProfile : null;
  }

  setProfile(name: string, preferences: RankingPreferences): PreferenceProfile {
    if (!name.trim() || name.length > 100) throw new ToolError('invalid_profile', 'Use a profile name between 1 and 100 characters.');
    validateRankingPreferences(preferences);
    const previous = this.getProfile(name);
    if (previous && JSON.stringify(previous.preferences) === JSON.stringify(preferences)) return previous;
    const value: PreferenceProfile = { name, preferences, updated_at: this.time() };
    this.sql.exec('INSERT INTO preference_profiles(name,value_json) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value_json=excluded.value_json', name, JSON.stringify(value));
    return value;
  }

  setFeedback(itemId: string, decision: ItemFeedback['decision'], reason?: string): ItemFeedback {
    if (!this.candidates.getCandidates([itemId]).length) throw new ToolError('item_not_found', 'Load this item in the search before giving feedback.');
    if (!['shortlist', 'reject', 'neutral'].includes(decision)) throw new ToolError('invalid_feedback', 'Choose shortlist, reject or neutral.');
    const previous = this.getFeedback([itemId])[itemId];
    if (previous?.decision === decision && (previous.reason ?? '') === (reason ?? '')) return previous;
    const value: ItemFeedback = { item_id: itemId, decision, ...(reason ? { reason } : {}), updated_at: this.time() };
    this.atomic(() => { this.writeFeedbackVersion(value, previous ?? null);
      this.sql.exec('INSERT INTO research_feedback(item_id,decision,value_json) VALUES(?,?,?) ON CONFLICT(item_id) DO UPDATE SET decision=excluded.decision,value_json=excluded.value_json', itemId, decision, JSON.stringify(value)); });
    return value;
  }

  private writeFeedbackVersion(value: ItemFeedback, previous: ItemFeedback | null): void {
    // Revision zero preserves the pre-upgrade value, including an explicit absent baseline.
    this.sql.exec('INSERT OR IGNORE INTO feedback_versions(item_id,revision,value_json) VALUES(?,0,?)', value.item_id, previous ? JSON.stringify(previous) : null);
    this.sql.exec('UPDATE feedback_clock SET revision=revision+1 WHERE id=1');
    this.sql.exec('INSERT INTO feedback_versions(item_id,revision,value_json) SELECT ?,revision,? FROM feedback_clock WHERE id=1', value.item_id, JSON.stringify(value));
  }

  feedbackRevision(): number { return this.rows<{ revision: number }>('SELECT revision FROM feedback_clock WHERE id=1')[0]!.revision; }

  feedbackAt(itemId: string, revision: number): ItemFeedback | null {
    const row = this.rows<{ value_json: string | null }>('SELECT value_json FROM feedback_versions WHERE item_id=? AND revision<=? ORDER BY revision DESC LIMIT 1', itemId, revision)[0];
    return row ? row.value_json ? JSON.parse(row.value_json) as ItemFeedback : null : this.getFeedback([itemId])[itemId] ?? null;
  }

  getFeedback(ids: string[]): Record<string, ItemFeedback> {
    const result: [string, ItemFeedback][] = [];
    for (const id of new Set(ids)) {
      const row = this.rows<{ value_json: string }>('SELECT value_json FROM research_feedback WHERE item_id=?', id)[0];
      if (row) result.push([id, JSON.parse(row.value_json) as ItemFeedback]);
    }
    return Object.fromEntries(result);
  }

  inheritFeedback(values: ItemFeedback[]): void {
    this.atomic(() => {
      for (const value of values) {
        if (this.candidates.getCandidates([value.item_id]).length && !this.getFeedback([value.item_id])[value.item_id]) {
          this.writeFeedbackVersion(value, null);
          this.sql.exec('INSERT OR IGNORE INTO research_feedback(item_id,decision,value_json) VALUES(?,?,?)', value.item_id, value.decision, JSON.stringify(value));
        }
      }
    });
  }

  responseNotes(step: number): Record<string, unknown> | null {
    const row = this.rows<{ value_json: string }>('SELECT value_json FROM search_response_notes WHERE step=?', step)[0];
    return row ? JSON.parse(row.value_json) as Record<string, unknown> : null;
  }

  saveResponseNotes(step: number, value: Record<string, unknown>): Record<string, unknown> {
    this.sql.exec('INSERT OR IGNORE INTO search_response_notes(step,value_json) VALUES(?,?)', step, JSON.stringify(value));
    return this.responseNotes(step)!;
  }

  listFeedback(decision: ItemFeedback['decision'] | 'all', after: number, limit: number): { items: (ItemFeedback & { sequence: number })[]; next_after: number | null } {
    pageBounds(after, limit);
    const rows = decision === 'all'
      ? this.rows<{ sequence: number; value_json: string }>('SELECT sequence,value_json FROM research_feedback WHERE sequence>? ORDER BY sequence LIMIT ?', after, limit + 1)
      : this.rows<{ sequence: number; value_json: string }>('SELECT sequence,value_json FROM research_feedback WHERE decision=? AND sequence>? ORDER BY sequence LIMIT ?', decision, after, limit + 1);
    return { items: rows.slice(0, limit).map(row => ({ ...JSON.parse(row.value_json) as ItemFeedback, sequence: row.sequence })),
      next_after: rows.length > limit ? rows[limit - 1]!.sequence : null };
  }

  createRefinement(runId: string, preferences: RankingPreferences, pageSize: number): string {
    validateRankingPreferences(preferences); pageBounds(0, pageSize);
    const cohort = this.candidates.snapshotCohort();
    const id = crypto.randomUUID();
    this.atomic(() => {
      this.sql.exec('INSERT INTO refinement_jobs(id,run_id,preferences_json,max_sequence,cohort_total,page_size,created_at) VALUES(?,?,?,?,?,?,?)',
        id, runId, JSON.stringify(preferences), cohort.max_sequence, cohort.total, pageSize, this.time());
      this.sql.exec('INSERT INTO refinement_feedback(refinement_id,item_id,value_json) SELECT ?,item_id,value_json FROM research_feedback', id);
      this.sql.exec('INSERT INTO refinement_canonical(refinement_id) VALUES(?)', id);
    });
    return id;
  }

  private refinementJob(id: string): JobRow {
    const job = this.rows<JobRow>('SELECT * FROM refinement_jobs WHERE id=?', id)[0];
    if (!job) throw new ToolError('refinement_not_found', 'This refinement does not belong to the search.');
    return job;
  }

  /** Import at most one historical receipt per request. Published bytes stay unchanged. */
  private ensureCanonical(id: string): boolean {
    const job = this.refinementJob(id);
    return this.atomic(() => {
      let state = this.rows<CanonicalRow>('SELECT * FROM refinement_canonical WHERE refinement_id=?', id)[0];
      if (!state) {
        this.sql.exec(`INSERT INTO refinement_canonical(refinement_id,evaluated,eligible,excluded,unknown)
          SELECT ?,COUNT(*),COALESCE(SUM(included),0),COALESCE(SUM(included=0),0),COALESCE(SUM(unknown),0)
          FROM refinement_items WHERE refinement_id=?`, id, id);
        state = this.rows<CanonicalRow>('SELECT * FROM refinement_canonical WHERE refinement_id=?', id)[0]!;
      }
      const step = state.imported_step + 1;
      if (step >= job.next_step || state.next_step >= job.next_step) return true;
      const receipt = this.rows<{ response_json: string }>('SELECT response_json FROM refinement_receipts WHERE refinement_id=? AND step=?', id, step)[0];
      if (!receipt) throw new ToolError('refinement_receipt_missing', 'An existing refinement receipt could not be recovered.');
      const page = JSON.parse(receipt.response_json) as RefinementPage;
      const ids = [...page.items.map(value => value.candidate.item.id), ...page.detail_only_items.map(value => value.item_id)];
      for (const itemId of ids) {
        this.sql.exec('INSERT OR IGNORE INTO refinement_positions(refinement_id,position,item_id) VALUES(?,?,?)', id, ++state.position, itemId);
        this.sql.exec('UPDATE refinement_items SET ordering_step=? WHERE refinement_id=? AND item_id=?', step, id, itemId);
      }
      this.sql.exec('INSERT OR IGNORE INTO refinement_prepared(refinement_id,step,response_json) VALUES(?,?,?)', id, step, receipt.response_json);
      this.sql.exec('UPDATE refinement_canonical SET imported_step=?,next_step=?,position=?,completed_at=? WHERE refinement_id=?', step, step + 1, state.position, page.status === 'ended' ? page.observed_at : null, id);
      return step + 1 >= job.next_step;
    });
  }

  advanceRefinement(id: string, step: number): RefinementPage {
    if (!Number.isSafeInteger(step) || step < 0) throw new ToolError('invalid_cursor', 'The refinement step is invalid.');
    const receipt = this.rows<{ response_json: string }>('SELECT response_json FROM refinement_receipts WHERE refinement_id=? AND step=?', id, step)[0];
    if (receipt) return JSON.parse(receipt.response_json) as RefinementPage;
    const job = this.refinementJob(id);
    if (job.next_step !== step) throw new ToolError('invalid_cursor', 'Use the exact next_cursor returned by this refinement.');
    if (!this.ensureCanonical(id)) throw new ToolError('refinement_preparing', 'The saved refinement order is being indexed. Retry the same cursor.', { retryable: true });
    const prepared = this.rows<{ response_json: string }>('SELECT response_json FROM refinement_prepared WHERE refinement_id=? AND step=?', id, step)[0];
    const page = prepared ? JSON.parse(prepared.response_json) as RefinementPage : this.prepareStep(id, step);
    this.atomic(() => {
      const json = prepared?.response_json ?? JSON.stringify(page);
      this.sql.exec('INSERT INTO refinement_receipts(refinement_id,step,response_json) VALUES(?,?,?)', id, step, json);
      for (const itemId of [...page.items.map(value => value.candidate.item.id), ...page.detail_only_items.map(value => value.item_id)]) {
        this.sql.exec('UPDATE refinement_items SET returned_step=? WHERE refinement_id=? AND item_id=?', step, id, itemId);
      }
      this.sql.exec('UPDATE refinement_jobs SET next_step=? WHERE id=?', step + 1, id);
    });
    return page;
  }

  prepareCollectionRefinement(id: string) {
    const imported = this.ensureCanonical(id);
    let state = this.rows<CanonicalRow>('SELECT * FROM refinement_canonical WHERE refinement_id=?', id)[0]!;
    if (imported && !state.completed_at) {
      this.prepareStep(id, state.next_step);
      state = this.rows<CanonicalRow>('SELECT * FROM refinement_canonical WHERE refinement_id=?', id)[0]!;
    }
    const job = this.refinementJob(id);
    return { ready: imported && Boolean(state.completed_at), total: job.ready ? state.eligible : null,
      scanned: state.evaluated, cohort: job.cohort_total, created_at: job.created_at,
      evaluation: { started_at: job.created_at, completed_at: state.completed_at, observations_from: state.observations_from, observations_to: state.observations_to } };
  }

  private prepareStep(id: string, step: number): RefinementPage {
    if (!Number.isSafeInteger(step) || step < 0) throw new ToolError('invalid_cursor', 'The refinement step is invalid.');
    return this.atomic(() => {
      const receipt = this.rows<{ response_json: string }>('SELECT response_json FROM refinement_prepared WHERE refinement_id=? AND step=?', id, step)[0];
      if (receipt) return JSON.parse(receipt.response_json) as RefinementPage;
      const job = this.rows<JobRow>('SELECT * FROM refinement_jobs WHERE id=?', id)[0];
      if (!job) throw new ToolError('refinement_not_found', 'Start refinement for this search before continuing it.');
      const canonical = this.rows<CanonicalRow>('SELECT * FROM refinement_canonical WHERE refinement_id=?', id)[0]!;
      if (canonical.next_step !== step) throw new ToolError('invalid_cursor', 'Use the exact next_cursor returned by this refinement.');
      const preferences = JSON.parse(job.preferences_json) as RankingPreferences;
      let scanned = job.scanned_to;
      let ready = Boolean(job.ready);
      for (let work = 0; !ready && work < SCAN_WORK; work += 16) {
        const rows = this.candidates.scanCandidates(scanned, job.max_sequence, 16);
        for (const row of rows) {
          const candidate = rankingSnapshot(row.candidate);
          const saved = this.rows<{ value_json: string }>('SELECT value_json FROM refinement_feedback WHERE refinement_id=? AND item_id=?', id, candidate.item.id)[0];
          const feedback = saved ? JSON.parse(saved.value_json) as ItemFeedback : undefined;
          const evaluation = evaluateCandidate(candidate, preferences, feedback);
          const value: StoredEvaluation = { candidate, evaluation, ...(feedback ? { feedback } : {}) };
          const json = JSON.stringify(value);
          const tier = evaluation.eligibility === 'pass' ? 1 : 0;
          const priceMode = preferences.mode === 'price_low';
          this.sql.exec('INSERT INTO refinement_items(refinement_id,item_id,included,unknown,sort_primary,sort_secondary,byte_size,entry_json) VALUES(?,?,?,?,?,?,?,?)',
            id, candidate.item.id, Number(evaluation.included), Number(evaluation.eligibility === 'unknown'),
            priceMode ? evaluation.base_score : tier, priceMode ? tier : evaluation.base_score, encoder.encode(json).byteLength, json);
          canonical.evaluated++;
          if (evaluation.included) canonical.eligible++; else canonical.excluded++;
          if (evaluation.eligibility === 'unknown') canonical.unknown++;
          const observed = candidate.item.observed_at;
          if (!canonical.observations_from || observed < canonical.observations_from) canonical.observations_from = observed;
          if (!canonical.observations_to || observed > canonical.observations_to) canonical.observations_to = observed;
          scanned = row.sequence;
        }
        ready = rows.length < 16 || scanned >= job.max_sequence;
      }
      this.sql.exec('UPDATE refinement_jobs SET scanned_to=?,ready=? WHERE id=?', scanned, Number(ready), id);
      const warnings: string[] = [];
      const items: RankedCandidate[] = [];
      const detailOnly: RefinementPage['detail_only_items'] = [];
      const omissions: RefinementPage['response_omissions'] = [];
      const emitted: string[] = [];
      // Evidence can be individually large while still fitting the accepted input
      // envelope. Omit duplicate response text explicitly, never ranking work or
      // canonical source data, and reserve room for the whole response metadata.
      const echoedPreferences = encoder.encode(JSON.stringify(preferences)).byteLength <= 400_000 ? preferences : null;
      if (!echoedPreferences) omissions.push({ field: 'preferences', retained_in: 'immutable refinement snapshot; supplied criteria were fully evaluated' });
      const excluded = this.rows<{ entry_json: string }>('SELECT entry_json FROM refinement_items WHERE refinement_id=? AND included=0 ORDER BY item_id LIMIT 8', id)
        .map(row => (JSON.parse(row.entry_json) as StoredEvaluation).evaluation)
        .map((evaluation, index) => {
          if (encoder.encode(JSON.stringify(evaluation)).byteLength <= 24_000) return evaluation;
          omissions.push({ field: `excluded_examples[${index}].evidence`, retained_in: 'immutable refinement snapshot and canonical candidate assessment' });
          return { ...evaluation, evidence: [] };
        });
      const itemBudget = RESPONSE_BYTES - encoder.encode(JSON.stringify({ preferences: echoedPreferences, excluded_examples: excluded })).byteLength - 40_000;
      if (ready) {
        const indexes = this.rows<{ item_id: string; byte_size: number }>('SELECT item_id,byte_size FROM refinement_items WHERE refinement_id=? AND included=1 AND ordering_step IS NULL ORDER BY sort_primary DESC,sort_secondary DESC,item_id LIMIT ?', id, Math.max(200, job.page_size * 4));
        const pool: StoredEvaluation[] = [];
        let bytes = 0;
        for (const index of indexes) {
          if (pool.length && bytes + index.byte_size > WINDOW_BYTES) break;
          const row = this.rows<{ entry_json: string }>('SELECT entry_json FROM refinement_items WHERE refinement_id=? AND item_id=?', id, index.item_id)[0]!;
          pool.push(JSON.parse(row.entry_json) as StoredEvaluation);
          bytes += index.byte_size;
        }
        const prior = this.rows<{ entry_json: string }>('SELECT entry_json FROM refinement_items WHERE refinement_id=? AND ordering_step=? ORDER BY sort_primary DESC,sort_secondary DESC,item_id LIMIT 12', id, step - 1)
          .map(row => (JSON.parse(row.entry_json) as StoredEvaluation).candidate);
        const ranked = rankCandidates(pool.map(value => value.candidate), preferences,
          new Map(pool.flatMap(value => value.feedback ? [[value.feedback.item_id, value.feedback] as const] : [])),
          { limit: job.page_size, diversity_context: prior });
        warnings.push(...ranked.warnings);
        bytes = 0;
        for (const fullEntry of ranked.items) {
          let entry = fullEntry;
          let size = encoder.encode(JSON.stringify(entry)).byteLength;
          if (size > itemBudget) {
            entry = { ...entry, evaluation: { ...entry.evaluation, evidence: [] }, response_omissions: [{
              field: 'evaluation.evidence', omitted_entries: entry.evaluation.evidence.length,
              retained_in: 'immutable refinement snapshot; full original assessment is preserved in this item and the candidate ledger',
            }] };
            size = encoder.encode(JSON.stringify(entry)).byteLength;
          }
          if (size > itemBudget) {
            detailOnly.push({ item_id: entry.candidate.item.id, eligibility: entry.evaluation.eligibility, score: entry.score,
              reason: 'This item needs a separate detail response because its evidence exceeds the page byte budget. It was fully evaluated; no source evidence was discarded.',
              details_tool: 'list_search_items returns the original candidate assessment; get_item_images returns all original photos with pagination.' });
            this.sql.exec('UPDATE refinement_items SET ordering_step=? WHERE refinement_id=? AND item_id=?', step, id, entry.candidate.item.id);
            emitted.push(entry.candidate.item.id);
            warnings.push('Some fully evaluated IDs appear in detail_only_items. Inspect their retained evidence separately; continuation still reaches every eligible ID.');
            continue;
          }
          if (bytes + size > itemBudget) {
            warnings.push('Response byte budget reached. Continue for every remaining eligible candidate.');
            break;
          }
          items.push(entry); bytes += size;
          this.sql.exec('UPDATE refinement_items SET ordering_step=? WHERE refinement_id=? AND item_id=?', step, id, entry.candidate.item.id);
            emitted.push(entry.candidate.item.id);
        }
      }
      const counts = { evaluated: canonical.evaluated, eligible: canonical.eligible, excluded: canonical.excluded, unknown: canonical.unknown, returned: canonical.position + emitted.length };
      const ended = ready && counts.returned === counts.eligible;
      warnings.push('This is a snapshot of discovered candidates and feedback, not exhaustive catalog coverage. Start a new refinement after changing feedback or visual evidence.');
      if (!ready) warnings.push('Candidate evaluation continues on the next cursor. No discovered candidate is dropped by the per-call work budget.');
      if (preferences.mode !== 'price_low' && (preferences.diversity ?? (preferences.mode === 'relevance' ? 0 : 0.2)) > 0) {
        warnings.push('Diversity reranks a bounded leading window using source metadata and recorded features, not image embeddings. Deferred candidates remain reachable.');
      }
      const result: RefinementPage = { run_id: job.run_id, refinement_id: id, preferences: echoedPreferences, items,
        detail_only_items: detailOnly, response_omissions: omissions,
        next_cursor: ended ? null : cursorFor(job.run_id, id, step + 1), status: ended ? 'ended' : ready ? 'ready' : 'scanning',
        coverage: { ...counts, cohort_total: job.cohort_total, snapshot_max_sequence: job.max_sequence }, excluded_examples: excluded,
        warnings: [...new Set(warnings)], observed_at: this.time() };
      for (const [index, itemId] of emitted.entries()) this.sql.exec('INSERT INTO refinement_positions(refinement_id,position,item_id) VALUES(?,?,?)', id, canonical.position + index + 1, itemId);
      this.sql.exec('INSERT INTO refinement_prepared(refinement_id,step,response_json) VALUES(?,?,?)', id, step, JSON.stringify(result));
      this.sql.exec('UPDATE refinement_canonical SET next_step=?,position=?,evaluated=?,eligible=?,excluded=?,unknown=?,observations_from=?,observations_to=?,completed_at=? WHERE refinement_id=?',
        step + 1, counts.returned, counts.evaluated, counts.eligible, counts.excluded, counts.unknown, canonical.observations_from, canonical.observations_to, ended ? this.time() : null, id);
      return result;
    });
  }

  erase(): void { for (const table of TABLES) this.sql.exec(`DELETE FROM ${table}`); }
}
