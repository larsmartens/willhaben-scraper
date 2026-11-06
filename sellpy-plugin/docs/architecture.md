# Architecture decision

Two independent sketches compared signed stateless cursors with a durable search-run owner. Both required a growing exact ledger to deduplicate results, preserve arbitrary continuation and retain visual evidence. The implementation chooses one SQLite Durable Object per authenticated principal and run. This document supersedes the transient sketch paths in the original append-only decision log.

## Ownership

| Boundary | Owner and invariant |
|---|---|
| Request and credential | Worker validates the personal capability before creating the official MCP handler. No process-global request state. |
| Shop contract | `SellpyProvider` discovers current public frontend configuration and returns typed observations. All network I/O uses the injected context fetch. |
| Search progress | One `SearchRun` actor owns criteria, arm offsets, candidates, provenance, operation receipts and uploaded-reference chunks. |
| Traffic coordination | One `OriginGate` actor per upstream host serializes permits and preserves the complete Retry-After cooldown. |
| Visual evidence | Exact original URL-based image identities are recorded only after model image content is delivered. Store categories remain separate from assistant observations. |
| Presentation | An immutable selected-ID list has its own continuation. Compact facts go to the model; full gallery and image hydration go to `_meta`. |

Search transport sessions do not own research state. Reconnects and Workers eviction preserve SQLite data. A request reserves a recoverable lease, performs network I/O outside a transaction, commits each successful provider page, then records an immutable response receipt. A newer lease generation excludes late writes from an abandoned operation. Repeating a cursor replays its receipt; a paused response advances to a new continuation cursor.

## Retrieval and judgment

Catalog, semantic, native item similarity, native source-image search, native multipart image upload and outfit recommendations are distinct routes. Native scores have different scales, so fusion uses weighted reciprocal ranks. Round-robin retrieval and reserved diversity slots give category-relaxed arms access to the returned pool.

For mislabeled garments, relaxed query text omits the desired garment noun and the corresponding source taxonomy filter. Budget, size and other verified hard constraints remain. The requested garment type stays in the intent and is checked visually later. This improves the opportunity to discover wrong-category items; it does not establish exhaustive recall.

An image-plus-change request creates both an image route and semantic text routes. It does not pretend the native service supports unobserved joint image/text composition. A model judges original returned images and records evidence.

## Efficiency choices

Use source-provided embeddings and native retrieval before adding a separately crawled embedding index. Hydrate native IDs in object batches, fetch public detail fields using GraphQL aliases, and preserve exact raw offsets even when localized filters reject every hydrated candidate. Cache configuration data, not stale item conclusions. Fetch image bytes only for selected visual inspection or gallery hydration.

SQL rows avoid rewriting a monolithic ever-growing search JSON. Immutable receipts cost storage but make retries deterministic. Reference bytes use small SQLite BLOB chunks so a temporary download URL does not break later upload-search pages. One shared gate per origin limits bursts without imposing a lifetime user quota.

## Scope of proof

Contract fixtures prove normalization, pagination and error behavior. Direct native calls prove current source contracts. Workerd tests prove actual SQLite, RPC, schema and eviction behavior. A simulated MCP Apps host proves bridge/UI interactions. Only an observed installed ChatGPT run can prove the final client integration. These evidence categories are reported separately.

No cross-family architecture judge was available. The sketches and subsequent independent reviewer were separate GPT agents. No formal model-checking verdict or benchmark-level SOTA superiority is claimed.
