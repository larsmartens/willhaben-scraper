# Sellpy gallery integration

The gallery uses `App` from the official `@modelcontextprotocol/ext-apps` 2.0.4 package. It registers handlers before connecting and runs in a sandboxed MCP Apps iframe. It requires no direct browser access to Sellpy APIs, external JavaScript, fonts or separate frontend deployment.

## Server contract

The canonical resource is `ui://sellpy/gallery-v3.html` with MIME type `text/html;profile=mcp-app`. The previous v2 URI remains a compatibility alias. Only `present_items` declares the rendering resource. The current page, collection identity and research scope are in `_meta.gallery`; exact original photo data is in `_meta.images`. The model receives a smaller structured card projection.

`present_items({run_id})` opens every observed candidate without an explicit ID list. `source` can select one retrieval arm, a refinement or the shortlist. An explicit `selection` preserves intentional order and reasons. Collection membership/order is stable. Item facts are current stored observations with their own timestamps, not a fabricated point-in-time catalog snapshot.

| App operation | Tool and input | Returned identity |
|---|---|---|
| Page navigation | `browse_collection({run_id,collection_id,cursor,page_size,request_id})` | Same run/collection plus request identity and page range |
| Global view | `browse_collection({action:'derive',view:{kind},...})` | New derived collection with preparation progress or completed membership |
| Stored full details | `browse_collection({action:'details',item_id,...})` | `_meta.collection_detail` with run, collection, request and exact item |
| Research coverage | `browse_collection({action:'coverage',...})` | `_meta.collection_scope` with explicit scope counters |
| Visible cover | `get_item_images({run_id,item_id,start_index,batch_size:1,for_model:false,refresh_details:false})` | Exact item/image references and optional original raster bytes |
| Full photo sequence | `get_item_images({run_id,item_id,start_index,batch_size,for_model:false})` | Canonical photo enrichment, image identities and continuation |
| Explicit source refresh | `get_items({run_id,ids:[item_id],for_model:false})` | Current canonical item observation; source cache bypassed |
| User decision | `set_item_feedback({run_id,item_id,decision})` | Exact run/item, acknowledged decision and update time |
| Observed history | `get_item_history({run_id,item_id,after,page_size})` | Actual retained observations and continuation |

`browse_collection` is app-only. Navigation does not repeat the entire cohort through model context and does not automatically search Sellpy or refresh item details. A preparing response resumes bounded work until the view is ready. Refinement views preserve canonical refinement order without advancing the model's refinement cursor.

## Bounded browsing

Normal pages contain twelve cards, with a twenty-four-card option. The current page replaces the prior page. At most three page payloads, four comparison selections and 48 photo buffers within 12 MiB remain cached. Collection totals are not clipped by these memory/view budgets. Back/next navigation and all original photo indices remain reachable.

The initial result embeds at most two covers. An IntersectionObserver-driven queue requests visible covers with a maximum of four concurrent loads. Images use original pixels and `object-fit: contain`, without inferred crops or tinting. Unused buffers and DOM nodes are released as pages change. Card photo updates preserve unrelated nodes and scroll state.

Global shortlist, availability, assessed/unassessed and price-order controls derive views over the full collection, not only the loaded page. Scope and preparation labels identify the source cohort and observation interval. Source-order navigation remains available. Comparison intentionally limits the simultaneously displayed columns to four; users can replace those choices and continue across any number of collection pages.

## Structured facts and evidence

Cards, details and comparison consume the pure projector in `src/card-facts.ts`. It emits labeled fragments for source price, status, size and condition, with optional source materials, colors, category, measurements and defect notes. Exact repeated brand/size tokens and category ancestor paths are removed only from display. Canonical source observations remain unchanged.

Each recorded visual requirement has one criterion, verdict and evidence entry. Confirmed, contradicted and unknown are distinct. Conflicting or explicitly uncertain evidence remains unknown. Negated requirements are not merged with positive requirements. Legacy selection notes and source descriptions remain available on demand, without heuristic rewriting into new image claims. Large page projections carry explicit summary metadata; full details restore canonical content at the same observation version.

Research scope distinguishes discovered candidates, source pages/arms, stored detail observations, stored descriptions, facts/descriptions delivered to the model, model-visible photographs, widget-delivered photographs and saved assessments. Historical counters absent from older versions remain unknown. Neither widget display nor explicit shortlist feedback implies that the model inspected pixels.

Source price, size, size-system, availability, material, measurement, defect or checked-photo changes invalidate a saved assessment using the backend's shared validity rule. Newer identical facts preserve it. The UI retains exact image identity and never attributes a photo to another item.

Comparison uses current stored canonical values. Price totals are grouped by currency, with missing-price counts; no exchange rate or shipping charge is invented. History contains observations actually made within the search and does not imply access to Sellpy's earlier price history or a future discount schedule.

## Race and identity boundaries

Every asynchronous page/detail/photo response is checked against run, collection, presentation generation and request identity, as applicable. Photo responses must also match the exact requested image version. Same-run replacement is a new presentation generation. Obsolete responses cannot repopulate a replaced collection.

A full stored-detail projection with the same observation timestamp may enrich its corresponding compact page; it must not be discarded as an older source refresh or restore an assessment invalidated by changed facts. Feedback has a separate serial intent order per item, so an older success or failure cannot override the latest explicit toggle. Cached pages merge source freshness and feedback timestamps separately.

Only an explicit **Discuss in chat** action sends selected IDs to the conversation. It uses supported `App.updateModelContext` and `App.sendMessage` capabilities and includes exact run/item identities. Merely rendering, browsing, filtering or hydrating photos sends no chat message. Unsupported hosts retain the tools, source links and local comparison.

## Rendering and source boundaries

Original item links are restricted to supported Sellpy marketplaces. Original photo URLs are restricted to `prod.images.sellpy.net`, `images.sellpy.net`, and the verified Sellpy public S3 image hosts. Hydrated data accepts JPEG, PNG and WebP. Source text is untrusted display data. CSP permits no browser API connections or external scripts.

A failed photo preserves successful siblings and reports its retry state. Provider Retry-After is respected. A client without MCP Apps can use the exact per-item photo URL, original link and compact facts returned to the model; fallback is conditional on actual renderer absence.

These boundaries follow the [official OpenAI plugin UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui), [plugin reference](https://developers.openai.com/plugins/reference) and [official MCP Apps App API](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html). Installed package declarations were checked directly before web documentation.

## Build and verification

```sh
npm run typecheck
npm test
npm run test:runtime
npm run build
npm run test:ui
```

The browser harness bundles current source independently of generated release artifacts and simulates the MCP Apps host bridge. It tests initialization, page navigation, bounded DOM/cache behavior, independent observation/evidence/feedback state, source detail access, stale responses, photo continuation and explicit chat actions. Large synthetic cohorts test hundreds of pages without live Sellpy traffic. Exact final counts and outcomes belong in the 1.2 verification record; a planned assertion is not a passed test.

The harness requires Playwright and an installed Chromium. `SELLPY_UI_CHROMIUM_PATH` selects an existing binary. Optional `SELLPY_UI_PHOTO_PATH` supplies a real photograph for layout inspection; the default deterministic raster fixture is sufficient for interaction assertions. Private screenshots remain ignored. Simulated-host evidence does not replace a separately observed installed ChatGPT run.

Historical v2 evidence remains in the 1.1 release records: a photo update in a 137-card fixture changed one card node instead of replacing all 137. Version 1.2 additionally bounds the page's total DOM size, so that old accumulated-list fixture is no longer the current navigation design.
