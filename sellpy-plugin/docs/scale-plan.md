# Sellpy Studio 1.2: scalable discovery and structured presentation

## Goal and acceptance

Transfer the useful current Willhaben improvements into the existing Sellpy plugin. Ordinary searches should expose many useful results, normally twelve cards per page with a twenty-four-card option, and let the user traverse all discovered results without an arbitrary total cap. Large collections must not require the model to repeat every ID or put an ever-growing object in one database row. Cards use compact labeled facts and criteria, with each fact in one place. Native Sellpy visual search, exact image evidence, saved research and the existing private connection remain supported.

The user explicitly authorizes deployment and uploading this new plugin version without another confirmation. This is new authorization for the previously blocked package-update retry; it does not authorize unrelated account or permission changes.

Starting baseline: local `62b195886a142e9362fcd306678ba8d5d7cfef62`, remote PR #2 `93f6a50a014321f642d991d6f5219b99158c4555`, identical tree `31815fe11654478c4d048dfd3b65a6eefc8eb595`. At planning time server 1.1.1 was live and the installed package reported 1.0.0. The completed release is server and installed package **1.2.1**; see the [release verification](scale-verification.md).

## Workflow checklist

- [x] Ground: personal-context retrieval, pinned current Willhaben source, current Sellpy source and independent research.
- [x] Sketch: two independent architecture candidates, caller usage, signatures and storage access patterns.
- [x] Agree: score alternatives and synthesize the implementation contract; no human checkpoint requested.
- [x] Implement: named owners with disjoint file scopes after the shared contract is fixed.
- [x] Scrap decision: revisit the design if repeated implementation workarounds contradict its invariants.
- [x] Verify: large collections, real SQLite and host interactions, native contracts, matched performance evidence and independent non-author review.
- [x] Release: ordered commits, exact artifact review/deployment/readback, installed-package update and setup guide.

Arena: Frame / Fan out / Cross-judge / Pick / Graft / Verify. Only GPT-family workers are available; independent candidates use the available inherited model. A cross-family judge is unavailable and will not be claimed.

## Throughput checkpoint

1. Blocking first steps: inspect the current retrieval, evidence and presentation boundaries; fix the collection/card contract before production writers fan out.
2. Independent work: Willhaben transfer research, native Sellpy ecosystem research and MCP/scaling research run concurrently. Provider improvements can proceed separately from the collection/UI implementation after their interface is specified.
3. Shared mutable state: one owner for the shared domain/tool/storage contract and one for UI files. Integration and generated artifacts are serialized. Design candidates write only their own isolated output directory.
4. Smallest safe decomposition: collection backend, bounded structured UI and native/provider extensions. Research reports and release documents are separate from code. Further splitting the same store/tool schema would increase merge and invariant risk without shortening the critical path.

## How the existing subsystem works

### Overview

The Worker authenticates a private connection and creates an official stateless MCP handler. Transport sessions do not own research state. Each principal and run has one SQLite Durable Object with candidate observations, native retrieval paths, progress, image evidence, operation receipts and retained image-upload chunks. The UI receives compact model data plus its richer gallery under tool-result metadata.

### Key concepts

- A candidate is a canonical shop observation plus retrieval provenance and optional image-grounded assistant assessment.
- Source metadata, actual model-visible photo evidence and explicit user feedback are separate records.
- Search continuation is replayable; source rate limits and windows are reported explicitly.
- Refinement fixes a candidate cohort and user feedback, evaluates it in bounded chunks, and retains emitted pages. It does not freeze all unscanned candidate facts at its creation time.
- Presentation currently stores a complete selected-ID array as one JSON value and requires model-supplied selection or its cursor.

### Runtime and pressure points

`present_items` defaults to six cards (maximum twenty). It reads the entire stored selection, slices it, refreshes the page's details, then sequentially fetches covers for every card until its byte/deadline budget. The gallery appends subsequent pages and rerenders the accumulated cards. Consequently storage-row size, model context, eager source work and browser DOM/memory all grow unnecessarily for broad discovery.

The existing store already offers `snapshotCohort()` and sequence-bounded `scanCandidates()`. These are better primitives for scalable implicit collections than copying Willhaben's LIMIT/OFFSET page query. An immutable collection means stable membership/order; any current facts must still carry their actual observation time. It must not be described as a complete point-in-time evidence snapshot.

### Ownership to preserve

| Responsibility | Existing owner | Constraint |
|---|---|---|
| Public Sellpy contracts | `src/sellpy/client.ts`, config and normalization | Native search first; no invented endpoint capability |
| Candidate ledger and evidence | `SearchStore` / `SearchRun` | Exact item/image identity; durable retention |
| Ranking and user feedback | `ResearchStore` and refinement evaluator | Unknown differs from confirmed; hard constraints stay hard |
| Presentation data | Tool adapter and presentation module | Page-bounded result; stable collection identity |
| Browser interactions | `ui/gallery.ts`, `ui/data.ts` | Bounded cards/images; stale response protection |
| Source pacing | `OriginGate` | Retain Retry-After and concurrent-request isolation |

These owners remain in place. The change deepens their existing boundaries rather than moving research ownership into transport or browser sessions.

## Research already established

- Current Willhaben PR #1 head `2c3f621eab6047bdae3f65f2e036d6044caf8764` is 1.4.2. Useful transfers include server-owned collections, 12/24 cards, two eager covers and four visible lazy covers, compact research counts, and duplicate cold-read suppression.
- Sellpy already uses official MCP server/client 2.4.0 and Apps 2.0.4. The primary release pages independently show those stable versions. A wrapper migration needs a concrete benefit; version novelty alone is insufficient.
- Sellpy already implements catalog, semantic, item similarity, source image, upload and outfit routes. Do not reimplement them through a weaker third-party scraper.
- Willhaben's seven-day research expiry is deliberately not transferred: Sellpy searches have no automatic expiry.
- All UI text should use labels and short fragments. Existing prose is preserved as evidence where necessary but should not be echoed in several UI sections or alongside duplicate canonical facts.

## Design evaluation rubric

1. Correct stable traversal: 10,000+ candidates, concurrent discovery and restart; no duplicates or lost members.
2. Bounded work: response size, SQL reads, model-supplied IDs, browser DOM and retained images scale with a page, not the collection.
3. Useful presentation: twelve/twenty-four cards, compact deduplicated facts, explicit source/evidence/uncertainty, affordable first page.
4. Evidence and access integrity: principal/run/collection membership and stale-response guards; no new visual claims from hydration.
5. Interface depth and compatibility: small server-owned API, existing saved state and cursors preserved or explicitly migrated, no parallel ways to own the same invariant.

## Final design and verification

### Arena decision, 7 November 2026

Two independent GPT design candidates were read in full. They separately converged on virtual sequence-bounded discovery/arm collections and indexed derived membership. Neither read the other candidate. Only the available GPT family was used; a cross-family judge was unavailable. The parent judged both against the prewritten rubric and selected B as the concise structural baseline, with explicit grafts from A.

| Criterion, 1–5 | A | B | Decision |
|---|---:|---:|---|
| Stable traversal and restart | 5 | 5 | Freeze membership/order, not an invented universal observation timestamp |
| Bounded work | 5 | 5 | Virtual common path; bounded derived preparation and indexed seeks |
| Useful compact presentation | 5 | 5 | One fact/evidence projector; 12/24 cards, two eager and four visible covers |
| Evidence/access integrity | 5 | 5 | Principal/run/collection/generation checks; delivery never becomes assessment |
| Interface depth/compatibility | 4 | 5 | B avoids universal observation MVCC; graft A's exact refinement order and careful legacy preparation |

The chosen implementation has one durable collection API. All-observed and individual-arm collections use immutable sequence bounds; selections, frozen shortlists, explicit global sorts and refinement projections use indexed membership/order. A candidate cutoff alone cannot freeze a later arm membership, and a mutable feedback row cannot freeze an old shortlist; the implementation must address both counterexamples. Preparation intervals and current observation times are separate from collection membership time.

`present_items({run_id})` opens the current observed cohort without an ID list or invented reasons. `browse_collection` is app-only. New page defaults are 12, with 24 offered in the app; legacy selections/cursors and prior page sizes remain readable. A page reads stored observations and does not trigger a source search or automatic detail refresh. The app replaces its current page, retains at most three page payloads and four comparison selections, and loads only visible covers through a queue of at most four requests. Initial presentation embeds at most two covers.

The existing `GalleryCard` and item vocabulary remain compatible. A shared collection contract adds version 3, collection identity, page range/navigation and explicit research scope. One pure fact/evidence projector serves cards/details/comparison. Legacy prose remains accessible as source/selection text; it is never heuristically summarized into a new visual claim. Every async action is checked against run, collection, generation and request identity, with exact image identity and separate feedback mutation sequencing where applicable.

The original Willhaben development conversation was also read directly. Its latest completed release is 1.4.2. A newer request in that conversation is currently transferring improvements back from Sellpy; unfinished concurrent work is not used as an implementation baseline. This avoids a circular dependency between the two projects.

### Implementation ownership

- Backend owner: collection/storage/domain/schema/tool/MCP/presentation modules and backend tests. Publishes the shared contract first.
- UI owner: gallery/data/comparison/styles, pure card-fact projector and browser tests. No shared backend edits.
- Native owner: provider/config, strict search-link parser and dedicated uncredentialed public-reference downloader, with contract tests.
- Parent: synthesis, documentation, integration, independent review, exact release artifacts, deployment and package update. Generated artifacts are built serially after source integration.

Measured proof and release receipts are recorded separately in [scale-verification.md](scale-verification.md). No benchmark, real-host interaction or migration is considered passed merely because it is included in this plan.


Completed release: the chosen boundaries survived review. Derived filters now use scalar source projections, legacy offsets remain independent of import progress, and UI metadata follows the accepted observation version. These corrections deepen the existing design; no workaround required replacing the architecture. The final 1.2.1 source passed 163 Node tests and 35 actual Workers tests. Core scale/native measurements, exact deployed artifact reads, the installed 1.2.1 package and real ChatGPT gallery navigation passed their separate gates. The final UI correction uses labeled scope facts and structured footer values, with v4 as the canonical resource and v3/v2 retained as aliases. The release procedure now refreshes the connected app catalogue before the final package metadata upload and verifies an app-only action in the actual host.
