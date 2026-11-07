import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { MARKETS } from './sellpy/normalize.js';
import { ToolError, type Candidate, type ItemFeedback, type SelectionEntry } from './domain.js';
import type { Atomic, SearchStore, SqlPort } from './search-store.js';
import type { ResearchStore } from './research-store.js';
import type { CollectionDescriptor, CollectionPageInfo, CollectionScope, CollectionSource, CollectionView } from './collection-contract.js';

type SqlValue = string | number | ArrayBuffer | null;
type Backing = 'observed' | 'arm' | 'members' | 'refinement' | 'legacy';
type Seek = { key: number; item: string };
type Cursor = { v: 2; kind: 'collection'; run_id: string; collection_id: string; direction: 'next' | 'previous'; key: number; item: string; rank: number };
type Config = { arm_id?: string; refinement_id?: string; base_id?: string; view?: CollectionView['kind']; legacy_id?: string; legacy?: LegacyState };
type Row = { id: string; source_json: string; title: string; created_at: string; membership_as_of: string; root_id: string;
  backing: Backing; maximum: number; total: number | null; status: 'ready' | 'preparing'; page_size: number;
  config_json: string; scan_key: number; scan_item: string; scanned: number; cohort: number; feedback_revision: number;
  observations_from: string | null; observations_to: string | null; completed_at: string | null };
type Member = { key: number; item_id: string; reason: string; cautions: string[]; notes_omitted?: boolean };
export interface OpenCollectionInput { source?: CollectionSource; selection?: SelectionEntry[]; title?: string; page_size?: number; request_id?: string }
export interface PageCollectionInput { cursor?: string; page_size?: number; request_id?: string }
export interface StoredCollectionPage {
  run_id: string; language: string; title: string; collection: CollectionDescriptor; page: CollectionPageInfo;
  scope: CollectionScope; candidates: Candidate[]; selection: SelectionEntry[]; feedback: Record<string, ItemFeedback>;
  warnings: string[]; request_id?: string;
}
interface LegacyState {
  offset: number; phase: 'start' | 'key' | 'colon' | 'value' | 'selection' | 'separator' | 'done';
  key: string; token: string; depth: number; quoted: boolean; escaped: boolean; count: number;
}
const BUILD_WORK = 128;
const MAX_PAGE = 24;
const LEGACY_BYTES = 64 * 1024;
const encoder = new TextEncoder();

function bounds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE) throw new ToolError('invalid_page_size', 'Use 1 to 24 cards per page.');
  return value;
}
function token(value: Cursor, secret: string): string {
  const signature = createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex');
  return btoa(JSON.stringify({ ...value, signature })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function parseCursor(input: string, runId: string, collectionId: string, secret: string): Cursor {
  try {
    if (input.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(input)) throw new Error();
    const { signature, ...unsigned } = JSON.parse(atob(input.replaceAll('-', '+').replaceAll('_', '/'))) as Cursor & { signature: string };
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw new Error();
    const expected = createHmac('sha256', secret).update(JSON.stringify(unsigned)).digest('hex');
    if (!timingSafeEqual(encoder.encode(signature), encoder.encode(expected))) throw new Error();
    const value = unsigned as Cursor;
    if (value.v !== 2 || value.kind !== 'collection' || value.run_id !== runId || value.collection_id !== collectionId ||
      !['next', 'previous'].includes(value.direction) || !Number.isSafeInteger(value.key) || typeof value.item !== 'string' || value.item.length > 100 ||
      !Number.isSafeInteger(value.rank) || value.rank < 0) throw new Error();
    return value;
  } catch { throw new ToolError('invalid_cursor', 'This cursor does not belong to this collection and search.'); }
}
function initialLegacy(): LegacyState { return { offset: 0, phase: 'start', key: '', token: '', depth: 0, quoted: false, escaped: false, count: 0 }; }

/** Private derived-state owner. All access is through the principal's SearchRun. */
export class CollectionStore {
  private readonly cursorSecret: string;
  constructor(private readonly sql: SqlPort, private readonly atomic: Atomic, private readonly candidates: SearchStore,
    private readonly research: ResearchStore, private readonly now: () => number = Date.now) {
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY,source_json TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL,membership_as_of TEXT NOT NULL,
        root_id TEXT NOT NULL,backing TEXT NOT NULL,maximum INTEGER NOT NULL DEFAULT 0,total INTEGER,status TEXT NOT NULL,page_size INTEGER NOT NULL,
        config_json TEXT NOT NULL,scan_key INTEGER NOT NULL DEFAULT 0,scan_item TEXT NOT NULL DEFAULT '',scanned INTEGER NOT NULL DEFAULT 0,cohort INTEGER NOT NULL DEFAULT 0,
        feedback_revision INTEGER NOT NULL DEFAULT 0,observations_from TEXT,observations_to TEXT,completed_at TEXT)`,
      'CREATE TABLE IF NOT EXISTS collection_members(collection_id TEXT NOT NULL,item_id TEXT NOT NULL,sort_key INTEGER NOT NULL,reason TEXT NOT NULL,cautions_json TEXT NOT NULL,PRIMARY KEY(collection_id,sort_key,item_id))',
      'CREATE INDEX IF NOT EXISTS collection_page ON collection_members(collection_id,sort_key,item_id)',
      'CREATE INDEX IF NOT EXISTS collection_identity ON collection_members(collection_id,item_id)',
      'CREATE TABLE IF NOT EXISTS collection_requests(request_id TEXT PRIMARY KEY,signature TEXT NOT NULL,collection_id TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS collection_legacy(presentation_id TEXT PRIMARY KEY,collection_id TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS collection_cursor_secret(id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT NOT NULL)',
    ]) this.sql.exec(statement);
    if (!this.candidates.isForgotten()) this.sql.exec('INSERT OR IGNORE INTO collection_cursor_secret(id,secret) VALUES(1,?)', Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join(''));
    this.cursorSecret = this.sql.exec<{ secret: string }>('SELECT secret FROM collection_cursor_secret WHERE id=1').toArray()[0]?.secret ?? '';
  }
  private rows<T extends Record<string, SqlValue>>(query: string, ...bindings: unknown[]): T[] { this.candidates.assertActive(); return this.sql.exec<T>(query, ...bindings).toArray(); }
  private time(): string { return new Date(this.now()).toISOString(); }
  private row(id: string): Row {
    const row = this.rows<Row>('SELECT * FROM collections WHERE id=?', id)[0];
    if (!row) throw new ToolError('collection_not_found', 'This collection does not belong to the search.');
    return row;
  }
  private create(source: CollectionDescriptor['source'], options: { title: string; backing: Backing; maximum?: number; total?: number | null; status?: Row['status']; root_id?: string; page_size: number; config?: Config; cohort?: number }): string {
    const id = crypto.randomUUID(), time = this.time();
    this.sql.exec(`INSERT INTO collections(id,source_json,title,created_at,membership_as_of,root_id,backing,maximum,total,status,page_size,config_json,cohort,feedback_revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, JSON.stringify(source), options.title, time, time, options.root_id ?? id, options.backing,
      options.maximum ?? 0, options.total ?? null, options.status ?? 'ready', options.page_size, JSON.stringify(options.config ?? {}), options.cohort ?? options.total ?? 0, this.research.feedbackRevision());
    return id;
  }
  private request(requestId: string | undefined, signature: string): string | null {
    if (!requestId) return null;
    const prior = this.rows<{ signature: string; collection_id: string }>('SELECT signature,collection_id FROM collection_requests WHERE request_id=?', requestId)[0];
    if (prior && prior.signature !== signature) throw new ToolError('collection_request_conflict', 'This request ID already describes a different collection.');
    return prior?.collection_id ?? null;
  }
  private remember(requestId: string | undefined, signature: string, id: string): void {
    if (requestId) this.sql.exec('INSERT INTO collection_requests(request_id,signature,collection_id) VALUES(?,?,?)', requestId, signature, id);
  }
  open(input: OpenCollectionInput): StoredCollectionPage {
    this.candidates.status();
    const size = bounds(input.page_size ?? 12), title = input.title ?? 'Sellpy Auswahl';
    if (input.selection && input.source) throw new ToolError('invalid_collection_source', 'Choose a source or an explicit selection.');
    const digest = createHash('sha256').update(JSON.stringify({ source: input.source ?? null, selection: Boolean(input.selection), title, size }));
    for (const entry of input.selection ?? []) digest.update(JSON.stringify(entry));
    const signature = digest.digest('hex');
    let id = this.request(input.request_id, signature);
    if (!id) {
      const source = input.source ?? { kind: 'observed' as const };
      if (input.selection) {
        id = this.atomic(() => {
          const collectionId = this.create({ kind: 'selection' }, { title, backing: 'members', total: 0, page_size: size });
          let position = 0;
          for (const selected of input.selection!) {
            const exists = this.rows<{ item_id: string }>('SELECT item_id FROM collection_members WHERE collection_id=? AND item_id=?', collectionId, selected.item_id).length;
            if (!exists) this.sql.exec('INSERT INTO collection_members(collection_id,item_id,sort_key,reason,cautions_json) VALUES(?,?,?,?,?)', collectionId, selected.item_id, ++position, selected.reason, JSON.stringify(selected.cautions ?? []));
          }
          this.sql.exec('UPDATE collections SET total=?,cohort=? WHERE id=?', position, position, collectionId);
          this.remember(input.request_id, signature, collectionId); return collectionId;
        });
      } else if (source.kind === 'refinement') {
        // Validate ownership before creating a public descriptor; preparation never advances the model cursor.
        const state = this.research.prepareCollectionRefinement(source.refinement_id);
        id = this.create(source, { title, backing: 'refinement', status: state.ready ? 'ready' : 'preparing', total: state.ready ? state.total : null,
          page_size: size, config: { refinement_id: source.refinement_id }, cohort: state.cohort });
        this.applyRefinement(id, state);
        this.remember(input.request_id, signature, id);
      } else {
        const cohort = this.candidates.snapshotCohort();
        if (source.kind === 'arm') {
          const ready = this.candidates.ensureArmMemberships(source.arm_id);
          const snapshot = this.armSnapshot(source.arm_id);
          id = this.create(source, { title, backing: 'arm', status: ready ? 'ready' : 'preparing', maximum: snapshot.maximum,
            total: ready ? snapshot.total : null, page_size: size, config: { arm_id: source.arm_id }, cohort: cohort.total });
        } else {
          const base = this.create({ kind: 'observed' }, { title, backing: 'observed', maximum: cohort.max_sequence, total: cohort.total, page_size: size });
          id = source.kind === 'shortlist' ? this.createDerived(base, { kind: 'shortlist' }, title) : base;
        }
        this.remember(input.request_id, signature, id);
      }
    }
    return this.page(id, { page_size: size, request_id: input.request_id }, true);
  }
  private armSnapshot(armId: string): { maximum: number; total: number } {
    return this.rows<{ maximum: number; total: number }>(`SELECT COALESCE((SELECT sequence FROM arm_memberships WHERE arm_id=? ORDER BY sequence DESC LIMIT 1),0) AS maximum,
      COALESCE((SELECT candidates FROM arm_scope WHERE arm_id=?),0) AS total`, armId, armId)[0]!;
  }
  private createDerived(baseId: string, view: CollectionView, title?: string): string {
    const base = this.row(baseId);
    if (base.status !== 'ready') throw new ToolError('collection_preparing', 'Finish preparing this collection before opening another view.', { retryable: true });
    if (view.kind === 'source_order') return base.root_id;
    return this.create(view.kind === 'shortlist' ? { kind: 'shortlist', base_collection_id: base.id, view: view.kind } : { kind: 'derived', base_collection_id: base.id, view: view.kind },
      { title: title ?? base.title, backing: 'members', status: 'preparing', total: 0, root_id: base.root_id, page_size: base.page_size,
        config: { base_id: base.id, view: view.kind }, cohort: base.total ?? 0 });
  }
  derive(id: string, view: CollectionView, requestId?: string, pageSize = 12): StoredCollectionPage {
    const original = this.row(id), base = this.row(original.root_id);
    const signature = JSON.stringify({ base: base.id, view });
    let derived = this.request(requestId, signature);
    if (!derived) { derived = this.createDerived(base.id, view); this.remember(requestId, signature, derived); }
    return this.page(derived, { page_size: pageSize, request_id: requestId });
  }
  private descriptor(row: Row): CollectionDescriptor {
    const source = JSON.parse(row.source_json) as CollectionDescriptor['source'], config = JSON.parse(row.config_json) as Config;
    const order: CollectionDescriptor['order'] = row.backing === 'observed' ? 'discovery' : row.backing === 'arm' ? 'arm_discovery' : row.backing === 'refinement' ? 'refinement'
      : config.view === 'price_asc' || config.view === 'price_desc' ? config.view : source.kind === 'shortlist' ? 'shortlist' : 'selection';
    return { id: row.id, source, created_at: row.created_at, membership_as_of: row.membership_as_of, order,
      total: row.status === 'ready' ? row.total : null, status: row.status,
      ...(row.status === 'preparing' ? { progress: { scanned: row.scanned, cohort: row.cohort } } : {}),
      ...(config.base_id || config.refinement_id ? { evaluation: { started_at: row.created_at, completed_at: row.completed_at,
        observations_from: row.observations_from, observations_to: row.observations_to } } : {}) };
  }
  private read(row: Row, seek: Seek | null, limit: number, reverse = false): Member[] {
    const order = reverse ? 'DESC' : 'ASC', comparison = reverse ? '<' : '>';
    const config = JSON.parse(row.config_json) as Config;
    if (row.backing === 'observed') {
      return this.rows<{ key: number; item_id: string }>(`SELECT sequence AS key,item_id FROM candidates WHERE sequence<=? ${seek ? `AND sequence${comparison}?` : ''} ORDER BY sequence ${order} LIMIT ?`,
        row.maximum, ...(seek ? [seek.key] : []), limit).map(value => ({ ...value, reason: '', cautions: [] }));
    }
    if (row.backing === 'arm') {
      return this.rows<{ key: number; item_id: string }>(`SELECT sequence AS key,item_id FROM arm_memberships WHERE arm_id=? AND sequence<=? ${seek ? `AND sequence${comparison}?` : ''} ORDER BY sequence ${order} LIMIT ?`,
        config.arm_id, row.maximum, ...(seek ? [seek.key] : []), limit).map(value => ({ ...value, reason: '', cautions: [] }));
    }
    if (row.backing === 'refinement') {
      return this.rows<{ key: number; item_id: string }>(`SELECT position AS key,item_id FROM refinement_positions WHERE refinement_id=? ${seek ? `AND position${comparison}?` : ''} ORDER BY position ${order} LIMIT ?`,
        config.refinement_id, ...(seek ? [seek.key] : []), limit).map(value => ({ ...value, reason: '', cautions: [] }));
    }
    return this.rows<{ key: number; item_id: string; reason: string; cautions_json: string; notes_omitted: number }>(`SELECT sort_key AS key,item_id,substr(reason,1,2000) AS reason,
      CASE WHEN LENGTH(CAST(cautions_json AS BLOB))<=8000 THEN cautions_json ELSE json_array(substr(COALESCE(json_extract(cautions_json,'$[0]'),''),1,2000),substr(COALESCE(json_extract(cautions_json,'$[1]'),''),1,2000)) END AS cautions_json,
      (LENGTH(reason)>2000 OR LENGTH(CAST(cautions_json AS BLOB))>8000) AS notes_omitted FROM collection_members WHERE collection_id=?
      ${seek ? `AND (sort_key,item_id)${comparison}(?,?)` : ''} ORDER BY sort_key ${order},item_id ${order} LIMIT ?`, row.id, ...(seek ? [seek.key, seek.item] : []), limit)
      .map(value => ({ key: value.key, item_id: value.item_id, reason: value.reason, cautions: JSON.parse(value.cautions_json) as string[], notes_omitted: Boolean(value.notes_omitted) }));
  }
  private applyRefinement(id: string, state: ReturnType<ResearchStore['prepareCollectionRefinement']>): void {
    this.sql.exec('UPDATE collections SET status=?,total=?,scanned=?,cohort=?,membership_as_of=?,observations_from=?,observations_to=?,completed_at=? WHERE id=?', state.ready ? 'ready' : 'preparing', state.ready ? state.total : null,
      state.scanned, state.cohort, state.created_at, state.evaluation.observations_from, state.evaluation.observations_to, state.evaluation.completed_at, id);
  }
  private advance(row: Row): Row {
    if (row.status === 'ready') return row;
    const config = JSON.parse(row.config_json) as Config;
    if (row.backing === 'refinement') this.applyRefinement(row.id, this.research.prepareCollectionRefinement(config.refinement_id!));
    else if (row.backing === 'arm') {
      if (this.candidates.ensureArmMemberships(config.arm_id!)) {
        const snapshot = this.armSnapshot(config.arm_id!);
        this.sql.exec('UPDATE collections SET maximum=?,total=?,status=\'ready\',membership_as_of=? WHERE id=?', snapshot.maximum, snapshot.total, this.time(), row.id);
      }
    } else if (row.backing === 'legacy') this.importLegacy(row);
    else if (config.base_id && config.view) {
      const base = this.row(config.base_id);
      const members = this.read(base, row.scanned ? { key: row.scan_key, item: row.scan_item } : null, BUILD_WORK);
      const found = new Map(this.candidates.collectionFacts(members.map(value => value.item_id)).map(value => [value.item_id, value]));
      const currency = MARKETS[this.candidates.status().plan.market]?.currency;
      this.atomic(() => {
        let total = row.total ?? 0, minimum = row.observations_from, maximum = row.observations_to;
        for (const member of members) {
          const item = found.get(member.item_id);
          if (item) { const observed = new Date(item.observed_at).toISOString(); if (!minimum || observed < minimum) minimum = observed; if (!maximum || observed > maximum) maximum = observed; }
          const include = config.view === 'shortlist' ? this.research.feedbackAt(member.item_id, row.feedback_revision)?.decision === 'shortlist'
            : config.view === 'available' ? item?.availability === 'available' : config.view === 'assessed' ? Boolean(item?.assessed)
            : config.view === 'unassessed' ? !item?.assessed : true;
          if (!include) continue;
          const price = item && item.currency === currency && item.price_minor !== null ? item.price_minor : undefined;
          const key = config.view === 'price_asc' ? price ?? Number.MAX_SAFE_INTEGER
            : config.view === 'price_desc' ? price === undefined ? Number.MAX_SAFE_INTEGER : -price : row.scanned + members.indexOf(member) + 1;
          if (base.backing === 'members' || base.backing === 'legacy') {
            this.sql.exec('INSERT INTO collection_members(collection_id,item_id,sort_key,reason,cautions_json) SELECT ?,item_id,?,reason,cautions_json FROM collection_members WHERE collection_id=? AND item_id=? ORDER BY sort_key LIMIT 1', row.id, key, base.id, member.item_id);
          } else this.sql.exec('INSERT INTO collection_members(collection_id,item_id,sort_key,reason,cautions_json) VALUES(?,?,?,?,?)', row.id, member.item_id, key, member.reason, JSON.stringify(member.cautions));
          total++;
        }
        const last = members.at(-1), scanned = row.scanned + members.length;
        const done = members.length < BUILD_WORK || scanned >= row.cohort;
        this.sql.exec('UPDATE collections SET total=?,scanned=?,scan_key=?,scan_item=?,status=?,observations_from=?,observations_to=?,completed_at=? WHERE id=?', total, scanned,
          last?.key ?? row.scan_key, last?.item_id ?? row.scan_item, done ? 'ready' : 'preparing', minimum, maximum, done ? this.time() : null, row.id);
      });
    }
    return this.row(row.id);
  }
  page(id: string, input: PageCollectionInput = {}, alreadyWorked = false): StoredCollectionPage {
    let row = this.row(id);
    if (!alreadyWorked) row = this.advance(row);
    const size = bounds(input.page_size ?? row.page_size), { plan } = this.candidates.status();
    // Run ID is read from the durable owner, not accepted from a collection token.
    const runId = this.rows<{ run_id: string }>('SELECT run_id FROM run WHERE id=1')[0]!.run_id;
    const cursor = input.cursor ? parseCursor(input.cursor, runId, id, this.cursorSecret) : null;
    const startToken = (seek: Seek | null, rank: number, direction: Cursor['direction'] = 'next') => token({ v: 2, kind: 'collection', run_id: runId, collection_id: id, direction, key: seek?.key ?? 0, item: seek?.item ?? '', rank }, this.cursorSecret);
    const warnings: string[] = [];
    if (row.status === 'preparing') {
      const resume = input.cursor ?? startToken(null, 0);
      return { run_id: runId, language: plan.language, title: row.title, collection: this.descriptor(row), page: { size, start: 0, end: 0, cursor: resume, previous_cursor: null, next_cursor: resume },
        candidates: [], selection: [], feedback: {}, scope: this.candidates.collectionScope(null), warnings: ['Collection preparation continues in bounded steps.'], ...(input.request_id ? { request_id: input.request_id } : {}) };
    }
    const reverse = cursor?.direction === 'previous';
    const seek = cursor && (cursor.rank > 0 || reverse) ? { key: cursor.key, item: cursor.item } : null;
    const read = this.read(row, seek, size + 1, reverse);
    let members: Member[], before: Seek | null, rank: number;
    if (reverse) {
      members = read.slice(0, size).reverse();
      before = read.length > size ? { key: read[size]!.key, item: read[size]!.item_id } : null;
      rank = Math.max(0, cursor!.rank - members.length);
    } else { members = read.slice(0, size); before = seek; rank = cursor?.rank ?? 0; }
    const first = members[0], last = members.at(-1);
    const hasNext = reverse ? rank + members.length < (row.total ?? 0) : read.length > size;
    const page: CollectionPageInfo = { size, start: members.length ? rank + 1 : 0, end: members.length ? rank + members.length : 0,
      cursor: startToken(before, rank), previous_cursor: rank > 0 && first ? startToken({ key: first.key, item: first.item_id }, rank, 'previous') : null,
      next_cursor: hasNext && last ? startToken({ key: last.key, item: last.item_id }, rank + members.length) : null };
    const candidates = this.candidates.getGalleryCandidates(members.map(value => value.item_id));
    for (const member of members) if (member.notes_omitted) {
      const candidate = candidates.find(value => value.item.id === member.item_id);
      if (candidate) candidate.presentation_summary = { omitted_fields: [...(candidate.presentation_summary?.omitted_fields ?? []), 'selection.notes'],
        image_count: candidate.presentation_summary?.image_count ?? candidate.item.images.length, assessment_recorded: candidate.presentation_summary?.assessment_recorded ?? Boolean(candidate.assessment),
        checked_image_count: candidate.presentation_summary?.checked_image_count ?? candidate.assessment?.checked_image_ids.length ?? 0 };
    }
    if (candidates.length !== members.length) warnings.push('Some fixed collection members have no stored item observation; their membership is retained.');
    if (JSON.parse(row.config_json).view?.startsWith('price_')) warnings.push(`Price order uses ${MARKETS[plan.market]?.currency ?? 'the search market currency'}; missing or different-currency prices appear last.`);
    if (row.observations_from) warnings.push('Order and membership are fixed. Displayed facts retain their own observation times; derived criteria were evaluated over the stated interval.');
    return { run_id: runId, language: plan.language, title: row.title, collection: this.descriptor(row), page,
      candidates, selection: members.map(value => ({ item_id: value.item_id, reason: value.reason, cautions: value.cautions })),
      feedback: this.research.getFeedback(members.map(value => value.item_id)), scope: this.candidates.collectionScope(row.total), warnings,
      ...(input.request_id ? { request_id: input.request_id } : {}) };
  }
  private member(row: Row, itemId: string): boolean {
    const config = JSON.parse(row.config_json) as Config;
    if (row.backing === 'observed') return Boolean(this.rows('SELECT item_id FROM candidates WHERE item_id=? AND sequence<=?', itemId, row.maximum).length);
    if (row.backing === 'arm') return Boolean(this.rows('SELECT item_id FROM arm_memberships WHERE arm_id=? AND item_id=? AND sequence<=?', config.arm_id, itemId, row.maximum).length);
    if (row.backing === 'refinement') return Boolean(this.rows('SELECT item_id FROM refinement_positions WHERE refinement_id=? AND item_id=?', config.refinement_id, itemId).length);
    return Boolean(this.rows('SELECT item_id FROM collection_members WHERE collection_id=? AND item_id=?', row.id, itemId).length);
  }
  detail(id: string, itemId: string): { candidate: Candidate; selection: SelectionEntry; feedback: ItemFeedback | undefined } {
    const row = this.row(id);
    if (!this.member(row, itemId)) throw new ToolError('item_not_in_collection', 'This item is not a member of this collection.');
    const candidate = this.candidates.getCandidates([itemId])[0];
    if (!candidate) throw new ToolError('item_not_found', 'This fixed member has no stored item observation.');
    const selected = this.rows<{ reason: string; cautions_json: string }>('SELECT reason,cautions_json FROM collection_members WHERE collection_id=? AND item_id=?', id, itemId)[0];
    return { candidate, selection: { item_id: itemId, reason: selected?.reason ?? '', cautions: selected ? JSON.parse(selected.cautions_json) as string[] : [] }, feedback: this.research.getFeedback([itemId])[itemId] };
  }
  scope(id: string): CollectionScope { const row = this.row(id); return this.candidates.collectionScope(row.status === 'ready' ? row.total : null); }
  legacy(presentationId: string, offset: number, requestId?: string): StoredCollectionPage {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ToolError('invalid_cursor', 'The presentation offset is invalid.');
    let id = this.rows<{ collection_id: string }>('SELECT collection_id FROM collection_legacy WHERE presentation_id=?', presentationId)[0]?.collection_id;
    if (!id) {
      if (!this.rows('SELECT id FROM presentations WHERE id=?', presentationId).length) throw new ToolError('selection_not_found', 'This saved presentation does not belong to the search.');
      id = this.create({ kind: 'selection' }, { title: 'Sellpy Auswahl', backing: 'legacy', status: 'preparing', page_size: 6, config: { legacy_id: presentationId, legacy: initialLegacy() } });
      this.sql.exec('INSERT INTO collection_legacy(presentation_id,collection_id) VALUES(?,?)', presentationId, id);
    }
    const row = this.advance(this.row(id));
    const runId = this.rows<{ run_id: string }>('SELECT run_id FROM run WHERE id=1')[0]!.run_id;
    return this.page(id, { page_size: row.page_size, request_id: requestId,
      cursor: token({ v: 2, kind: 'collection', run_id: runId, collection_id: id, direction: 'next', key: offset, item: offset ? '~' : '', rank: offset }, this.cursorSecret) }, true);
  }
  private importLegacy(row: Row): void {
    const config = JSON.parse(row.config_json) as Config, state = config.legacy!;
    const raw = this.rows<{ bytes: ArrayBuffer }>('SELECT substr(CAST(value_json AS BLOB),?,?) AS bytes FROM presentations WHERE id=?', state.offset + 1, LEGACY_BYTES, config.legacy_id)[0];
    if (!raw) throw new ToolError('selection_not_found', 'This historical presentation is unavailable.');
    const bytes = new Uint8Array(raw.bytes);
    let end = bytes.length, text = '';
    while (end >= Math.max(0, bytes.length - 3)) { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)); break; } catch { end--; } }
    if (!text && bytes.length) throw new ToolError('legacy_presentation_invalid', 'The saved presentation contains invalid text.');
    let imported = 0, consumed = 0, title = row.title, pageSize = row.page_size;
    this.atomic(() => {
      const finishValue = () => {
        const value: unknown = JSON.parse(state.token);
        if (state.key === 'title' && typeof value === 'string') title = value;
        if (state.key === 'page_size' && typeof value === 'number') pageSize = bounds(value);
        if (state.key === 'selection') {
          const entry = value as SelectionEntry;
          if (!entry || typeof entry.item_id !== 'string' || typeof entry.reason !== 'string') throw new ToolError('legacy_presentation_invalid', 'A saved selection entry is invalid.');
          state.count++; imported++;
          this.sql.exec('INSERT OR IGNORE INTO collection_members(collection_id,item_id,sort_key,reason,cautions_json) VALUES(?,?,?,?,?)', row.id, entry.item_id, state.count, entry.reason, JSON.stringify(entry.cautions ?? []));
          state.phase = 'selection';
        } else state.phase = 'separator';
        state.token = ''; state.depth = 0; state.quoted = false; state.escaped = false;
      };
      for (const char of text) {
        if (imported >= BUILD_WORK || state.phase === 'done') break;
        consumed += encoder.encode(char).byteLength;
        if (state.phase === 'start') { if (/\s/.test(char)) continue; if (char !== '{') throw new ToolError('legacy_presentation_invalid', 'The saved presentation is invalid.'); state.phase = 'key'; continue; }
        if (state.phase === 'key') {
          if (!state.token && /[\s,]/.test(char)) continue;
          if (!state.token && char === '}') { state.phase = 'done'; continue; }
          state.token += char;
          if (state.escaped) state.escaped = false;
          else if (char === '\\') state.escaped = true;
          else if (char === '"' && state.token.length > 1) { state.key = JSON.parse(state.token) as string; state.token = ''; state.phase = 'colon'; }
          continue;
        }
        if (state.phase === 'colon') { if (/\s/.test(char)) continue; if (char !== ':') throw new ToolError('legacy_presentation_invalid', 'The saved field is invalid.'); state.phase = 'value'; continue; }
        if (state.phase === 'separator') { if (/\s/.test(char)) continue; if (char === ',') state.phase = 'key'; else if (char === '}') state.phase = 'done'; else throw new ToolError('legacy_presentation_invalid', 'The saved separator is invalid.'); continue; }
        if (state.phase === 'selection') { if (/[\s,]/.test(char)) continue; if (char === ']') { state.phase = 'separator'; continue; } state.phase = 'value'; }
        if (!state.token && /\s/.test(char)) continue;
        if (!state.token && state.key === 'selection' && char === '[') { state.phase = 'selection'; continue; }
        if (!state.quoted && state.depth === 0 && state.token && /[,}]/.test(char)) {
          finishValue(); state.phase = char === ',' ? 'key' : 'done'; continue;
        }
        state.token += char;
        if (state.token.length > 1_000_000) throw new ToolError('legacy_entry_too_large', 'One historical selection entry exceeds the bounded conversion budget. Its original record is retained.');
        if (state.escaped) state.escaped = false;
        else if (state.quoted && char === '\\') state.escaped = true;
        else if (char === '"') { state.quoted = !state.quoted; if (!state.quoted && state.depth === 0) finishValue(); }
        else if (!state.quoted && (char === '{' || char === '[')) state.depth++;
        else if (!state.quoted && (char === '}' || char === ']')) { state.depth--; if (state.depth === 0) finishValue(); }
      }
      state.offset += consumed;
      const ready = state.phase === 'done';
      if (!ready && !bytes.length) throw new ToolError('legacy_presentation_invalid', 'The saved presentation ended before conversion completed.');
      this.sql.exec('UPDATE collections SET title=?,page_size=?,config_json=?,scanned=?,cohort=?,total=?,status=?,backing=?,completed_at=? WHERE id=?', title, pageSize, JSON.stringify(config), state.count, state.count,
        ready ? state.count : null, ready ? 'ready' : 'preparing', ready ? 'members' : 'legacy', ready ? this.time() : null, row.id);
    });
  }
  erase(): void { for (const table of ['collection_members', 'collection_requests', 'collection_legacy', 'collection_cursor_secret', 'collections']) this.sql.exec(`DELETE FROM ${table}`); }
}
