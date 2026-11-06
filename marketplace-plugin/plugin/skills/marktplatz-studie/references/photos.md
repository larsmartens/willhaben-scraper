# Photo retrieval

Use image content from the search or gallery tools when assessing visible features. `present_listings` sends its selected photos directly to the presentation component. Read [presenting offers](presentation.md) when assembling the final recommendation.

## Compare search covers

Use the existing search arguments and `images=thumbnails`. Select observed IDs through `imageIds` to inspect specific candidates from that page. Use `imageLimit` for the first available covers. These selectors are alternatives.

Search covers reuse the search observation and require only image downloads. `images=links` returns `coverImage` metadata. An actual MCP image block provides visual evidence. `imageContentIndex` identifies its content-array position after the text block.

## Inspect a gallery

Call `inspect_listing_images` with the observed numeric listing ID. Use `indices` for precise zero-based positions, or `start` and `count` for a range. Continue with `nextIndex`. For an interrupted explicit selection, repeat the returned `remainingIndices`.

Choose `size=thumbnail` for a visual shortlist and `size=full` for closer examination. The returned `size` identifies the available variant. A missing native thumbnail can produce a full-size fallback.

Choose `mode=links` when only gallery URLs are needed. `galleryTotal` counts available references and `galleryComplete` indicates whether the source supplied an authoritative gallery. Preserve partial-gallery uncertainty when that flag is false.

If `stopReason=response_budget`, continue from the returned position. If one image is too large, request its thumbnail or link. If a response contains `retryAt`, resume at that time. Successful image results remain usable when later images fail.

Read numerical dimensions from listing attributes or explicit text. Keep inferred appearance and documented specifications distinct in the answer.
