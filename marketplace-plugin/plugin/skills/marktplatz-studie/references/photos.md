# Photo retrieval

Use image content from the search or gallery tools when assessing visible features. `present_listings` sends its selected photos directly to the presentation component. Read [presenting offers](presentation.md) when assembling the final recommendation.

## Compare search covers

Use the existing search arguments and `images=thumbnails`. Select observed IDs through `imageIds` to inspect specific candidates from that page. Use `imageLimit` for the first available covers. These selectors are alternatives.

Search covers reuse the search observation and require only image downloads. `images=links` returns `coverImage` metadata. An actual MCP image block provides visual evidence. `imageContentIndex` identifies its content-array position after the text block.

## Inspect a gallery

Call `inspect_listing_images` with the observed numeric listing ID and the task's `researchId`. Use `indices` for precise zero-based positions, or `start` and `count` for a range. Continue with `nextIndex`. For an interrupted explicit selection, repeat the returned `remainingIndices`.

Choose `size=thumbnail` for a visual shortlist and `size=full` for closer examination. The returned `size` identifies the available variant. A missing native thumbnail can produce a full-size fallback.

Choose `mode=links` when only gallery URLs are needed. `galleryTotal` counts available references and `galleryComplete` indicates whether the source supplied an authoritative gallery. Preserve partial-gallery uncertainty when that flag is false.

If `stopReason=response_budget`, continue from the returned position. If one image is too large, request its thumbnail or link. If a response contains `retryAt`, resume at that time. Successful image results remain usable when later images fail.

## Save findings for later decisions

After inspecting the successful image blocks, copy the matching `reviewContexts` entry into `record_review`. Carry its `researchId`, listing `id` and `evidenceId`. Set `photoIds` and `photoIndices` from the entry's `photos`. These identities refer to the actual delivered original photos.

Record a concise `findings` summary and `requirements` with the exact requirement label, `verdict` and concrete `evidence`. Use `confirmed`, `contradicted` or `unknown` according to the visible evidence. Copy applicable labels from the photo context or the current refinement. Preserve negations when matching labels. A new judgment updates that requirement and retains independent valid findings.

Use the successfully delivered photos from the current batch. Fetch another view when the requirement remains unresolved. If the context names `inspect_listing_images` as its next tool, retrieve current photos before saving structured requirements. A changed original photo or relevant listing fact makes the earlier evidence stale.

After saving the findings, start a new `refine_research` when the selection depends on them. Present the completed collection so its cards carry the stored findings. For a direct comparison, present the selected IDs again after recording the evidence. Read [refining a selection](refinement.md) for strict follow-up criteria.

Read numerical dimensions from listing attributes or explicit text. Keep inferred appearance and documented specifications distinct in the answer.
