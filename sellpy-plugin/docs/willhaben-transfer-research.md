# Willhaben → Sellpy: implementation transfer research

Research date: 2026-11-07. This is a read-only comparison of Willhaben **1.4.2**, PR #1 head `2c3f621eab6047bdae3f65f2e036d6044caf8764`, and Sellpy **1.1.1**, PR #2 head `93f6a50a014321f642d991d6f5219b99158c4555`. It describes the baseline before the Sellpy implementation being developed in this session. The old local Willhaben reference at `e377ee8` is not the latest release. PR #1 was read twice and still named the same head; its last update was 2026-11-07 15:19:06 UTC. [W0] [S0]

## Decision

Keep Sellpy's existing official MCP/Apps stack and durable search/refinement architecture. Transfer Willhaben's **browse every observed result, bounded page rendering, selective photo loading and auditable coverage** contracts. Implement them inside Sellpy's existing run storage, rather than introducing another overlapping research database or replacing its richer visual-assessment model. The user's new emphasis on many results, performance and terse UI makes this the highest-value transfer. [W1] [W2] [W3] [S1] [S2] [S3]

The important baseline gap is precise: Sellpy's `present_items` requires an explicit model-supplied selection, defaults to **six** cards, stores that selection as one JSON value, hydrates page covers sequentially, and its widget appends later pages and renders the entire accumulated card set again. Its search store already retains all candidates and offers a sequence-based bounded scan. Willhaben defaults to **12**, supports **24**, can create an implicit collection of all observed results or a query subset, and replaces the current page. [W1] [W2] [W3] [S2] [S3] [S4] [S5]

## Evidence boundary

The investigation directly read fresh GitHub PR metadata, pinned source files, packaged skill instructions and regression code. Eighteen fetched source/test/skill files were materialized in a separate reference directory, and their `git hash-object` values matched the GitHub blob SHAs. No production source, deployment, installed plugin or PR was changed by this investigation. The sole project file written is this report.

Willhaben's PR and release document report completed production and actual ChatGPT acceptance. Those reports are distinguished below from source-confirmed behavior; the Willhaben test suites were not independently re-executed here. The parent investigation subsequently read the original Willhaben development conversation directly. The research worker itself did not access that chat; the direct-read addendum below supplies the evidence boundary. [W0] [W4]

### Latest completed chat request, cross-checked against source

The parent agent first retrieved reconstructed personal context for a user request at **2026-11-07 12:36:55 UTC** and an assistant completion at **15:20:38 UTC**. It then read the original conversation titled “Willhaben API Plugin planen” directly and confirmed the corresponding request and completed 1.4.2 response. The user requested current MCP architecture/alternatives, additional native capabilities, image input by attachment/HTTPS URL/listing photo, scalable result counts, compact query/hit/detail/photo coverage, the name `willhaben`, icon/description, and Writing for Agents/skill revisions. The completion reported version 1.4.2 live and installed with official SDK 2.4.0, Apps 2.0.4, search pages of 50 by default/up to 100, card pages of 12/24, browse-all-loaded-results, research counts, durable SQLite state and shared request handling.

**Direct-read addendum:** A newer message in that conversation asks Willhaben to inspect this Sellpy work and transfer useful improvements back. That turn was still in progress when read. The implementation reference here remains the last completed, source-pinned Willhaben 1.4.2 release, avoiding a circular dependency on concurrent unfinished work. The private conversation identifier is intentionally not copied into the public repository.

Source inspection above and below confirms the functional implementation of those architecture, image-search, browsing, coverage and instruction changes. The generic plugin-directory icon and acceptance on the user's actual Android device remained open; these should not be represented as completed merely because the header icon and mobile Chromium layouts worked. The PR release record states the same distinction. Sellpy should inherit the useful behavior and testing discipline, with its own branding and its own native endpoint contracts. [W0] [W1] [W3] [W4] [W8] [W11]

## Latest Willhaben behavior and Sellpy equivalents

| Concern | Willhaben 1.4.2: implemented evidence | Sellpy 1.1.1 baseline | Transfer decision |
| --- | --- | --- | --- |
| MCP implementation | Official server 2.4.0 Fetch handler; Apps 2.0.4; legacy protocol handling | Already official server/client 2.4.0 and Apps 2.0.4 | Keep the architecture; no new framework is needed merely for parity. |
| Large result presentation | Implicit all-observed collection, selected query scopes, or explicit ordered selection; 12/24-card pages | Explicit selection only; six-card default, maximum 20 | Add implicit run/route/refinement scopes and bounded pages. |
| Durable collection | Snapshot membership plus retained normalized observations independent of short cache | Candidates already persist in SQLite with no automatic expiry | Reuse existing candidates and immutable refinement snapshots. |
| Browser memory | Replace page DOM; clear old view state; generation checks reject late responses | Continuation appends to `gallery.cards`; each render visits every loaded card | Replace current page; bound image cache and retain shortlist separately. |
| Covers | Two initial covers; visible-image requests of at most four; later pages initially hydrate zero | Sequential eager hydration for every page card within six-MiB budget | Copy selective loading policy, not an unbounded preload. |
| Research coverage | Distinguishes source retrieval, descriptions delivered to model, model photos, widget photos and recorded findings | Route progress, source totals, provenance and model image-evidence ledger already exist; no equivalent complete audience-aware UI coverage | Extend existing storage with delivery audience/field counts and a compact expandable audit. |
| Native visual search | Attachment, public URL, or exact listing photo; opaque continuation | Native semantic, seed similarity, Sellpy-image similarity, uploaded-reference and outfit routes already exist | Preserve Sellpy's native provider; add convenience contracts only where verified. |
| Concurrent cold requests | Atomic lease/cache in shared `OriginGate` | OriginGate paces/cools down; per-run lease protects continuation, not cross-request source deduplication | Adapt single-flight for deterministic public reads with complete request identity. |
| Overview UX | Show first useful page immediately; detailed checks for advice/verification | Instructions focus on refreshed shortlist and individually reasoned selection | Separate ordinary browsing from verified recommendations; concise fragments and no repeated card facts. |
| Personal state | Seven-day inactivity research; studies 24 hours | Indefinite run state, saved preferences, feedback, observed history | Preserve Sellpy's explicit indefinite-retention design and richer personal tools. |

Sources for the matrix: Willhaben tool contracts, collection SQL, widget implementation, research ledger, lease coordinator and packaged skill [W1–W8]; Sellpy schemas, tools, search/refinement store, MCP instructions, widget and provider [S1–S8].

## Exact reusable contracts and adaptations

### 1. A collection is a view of retained candidates

Willhaben's `ResearchSession.saveCollection` snapshots the maximum listing sequence and event sequence. An implicit collection stores its scope and watermarks instead of copying thousands of IDs. Explicit selections use an indexed `(collection_id, position)` table and unique collection/member index. `readCollection` validates scope, cursor, page size and every requested image/detail ID against membership. `present_listings` returns navigation metadata with the page, and app-only `browse_collection` handles `page`, `covers`, `photos` and `details`. [W1] [W2]

Sellpy already has `snapshotCohort`, `scanCandidates(after, maximum, limit)`, durable normalized candidate objects, retrieval paths and immutable refinement storage. These are the appropriate foundation. Suggested contract:

- `present_items(run_id, scope?, selection?, refinement_id?, page_size=12)` creates the initial collection without forcing the model to enumerate all candidate IDs.
- An app-only browse tool accepts collection identity, scoped cursor and one narrowly defined action. Every supplied item ID is checked against the collection and run.
- Expose current range, snapshot total, available continuation and coverage separately. A collection's end means the loaded snapshot ended, not the Sellpy catalog.
- Keep explicit reason/cautions optional for a broad overview. Require grounded reasoning when the assistant actually recommends an item. Do not fabricate a reason for each automatically included candidate.
- Preserve old presentation cursors or give an explicit migration error; do not silently reinterpret old cursor fields.

**Improve on the Willhaben implementation:** `readCollection` currently uses `LIMIT … OFFSET`. It proves bounded response size and membership, but deep offsets still require skipped-row work. Sellpy's existing sequence-range scan can provide keyset continuation for implicit snapshots; explicit immutable positions can use indexed position ranges. A 10,000-item correctness test alone is not evidence of constant-cost deep paging. [W2] [W9] [S3] [S6]

### 2. Page rendering and photo delivery must stay bounded

Willhaben's widget `render` replaces the prior card nodes and increments a generation. Its `IntersectionObserver` queues nearby covers, `flushCovers` takes at most four IDs, and asynchronous responses check generation before updating cards. `browse_collection(action="page")` hydrates no covers, so navigating through already loaded candidate metadata does not wait for twelve image downloads. The first presentation defaults to two eager images. Photos travel in `_meta`, and targeted model inspection remains a separate MCP image-content route. [W1] [W3] [W5]

Sellpy's `acceptGallery(result, true)` currently merges every later page into one `Map`, and `render` creates cards for the entire resulting array. `present` also retrieves each cover sequentially before returning. Increasing the page-size default alone would increase this cost rather than solve it. [S2] [S4]

Transfer page replacement, visible cover batches and generation protection. Retain Sellpy's useful comparison and shortlist behavior by keeping selection state keyed by item ID independently of the current page. Do not discard off-page shortlist choices or imply that a page-local sort is a global result sort. Use the existing native catalog sorting or a complete immutable refinement for global ordering. Label local controls clearly if they affect only one page. [S4] [S6] [S8]

Keep normal cards short: original photo, title/brand without needless repetition, price, size, condition, availability, and a compact criterion/status fragment when useful. Put material details, defects, retrieved description, uncertainty and provenance behind expandable panels. The parent user's requested fragment style can be stricter than Willhaben's one-sentence accompanying-answer rule; the reusable principle is that app facts are not duplicated in prose or a second table. [W7] [S4]

### 3. Coverage must describe what was actually delivered

Willhaben's research tables separate query membership, details by audience, photos by audience/index/size and assistant-reported reviews. `get_research` paginates summary, queries and item records. The widget renders one expandable research section rather than a long repeated explanation. A recorded visual review is rejected if its photo indices were not previously delivered to the model. Overlapping queries deduplicate evidence within their membership and do not imply that summed per-query counts equal unique global counts. [W2] [W3] [W9]

Sellpy already rejects visual assessments lacking model-delivered image IDs and stores confirmed/contradicted/unknown findings per requirement, which is more useful than replacing them with a generic free-text review. Its current `image_evidence` table records model delivery only; its run/arm coverage does not establish that every stored item description was actually delivered to the model or that every widget image was visually assessed. [S2] [S3]

Extend the ledger, do not replace the evidence model:

- Preserve per-route native totals/windows, source pages and deduplicated candidate counts.
- Count model-delivered fields/descriptions and exact delivered image identities separately from widget delivery.
- Count recorded assessments as assistant-reported findings, never as objective source labels or proof the user saw an image.
- Keep audit events compact and idempotent on cursor replay. Reference download URLs, credentials and image bytes do not belong in audit JSON.
- Render aggregate fragments first, with paginated per-route/per-item drill-down only when opened.

### 4. Retention is distinct from freshness

Willhaben 1.4.2 fixed an actual design error: long-lived collection IDs originally depended on five-minute shared search-cache entries. `presentationProvider` now resolves retained research-owned observations, merges newer cached evidence, preserves timestamps and respects tombstones. Missing legacy observations remain explicit and do not cause an automatic detail request for every card. Release notes report a 50-item 12/12/12/12/2 reproduction after expiry and a production 44-item 12/12/12/8 check after 353 seconds. Those are release-reported checks, not reruns by this investigation. [W0] [W1] [W4]

Sellpy already stores candidate observations indefinitely, so importing Willhaben's second observation store would duplicate responsibility. Read existing run candidates for ordinary browsing. Show their actual observation times; use explicit detail refresh for current price/status advice. Keep the existing retained image reference and explicit `forget_search` behavior. Snapshot membership can remain stable while current feedback and separately labelled fresh observations are available; the UI must not silently re-rank an existing cursor after feedback changes. [S2] [S3] [S6] [S7]

### 5. Shared request coalescing should be selective

Willhaben's `OriginGate` adds a keyed observation cache and atomic `claimObservation`, `commitObservation`, `releaseObservation` methods. Leases have an owner and expiry; commits check both. The provider waits within a deadline and shares the newly observed result, including among simultaneous refreshes. Its real runtime regression contains assertions that four independent cold searches cause one upstream request, four refreshes share one newly fetched observation, and concurrent detail requests also coalesce. [W6] [W10]

Sellpy already protects repeated continuation steps with durable operation receipts and uses request-local object memoization. These solve different problems. The OriginGate currently has only pacing/cooldown state, so deterministic public requests duplicated across independent calls remain an opportunity. [S3] [S8] [S9]

Adapt the lease concept for appropriate public catalog/config/item/native-result requests. The cache key must include method, exact endpoint/body or canonical query, market, language/index, filters/sort/offset/limit, and any source-version dependency. Keep explicit fresh-price checks fresh, but allow truly concurrent checks to share the same newly fetched observation. Never globally cache user attachment bytes or private file URLs. Reference-upload requests need their own verified idempotency and privacy design; do not apply a blanket HTTP memoizer. Preserve all origin cooldown and deadline behavior. [W6] [S8] [S9]

### 6. Native visual search is already real in Sellpy

Willhaben uses three input modes: host attachment descriptor, public HTTPS URL and exact listing photo. Its upload normalization follows the observed Willhaben frontend: JPEG at maximum 300×300, quality 90, with Cloudflare Images. Opaque continuation retains image/filter identity. This is a useful UX reference, **not** a Sellpy image-preprocessing specification. [W11] [W12]

Sellpy already implements native uploaded-reference multipart search, seed similarity, Sellpy-image similarity, semantic retrieval and outfit recommendations. Reference bytes persist privately so a later page does not depend on an expired host download URL. Native responses are schema-checked and canonical objects are hydrated from Sellpy. Its `modification` behavior combines native image and semantic routes; it explicitly does not claim verified joint image/text inference. [S2] [S7] [S8]

Useful additional convenience, subject to the Sellpy-specific contract investigation: allow an exact item ID/photo index as the image seed; permit a user-supplied public URL through the same validated upload path if the native endpoint accepts the downloaded bytes. Keep arbitrary URL download validation, file-size limits, exact image identity and source provenance. Do not send a generic public URL to the Sellpy product-image route if that route accepts only observed Sellpy image URLs. Do not replace the existing stronger mislabelled-category recovery and requirement-level visual assessment with Willhaben's simpler review tool. [W11] [W12] [S7] [S8]

## Libraries and additional native functionality

The pinned Willhaben package uses official MCP server 2.4.0 and Apps 2.0.4. Sellpy already matches these. Sellpy imports legacy SDK 1.32.2 only in `scripts/verify-live.mjs` for old-client verification; it is not the worker MCP runtime. Moving that package to development dependencies is dependency hygiene, not evidence of a runtime latency improvement. The Willhaben record discusses Cloudflare Agents, Vercel mcp-handler and mcp-lite, but adopting another framework does not by itself improve this existing Worker. Any newer version recommendation needs the parent's current official-source research, not extrapolation from this comparison. [W4] [W13] [S1] [S10]

Willhaben also implemented search-URL import with unsupported parameters exposed; title-only, included/excluded-term, recent-48-hour and handover filters; seller context; asking-price cohorts and study comparisons. Transfer their **purpose** where Sellpy evidence supports it: native search-URL import, explicit effective filters, honest window/coverage reporting, comparable price cohorts and snapshots. Willhaben seller membership, private/dealer distinction, PayLivery, handover IDs and exact search parameters are platform-specific. Do not invent Sellpy equivalents or reuse numeric native filter IDs. Sellpy's preferences, shortlist/rejection, observed item history and immutable refinement already cover several related use cases. [W0] [W14] [S6] [S7] [S8]

## Acceptance criteria for the transfer

These are targeted regression recommendations for the concrete changes, not a proposal to repeat every existing test:

1. **Many candidates:** At least 10,000 retained candidates; every ID reachable exactly once in stable order with 12/24-card pages; no whole-run JSON load, all-card DOM, or eager image hydration. Measure deep-page SQL work as well as correct counts.
2. **Concurrent discovery:** Continuing the source search does not reorder or add members to an existing snapshot. A refreshed collection explicitly includes the newly discovered cohort.
3. **Bounded rendering:** The browser has at most the page-sized card set; covers load only near the viewport in batches of at most four; late previous-page/query/image responses cannot alter the current view; mobile and fullscreen remain usable.
4. **Durability:** After worker restart and short shared-cache expiry, every stored page remains browsable with original observation times and no automatic detail fan-out. Source deletion/status changes remain visible as evidence rather than disappearing silently.
5. **Evidence:** Widget cover/gallery browsing does not increase model-photo or visual-assessment counts. Model image delivery and recorded findings do; duplicate replay does not inflate unique counts. Overlapping routes are deduplicated correctly.
6. **Selection continuity:** Shortlist/comparison choices survive page navigation. Page-local sort/filter scope is explicit; global ordering uses a complete suitable collection/refinement contract.
7. **Coalescing:** Four independent identical public cold requests yield one source call; distinct locale/filter/body requests never cross-contaminate; freshness, failures, cooldown, lease expiry and cancellation remain correct.
8. **UX:** An ordinary search can show 12 useful cards immediately after the first useful result page. No fabricated recommendation prose, repeated facts, or blanket detail-before-overview requirement. A visual recommendation still requires actual model-visible images and recorded evidence.

Willhaben provides concrete reference assertions for large snapshots, late responses, bounded visible images, audience-specific evidence and source-call coalescing. They should be adapted to Sellpy's domain/storage contracts rather than copied mechanically. [W9] [W10] [W15]

## Pinned primary sources

Willhaben sources all refer to head `2c3f621eab6047bdae3f65f2e036d6044caf8764` except the mutable PR page. Sellpy sources refer to baseline head `93f6a50a014321f642d991d6f5219b99158c4555`.

- [W0] [PR #1: 1.4.2 release and acceptance record](https://github.com/larsmartens/willhaben-scraper/pull/1).
- [W1] [Willhaben tools: presentation, app browsing, source tracking and observation resolution](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/src/tools.mjs).
- [W2] [ResearchSession: SQL ledger and collection snapshots](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/src/research-session.mjs).
- [W3] [Willhaben widget: bounded pages, generation guards, coverage and lazy covers](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/src/presentation-ui.mjs).
- [W4] [Willhaben 1.4 upgrade and verification record](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/docs/upgrade-1.4.md).
- [W5] [Willhaben presentation: default two-image hydration and metadata delivery](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/src/presentation.mjs).
- [W6] [Willhaben OriginGate: observation leases/cache](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/src/origin-gate.mjs).
- [W7] [Packaged presentation instructions](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/plugin/skills/marktplatz-studie/references/presentation.md).
- [W8] [Packaged Willhaben skill: overview versus verification workflow](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/plugin/skills/marktplatz-studie/SKILL.md).
- [W9] [Research runtime regression: 10,000 IDs, 417 pages, evidence and retention](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/test/research.runtime.mjs).
- [W10] [Provider runtime regression: four concurrent cold requests, refresh and detail coalescing](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/test/provider.runtime.mjs).
- [W11] [Native visual-search source/input normalization and continuation](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/src/visual-search.mjs).
- [W12] [Packaged visual-search instructions](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/plugin/skills/marktplatz-studie/references/visual-search.md).
- [W13] [Willhaben pinned dependencies](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/package.json).
- [W14] [Willhaben native provider: source filters, URL import, cache use and coalescing](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/src/providers.mjs).
- [W15] [Browser scaling regression: visible covers, mobile, fullscreen and stale responses](https://github.com/larsmartens/willhaben-scraper/blob/2c3f621eab6047bdae3f65f2e036d6044caf8764/marketplace-plugin/test/presentation-scale.browser.mjs).
- [S0] [PR #2: Sellpy baseline](https://github.com/larsmartens/willhaben-scraper/pull/2).
- [S1] [Sellpy MCP implementation/instructions](https://github.com/larsmartens/willhaben-scraper/blob/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin/src/mcp.ts).
- [S2] [Sellpy tool implementation](https://github.com/larsmartens/willhaben-scraper/blob/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin/src/tools.ts).
- [S3] [Sellpy durable search store](https://github.com/larsmartens/willhaben-scraper/blob/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin/src/search-store.ts).
- [S4] [Sellpy gallery: rendering, appending, comparison and image state](https://github.com/larsmartens/willhaben-scraper/blob/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin/ui/gallery.ts).
- [S5] [Sellpy schemas and tool descriptions](https://github.com/larsmartens/willhaben-scraper/blob/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin/src/schemas.ts).
- [S6] [Sellpy refinement persistence and bounded candidate evaluation](https://github.com/larsmartens/willhaben-scraper/blob/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin/src/research-store.ts).
- [S7] [Packaged Sellpy skill](https://github.com/larsmartens/willhaben-scraper/blob/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin/plugin/skills/sellpy-studio/SKILL.md).
- [S8] [Sellpy native provider: retrieval routes and request-local object memoization](https://github.com/larsmartens/willhaben-scraper/blob/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin/src/sellpy/client.ts).
- [S9] [Sellpy OriginGate and provider context](https://github.com/larsmartens/willhaben-scraper/blob/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin/src/traffic.ts).
- [S10] [Sellpy pinned dependencies](https://github.com/larsmartens/willhaben-scraper/blob/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin/package.json) and [modern/legacy live client checks](https://github.com/larsmartens/willhaben-scraper/blob/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin/scripts/verify-live.mjs).
