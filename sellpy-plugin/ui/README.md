# Sellpy gallery integration

The gallery uses `App` from the official `@modelcontextprotocol/ext-apps` package. It registers result handlers before connecting and runs in a sandboxed MCP Apps iframe. It does not need direct browser fetch access to Sellpy APIs, external JavaScript, fonts or a frontend deployment.

## Server interface

`src/presentation.ts` exports:

- `PRESENTATION_URI`: `ui://sellpy/gallery-v2.html`. The versioned URI prevents a host from reusing the v1 UI resource after upgrading tools.
- `PRESENTATION_MIME`: `text/html;profile=mcp-app`.
- `PRESENTATION_RESOURCE_META`: UI border preference, exact permitted photo origins and supported display modes.
- `PRESENTATION_HTML`: the complete bundled HTML resource.
- `buildGallery({run_id, language, title, candidates, selection, next_cursor?, warnings?, feedback?})`: canonical items in selection order, with reasons, exact-item feedback and visual assessments kept separate. The optional feedback map is keyed by item ID and each record must independently match that ID.
- `galleryResult(gallery, images?)`: compact structured card facts for the assistant, full gallery data in `_meta.gallery`, and original raster data URLs in `_meta.images`, keyed by exact item image ID.

Only the `present_items` rendering tool should declare `_meta.ui.resourceUri`. The image, detail and rendering tools called by the widget must permit app visibility. The widget calls:

| Tool | Arguments | Required result |
| --- | --- | --- |
| `present_items` | `{run_id, cursor}` | Another result from `galleryResult`; the presentation cursor must not be a search cursor. |
| `get_item_images` | `{run_id, item_id, start_index, batch_size, for_model:false}` | `structuredContent` with `item_id`, exact `{id,index,url,status,error?}` image rows, `next_index`, and optional `remaining_indices`; `_meta.images` supplies raster data URLs. |
| `get_items` | `{run_id, ids:[item_id]}` | `structuredContent.items` containing canonical `ItemObservation` values. |
| `set_item_feedback` | `{run_id, item_id, decision:'shortlist'|'reject'|'neutral'}` | `structuredContent` with the exact `run_id`, `item_id` and `feedback:{item_id,decision,updated_at,reason?}`. Only a successful matching response updates the UI. |

Photo errors can include `error.message` and `error.retry_at` in an individual row or in the whole structured result. Successful photos remain visible when another photo fails. The retry button respects the provider's retry time. A blocked direct cover URL gets one automatic server hydration attempt; further attempts are explicit. Cover images load lazily, and detail photos load in small repeatable batches. There is no cumulative photo limit or selection-count truncation in presentation.

Original photo URLs are restricted to `prod.images.sellpy.net`, `images.sellpy.net`, `sellpy-parse-prod-files.s3.amazonaws.com` and `sellpy-parse-prod-files.s3.eu-west-1.amazonaws.com`. Hydrated data accepts JPEG, PNG and WebP only. An ambiguous image ID associated with different source URLs is never hydrated. The UI uses original pixels with `object-fit: contain`, without cropping or tinting.

Widget photo display is not evidence that the assistant inspected those pixels. An assessment is shown only when its item ID and checked image IDs match the current observations. Refresh uses the same validity rule as the backend: changed price, size, size system, availability, materials, measurements, defects or missing checked photos invalidate the assessment. A newer observation of identical facts preserves it. Source category, materials and descriptions remain visible separately. The tool text instructs clients without MCP Apps to render each recommended item's exact photo in Markdown, followed by its facts and listing link; compact structured cards contain the required original URLs.

## Selection, comparison and conversation

Each card exposes a persistent shortlist/reject toggle, a separate local comparison checkbox, and a visible checked-photo count or unexamined badge. A preference never becomes visual evidence. Filters operate only on already loaded cards and can show all, shortlisted, rejected, currently available or visually assessed items. The original observations remain accessible.

Comparison is computed locally from exact selected cards without another provider request. Its scrollable, keyboard-accessible table keeps source prices, sizes, materials, measurements and categories separate from assistant reasons, image-backed requirements and uncertainties. Missing measurements/materials and unchecked requirements are shown as unknown. Card details, comparison and ranking share exact normalized requirement consolidation: conflicting records or any explicit unknown stay unknown, including differences only in casing, whitespace or Unicode compatibility forms. Negated requirements remain distinct. It does not infer fit from a size label or fabric from an appearance. All selected cards remain reachable without a three-item or other cumulative comparison cap.

When the host advertises text-message support, an explicit **Discuss in chat** button sends the selected item IDs (or the loaded shortlist when no comparison is selected) to the current conversation. It first uses `App.updateModelContext` when supported, then `App.sendMessage`. The message also contains exact run/item identities so a rejected optional context update does not lose the selection. Merely displaying the gallery, loading images or changing its filter never sends chat messages or model context. Unsupported hosts keep the server tools, local comparison and source links without offering the chat action.

Photo hydration updates only the affected card or comparison header, preserving unrelated cards, image nodes and scroll state. Obsolete photo buffers are released when a presentation selection is replaced; source references stay reachable through the search ledger. Run and presentation-generation checks reject stale image, refresh, pagination and feedback responses. Overlapping appended pages merge source observations and feedback by their separate timestamps; older snapshots cannot undo an acknowledged shortlist or refresh, or restore evidence invalidated by newer source facts.

These choices follow the [official OpenAI plugin UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui), which recommends UI for inspection and comparison while keeping tools useful independently, and the [official MCP Apps App API](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html). The actual method signatures and capability flags were checked first against the installed `@modelcontextprotocol/ext-apps` 2.0.4 declarations. No undocumented browser globals or extra frontend framework are required.

## Build and verification

Run the UI build before the Worker build:

```sh
node scripts/build-ui.mjs
node --import tsx --test test/presentation.test.ts
node test/ui.browser.mjs
```

The browser test uses Playwright with a local simulated MCP Apps host. It covers the initialization handshake, mobile and desktop layouts, full photo continuation, partial failures, retry times, failed direct-cover recovery, price/status refresh, pagination, untrusted titles, dark mode, fullscreen, host-mediated links and stale request isolation. The v2 additions cover feedback failure/success and persistence, feedback-versus-evidence separation, a same-run late-feedback race, local filters, comparison identity/unknowns, conflicting and uncertain requirement records, unchanged and changed source refreshes, an overlapping-page race against successful feedback and refresh writes, keyboard scrolling, explicit context/message actions, host capability fallback, and a 137-card hydration regression. It needs an installed Chromium browser. If needed, set `SELLPY_UI_CHROMIUM_PATH` to an existing Chromium executable. Screenshots default to the ignored `artifacts/private/ui` directory; `SELLPY_UI_ARTIFACTS` changes that location. `SELLPY_UI_PHOTO_PATH` optionally supplies a real JPEG, PNG or WebP for layout inspection; otherwise a deterministic tiny raster fixture is used.

### Measured work reduction

On baseline revision `92ac6218496d4057626ddcc58621687c8dc9dcc3`, one next-photo batch in a 137-card fixture replaced **all 137** card DOM nodes. The v2 implementation replaces **one**, preserving the other **136**. The browser regression checks retained DOM identity, not a favorable wall-clock sample. This establishes removal of unnecessary per-card work; it is not a claim of a 137-fold end-to-end latency improvement. The original 18 scenarios remain in the expanded 33-scenario suite, with 13 presentation/data tests covering identity, explicit unknowns, evidence consistency, observation freshness and no cumulative comparison truncation.

The screenshot data consists of synthetic test listings and repeated fixture photographs. It is not a live product recommendation or a claim that the displayed fixture titles, prices and photographs describe real matching offers. The simulated-host tests do not replace installation and visual testing in the user's actual ChatGPT client.
