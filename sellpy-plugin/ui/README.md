# Sellpy gallery integration

The gallery uses `App` from the official `@modelcontextprotocol/ext-apps` package. It registers result handlers before connecting and runs in a sandboxed MCP Apps iframe. It does not need direct browser fetch access to Sellpy APIs, external JavaScript, fonts or a frontend deployment.

## Server interface

`src/presentation.ts` exports:

- `PRESENTATION_URI`: `ui://sellpy/gallery-v1.html`.
- `PRESENTATION_MIME`: `text/html;profile=mcp-app`.
- `PRESENTATION_RESOURCE_META`: UI border preference, exact permitted photo origins and supported display modes.
- `PRESENTATION_HTML`: the complete bundled HTML resource.
- `buildGallery({run_id, language, title, candidates, selection, next_cursor?, warnings?})`: canonical items in selection order, with reasons and visual assessments kept separate.
- `galleryResult(gallery, images?)`: compact structured card facts for the assistant, full gallery data in `_meta.gallery`, and original raster data URLs in `_meta.images`, keyed by exact item image ID.

Only the `present_items` rendering tool should declare `_meta.ui.resourceUri`. The image, detail and rendering tools called by the widget must permit app visibility. The widget calls:

| Tool | Arguments | Required result |
| --- | --- | --- |
| `present_items` | `{run_id, cursor}` | Another result from `galleryResult`; the presentation cursor must not be a search cursor. |
| `get_item_images` | `{run_id, item_id, start_index, batch_size, for_model:false}` | `structuredContent` with `item_id`, exact `{id,index,url,status,error?}` image rows, `next_index`, and optional `remaining_indices`; `_meta.images` supplies raster data URLs. |
| `get_items` | `{run_id, ids:[item_id]}` | `structuredContent.items` containing canonical `ItemObservation` values. |

Photo errors can include `error.message` and `error.retry_at` in an individual row or in the whole structured result. Successful photos remain visible when another photo fails. The retry button respects the provider's retry time. A blocked direct cover URL gets one automatic server hydration attempt; further attempts are explicit. Cover images load lazily, and detail photos load in small repeatable batches. There is no cumulative photo limit or selection-count truncation in presentation.

Original photo URLs are restricted to `prod.images.sellpy.net`, `images.sellpy.net`, `sellpy-parse-prod-files.s3.amazonaws.com` and `sellpy-parse-prod-files.s3.eu-west-1.amazonaws.com`. Hydrated data accepts JPEG, PNG and WebP only. An ambiguous image ID associated with different source URLs is never hydrated. The UI uses original pixels with `object-fit: contain`, without cropping or tinting.

Widget photo display is not evidence that the assistant inspected those pixels. An assessment is shown only when its item ID and checked image IDs match the current observations. Source category, materials and descriptions remain visible separately. The tool text instructs clients without MCP Apps to render each recommended item's exact photo in Markdown, followed by its facts and listing link; compact structured cards contain the required original URLs.

## Build and verification

Run the UI build before the Worker build:

```sh
node scripts/build-ui.mjs
node --import tsx --test test/presentation.test.ts
node test/ui.browser.mjs
```

The browser test uses Playwright with a local simulated MCP Apps host. It covers the initialization handshake, mobile and desktop layouts, full photo continuation, partial failures, retry times, failed direct-cover recovery, price/status refresh, pagination, untrusted titles, dark mode, fullscreen, host-mediated links and stale request isolation. It needs an installed Chromium browser. If needed, set `SELLPY_UI_CHROMIUM_PATH` to an existing Chromium executable. Screenshots default to the ignored `artifacts/private/ui` directory; `SELLPY_UI_ARTIFACTS` changes that location. `SELLPY_UI_PHOTO_PATH` optionally supplies a real JPEG, PNG or WebP for layout inspection; otherwise a deterministic tiny raster fixture is used.

The screenshot data consists of synthetic test listings and repeated fixture photographs. It is not a live product recommendation or a claim that the displayed fixture titles, prices and photographs describe real matching offers. The simulated-host tests do not replace installation and visual testing in the user's actual ChatGPT client.
