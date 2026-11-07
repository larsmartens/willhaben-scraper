import { DurableObject } from "cloudflare:workers";
import {
  RESEARCH_INACTIVITY_DAYS, RESEARCH_INACTIVITY_MS,
  normalizeResearchEvent, normalizeResearchRead, normalizeCollection, normalizeCollectionIds,
  normalizeListingObservations, normalizeObservationIds, newestListingObservation,
  researchError, researchHash, researchCursor, readResearchCursor,
  validateResearchId, validateResearchSource, validateCollectionId,
} from "./research.mjs";
import { requirementKey, reviewEvidence, normalizeRefinement, evaluateRefinement, REFINEMENT_STEP_SIZE } from "./review.mjs";

const iso = value => new Date(value).toISOString();

export class ResearchSession extends DurableObject {
  #deleted = false;

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS session (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1), research_id TEXT NOT NULL,
          source TEXT NOT NULL, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL, signature TEXT NOT NULL, payload TEXT NOT NULL, observed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS events_type ON events (type);
        CREATE TABLE IF NOT EXISTS queries (
          query_id TEXT PRIMARY KEY, query TEXT NOT NULL, filters TEXT NOT NULL, search_type TEXT NOT NULL, page_size INTEGER NOT NULL,
          calls INTEGER NOT NULL DEFAULT 0, rows_returned INTEGER NOT NULL DEFAULT 0,
          scanned_count INTEGER NOT NULL DEFAULT 0, filtered_out_count INTEGER NOT NULL DEFAULT 0,
          reported_total INTEGER, last_known_total INTEGER, total_changed INTEGER NOT NULL DEFAULT 0,
          exhausted INTEGER NOT NULL DEFAULT 0, next_cursor TEXT, observed_at TEXT NOT NULL, first_sequence INTEGER NOT NULL,
          progress_page INTEGER NOT NULL DEFAULT 0, progress_observed_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS queries_order ON queries (first_sequence);
        CREATE TABLE IF NOT EXISTS query_pages (
          query_id TEXT NOT NULL, page INTEGER NOT NULL, page_size INTEGER NOT NULL,
          PRIMARY KEY (query_id, page, page_size)
        );
        CREATE TABLE IF NOT EXISTS listings (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
          detail_retrieved INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS listing_observations (
          listing_id TEXT PRIMARY KEY, kind TEXT NOT NULL, observed_at TEXT NOT NULL, listing TEXT
        );
        CREATE TABLE IF NOT EXISTS search_hits (
          query_id TEXT NOT NULL, listing_id TEXT NOT NULL, first_event INTEGER NOT NULL, PRIMARY KEY (query_id, listing_id)
        );
        CREATE INDEX IF NOT EXISTS search_hits_listing ON search_hits (listing_id);
        CREATE TABLE IF NOT EXISTS details (
          listing_id TEXT NOT NULL, audience TEXT NOT NULL, fields TEXT NOT NULL,
          description TEXT, observed_at TEXT NOT NULL, PRIMARY KEY (listing_id, audience)
        );
        CREATE TABLE IF NOT EXISTS photos (
          listing_id TEXT NOT NULL, audience TEXT NOT NULL, photo_index INTEGER NOT NULL,
          size TEXT NOT NULL, observed_at TEXT NOT NULL, deliveries INTEGER NOT NULL,
          PRIMARY KEY (listing_id, audience, photo_index, size)
        );
        CREATE TABLE IF NOT EXISTS reviews (
          event_id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, photo_indices TEXT NOT NULL,
          findings TEXT NOT NULL, observed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS reviews_listing ON reviews (listing_id, observed_at);
        CREATE TABLE IF NOT EXISTS presented (listing_id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS collections (
          collection_id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL,
          signature TEXT NOT NULL, created_ms INTEGER NOT NULL, available_total INTEGER NOT NULL,
          mode TEXT NOT NULL, query_ids TEXT NOT NULL, listing_watermark INTEGER NOT NULL, event_watermark INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collection_items (
          collection_id TEXT NOT NULL, position INTEGER NOT NULL, listing_id TEXT NOT NULL, selection TEXT NOT NULL,
          PRIMARY KEY (collection_id, position)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS collection_members ON collection_items (collection_id, listing_id);
        CREATE TABLE IF NOT EXISTS photo_receipts (
          listing_id TEXT NOT NULL, photo_id TEXT NOT NULL, evidence_id TEXT NOT NULL,
          photo_index INTEGER NOT NULL, source_observed_at TEXT NOT NULL, delivered_at TEXT NOT NULL,
          valid INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (listing_id, photo_id, evidence_id)
        );
        CREATE TABLE IF NOT EXISTS review_requirements (
          listing_id TEXT NOT NULL, requirement_key TEXT NOT NULL, requirement TEXT NOT NULL,
          verdict TEXT NOT NULL, evidence TEXT NOT NULL, photo_ids TEXT NOT NULL, evidence_id TEXT NOT NULL,
          findings TEXT NOT NULL, reviewed_at TEXT NOT NULL, source_observed_at TEXT NOT NULL,
          valid INTEGER NOT NULL DEFAULT 1, event_sequence INTEGER NOT NULL, PRIMARY KEY (listing_id, requirement_key)
        );
        CREATE TABLE IF NOT EXISTS listing_feedback (
          revision INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT NOT NULL, decision TEXT NOT NULL,
          reason TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS feedback_listing ON listing_feedback (listing_id, revision DESC);
        CREATE TABLE IF NOT EXISTS refinements (
          refinement_id TEXT PRIMARY KEY, cohort_id TEXT NOT NULL, result_collection_id TEXT NOT NULL,
          preferences TEXT NOT NULL, feedback_watermark INTEGER NOT NULL, candidate_total INTEGER NOT NULL,
          next_offset INTEGER NOT NULL DEFAULT 0, next_step INTEGER NOT NULL DEFAULT 0,
          eligible_count INTEGER NOT NULL DEFAULT 0, excluded_count INTEGER NOT NULL DEFAULT 0,
          unknown_count INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, created_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS refinement_results (
          refinement_id TEXT NOT NULL, position INTEGER NOT NULL, listing_id TEXT NOT NULL,
          eligible INTEGER NOT NULL, score INTEGER NOT NULL, evaluation TEXT NOT NULL, selection TEXT NOT NULL,
          PRIMARY KEY (refinement_id, position)
        );
        CREATE TABLE IF NOT EXISTS refinement_steps (
          refinement_id TEXT NOT NULL, step INTEGER NOT NULL, response TEXT NOT NULL,
          PRIMARY KEY (refinement_id, step)
        );
      `);
    });
  }

  #sql(query, ...params) {
    return this.ctx.storage.sql.exec(query, ...params);
  }

  #session() {
    if (this.#deleted) throw researchError("research_expired", "This research expired after seven days of inactivity. Start a new research session.");
    const row = this.#sql("SELECT * FROM session WHERE singleton = 1").toArray()[0];
    if (!row) throw researchError("research_unavailable", "Research is unavailable or expired. Start a new research session.");
    if (row.expires_ms <= Date.now()) throw researchError("research_expired", "This research expired after seven days of inactivity. Start a new research session.");
    return row;
  }

  #touch() {
    const row = this.#session();
    const now = Math.max(Date.now(), row.updated_ms);
    this.#sql("UPDATE session SET updated_ms = ?, expires_ms = ? WHERE singleton = 1", now, now + RESEARCH_INACTIVITY_MS);
  }

  #metadata() {
    const row = this.#session();
    return { researchId: row.research_id, source: row.source, createdAt: iso(row.created_ms),
      updatedAt: iso(row.updated_ms), expiresAt: iso(row.expires_ms), inactivityDays: RESEARCH_INACTIVITY_DAYS };
  }

  #failure(error) {
    if (!error.code) throw error;
    return { error: { code: error.code, message: error.message } };
  }

  async #execute(operation) {
    try {
      const result = this.ctx.storage.transactionSync(operation);
      await this.ctx.storage.setAlarm(this.#session().expires_ms);
      return result;
    } catch (error) {
      return this.#failure(error);
    }
  }

  initialize({ researchId, source }) {
    return this.#execute(() => {
      validateResearchId(researchId);
      validateResearchSource(source);
      if (this.#deleted) throw researchError("research_expired", "Start a new research session after inactivity expiry.");
      const now = Date.now();
      this.#sql("INSERT OR IGNORE INTO session VALUES (1, ?, ?, ?, ?, ?)", researchId, source, now, now, now + RESEARCH_INACTIVITY_MS);
      const row = this.#session();
      if (row.research_id !== researchId || row.source !== source) throw researchError("research_conflict", "This research already has a different identity or source.");
      this.#touch();
      return this.#metadata();
    });
  }

  #listing(id) {
    this.#sql("INSERT OR IGNORE INTO listings (id) VALUES (?)", id);
  }

  #recordSearch(event, sequence) {
    const filters = JSON.stringify(event.filters);
    const old = this.#sql("SELECT * FROM queries WHERE query_id = ?", event.queryId).toArray()[0];
    if (old && (old.query !== event.query || old.filters !== filters || old.search_type !== event.searchType || old.page_size !== event.pageSize)) {
      throw researchError("research_query_conflict", "A queryId already identifies a different query or filter selection.");
    }
    this.#sql(`INSERT OR IGNORE INTO queries (query_id, query, filters, search_type, page_size, observed_at, first_sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, event.queryId, event.query, filters, event.searchType, event.pageSize, event.observedAt, sequence);
    const newer = !old || event.observedAt >= old.observed_at;
    const advances = !old || event.page > old.progress_page ||
      (event.page === old.progress_page && event.observedAt >= old.progress_observed_at);
    const changed = old?.last_known_total != null && event.reportedTotal != null && old.last_known_total !== event.reportedTotal;
    this.#sql(`UPDATE queries SET calls = calls + 1, rows_returned = rows_returned + ?,
      scanned_count = scanned_count + ?, filtered_out_count = filtered_out_count + ?, total_changed = MAX(total_changed, ?),
      reported_total = ?, last_known_total = COALESCE(?, last_known_total), exhausted = ?, next_cursor = ?,
      observed_at = ?, progress_page = ?, progress_observed_at = ? WHERE query_id = ?`,
    event.ids.length, event.scannedCount, event.filteredOutCount, Number(changed), newer ? event.reportedTotal : old.reported_total, event.reportedTotal,
    advances ? Number(event.exhausted) : old.exhausted, advances ? event.nextCursor : old.next_cursor,
    newer ? event.observedAt : old.observed_at, advances ? event.page : old.progress_page,
    advances ? event.observedAt : old.progress_observed_at, event.queryId);
    this.#sql("INSERT OR IGNORE INTO query_pages VALUES (?, ?, ?)", event.queryId, event.page, event.pageSize);
    for (const id of event.ids) {
      this.#listing(id);
      this.#sql("INSERT OR IGNORE INTO search_hits VALUES (?, ?, ?)", event.queryId, id, sequence);
    }
  }

  #recordDetails(event) {
    for (const id of event.retrievedIds) {
      this.#listing(id);
      this.#sql("UPDATE listings SET detail_retrieved = 1 WHERE id = ?", id);
    }
    for (const record of event.records) {
      this.#listing(record.id);
      const old = this.#sql("SELECT * FROM details WHERE listing_id = ? AND audience = ?", record.id, event.audience).toArray()[0];
      const fields = [...new Set([...(old ? JSON.parse(old.fields) : []), ...record.fields])].sort();
      let description = old?.description ? JSON.parse(old.description) : null;
      // A complete normalized description can be shorter than a previously delivered raw prefix.
      if (record.description && (!description || record.description.observedAt > description.observedAt ||
          (record.description.observedAt === description.observedAt &&
            ((description.truncated && !record.description.truncated) ||
             (description.truncated === record.description.truncated && record.description.deliveredChars >= description.deliveredChars))))) {
        description = record.description;
      }
      this.#sql(`INSERT INTO details VALUES (?, ?, ?, ?, ?) ON CONFLICT (listing_id, audience) DO UPDATE SET
        fields = excluded.fields, description = excluded.description, observed_at = MAX(details.observed_at, excluded.observed_at)`,
      record.id, event.audience, JSON.stringify(fields), description ? JSON.stringify(description) : null, record.observedAt);
    }
  }

  #recordPhotos(event) {
    for (const photo of event.photos) {
      this.#listing(photo.id);
      this.#sql(`INSERT INTO photos VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT (listing_id, audience, photo_index, size) DO UPDATE SET
          observed_at = MAX(photos.observed_at, excluded.observed_at), deliveries = photos.deliveries + 1`,
      photo.id, event.audience, photo.index, photo.size, photo.observedAt);
      if (event.audience === "model" && photo.evidenceId) {
        const observation = this.#observation(photo.id);
        if (observation?.listing?.evidenceId !== photo.evidenceId ||
            !observation.listing.gallery.some(item => item.photoId === photo.photoId)) continue;
        this.#sql(`INSERT INTO photo_receipts VALUES (?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT (listing_id, photo_id, evidence_id) DO UPDATE SET
          photo_index = excluded.photo_index, source_observed_at = excluded.source_observed_at,
          delivered_at = excluded.delivered_at, valid = 1`,
        photo.id, photo.photoId, photo.evidenceId, photo.index, photo.listingObservedAt, event.observedAt);
      }
    }
  }

  #recordReview(event, sequence) {
    for (const index of event.photoIndices) {
      const delivered = this.#sql("SELECT 1 FROM photos WHERE listing_id = ? AND audience = 'model' AND photo_index = ? LIMIT 1", event.id, index).toArray();
      if (!delivered.length) throw researchError("review_photo_not_delivered", "Record visual findings only for photo indices previously delivered to the model in this research.");
    }
    this.#sql("INSERT INTO reviews VALUES (?, ?, ?, ?, ?)", event.eventId, event.id,
      JSON.stringify(event.photoIndices), event.findings, event.observedAt);
    if (!event.requirements) return;
    const observation = this.#observation(event.id);
    if (observation?.listing?.evidenceId !== event.evidenceId) {
      throw researchError("review_evidence_stale", "The listing facts changed after the photos were delivered. Call inspect_listing_images with fresh=true and copy its successful review context.");
    }
    const receipts = event.photoIds.map(photoId => this.#sql(`SELECT * FROM photo_receipts
      WHERE listing_id = ? AND photo_id = ? AND evidence_id = ? AND valid = 1`, event.id, photoId, event.evidenceId).toArray()[0]);
    if (receipts.some(receipt => !receipt) || event.photoIndices.some(index => !receipts.some(receipt => receipt.photo_index === index)) ||
        receipts.some(receipt => !event.photoIndices.includes(receipt.photo_index))) {
      throw researchError("review_photo_not_delivered", "Copy photoIds and photoIndices from successful model-image deliveries in this research. Read changed or missing photos again.");
    }
    for (const requirement of event.requirements) {
      this.#sql(`INSERT INTO review_requirements VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT (listing_id, requirement_key) DO UPDATE SET requirement = excluded.requirement,
          verdict = excluded.verdict, evidence = excluded.evidence, photo_ids = excluded.photo_ids,
          evidence_id = excluded.evidence_id, findings = excluded.findings, reviewed_at = excluded.reviewed_at,
          source_observed_at = excluded.source_observed_at, valid = 1, event_sequence = excluded.event_sequence
        WHERE excluded.reviewed_at > review_requirements.reviewed_at OR
          (excluded.reviewed_at = review_requirements.reviewed_at AND excluded.event_sequence > review_requirements.event_sequence)`,
      event.id, requirementKey(requirement.requirement), requirement.requirement, requirement.verdict, requirement.evidence,
      JSON.stringify(requirement.photoIds), event.evidenceId, event.findings, event.observedAt,
      receipts.filter(receipt => requirement.photoIds.includes(receipt.photo_id)).map(receipt => receipt.source_observed_at).sort()[0], sequence);
    }
  }

  async #prepareObservations(input) {
    return Promise.all(normalizeListingObservations(input).map(async observation => {
      if (!observation.listing) return observation;
      const evidence = await reviewEvidence(observation.listing);
      return { ...observation, listing: { ...observation.listing, evidenceId: evidence.evidenceId,
        gallery: observation.listing.gallery.map((photo, index) => ({ ...photo, photoId: evidence.photos[index].photoId })) } };
    }));
  }

  #observation(id) {
    const row = this.#sql("SELECT * FROM listing_observations WHERE listing_id = ?", id).toArray()[0];
    return row ? { id, kind: row.kind, observedAt: row.observed_at,
      ...(row.listing ? { listing: JSON.parse(row.listing) } : {}) } : null;
  }

  #recordObservations(observations) {
    for (const incoming of observations) {
      const row = this.#sql("SELECT * FROM listing_observations WHERE listing_id = ?", incoming.id).toArray()[0];
      const current = row ? { kind: row.kind, observedAt: row.observed_at } : null;
      const stripEvidence = (key, value) => ["photoId", "evidenceId"].includes(key) ? undefined : value;
      const enrichLegacy = row?.listing && !JSON.parse(row.listing).evidenceId && row.kind === incoming.kind &&
        row.observed_at === incoming.observedAt && JSON.stringify(JSON.parse(row.listing), stripEvidence) === JSON.stringify(incoming.listing, stripEvidence);
      if (newestListingObservation(current, incoming) !== incoming && !enrichLegacy) continue;
      const evidenceId = incoming.listing?.evidenceId ?? "";
      const photoIds = JSON.stringify(incoming.listing?.gallery.map(photo => photo.photoId).filter(Boolean) ?? []);
      this.#sql(`UPDATE photo_receipts SET valid = 0 WHERE listing_id = ? AND valid = 1 AND
        (evidence_id <> ? OR NOT EXISTS (SELECT 1 FROM json_each(?) p WHERE p.value = photo_receipts.photo_id))`,
      incoming.id, evidenceId, photoIds);
      this.#sql(`UPDATE review_requirements SET valid = 0 WHERE listing_id = ? AND valid = 1 AND
        (evidence_id <> ? OR EXISTS (SELECT 1 FROM json_each(review_requirements.photo_ids) r
          WHERE NOT EXISTS (SELECT 1 FROM json_each(?) p WHERE p.value = r.value)))`,
      incoming.id, evidenceId, photoIds);
      this.#sql(`INSERT INTO listing_observations VALUES (?, ?, ?, ?)
        ON CONFLICT (listing_id) DO UPDATE SET kind = excluded.kind,
          observed_at = excluded.observed_at, listing = excluded.listing`,
      incoming.id, incoming.kind, incoming.observedAt, incoming.listing ? JSON.stringify(incoming.listing) : null);
    }
  }

  async append(input) {
    try {
      const event = await normalizeResearchEvent(input);
      const observations = await this.#prepareObservations(input.observations);
      const evidence = JSON.stringify(event, (key, value) => key === "observedAt" ? undefined : value);
      const signature = await researchHash(observations.length ? JSON.stringify([evidence, observations],
        (key, value) => ["evidenceId", "photoId"].includes(key) ? undefined : value) : evidence);
      return this.#execute(() => {
        this.#touch();
        const old = this.#sql("SELECT signature FROM events WHERE event_id = ?", event.eventId).toArray()[0];
        if (old && old.signature !== signature) throw researchError("research_event_conflict", "The eventId was already used for different research evidence.");
        if (!old) {
          const row = this.#sql("INSERT INTO events (event_id, type, signature, payload, observed_at) VALUES (?, ?, ?, ?, ?) RETURNING sequence",
            event.eventId, event.type, signature, JSON.stringify(event), event.observedAt).one();
          if (event.type === "search") this.#recordSearch(event, row.sequence);
          if (event.type === "details") this.#recordDetails(event);
          if (event.type === "photos") this.#recordPhotos(event);
          if (event.type === "review") this.#recordReview(event, row.sequence);
          if (event.type === "presentation") for (const id of event.ids) {
            this.#listing(id);
            this.#sql("INSERT OR IGNORE INTO presented VALUES (?)", id);
          }
          this.#recordObservations(observations);
        }
        return { ...this.#summary(), duplicate: Boolean(old), ...(event.type === "search" ? { queryId: event.queryId } : {}),
          ...(event.type === "photos" && event.audience === "model" ? { reviewContexts: this.#reviewContexts(event) } : {}),
          ...(event.type === "review" ? { id: event.id, review: this.#review(event.id) } : {}) };
      });
    } catch (error) {
      return this.#failure(error);
    }
  }

  async resolveObservations({ ids, observations = [] } = {}) {
    let incoming;
    try { incoming = await this.#prepareObservations(observations); }
    catch (error) { return this.#failure(error); }
    return this.#execute(() => {
      const wanted = normalizeObservationIds(ids);
      if (incoming.some(observation => !wanted.includes(observation.id))) {
        throw researchError("invalid_research_input", "Only requested listing observations can be resolved.");
      }
      this.#touch();
      this.#recordObservations(incoming);
      const rows = wanted.length ? this.#sql(`SELECT * FROM listing_observations
        WHERE listing_id IN (${wanted.map(() => "?").join(", ")})`, ...wanted).toArray() : [];
      const byId = new Map(rows.map(row => [row.listing_id, {
        id: row.listing_id, kind: row.kind, observedAt: row.observed_at,
        ...(row.listing ? { listing: JSON.parse(row.listing) } : {}),
      }]));
      return { researchId: this.#metadata().researchId,
        observations: wanted.filter(id => byId.has(id)).map(id => byId.get(id)),
        missingIds: wanted.filter(id => !byId.has(id)) };
    });
  }

  #review(id) {
    const observation = this.#observation(id);
    const rows = this.#sql("SELECT * FROM review_requirements WHERE listing_id = ? ORDER BY reviewed_at DESC, requirement_key", id).toArray();
    const indices = new Map((observation?.listing?.gallery ?? []).map(photo => [photo.photoId, photo.index]));
    const applicable = rows.filter(row => row.valid && row.evidence_id === observation?.listing?.evidenceId &&
      JSON.parse(row.photo_ids).every(photoId => indices.has(photoId)));
    const requirements = applicable.map(row => ({ requirement: row.requirement, verdict: row.verdict,
      evidence: row.evidence, photoIds: JSON.parse(row.photo_ids),
      photoIndices: JSON.parse(row.photo_ids).map(photoId => indices.get(photoId)).sort((a, b) => a - b),
      reviewedAt: row.reviewed_at, sourceObservedAt: row.source_observed_at }));
    const checkedPhotoIds = [...new Set(requirements.flatMap(item => item.photoIds))];
    return { status: !rows.length ? "unreviewed" : applicable.length === rows.length ? "current" : "stale",
      evidenceType: "agent-reported", observedAt: observation?.observedAt ?? null,
      reviewedAt: rows[0]?.reviewed_at ?? null, checkedPhotoIds,
      checkedPhotoIndices: checkedPhotoIds.map(photoId => indices.get(photoId)).sort((a, b) => a - b),
      findings: [...new Set(applicable.map(row => row.findings))], requirements,
      staleRequirements: rows.filter(row => !applicable.includes(row)).map(row => row.requirement) };
  }

  #feedback(id, watermark = Number.MAX_SAFE_INTEGER) {
    const row = this.#sql("SELECT * FROM listing_feedback WHERE listing_id = ? AND revision <= ? ORDER BY revision DESC LIMIT 1", id, watermark).toArray()[0];
    return row ? { decision: row.decision, revision: row.revision, updatedAt: row.updated_at,
      ...(row.reason ? { reason: row.reason } : {}) }
      : { decision: "neutral", revision: 0, updatedAt: null };
  }

  #reviewContexts(event) {
    const latest = this.#sql("SELECT preferences FROM refinements ORDER BY created_ms DESC, rowid DESC LIMIT 1").toArray()[0];
    const requirements = latest ? JSON.parse(latest.preferences).requirements : [];
    return [...new Set(event.photos.map(photo => photo.id))].map(id => {
      const observation = this.#observation(id);
      const photos = event.photos.filter(photo => photo.id === id && photo.evidenceId === observation?.listing?.evidenceId &&
        this.#sql("SELECT 1 FROM photo_receipts WHERE listing_id = ? AND photo_id = ? AND evidence_id = ? AND valid = 1",
          id, photo.photoId ?? "", photo.evidenceId ?? "").toArray().length)
        .map(photo => ({ index: photo.index, photoId: photo.photoId, size: photo.size }));
      return { researchId: this.#metadata().researchId, id, evidenceId: photos.length ? observation.listing.evidenceId : null,
        listingObservedAt: event.photos.find(photo => photo.id === id && photo.evidenceId === observation?.listing?.evidenceId)?.listingObservedAt ?? null,
        photos, requirements,
        nextTool: photos.length ? "record_review" : "inspect_listing_images",
        nextAction: photos.length
          ? "Inspect these successfully delivered image blocks. Record actual visual findings with record_review, copying evidenceId, photoIds and photoIndices. Use the exact applicable requirement labels with confirmed, contradicted or unknown. Then start a new refine_research or present_listings to use the saved findings."
          : "No current model-image receipt is available from this batch. Call inspect_listing_images with fresh=true before recording structured visual requirements." };
    });
  }

  readListingState({ ids } = {}) {
    return this.#execute(() => {
      const wanted = normalizeObservationIds(ids);
      this.#touch();
      return { researchId: this.#metadata().researchId, listings: wanted.map(id => {
        const review = this.#review(id);
        const { checkedPhotoIds, ...compact } = review;
        return { id, feedback: this.#feedback(id), review: { ...compact,
          findings: review.findings.slice(0, 1).map(text => text.slice(0, 500)),
          findingsTruncated: review.findings.length > 1 || review.findings.some(text => text.length > 500),
          requirements: review.requirements.slice(0, 8).map(({ photoIds, ...item }) => ({ ...item,
            evidence: item.evidence.slice(0, 280), evidenceTruncated: item.evidence.length > 280 })),
          requirementsTotal: review.requirements.length, requirementsTruncated: review.requirements.length > 8,
          fullReview: { tool: "get_research", arguments: { researchId: this.#metadata().researchId, section: "listings", ids: [id] } } } };
      }) };
    });
  }

  setListingFeedback({ id, decision, reason = "" } = {}) {
    return this.#execute(() => {
      const [listingId] = normalizeObservationIds([id]);
      if (!["shortlist", "reject", "neutral"].includes(decision) || typeof reason !== "string" || reason.length > 280) {
        throw researchError("invalid_research_input", "Choose shortlist, reject or neutral with an optional short reason.");
      }
      this.#touch();
      if (!this.#sql("SELECT 1 FROM listings WHERE id = ?", listingId).toArray().length) {
        throw researchError("research_listing_unavailable", "This listing has not been observed in the selected research.");
      }
      const old = this.#feedback(listingId);
      if (old.decision !== decision || (old.reason ?? "") !== reason.trim()) {
        this.#sql("INSERT INTO listing_feedback (listing_id, decision, reason, updated_at) VALUES (?, ?, ?, ?)",
          listingId, decision, reason.trim(), iso(Date.now()));
      }
      return { researchId: this.#metadata().researchId, id: listingId, feedback: this.#feedback(listingId) };
    });
  }

  #counts() {
    return this.#sql(`SELECT
      (SELECT COUNT(*) FROM events WHERE type = 'search') AS searchCalls,
      (SELECT COALESCE(SUM(rows_returned), 0) FROM queries) AS searchRowsReturned,
      (SELECT COALESCE(SUM(scanned_count), 0) FROM queries) AS searchRowsScanned,
      (SELECT COALESCE(SUM(filtered_out_count), 0) FROM queries) AS searchRowsFilteredOut,
      (SELECT COUNT(DISTINCT listing_id) FROM search_hits) AS uniqueSearchListings,
      (SELECT COUNT(*) FROM query_pages) AS searchPagesFetched,
      (SELECT COUNT(*) FROM listings WHERE detail_retrieved = 1) AS detailRecordsRetrieved,
      (SELECT COUNT(*) FROM details WHERE audience = 'model') AS detailRecordsDeliveredToModel,
      (SELECT COUNT(*) FROM details WHERE audience = 'model' AND description IS NOT NULL) AS descriptionsDeliveredToModel,
      (SELECT COUNT(*) FROM details WHERE audience = 'model' AND json_extract(description, '$.truncated') = 0) AS descriptionsFull,
      (SELECT COUNT(*) FROM details WHERE audience = 'model' AND json_extract(description, '$.truncated') = 1) AS descriptionsTruncated,
      (SELECT COALESCE(SUM(deliveries), 0) FROM photos WHERE audience = 'model') AS photoBlocksDeliveredToModel,
      (SELECT COUNT(*) FROM (SELECT listing_id, photo_index FROM photos WHERE audience = 'model' GROUP BY listing_id, photo_index)) AS uniqueModelPhotoIndices,
      (SELECT COALESCE(SUM(deliveries), 0) FROM photos WHERE audience = 'app') AS uiPhotosLoaded,
      (SELECT COUNT(*) FROM (SELECT listing_id, photo_index FROM photos WHERE audience = 'app' GROUP BY listing_id, photo_index)) AS uniqueUiPhotoIndices,
      (SELECT COUNT(*) FROM reviews) AS visualFindingsRecorded,
      (SELECT COUNT(*) FROM (SELECT reviews.listing_id, json_each.value FROM reviews, json_each(reviews.photo_indices)
        GROUP BY reviews.listing_id, json_each.value)) AS photosWithRecordedFindings,
      (SELECT COUNT(*) FROM presented) AS presentedListings
    `).one();
  }

  #queryPage(offset, limit) {
    return this.#sql(`SELECT q.*,
      (SELECT COUNT(*) FROM query_pages p WHERE p.query_id = q.query_id) AS pages_fetched,
      (SELECT COUNT(*) FROM search_hits h WHERE h.query_id = q.query_id) AS unique_listings,
      (SELECT COUNT(*) FROM search_hits h JOIN listings l ON l.id = h.listing_id
        WHERE h.query_id = q.query_id AND l.detail_retrieved = 1) AS detail_records_retrieved,
      (SELECT COUNT(*) FROM search_hits h JOIN details d ON d.listing_id = h.listing_id
        WHERE h.query_id = q.query_id AND d.audience = 'model') AS detail_records_delivered,
      (SELECT COUNT(*) FROM search_hits h JOIN details d ON d.listing_id = h.listing_id
        WHERE h.query_id = q.query_id AND d.audience = 'model' AND d.description IS NOT NULL) AS descriptions_delivered,
      (SELECT COUNT(*) FROM (SELECT p.listing_id, p.photo_index FROM search_hits h
        JOIN photos p ON p.listing_id = h.listing_id WHERE h.query_id = q.query_id AND p.audience = 'model'
        GROUP BY p.listing_id, p.photo_index)) AS model_photo_indices,
      (SELECT COUNT(*) FROM (SELECT p.listing_id, p.photo_index FROM search_hits h
        JOIN photos p ON p.listing_id = h.listing_id WHERE h.query_id = q.query_id AND p.audience = 'app'
        GROUP BY p.listing_id, p.photo_index)) AS ui_photo_indices,
      (SELECT COUNT(*) FROM (SELECT r.listing_id, reviewed.value FROM search_hits h
        JOIN reviews r ON r.listing_id = h.listing_id CROSS JOIN json_each(r.photo_indices) reviewed
        WHERE h.query_id = q.query_id GROUP BY r.listing_id, reviewed.value)) AS photos_with_findings
      FROM queries q ORDER BY first_sequence LIMIT ? OFFSET ?`, limit, offset).toArray().map(row => ({
      queryId: row.query_id, query: row.query, filters: JSON.parse(row.filters), searchType: row.search_type,
      pageSize: row.page_size, calls: row.calls, pagesFetched: row.pages_fetched, rowsReturned: row.rows_returned,
      scannedCount: row.scanned_count, filteredOutCount: row.filtered_out_count,
      uniqueListings: row.unique_listings, reportedTotal: row.reported_total, reportedTotalChanged: Boolean(row.total_changed),
      exhausted: Boolean(row.exhausted) && !row.total_changed, restartRequired: Boolean(row.total_changed),
      nextCursor: row.next_cursor, observedAt: row.observed_at,
      progressPage: row.progress_page, progressObservedAt: row.progress_observed_at,
      counts: {
        detailRecordsRetrieved: row.detail_records_retrieved,
        detailRecordsDeliveredToModel: row.detail_records_delivered,
        descriptionsDeliveredToModel: row.descriptions_delivered,
        uniqueModelPhotoIndices: row.model_photo_indices,
        uniqueUiPhotoIndices: row.ui_photo_indices,
        photosWithRecordedFindings: row.photos_with_findings,
      },
    }));
  }

  #summary() {
    const metadata = this.#metadata();
    const queryCount = this.#sql("SELECT COUNT(*) AS count FROM queries").one().count;
    return { ...metadata, counts: this.#counts(), queryCount, queries: this.#queryPage(0, 8),
      queriesNextCursor: queryCount > 8 ? researchCursor(metadata.researchId + ":queries", 8) : null };
  }

  #listingAudit(row) {
    const details = this.#sql("SELECT * FROM details WHERE listing_id = ?", row.id).toArray();
    const model = details.find(item => item.audience === "model");
    const app = details.find(item => item.audience === "app");
    const photos = this.#sql("SELECT * FROM photos WHERE listing_id = ? ORDER BY photo_index, audience, size", row.id).toArray();
    const photoRecord = photo => ({ index: photo.photo_index, size: photo.size, observedAt: photo.observed_at, deliveries: photo.deliveries });
    const reviewCount = this.#sql("SELECT COUNT(*) AS count FROM reviews WHERE listing_id = ?", row.id).one().count;
    const findings = this.#sql("SELECT * FROM reviews WHERE listing_id = ? ORDER BY observed_at DESC LIMIT 3", row.id).toArray().map(review => ({
      photoIndices: JSON.parse(review.photo_indices), findings: review.findings,
      observedAt: review.observed_at, evidenceType: "agent-reported",
    }));
    return { id: row.id, detailRetrieved: Boolean(row.detail_retrieved),
      searchQueryIds: this.#sql("SELECT query_id FROM search_hits WHERE listing_id = ? ORDER BY query_id", row.id).toArray().map(hit => hit.query_id),
      detailObservedAt: model?.observed_at ?? null, deliveredFields: model ? JSON.parse(model.fields) : [],
      description: model?.description ? JSON.parse(model.description) : null,
      appDeliveredFields: app ? JSON.parse(app.fields) : [],
      modelPhotos: photos.filter(photo => photo.audience === "model").map(photoRecord),
      uiPhotos: photos.filter(photo => photo.audience === "app").map(photoRecord),
      findings, findingsCount: reviewCount, findingsTruncated: reviewCount > findings.length,
      review: this.#review(row.id), feedback: this.#feedback(row.id) };
  }

  read(args = {}) {
    return this.#execute(() => {
      const { section, limit, cursor, ids } = normalizeResearchRead(args);
      this.#touch();
      const summary = this.#summary();
      if (section === "summary") return summary;
      if (ids) {
        const rows = ids.map(id => this.#sql("SELECT * FROM listings WHERE id = ?", id).toArray()[0]);
        return { ...summary, listings: rows.filter(Boolean).map(row => this.#listingAudit(row)),
          missingIds: ids.filter((id, index) => !rows[index]), total: rows.filter(Boolean).length, nextCursor: null };
      }
      const scope = summary.researchId + ":" + section;
      const offset = readResearchCursor(cursor, scope);
      const total = section === "queries" ? summary.queryCount : this.#sql("SELECT COUNT(*) AS count FROM listings").one().count;
      const entries = section === "queries" ? this.#queryPage(offset, limit)
        : this.#sql("SELECT * FROM listings ORDER BY sequence LIMIT ? OFFSET ?", limit, offset).toArray().map(row => this.#listingAudit(row));
      return { ...summary, [section]: entries, offset, total,
        nextCursor: offset + entries.length < total ? researchCursor(scope, offset + entries.length) : null };
    });
  }

  #collectionMetadata(row) {
    const definition = JSON.parse(row.signature);
    return { ...this.#metadata(), collectionId: row.collection_id, title: row.title, summary: row.summary,
      criteria: definition.criteria ?? [], requirements: definition.requirements ?? [],
      ...(definition.refinementId ? { refinementId: definition.refinementId } : {}),
      collectionCreatedAt: iso(row.created_ms), total: row.available_total,
      availableTotal: row.available_total, moreAvailable: false, selectionMode: row.mode };
  }

  #collectionFilter(row) {
    const queryIds = JSON.parse(row.query_ids);
    const queryFilter = queryIds.length ? `AND h.query_id IN (${queryIds.map(() => "?").join(", ")})` : "";
    return { condition: `l.sequence <= ? AND EXISTS (SELECT 1 FROM search_hits h
      WHERE h.listing_id = l.id AND h.first_event <= ? ${queryFilter})`,
    params: [row.listing_watermark, row.event_watermark, ...queryIds] };
  }

  #saveCollection(collection) {
    const signature = JSON.stringify(collection);
    const old = this.#sql("SELECT * FROM collections WHERE collection_id = ?", collection.collectionId).toArray()[0];
    if (old) {
      if (old.signature !== signature) throw researchError("collection_conflict", "This collectionId already identifies a different ordered selection.");
      return this.#collectionMetadata(old);
    }
    const queryIds = collection.queryIds ?? [];
    const snapshot = { query_ids: JSON.stringify(queryIds),
      listing_watermark: this.#sql("SELECT COALESCE(MAX(sequence), 0) AS watermark FROM listings").one().watermark,
      event_watermark: this.#sql("SELECT COALESCE(MAX(sequence), 0) AS watermark FROM events").one().watermark };
    let availableTotal = collection.selections?.length;
    if (!collection.selections) {
      for (const queryId of queryIds) {
        if (!this.#sql("SELECT 1 FROM queries WHERE query_id = ?", queryId).toArray().length) {
          throw researchError("research_query_unavailable", "A selected queryId is absent from this research.");
        }
      }
      const { condition, params } = this.#collectionFilter(snapshot);
      availableTotal = this.#sql(`SELECT COUNT(*) AS count FROM listings l WHERE ${condition}`, ...params).one().count;
    }
    this.#sql("INSERT INTO collections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", collection.collectionId, collection.title,
      collection.summary, signature, Date.now(), availableTotal, collection.selections ? "explicit" : "query",
      snapshot.query_ids, snapshot.listing_watermark, snapshot.event_watermark);
    for (const [position, selection] of (collection.selections ?? []).entries()) {
      this.#sql("INSERT INTO collection_items VALUES (?, ?, ?, ?)", collection.collectionId, position, selection.id, JSON.stringify(selection));
    }
    return this.#collectionMetadata(this.#sql("SELECT * FROM collections WHERE collection_id = ?", collection.collectionId).one());
  }

  saveCollection(args) {
    return this.#execute(() => {
      this.#touch();
      return this.#saveCollection(normalizeCollection(args));
    });
  }

  #retainedCohort() {
    const collectionId = "wc_" + crypto.randomUUID().replaceAll("-", "");
    const total = this.#sql("SELECT COUNT(*) AS value FROM listings l JOIN listing_observations o ON o.listing_id = l.id").one().value;
    const title = "Gespeicherte Beobachtungen";
    const signature = JSON.stringify({ collectionId, title, summary: "" });
    const listingWatermark = this.#sql("SELECT COALESCE(MAX(sequence), 0) AS value FROM listings").one().value;
    const eventWatermark = this.#sql("SELECT COALESCE(MAX(sequence), 0) AS value FROM events").one().value;
    this.#sql("INSERT INTO collections VALUES (?, ?, '', ?, ?, ?, 'retained', '[]', ?, ?)",
      collectionId, title, signature, Date.now(), total, listingWatermark, eventWatermark);
    this.#sql(`INSERT INTO collection_items (collection_id, position, listing_id, selection)
      SELECT ?, ROW_NUMBER() OVER (ORDER BY l.sequence) - 1, l.id, json_object('id', l.id)
      FROM listings l JOIN listing_observations o ON o.listing_id = l.id`, collectionId);
    return { collectionId, total };
  }

  #refinementStep(job, step) {
    const previous = this.#sql("SELECT response FROM refinement_steps WHERE refinement_id = ? AND step = ?", job.refinement_id, step).toArray()[0];
    if (previous) return JSON.parse(previous.response);
    if (job.completed || step !== job.next_step) {
      throw researchError("invalid_research_cursor", "Use the nextCursor returned by this refinement, or start a new refinement for changed preferences.");
    }
    const preferences = JSON.parse(job.preferences);
    const cohort = this.#sql("SELECT * FROM collections WHERE collection_id = ?", job.cohort_id).one();
    let candidates;
    if (cohort.mode === "query") {
      const { condition, params } = this.#collectionFilter(cohort);
      candidates = this.#sql(`SELECT id FROM listings l WHERE ${condition}
        ORDER BY sequence LIMIT ? OFFSET ?`, ...params, REFINEMENT_STEP_SIZE, job.next_offset).toArray();
    } else candidates = this.#sql(`SELECT listing_id AS id FROM collection_items
      WHERE collection_id = ? ORDER BY position LIMIT ? OFFSET ?`, cohort.collection_id, REFINEMENT_STEP_SIZE, job.next_offset).toArray();
    const decisions = candidates.map(({ id }, index) => {
      const evaluation = evaluateRefinement(this.#observation(id), this.#review(id),
        this.#feedback(id, job.feedback_watermark), preferences);
      const confirmed = evaluation.requirements.filter(item => item.verdict !== "unknown" && item.mode !== "prefer");
      const open = evaluation.requirements.filter(item => item.verdict === "unknown").map(item => item.requirement);
      const selection = { id,
        reason: confirmed.length ? confirmed.map(item => item.requirement).join(" · ").slice(0, 280) : "",
        cautions: open.slice(0, 3).map(label => ("Offen · " + label).slice(0, 180)),
        refinement: { observedAt: evaluation.observedAt, unknown: evaluation.unknown, score: evaluation.score } };
      this.#sql("INSERT INTO refinement_results VALUES (?, ?, ?, ?, ?, ?, ?)", job.refinement_id,
        job.next_offset + index, id, Number(evaluation.eligible), evaluation.score, JSON.stringify(evaluation), JSON.stringify(selection));
      return { id, ...evaluation };
    });
    const evaluatedCount = job.next_offset + decisions.length;
    const eligibleCount = job.eligible_count + decisions.filter(item => item.eligible).length;
    const excludedCount = job.excluded_count + decisions.filter(item => !item.eligible).length;
    const unknownCount = job.unknown_count + decisions.filter(item => item.unknown).length;
    const completed = evaluatedCount >= job.candidate_total;
    this.#sql(`UPDATE refinements SET next_offset = ?, next_step = ?, eligible_count = ?, excluded_count = ?,
      unknown_count = ?, completed = ? WHERE refinement_id = ?`, evaluatedCount, step + 1,
    eligibleCount, excludedCount, unknownCount, Number(completed), job.refinement_id);
    if (completed) {
      const title = "Verfeinerte Angebote";
      const summary = `${eligibleCount} passende Angebote aus ${job.candidate_total} gespeicherten Kandidaten`;
      const signature = JSON.stringify({ collectionId: job.result_collection_id, title, summary,
        criteria: preferences.criteria, requirements: preferences.requirements, refinementId: job.refinement_id });
      this.#sql("INSERT INTO collections VALUES (?, ?, ?, ?, ?, ?, 'explicit', '[]', ?, ?)",
        job.result_collection_id, title, summary, signature, Date.now(), eligibleCount,
        cohort.listing_watermark, cohort.event_watermark);
      this.#sql(`INSERT INTO collection_items (collection_id, position, listing_id, selection)
        SELECT ?, ROW_NUMBER() OVER (ORDER BY score DESC, position) - 1, listing_id, selection
        FROM refinement_results WHERE refinement_id = ? AND eligible = 1`, job.result_collection_id, job.refinement_id);
    }
    const researchId = this.#metadata().researchId;
    const nextCursor = completed ? null : researchCursor(researchId + ":refinement:" + job.refinement_id, step + 1);
    const preview = this.#sql(`SELECT listing_id, evaluation FROM refinement_results
      WHERE refinement_id = ? AND eligible = 1 ORDER BY score DESC, position LIMIT 12`, job.refinement_id).toArray().map(row => {
      const evaluation = JSON.parse(row.evaluation);
      return { id: row.listing_id, score: evaluation.score, unknown: evaluation.unknown, observedAt: evaluation.observedAt };
    });
    const result = { researchId, refinementId: job.refinement_id, completed, totalCandidates: job.candidate_total,
      evaluatedCount, stepEvaluated: decisions.length, maxStepSize: REFINEMENT_STEP_SIZE,
      eligibleCount, excludedCount, unknownCount, preferences, preview,
      reviewNeeded: decisions.filter(item => item.requirements.some(requirement => requirement.verdict === "unknown"))
        .slice(0, 12).map(item => ({ id: item.id, requirements: item.requirements.filter(requirement => requirement.verdict === "unknown").map(requirement => requirement.requirement) })),
      collectionId: completed ? job.result_collection_id : null, nextCursor,
      evaluationScope: "Cohort membership, preferences and explicit feedback are fixed at refinement start. Each retained observation is evaluated at its step with its original observedAt. Completed membership and cursor receipts are immutable.",
      ranking: "Shortlisted eligible offers receive 100 points, confirmed hard requirements 2 each, confirmed preferences 1 each. Equal scores preserve discovery order.",
      ...(nextCursor ? { continuation: { tool: "refine_research", arguments: { researchId, refinementId: job.refinement_id, cursor: nextCursor } } }
        : { presentation: { tool: "present_listings", arguments: { source: this.#metadata().source, researchId, collectionId: job.result_collection_id } } }),
      nextAction: completed ? "Open collectionId with present_listings. For unknown visual requirements, inspect original photos, record exact requirement findings, then start a new refinement."
        : "Repeat continuation to evaluate the remaining retained candidates before presenting the completed collection." };
    this.#sql("INSERT INTO refinement_steps VALUES (?, ?, ?)", job.refinement_id, step, JSON.stringify(result));
    return result;
  }

  refine(args = {}) {
    return this.#execute(() => {
      this.#touch();
      if (args.refinementId !== undefined || args.cursor !== undefined) {
        if (!/^wf_[a-f0-9]{32}$/.test(args.refinementId ?? "") || args.cursor === undefined ||
            ["requirements", "criteria", "unknownPolicy", "feedbackFilter", "queryIds"].some(key => args[key] !== undefined)) {
          throw researchError("invalid_research_input", "Continue using only researchId, refinementId and cursor. Start a new refinement to change preferences.");
        }
        const job = this.#sql("SELECT * FROM refinements WHERE refinement_id = ?", args.refinementId).toArray()[0];
        if (!job) throw researchError("refinement_unavailable", "This refinement is unavailable in the selected research.");
        const step = readResearchCursor(args.cursor, this.#metadata().researchId + ":refinement:" + args.refinementId);
        return this.#refinementStep(job, step);
      }
      const preferences = normalizeRefinement(args);
      const cohort = args.queryIds ? this.#saveCollection(normalizeCollection({ queryIds: args.queryIds })) : this.#retainedCohort();
      const refinementId = "wf_" + crypto.randomUUID().replaceAll("-", "");
      const collectionId = "wc_" + crypto.randomUUID().replaceAll("-", "");
      const watermark = this.#sql("SELECT COALESCE(MAX(revision), 0) AS value FROM listing_feedback").one().value;
      this.#sql(`INSERT INTO refinements (refinement_id, cohort_id, result_collection_id, preferences, feedback_watermark, candidate_total, created_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, refinementId, cohort.collectionId, collectionId, JSON.stringify(preferences), watermark, cohort.total, Date.now());
      return this.#refinementStep(this.#sql("SELECT * FROM refinements WHERE refinement_id = ?", refinementId).one(), 0);
    });
  }

  readCollection({ collectionId, pageSize = 12, cursor, ids } = {}) {
    return this.#execute(() => {
      validateCollectionId(collectionId);
      if (![12, 24].includes(pageSize)) throw researchError("invalid_research_input", "Collection pageSize must be 12 or 24.");
      this.#touch();
      const row = this.#sql("SELECT * FROM collections WHERE collection_id = ?", collectionId).toArray()[0];
      if (!row) throw researchError("collection_unavailable", "This ordered collection is unavailable in the selected research.");
      const metadata = this.#collectionMetadata(row);
      const snapshot = row.mode === "query" ? this.#collectionFilter(row) : null;
      if (ids !== undefined) {
        const memberIds = normalizeCollectionIds(ids);
        const members = memberIds.map(() => "?").join(", ");
        const selections = snapshot ? this.#sql(`SELECT id FROM listings l WHERE ${snapshot.condition}
          AND l.id IN (${members}) ORDER BY sequence`, ...snapshot.params, ...memberIds).toArray()
          : this.#sql(`SELECT selection FROM collection_items WHERE collection_id = ?
          AND listing_id IN (${memberIds.map(() => "?").join(", ")}) ORDER BY position`, collectionId, ...memberIds)
          .toArray().map(item => JSON.parse(item.selection));
        if (selections.length !== memberIds.length) throw researchError("collection_selection_mismatch", "Every requested ID must belong to this ordered collection.");
        return { ...metadata, selections, subset: true, offset: null, pageSize: memberIds.length,
          nextCursor: null, previousCursor: null };
      }
      const scope = metadata.researchId + ":" + collectionId + ":" + pageSize;
      const offset = readResearchCursor(cursor, scope);
      if (offset > metadata.total) throw researchError("invalid_research_input", "The cursor is outside this collection.");
      const selections = snapshot ? this.#sql(`SELECT id FROM listings l WHERE ${snapshot.condition}
        ORDER BY sequence LIMIT ? OFFSET ?`, ...snapshot.params, pageSize, offset).toArray()
        : this.#sql("SELECT selection FROM collection_items WHERE collection_id = ? ORDER BY position LIMIT ? OFFSET ?", collectionId, pageSize, offset)
          .toArray().map(item => JSON.parse(item.selection));
      return { ...metadata, selections, offset, pageSize,
        nextCursor: offset + selections.length < metadata.total ? researchCursor(scope, offset + selections.length) : null,
        previousCursor: offset > 0 ? researchCursor(scope, Math.max(0, offset - pageSize)) : null };
    });
  }

  async alarm() {
    if (this.#deleted) return;
    const row = this.#sql("SELECT expires_ms FROM session WHERE singleton = 1").toArray()[0];
    if (row && row.expires_ms > Date.now()) {
      await this.ctx.storage.setAlarm(row.expires_ms);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.#deleted = true;
  }
}
