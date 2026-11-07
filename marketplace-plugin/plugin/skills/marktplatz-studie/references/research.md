# Research coverage

The first authenticated data call returns `researchId`. Reuse it for this task's searches, details, photos and presentation. Parallel variants can share that ID after the first call. Separate tasks receive separate IDs.

Use the automatically returned summary for routine reporting. It contains each query's native total and retrieved pages, the deduplicated observed listing count, delivered descriptions and photos, app images and recorded findings. Expand `get_research` with `section=queries` for all query rows or `section=listings` for precise evidence. Follow its `nextCursor` while additional records are needed.

For specific offers, use `section=listings` with their `ids`. This returns the full saved requirements, exact photo identities and feedback for those offers. Follow a compact card's `fullReview` arguments when its truncation flags indicate omitted evidence.

For each query, show the phrase or visual reference, filters, native total, unique retrieved IDs and its detail/photo counts. The same listing can belong to several queries. Use the global unique counts for overall coverage.

An individual record identifies delivered fields, description character counts and truncation, exact zero-based photo indices and recorded findings. `detailRecordsRetrieved` records server retrieval. `detailRecordsDeliveredToModel` and `descriptionsDeliveredToModel` identify content returned to ChatGPT. `uniqueModelPhotoIndices` counts delivered photos. App images have their own counters. `record_review` records your actual findings after receiving the corresponding image blocks and labels them agent-reported.

Describe these observations with their recorded scope. A delivered image establishes available visual input. A documented finding establishes what you reported inspecting. Use `end` and the query's completeness indicators when describing exhaustion. A changing reported total can require a fresh search before claiming a complete snapshot.

Research metadata, collections and compact live-offer observations expire after seven days of inactivity. These observations retain listing facts, observed photo links and their original `observedAt` beyond the short search cache. Use that time when presenting a retained offer. The result supplies `expiresAt`, and access renews retention. Start a new research after expiry. Saved studies have their own explicit 24-hour workflow.
