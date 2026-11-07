# Architecture decision

Two independent sketches compared signed stateless cursors with a durable search-run owner. Both required a growing exact ledger to deduplicate results, preserve arbitrary continuation and retain visual evidence. The implementation chooses one SQLite Durable Object per authenticated principal and run. This document supersedes the transient sketch paths in the original append-only decision log.

## Ownership

| Boundary | Owner and invariant |
|---|---|
| Request and credential | Worker validates the personal capability before creating the official MCP handler. No process-global request state. |
| Shop contract | `SellpyProvider` discovers current public frontend configuration and returns typed observations. All network I/O uses the injected context fetch. |
| Search progress | One `SearchRun` actor owns criteria, arm offsets, candidates, provenance, operation receipts and uploaded-reference chunks. |
| Traffic coordination | One `OriginGate` actor per upstream host serializes permits and preserves the complete Retry-After cooldown. Sixteen separately named actors in that binding coordinate bounded completed public observations through atomic leases. |
| Visual evidence | Exact original URL-based image identities are recorded only after model image content is delivered. Store categories remain separate from assistant observations. |
| Presentation | `CollectionStore` owns stable membership/order and indexed navigation; normal observed/arm collections use sequence bounds, and explicit/derived views use indexed members. Compact facts go to the model; page data and image hydration go to `_meta`. |

Search transport sessions do not own research state. Reconnects and Workers eviction preserve SQLite data. A request reserves a recoverable lease, performs network I/O outside a transaction, commits each successful provider page, then records an immutable response receipt. A newer lease generation excludes late writes from an abandoned operation. Repeating a cursor replays its receipt; a paused response advances to a new continuation cursor.

## Retrieval and judgment

Catalog, semantic, native item similarity, native source-image search, native multipart image upload and outfit recommendations are distinct routes. Native scores have different scales, so fusion uses weighted reciprocal ranks. Round-robin retrieval and reserved diversity slots give category-relaxed arms access to the returned pool.

For mislabeled garments, relaxed query text omits the desired garment noun and the corresponding source taxonomy filter. Budget, size and other verified hard constraints remain. The requested garment type stays in the intent and is checked visually later. This improves the opportunity to discover wrong-category items; it does not establish exhaustive recall.

An image-plus-change request creates both an image route and semantic text routes. It does not pretend the native service supports unobserved joint image/text composition. A model judges original returned images and records evidence.

## Efficiency choices

Use source-provided embeddings and native retrieval before adding a separately crawled embedding index. Hydrate native IDs in object batches, fetch public detail fields using GraphQL aliases, and preserve exact raw offsets even when localized filters reject every hydrated candidate. Configuration has a separate cache. Public provider observations have short, source-timestamp-based lifetimes: search 15 seconds, details 5 seconds, facets/brands 60 seconds. No visual conclusion or private preference is shared. Explicit detail validation bypasses the observation cache.

Atomic claim/commit/release leases coalesce concurrent source work across distinct Worker request contexts. Persist completed JSON, never promises, responses, streams or request contexts. Request keys are semantic SHA-256 hashes; cached projections omit echoed caller criteria. Each of sixteen shards has bounded entry, byte and lease counts with indexed expiry cleanup. Every actual miss still uses the origin pacing gate. A fresh cache hit can be served during cooldown because it performs no upstream request and preserves its original observation time.

SQL rows avoid rewriting a monolithic ever-growing search JSON. Immutable receipts cost storage but make retries deterministic. Reference bytes use small SQLite BLOB chunks so a temporary download URL does not break later upload-search pages. One shared gate per origin limits bursts without imposing a lifetime user quota.

## Collection and display boundaries

The 1.2 design was selected from two independently written candidates, using the explicit rubric in `scale-plan.md`. All-observed collections freeze a candidate sequence bound; arm collections freeze their own membership sequence. A fixed collection is an identity/order snapshot, not a universal timestamp snapshot of item facts. Current observations remain labeled with their own times. Derived views process bounded batches and report preparation and observation intervals. Refinement collections reuse the canonical durable output order without consuming model pagination receipts.

`present_items` creates a collection without repeating every discovered ID. App-only `browse_collection` navigates it, prepares global views, or reads stored details/scope. Twelve cards is the default; twenty-four is the interactive option. Page queries use indexed seeks rather than increasingly expensive OFFSET scans. Large legacy selections are imported incrementally with UTF-8-aware progress, retaining their original IDs, reasons, order and page size.

Page projections keep oversized descriptions and evidence out of the ordinary card payload; exact canonical content remains available through detail access. Two initial covers and four concurrent viewport photo requests bound source/image work. The UI holds three page payloads, four comparison selections and a 48-photo/12 MiB cache. Replacing a page releases off-page DOM nodes and unused image buffers. Run, collection, generation, request and exact image identities reject stale asynchronous responses; feedback intents have a separate serial order.

One pure projector supplies cards, details and comparison with labeled shop facts and accepted requirement evidence. It removes exact display duplication and never synthesizes a claim from legacy prose. Stored details, model-delivered descriptions/facts, actual model photos, widget photos and saved assessments are separate scope counts. Unknown historical counts stay unknown. Viewing a photo or shortlisting an item does not create an assistant visual assessment.

The public-reference downloader uses uncredentialed HTTPS requests, validates every redirect, enforces file/time/type budgets, and does not forward user credentials. Hostname screening alone is not a DNS-level guarantee: the deployed global Cloudflare Worker relies on Cloudflare's outbound public-network proxy; no VPC/service/own-zone-origin binding is attached. The boundary must be re-evaluated before moving this downloader to another runtime or adding private-network access.

## Scope of proof

Contract fixtures prove normalization, pagination and error behavior. Direct native calls prove current source contracts. Workerd tests prove actual SQLite, RPC, schema and eviction behavior. A simulated MCP Apps host proves bridge/UI interactions. Only an observed installed ChatGPT run can prove the final client integration. These evidence categories are reported separately.

No cross-family architecture judge was available. The sketches and subsequent independent reviewer were separate GPT agents. No formal model-checking verdict or benchmark-level SOTA superiority is claimed.
