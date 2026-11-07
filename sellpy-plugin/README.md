# Sellpy Studio

A remote MCP plugin for ordinary and visual Sellpy shopping research in ChatGPT. It combines Sellpy's native catalog, semantic, item-similarity, product-image, uploaded-image and outfit services with durable search progress and an illustrated MCP Apps gallery.

The deployment and private research state are independent of Willhaben. The 1.2 implementation adapts useful patterns from its last completed 1.4.2 release. Default market is Austria, language German. Prices use the selected market's currency and integer minor units internally.

**Release status:** server **1.2.1 is deployed** and the existing installed ChatGPT package reports **1.2.1**. Its 27 tools comprise 26 model tools and one app-only collection navigator. The release passed 163 Node tests, 35 actual Workers tests, a 10,137-item/423-page Chromium traversal and nine live verification gates for the 1.2.0 core. The final 1.2.1 UI correction passed fresh full suites plus focused German/English coverage checks and exact deployed-resource verification. See the [1.2 release record](docs/scale-verification.md) for exact artifacts, performance scope, installation and actual-host evidence. Historical evidence remains in the [1.1.1 record](docs/followthrough-verification.md).

## User workflows

| Request | Behavior |
|---|---|
| “Leinenkleider, Größe M, bis 40 Euro” | Discover real facets, catalog search, current detail checks, illustrated shortlist. |
| “Cottagecore, auch falsch beschriftete Angebote” | Multiple native semantic and catalog arms, some without category or garment-name constraints; rank fusion, then actual image inspection. |
| “So wie dieses Bild, aber lange Ärmel” | Native uploaded-image retrieval plus semantic attribute searches; verify sleeves on original candidate photographs. |
| “Suche mit diesem öffentlichen Bildlink / dem zweiten Artikelfoto” | An uncredentialed public image is downloaded and retained for native upload; a known item photo uses its exact stored index and identity. |
| “Übernimm diese Sellpy-Suche” | Import supported native URL filters, market, currency and order; reject unknown restrictions explicitly. |
| “Welche Marken ähneln COS?” | Native similar-brand discovery; search each chosen brand separately to check current inventory. |
| “Mehr wie dieser Artikel” | Native item similarity with exact seed identity and optional category relaxation. |
| “Was passt zu diesem Rock?” | Native complementary recommendations; the source's finite window is stated explicitly. |
| “Zeig die weiteren Fotos / such weiter” | Continue photo or search pages without a cumulative plugin count cap. |
| “Zeig alle gefundenen Stücke” | Open the entire observed cohort without repeating its IDs; browse twelve or twenty-four cards per page. |
| “Speichere diese Suche” | Private durable bookmark, criteria, observations, provenance and continuation. |
| “Lange Ärmel, keine Transparenz; Größe M und bis 40 Euro” | Explicit hard criteria, original-photo verdicts, literal source facts and a separate unknown state. |
| “Merke diese drei; das andere gefällt mir nicht” | Durable shortlist/reject feedback and a fresh refinement that applies those decisions. |
| “Vergleiche die gemerkten Stücke” | Side-by-side original facts and requirement evidence; explicit continuation in chat. |
| “Merke meine Suchpräferenzen” | Named private profile; no inferred body fit or cross-user learning. |
| “Wiederhole die Suche; was hat sich geändert?” | New inventory run, newly encountered IDs and actually observed price/status changes. |
| “Lösche diese Suche mitsamt Referenzbild” | Private run deletion, including retained images, assessments, feedback, history and bookmark. |

## Tools

There are 27 focused tools: 26 available to the model, plus one app-only collection tool. The original 16 remain: `get_capabilities`, `discover_filters`, `search_items`, `search_style`, `find_similar`, `search_by_image`, `find_outfit`, `continue_search`, `get_search_status`, `list_search_items`, `get_items`, `get_item_images`, `record_visual_assessment`, `present_items`, `save_search`, `list_saved_searches`.

The eight 1.1 additions are `get_preferences`, `set_preferences`, `set_item_feedback`, `list_item_feedback`, `refine_search`, `get_item_history`, `refresh_search` and `forget_search`. Version 1.2 adds `search_url`, `search_similar_brands` and app-only `browse_collection`.

Refinement uses a durable cohort and feedback snapshot, streams evaluation in batches of 256 and keeps every deferred candidate. Candidate observations are captured when processed, with their own observation timestamps; this is not a catalog-wide instantaneous snapshot. Positive and negative visual requirements use exact recorded image evidence. Native facets shared by all effective retrieval arms stay hard constraints, while deliberate category/style recovery stays relaxed. A bounded MMR-style metadata window reduces repetitive selections without pretending to use image embeddings.

The official MCP SDK v2 serves modern and legacy streamable HTTP. The official MCP Apps bridge provides a self-contained gallery. Compact structured cards also support illustrated Markdown in clients without an MCP Apps renderer. Model-visible image content and widget-only image hydration remain separate; only the former authorizes recorded visual evidence.

## Large collections and clear cards

`present_items({run_id})` opens all observed candidates, with no model-supplied ID array. A source may instead identify one retrieval arm, a saved shortlist or a refinement; an explicit ordered selection remains supported. Membership and order are stable. Current stored item facts keep their actual observation timestamps. Collection creation is not a claim that every observation was taken at one instant.

Normal pages contain twelve cards; the app also offers twenty-four. Navigation uses indexed keyset seeks. The app retains at most three pages, four comparison selections, and 48 photos within a 12 MiB photo budget. It replaces the current page instead of growing the DOM indefinitely. These are view and memory budgets: every collection member and every original photo remains reachable.

Initial presentation embeds at most two covers. A four-request viewport queue loads remaining visible photos. Browsing reads stored facts, without automatically refreshing details for every page. Explicit refresh uses fresh source details; descriptions and observed history are available on demand. Shortlist, availability, assessment and price-order views are prepared over the complete collection in bounded batches, rather than sorting or filtering only the currently visible cards.

Cards, details and comparison consume one shared fact projector. Shop fields, recorded photo criteria and uncertainty are labeled separately. Brand/size duplication and repeated category ancestors are removed from the display without altering source observations. Original descriptions and selection notes remain available on demand. Search scope distinguishes candidates, stored details/descriptions, facts/descriptions delivered to the model, model-visible photos, widget photos and saved assessments; historical counts that were never recorded are shown as unknown.

Identical completed public observations are shared through durable claim/commit leases: search 15 seconds, details 5 seconds, facets and brand discovery 60 seconds. Source observation time is preserved. Explicit price/status validation bypasses this cache; uploaded references, private research, account data and mutations are excluded. Source pacing and Retry-After still govern every actual miss.

## No artificial cumulative cap

No fixed lifetime ceiling is imposed on pages, candidates, detail calls, image calls or saved searches. Every successful source page is committed before returning a response. Unreturned candidates remain in SQLite. Cursor replay is immutable and concurrent calls cannot consume the same frontier twice.

Individual calls are bounded: 35 seconds at the tool boundary, up to 30 seconds of search work, up to eight provider-page requests per search call, 200 returned candidates per page, 20 requested detail/image entries per batch, a roughly 1.25 MB internal candidate response budget, and a 6 MiB encoded image response budget. A reference upload is limited to 10 MiB per file. These are operational bounds with explicit continuation or file-specific errors. They are not cumulative research quotas.

Unusually large refinement evidence is projected with explicit `response_omissions`; an individually oversized candidate is returned as a traversable `detail_only_items` entry if needed. Full source observations, original photos and assessments remain retained. A large item cannot permanently block later candidates.

Sellpy may expose finite query windows, rate limits and changing inventory; Cloudflare has platform storage and execution limits. No implementation can promise physically unlimited catalog coverage. Native semantic recall and visual style quality have not been benchmarked against a labeled Sellpy corpus. The native services plus model visual inspection are a current practical architecture, not a claim of measured superiority over every retrieval system.

## Connect

Public service base: `https://sellpy-studio.lars-e82.workers.dev`.

`GET /health` reports service identity/version. `/mcp` requires a personal bearer token. For clients whose custom-server dialog supports only no authentication or OAuth, use the separately issued private capability URL ending `/personal/<token>/mcp` and choose No authentication in that dialog. That URL itself is the credential. Never publish it or put it in this repository. Only the SHA-256 token hash is stored in the Worker.

The public `plugin/` directory is a portable package template. It deliberately contains no private connection secret. Point its `mcp.json` at the privately configured endpoint, or add the private endpoint directly under ChatGPT Plugins → plus → Add custom MCP server. MCP instructions include the complete core workflow, so a direct custom MCP connection does not depend on the packaged skill being loaded.

An uploaded reference is sent to Sellpy and retained in the run's private SQLite storage to support later pages after its temporary file URL expires. Search state has no automatic expiry. This is a personal deployment: anyone with its capability credential shares its private search namespace. Public multi-user distribution would require separate account authentication and retention controls.

## Develop and verify

Node 24 or newer is used for the SQLite test harness. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run cf-typegen
npm run typecheck
npm test
npm run test:runtime
npm run build
npm run test:ui
```

For an authenticated remote release check, keep a private, ignored `artifacts/private/connection.json` containing `endpoint` and `token`, then run `node scripts/verify-live.mjs`. `SELLPY_CONNECTION_FILE` can point to another private credential file. The harness deliberately exercises default-size native requests, both protocol generations, immutable continuation, canonical photo enrichment and model/widget evidence separation. Its public JSON report excludes credentials and image bytes.

`node scripts/verify-upgrade.mjs` checks the added research tools using disposable runs and a dedicated technical profile, then clears those fixtures. It never overwrites the default preference profile or deletes pre-existing searches.

`node scripts/verify-scale.mjs` checks the 1.2 protocol/tool contract, implicit collection traversal, newer discoveries versus fixed membership, global shortlists, native URL/brand/image inputs and a matched initial-page baseline. It removes only its own disposable runs. The private `artifacts/private/scale-baseline.json` contains the pre-upgrade 12-item measurement; the report explicitly distinguishes initial useful-page latency from loading all twelve photographs.

The UI test needs Playwright and an installed Chromium. Set `SELLPY_UI_CHROMIUM_PATH` to an existing binary if needed. Optional `SELLPY_UI_PHOTO_PATH` supplies a real photograph for local visual inspection; the default deterministic fixture is sufficient for interaction assertions. Private test artifacts are ignored.

For deployment, create an independent Worker with the bindings and SQLite migration in `wrangler.jsonc`, set `PERSONAL_KEY_SHA256` as a secret, then deploy. Never reuse another plugin's token. Invocation URL logs and request traces are disabled for capability URL privacy. The application logs only compact event types, without input queries, file URLs or tokens.

## Design and evidence

- [Implementation plan](docs/implementation-plan.md)
- [Architecture and design decision](docs/architecture.md)
- [Observed Sellpy contracts and native live results](docs/provider-contracts.md)
- [Verification record](docs/verification.md)
- [Independent review](docs/independent-review.md)
- [Remote MCP verification](docs/live-verification.json)
- [Observed visual-assessment workflow](docs/live-visual-verification.json)
- [Gallery integration](ui/README.md)
- [Decision log](docs/decisions.tsv)
- [Version 1.1 implementation plan](docs/upgrade-plan.md)
- [Refinement design and limits](docs/refinement-design.md)
- [Matched provider performance evidence](docs/provider-performance.md)
- [Independent upgrade review](docs/review-upgrade.md)
- [Independent upgrade state review](docs/review-upgrade-state.md)
- [Version 1.1 deployment and ChatGPT verification](docs/upgrade-verification.md)
- [Version 1.1 live research workflows](docs/upgrade-live-verification.json)
- [Version 1.2 release verification](docs/scale-verification.md)
- [Version 1.2 independent review](docs/scale-review.md)
- [Version 1.2 scale plan and architecture comparison](docs/scale-plan.md)
- [Current Willhaben transfer research](docs/willhaben-transfer-research.md)
- [Native Sellpy and similar-project research](docs/sellpy-native-ecosystem-20261107.md)
- [Current MCP and scaling research](docs/mcp-scaling-design-20261107.md)

First-party integration references: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [ChatGPT connection flow](https://developers.openai.com/plugins/deploy/connect-chatgpt), [file inputs and UI metadata](https://developers.openai.com/plugins/reference), [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Cloudflare SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

### Version 1.1.1 follow-through

- [Release and actual ChatGPT acceptance](docs/followthrough-verification.md)
- [Independent response-contract and live-state review](docs/followthrough-review.md)
- [Five live server checks](docs/followthrough-live-verification.json)
- [Implementation plan and acceptance trail](docs/followthrough-plan.md)
