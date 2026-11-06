# Continuation and recovery

## Search pages

Repeat `source`, `query`, `filters` and `pageSize`, then pass the returned `nextCursor`. For provided data, repeat the same `listings`. Field and image selection may change between calls. Start a new search when its scope or page size changes.

Deduplicate by listing ID across pages and variants. `returnedCount` describes this page and `total` carries the source's reported count. A null total means unknown. A short page can still have a continuation. A successful empty page ends that search.

## Detail batches

Repeat the original `source` and complete `ids` selection with `nextCursor`. Repeat `listings` for provided data. Use `remainingCount` and `failedIds` to identify pending work. A smaller `limit` changes the next batch size without discarding pending IDs.

The returned `results` remain valid when `errors` is nonempty. An unavailable listing is a current availability observation. Preserve the user's unresolved criteria for other candidates.

## Recoverable interruptions

Resume after `retryAt` when supplied. Preserve the failed ID or image index carried by the continuation. A timeout or shared upstream cooldown can interrupt a batch before its requested size.

Use `fresh=true` when current price or availability matters. Cache age and original observation time remain part of the evidence. Cached observations can be available during an upstream cooldown.

When an input error identifies allowed fields, correct that argument before repeating. For an invalid cursor, repeat its original search or ID selection, or start the changed selection from its first page.

## Filter discovery

Start with the compact dimension overview. Select `dimension` or `filter`, optionally with `valueQuery`, and page through `nextCursor`. Copy only values that explicitly identify a supported filter. A `searchText` suggestion belongs in the query. Resolve similarly named locations or categories using their labels and returned IDs.
