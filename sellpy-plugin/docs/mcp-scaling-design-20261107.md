# Sellpy MCP and large-result design review

**Date:** 2026-11-07  
**Scope:** independent read-only source review and primary-source research; implementation decision belongs to the integrating agent.  
**Inspected baseline:** Sellpy Studio 1.1.1, local commit `62b195886a142e9362fcd306678ba8d5d7cfef62`. Source files were read directly. No production endpoint, installed plugin, user data, or application code was changed for this report. Recommendations below are not implementation claims or measured improvements.

## Overview

Retain the current official MCP v2 server and MCP Apps libraries. The main remaining scale problem is the application contract between discovered candidates, presentation selection, and UI paging. It is not an obsolete protocol library.

The recommended design is a **durable indexed collection with stable membership and order, bounded pages, explicit observation semantics, and an app-only paging tool**. Show 12 cards initially, support 24-card pages, and keep earlier pages reachable without retaining their complete DOM and base64 photographs in the widget. These are proposed interaction budgets, not total-result limits.

The current implementation already has valuable foundations: per-search SQLite Durable Objects, idempotent search continuation, source rate control, retained reference image bytes, complete candidate retention, keyset scanning for refinement, and exact image evidence. Reuse those foundations. Add a collection boundary rather than a second search engine or a second persistence system.

### Current libraries and alternatives

| Choice | Verified state | Recommendation |
|---|---|---|
| `@modelcontextprotocol/server` / `client` 2.4.0 | Installed; upstream releases list 2.4.0 dated 23 October 2026 [S1]. Local server README identifies v2 as the stable line. | Retain; use official handler, schemas, error behavior, and compatibility support. |
| `@modelcontextprotocol/ext-apps` 2.0.4 | Installed; upstream latest release found is 2.0.4 dated 27 October. Its release notes describe example/dependency changes, not a new library API [S2]. | Retain; native MCP Apps bridge, no independent iframe messaging implementation. |
| Cloudflare `agents/mcp/server` wrapper | Current Cloudflare guide also uses a stateless factory around SDK v2 [S3]. | A valid alternative for an app already using Agents. No demonstrated benefit from inserting it into this working Worker. |
| Stateful `McpAgent` protocol sessions | Cloudflare currently marks this API deprecated [S4]. | Do not migrate the current stateless protocol endpoint to it for collection persistence. Application state already belongs in `SearchRun`. |
| Custom JSON-RPC transport or another convenience framework | Would introduce another compatibility surface. No matching latency evidence was obtained. | Do not replace the official transport to claim “SOTA.” Optimize observed application work first. |
| Legacy `@modelcontextprotocol/sdk` 1.32.2 | Only `scripts/verify-live.mjs` imports it, for an older-client compatibility check; production imports v2. | Keep the compatibility test. Moving this dependency to devDependencies is housekeeping, not a runtime-speed claim. |

The upstream handler factory is deliberately per-request and supports web-standard `Request`/`Response`; shared caches belong outside that factory. JSON-only mode suppresses mid-call notifications [S5]. The current short, resumable operations fit JSON responses. Streaming should be introduced only for a real progress or subscription need, with cancellation and reconnect behavior tested.

## Key concepts

| Concept | Required meaning |
|---|---|
| Discovered candidates | Unique Sellpy IDs actually returned by an executed source route. Not Sellpy's entire catalog. |
| Collection | A navigable set of those candidates, or an explicit recommendation/refinement selection, identified independently of the search run. |
| Membership snapshot | IDs and order fixed at collection creation. Does not by itself freeze prices, photos, or visual evidence. |
| Observation snapshot | The exact source observation and assessment used to construct a card. Must have a stored revision or immutable copy if replay is promised. |
| Current overlay | Explicitly refreshed facts or user feedback shown over an older collection observation. Must not silently change the original assessment or membership. |
| Model-visible evidence | Original image content delivered through `get_item_images(for_model:true)` and the exact checked image IDs. UI thumbnails do not qualify. |
| Coverage | Counts of work actually completed, separated by discovery, detail retrieval, model image delivery, assessment, and UI presentation. |
| No arbitrary total cap | Continuations can reach all retained discovered IDs. Per-call work, byte, UI, source-window, and storage limits still exist. |

### Important existing snapshot nuance

`ResearchStore.createRefinement` freezes candidate `max_sequence`, cohort count, preferences, and feedback. `advanceRefinement` then scans up to 256 candidates per call and materializes each candidate's current facts and assessment. Already materialized rows and replay receipts are stable; an **unscanned** candidate can still change before a later scanning call.

Therefore the existing refinement is not a single point-in-time snapshot of every candidate's evidence at creation. `item_observations` stores selected commercial fields; it does not retain full title, image lists, descriptions, or visual assessment history. Reusing it as a complete historical card store would be incorrect. The collection design must state whether it freezes membership only or also freezes card observations.

## How it works today: actual scale and latency paths

| Path | Observed implementation | Consequence |
|---|---|---|
| Initial presentation | `present_items` requires a model-supplied `selection`; default page size 6, maximum 20. | The tool does not offer browsing all discovered items directly; the model must enumerate IDs and reasons first. |
| Selection storage | One `presentations.value_json` stores the entire selection. Every page loads/parses that whole value before slicing. | Work and row size grow with total selection length, despite small pages. The handler's 1 MiB request-body limit also constrains selection creation. Raising that limit would not solve the design. |
| Page preparation | `getCandidates(..., true)` refreshes missing/non-detail or older-than-two-minute observations. | Browse latency can include source API requests. Browsing old retained results should not require an upstream service to be available. |
| Canonical detail fetching | Catalog and GraphQL requests already run together, two concurrent sources, in batches of ten. | Preserve this optimization. A 12/24-card page can span multiple detail batches if refresh remains mandatory. |
| Cover hydration | Presentation loops covers sequentially; shared encoded-image budget is 6 MiB. | Increasing card count directly increases critical-path image work and payload until the budget/deadline intervenes. |
| Widget continuation | `acceptGallery(..., true)` merges every earlier card; photos remain for all cards; `render()` rebuilds the accumulated view. | Network paging does not bound browser memory or DOM. `orderedCards()` sorts/filters only the loaded set. |
| Layout | Horizontal carousel; three visible columns on a wide inline surface, one on narrow screens. | Six returned cards are still perceived as a handful. A dense vertical grid/page is a better browse surface. |
| Candidate listing | `listCandidates` uses `LIMIT ... OFFSET ...`. | Deep pages repeatedly skip earlier rows. Existing `scanCandidates(after,max,limit)` already supplies the keyset primitive needed for stable discovery-order browsing. |
| Status reads | `status()` aggregates all candidate counts; some RPCs invoke it as an active-state guard. | Avoid full coverage aggregation when only deletion/active-state validation is needed. Optimize counters only after measurement and preserve transactional correctness. |
| Candidate hydration | `getCandidates` performs per-ID candidate lookup, then per-item retrieval-path lookup. | This is local SQLite work, not network N+1. Batch within platform parameter limits if profiling shows it matters; it is secondary to mandatory source/image calls. |
| UI fact duplication | Brand above a source-generated title containing brand/type/size; size again in facts; free-text reason/cautions often repeat price, condition, and evidence. | A structured display projection is needed. Styling alone cannot remove semantic duplication reliably. |

Cloudflare's page freshly opened on 7 November documents 10 GB per SQLite Durable Object, an **8 MB** maximum SQL string/BLOB/row, 100 bound parameters, and six simultaneous outgoing connections per request [S6]. An earlier search-index excerpt still showed the previous 2 MB figure; the freshly opened page supersedes that excerpt. These are reasons for indexed bounded rows and conservative parallelism, not a guarantee about how many real listings fit. The present 1 MiB request limit is encountered before the SQL row ceiling can be reached through a normal single presentation call.

## Two concrete collection designs

### A. Direct bounded browsing over the candidate ledger

`present_items` accepts a discovered-results source instead of an explicit selection. A small collection header records `run_id`, maximum discovery sequence, creation time, and sort policy. Pages use `sequence > after AND sequence <= snapshot_max_sequence`. The widget replaces its displayed page and keeps bounded navigation tokens.

| Dimension | Behavior |
|---|---|
| Module depth | Small facade around existing `snapshotCohort` / `scanCandidates`; minimal new persistence. |
| First-page latency | Local reads only when source refresh and most image hydration are removed from the critical path. |
| Memory | O(page size), assuming page replacement and bounded photo cache. |
| Persistent state | Header only; canonical candidate records remain the source of card facts. |
| Restart/TTL | Stable if candidate records remain durable; no dependence on process cache. |
| Snapshot semantics | Stable discovery-order membership; source facts/evidence are latest retained values at read time. |
| Sorting/filtering | Discovery order is straightforward. Live price/availability/assessment filters can move rows between pages; “all matches” requires a frozen membership/index or explicitly live browsing semantics. |
| Arbitrary ranked selection | Requires a separate ordered-membership representation; the old giant selection JSON must still be replaced. |

**Use when:** the first requirement is simply “browse every discovered item in discovery order,” with clearly timestamped current retained facts. It is the lowest-risk thin implementation. It cannot honestly promise replay of a historical evaluation or consistent global mutable-field sorting without additional state.

### B. Indexed durable collection and card observations — recommended

Add a deep `CollectionStore` module within the existing per-search Durable Object. Store a small collection header plus one indexed row per membership, with stable ordinal, item ID, and observation/evidence reference. Build from an existing search cohort or completed refinement; no model-supplied giant ID array is required.

Suggested conceptual schema:

```text
collections: id, run_id, source_kind, source_id, snapshot_max_sequence,
             created_at, status, total, build_cursor, sort/filter definition
collection_members: collection_id, ordinal, item_id, observation_revision
card_observations: revision, item_id, immutable compact card facts,
                   image references, assessment reference, observed_at
```

This is a schema sketch, not a new implementation. Keep unique `(collection_id,item_id)` and indexed `(collection_id,ordinal)` constraints. A revision table can be introduced only if it materially avoids copies; copying bounded compact observations per membership is simpler for the first release. Full original evidence remains accessible separately, with an exact revision reference if frozen replay is promised.

| Dimension | Behavior |
|---|---|
| Module depth | The module owns construction, membership, ordering, cursors, snapshot semantics, and deletion. Tools/UI receive pages instead of knowing the storage strategy. |
| First-page latency | Collection creation has O(N) membership work. Use server-side insertion or resumable bounded construction; return explicit construction progress when necessary. Subsequent pages are indexed local reads. |
| Memory | O(page size + bounded construction batch). Do not build a full JavaScript array first. |
| Persistent state | O(N) membership; compact immutable observations or version references. A storage tradeoff buys exact replay and global ordering. |
| Restart/TTL | Collection pages work after isolate restart and after all transient source caches expire. Durable Objects can be evicted; module-scope maps are accelerators only [S7]. |
| Snapshot semantics | Membership/order fixed. Card observation snapshot is fixed only if copied or versioned. Explicit refresh can return a current overlay/new collection, not silently rewrite historical evidence. |
| Sorting/filtering | Server-side over the entire collection; changed criteria create a new collection revision. Page-local sorting must be labeled as page-local if retained. |
| Selection/compare | Shortlist decisions remain durable by item ID. UI can page away while retaining selected IDs; comparison fetches only selected items. No need to keep every card in memory. |

**Critical construction decision:** a chunked copy from mutable candidates is not automatically a point-in-time snapshot. Either freeze the required compact observations in one transactional SQL operation whose measured runtime is acceptable, version candidates before chunking, or explicitly call the result “membership snapshot with observations captured during build.” Do not hold a database transaction open across source network requests.

### Decision

Choose **B** for the user's complete requirement: large browseable sets, globally meaningful filters/order, reliable reopen behavior, compact evidence, and reuse across recommendations. Use A's keyset scan internally for discovery-order construction. If construction semantics cannot be implemented and verified within the release, ship A honestly instead of labeling it an immutable evidence snapshot.

Do not add a separate database, external vector index, queue service, React migration, or virtualization package merely for 12/24-card pages. A virtualized infinite grid is another possible UX, but page replacement already provides bounded DOM with substantially less focus, accessibility, and scroll-restoration complexity.

## Proposed tool and UI contract

Extend the existing `present_items` entrance to accept explicit selection, discovered cohort, or refinement reference. Register **one** app-only `browse_collection` for page navigation and collection filter/sort requests. Keep model-visible result data useful without a widget.

OpenAI distinguishes concise `structuredContent` visible to the model from UI/client data in `_meta`; stable identifiers should support later calls, and tools should remain useful without UI [S8]. Apply that distinction as follows:

| Surface | Content |
|---|---|
| Model structured result | Collection/run IDs; displayed item IDs and compact factual fallback cards; page position; coverage; continuation; explicit unresolved evidence. No base64 thumbnails. |
| UI metadata | Exact current page cards; hydration keyed by item/image identity; collection navigation; small coverage projection. |
| First paint | 12 compact cards by default; 24 optional; only two eager covers suggested as a measured starting budget. |
| Visible lazy loading | At most four concurrent visible-cover requests suggested; cooperate with existing origin pacing/cooldown. Reuse the existing safe image-loading path. |
| Browser memory | Current page plus bounded adjacent-page/photo LRU, and selected IDs. Clear page-only resources after eviction. |
| Global filtering | Server-owned revision or explicit collection query; never imply the loaded page represents all matches. |
| Slow/failing source | Retained cards remain usable; explicit refresh reports old observation times and unresolved current status. |
| Request identity | Check run ID, collection ID/revision, UI generation, item ID and image identity. Existing run/generation guards are a useful foundation. |

Coalesce simultaneous cold requests by canonical resource key only where semantics match. A canonical detail refresh must not accidentally reuse an earlier search-hydration observation. Share completed observations or reusable parsed bytes; do not share a consumable `Response` body. One caller aborting must not cancel other callers. Preserve rate-limit feedback and evict rejected in-flight promises. Measure the two-caller upstream request count before claiming an improvement.

## Compact, evidence-preserving cards and coverage

Create a display projection with typed fields; leave canonical source facts and full evidence intact. Do not infer or rewrite meaning by clipping sentences or deleting repeated words with regexes.

| Card area | Display rule |
|---|---|
| Heading | Garment type/title and brand each once. Prefer known normalized source fields; preserve full original title in expandable source detail. |
| Commercial facts | Price, original price when meaningful, source size, condition, availability once each. |
| Visual criteria | Exact criterion label plus confirmed / contradicted / unknown; checked-image count. “Cottagecore ✓” only from a recorded applicable criterion verdict. |
| Unknowns | Compact fragments, e.g. `Material: offen`, `Maße: fehlen`; distinguish absent source data from visual uncertainty. |
| Category mismatch | Source category and observed garment type remain separately labeled. An observed dress does not erase the source's underwear label. |
| Evidence detail | Exact checked image IDs, source observation time, full recorded evidence, paths, raw source description accessible on demand. |
| Reasons | New compact annotations should refer to evidence keys. Existing arbitrary `reason`/`cautions` stay accessible as legacy notes, not forcibly rewritten into purported facts. |

A concise research strip can show **Gefunden · Details · Bilder geliefert · Visuell geprüft · Sammlung** with distinct counts, followed by expandable route/query coverage. Count unique IDs for overall discovery; never sum overlapping route totals. A downloaded widget cover does not increment model-visible image delivery. A recommendation selection does not imply that every discovered candidate was assessed. Source windows, paused routes, failed pages, and unknown upstream totals remain explicit.

### Where the work belongs

| Module | Responsibility |
|---|---|
| `src/search-store.ts` | Existing candidate/source ledger; narrow cohort scans and active-state checks. |
| `src/research-store.ts` | Existing preference/feedback/refinement semantics; expose completed ranked membership without re-ranking in UI. |
| New `src/collection-store.ts` | Collection lifecycle, bounded build, indexed members, durable observation contract, replay, deletion. |
| `src/search-run.ts` | Principal-scoped RPC facade; no second independent search-state owner. |
| `src/presentation.ts` + shared UI data types | Evidence-preserving card projection, compact model result, exact hydration identity. |
| `src/tools.ts`, `schemas.ts`, `mcp.ts` | Two entrances: model presentation and app paging; explicit output schemas for new collection/coverage contracts. |
| `ui/gallery.ts`, `styles.css` | Grid/page navigation, bounded cache, viewport image loading, selection persistence, structured facts. |

The fresh Willhaben 1.4.2 comparison agent reports indexed collections, app-only browsing, 12/24-card behavior, two eager/four lazy covers, durable observations, research coverage and cold-request coalescing at commit `2c3f621eab6047bdae3f65f2e036d6044caf8764`. That is useful comparative evidence, not source code independently audited by this report's author. Port contracts and proven invariants after review; Sellpy's model-visible image evidence and refinement semantics require adaptation.

## Discriminating validation and gotchas

| Test | What it must distinguish |
|---|---|
| Large real construction path | Create a 10,000-ID synthetic source fixture through search ingestion and collection construction, not direct table insertion. Traverse every page; assert exact unique set, order, no omissions, no duplicates, bounded response bytes and DOM. Synthetic IDs prove scale behavior, not Sellpy recall. |
| Real source acceptance | Separately collect a genuine Sellpy result set spanning several pages. Retain actual IDs/photos/observation times and verify page transitions in ChatGPT. Never use inserted fixtures as evidence of upstream coverage. |
| Restart and transient expiry | Restart the Durable Object after early pages, expire transient provider caches, disable provider access, then read a middle and final collection page. Retained browse should succeed without fresh search/detail calls. |
| Snapshot discriminant | Create more than one build/scan batch, update an unscanned item's facts/evidence, add new candidates, change feedback, then continue. Assert the chosen documented membership and evidence semantics, rather than merely checking a `snapshot` field. |
| Same-run stale response | Start collection A; switch to B in the same run; deliver A's page/photo/refresh responses late. None may alter B, its visible photos, feedback, or count. |
| Global sort/filter | Choose matching/cheaper items only on later pages. A whole-collection filter/order must find them without loading preceding pages into browser memory. |
| Evidence identity | Return another item's valid-looking image ID/URL, updated photo sets, stale assessments, or failed image delivery. Preserve the original item association; do not mark covers as model inspection. |
| Cold duplicate requests | Start simultaneous identical page/image/detail requests with an instrumented provider; check actual upstream call count and independent failure/cancellation. Sequential warm-cache tests do not establish coalescing. |
| Structured-card review | Use real title/brand/size/condition fixtures and both contradictory and unknown visual criteria. Verify each ordinary fact appears once in the collapsed card, evidence labels retain meaning, long legacy notes remain accessible, and exact original URLs remain linked. |
| Deleted/private state | Forget a run, then reuse old cursors and collection IDs; reject them and delete all new collection tables. Other principals must not obtain the collection. |

Report cold/warm latency separately, payload bytes separately from original image bytes, and first usable cards separately from all-image completion. Compare the same task and source fixture before/after. Existing historical provider benchmarks and Willhaben's reported 10,000-listing test are not fresh Sellpy measurements. No new test suite was run in this read-only design task.

### Primary references

- **[S1]** MCP TypeScript SDK releases: <https://github.com/modelcontextprotocol/typescript-sdk/releases> — verified current release 2.4.0 and package versions.
- **[S2]** MCP Apps releases: <https://github.com/modelcontextprotocol/ext-apps/releases> — verified 2.0.4 release and library API scope.
- **[S3]** Cloudflare MCP handler API: <https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/> — stateless SDK v2 factory.
- **[S4]** Cloudflare McpAgent API: <https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/> — deprecated stateful API.
- **[S5]** Official SDK HTTP guide: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md> — factory lifecycle, shared caches, JSON/SSE response behavior.
- **[S6]** Cloudflare Durable Object limits: <https://developers.cloudflare.com/durable-objects/platform/limits/> — SQL row, parameters, object storage and connection limits; freshly reopened page dated 7 November 2026, superseding a stale 29 October search excerpt.
- **[S7]** Cloudflare durable storage guidance: <https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/> — eviction/deployment state loss and durable SQLite storage.
- **[S8]** OpenAI plugin MCP server guide: <https://developers.openai.com/plugins/build/mcp-server> — structured results, model-hidden metadata, useful UI-independent workflows.

Local implementation evidence: `package.json`, installed SDK READMEs, `src/mcp.ts`, `src/tools.ts`, `src/schemas.ts`, `src/search-store.ts`, `src/search-run.ts`, `src/research-store.ts`, `src/observations.ts`, `src/presentation.ts`, `src/sellpy/client.ts`, `src/images.ts`, `src/traffic.ts`, `ui/gallery.ts`, `ui/comparison.ts`, `ui/styles.css`, and existing relevant test names/bodies. Complexity and architecture comparisons are engineering inferences from these implementations, not benchmark results.


## Parent follow-up: wrapper choice, 7 November 2026

The parent independently opened the current official MCP July 28 protocol announcement, OpenAI's plugin UI/reference/packaging documentation, and the primary repositories below. The protocol's stateless transport and explicit application-state handles support keeping durable research in SearchRun rather than making one MCP transport session own the research.

| Alternative | Observed primary-source scope | Decision for this plugin |
|---|---|---|
| Official TypeScript SDK 2.4.0 + MCP Apps 2.0.4 | Direct current protocol/Apps support already installed and working in this Worker | Retain the official core; optimize storage, source work and UI instead of changing a functioning transport merely for novelty |
| Fiberplane `mcp-lite` | Fetch-based rewrite advertising zero runtime dependencies and HTTP/SSE support | Interesting bundle-size alternative; no matched test establishes that a migration would improve this plugin while preserving its current Apps, visibility and legacy-client behavior |
| Vercel `mcp-handler` | Current primary README describes SDK v2, the 2026-07-28 protocol and stateless/legacy handling | Useful framework adapter; the existing direct official Fetch handler already provides the needed deployment boundary |
| FastMCP | A higher-level TypeScript server framework with an active release history | Broader convenience surface is not a measured improvement over this small explicit server; no migration justified by the present bottlenecks |
| Cloudflare Agents/McpAgent | Current Cloudflare handler documentation recommends SDK v2; older stateful McpAgent guidance is deprecated | Keep separate durable domain state, without introducing another agent/session ownership layer |

This is an engineering choice for this codebase, not a benchmark ranking of the libraries. The production dependency set keeps exact current stable pins; the older SDK remains only a development compatibility-test dependency. No unsupported preview is introduced to obtain a newer version number.

Additional primary references: [official MCP protocol announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [Fiberplane mcp-lite](https://github.com/fiberplane/mcp-lite), [Vercel mcp-handler](https://github.com/vercel-labs/mcp-handler), [FastMCP releases](https://github.com/punkpeye/fastmcp/releases), [OpenAI plugin reference](https://developers.openai.com/plugins/reference), [OpenAI ChatGPT UI guide](https://developers.openai.com/plugins/build/chatgpt-ui), and [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins).
