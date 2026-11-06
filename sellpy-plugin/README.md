# Sellpy Studio

A remote MCP plugin for ordinary and visual Sellpy shopping research in ChatGPT. It combines Sellpy's native catalog, semantic, item-similarity, product-image, uploaded-image and outfit services with durable search progress and an illustrated MCP Apps gallery.

The implementation is independent of the in-flight Willhaben plugin. Default market is Austria, language German. Prices use the selected market's currency and integer minor units internally.

## User workflows

| Request | Behavior |
|---|---|
| “Leinenkleider, Größe M, bis 40 Euro” | Discover real facets, catalog search, current detail checks, illustrated shortlist. |
| “Cottagecore, auch falsch beschriftete Angebote” | Multiple native semantic and catalog arms, some without category or garment-name constraints; rank fusion, then actual image inspection. |
| “So wie dieses Bild, aber lange Ärmel” | Native uploaded-image retrieval plus semantic attribute searches; verify sleeves on original candidate photographs. |
| “Mehr wie dieser Artikel” | Native item similarity with exact seed identity and optional category relaxation. |
| “Was passt zu diesem Rock?” | Native complementary recommendations; the source's finite window is stated explicitly. |
| “Zeig die weiteren Fotos / such weiter” | Continue photo or search pages without a cumulative plugin count cap. |
| “Speichere diese Suche” | Private durable bookmark, criteria, observations, provenance and continuation. |

## Tools

There are 16 focused tools: `get_capabilities`, `discover_filters`, `search_items`, `search_style`, `find_similar`, `search_by_image`, `find_outfit`, `continue_search`, `get_search_status`, `list_search_items`, `get_items`, `get_item_images`, `record_visual_assessment`, `present_items`, `save_search`, `list_saved_searches`.

The official MCP SDK v2 serves modern and legacy streamable HTTP. The official MCP Apps bridge provides a self-contained gallery. Compact structured cards also support illustrated Markdown in clients without an MCP Apps renderer. Model-visible image content and widget-only image hydration remain separate; only the former authorizes recorded visual evidence.

## No artificial cumulative cap

No fixed lifetime ceiling is imposed on pages, candidates, detail calls, image calls or saved searches. Every successful source page is committed before returning a response. Unreturned candidates remain in SQLite. Cursor replay is immutable and concurrent calls cannot consume the same frontier twice.

Individual calls are bounded: 35 seconds at the tool boundary, up to 30 seconds of search work, up to eight provider-page requests per search call, 200 returned candidates per page, 20 requested detail/image entries per batch, a roughly 1.25 MB internal candidate response budget, and a 6 MiB encoded image response budget. A reference upload is limited to 10 MiB per file. These are operational bounds with explicit continuation or file-specific errors. They are not cumulative research quotas.

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

The UI test needs Playwright and an installed Chromium. Set `SELLPY_UI_CHROMIUM_PATH` to an existing binary if needed. Optional `SELLPY_UI_PHOTO_PATH` supplies a real photograph for local visual inspection; the default deterministic fixture is sufficient for interaction assertions. Private test artifacts are ignored.

For deployment, create an independent Worker with the bindings and SQLite migration in `wrangler.jsonc`, set `PERSONAL_KEY_SHA256` as a secret, then deploy. Never reuse another plugin's token. Invocation URL logs and request traces are disabled for capability URL privacy. The application logs only compact event types, without input queries, file URLs or tokens.

## Design and evidence

- [Implementation plan](docs/implementation-plan.md)
- [Architecture and design decision](docs/architecture.md)
- [Observed Sellpy contracts and native live results](docs/provider-contracts.md)
- [Verification record](docs/verification.md)
- [Independent review](docs/independent-review.md)
- [Gallery integration](ui/README.md)
- [Decision log](docs/decisions.tsv)

First-party integration references: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [ChatGPT connection flow](https://developers.openai.com/plugins/deploy/connect-chatgpt), [file inputs and UI metadata](https://developers.openai.com/plugins/reference), [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Cloudflare SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
