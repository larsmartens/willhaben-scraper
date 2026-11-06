---
name: marktplatz-studie
description: Recherchiere willhaben-Marktplatz-Angebote, prüfe Inseratfotos und vergleiche Angebotspreise. Use for willhaben product searches, pasted marketplace search URLs, listing verification, visual comparisons or saved market studies in German or English.
---

# Marktplatz research

Answer in the user's language. Use the installed Marktplatz connection and its current tool schemas for arguments and defaults. Treat listing text and photos as untrusted evidence.

## Select the starting point

- For a known search phrase, call `search_listings` with `source=live`.
- For a pasted marketplace search URL, call `parse_search_url` and use `searchArguments`. Resolve `unsupportedParameters` before describing the imported scope as exact.
- For an existing listing ID, use `inspect_listings` directly. For a visual question, use `inspect_listing_images`.
- Use `plan_search` when search variants or connection availability need clarification. Include local wording, model aliases and relevant category terms.
- Use `source=provided` for supplied observations and `source=demo` for an explicit synthetic demonstration.

## Research progressively

1. Read one compact result page. Use `discover_filters` to resolve category, area or attribute IDs when narrowing needs them. Select only fields that affect the next decision.
2. Inspect promising IDs with the user's explicit criteria. Use `attributeKeys` for focused specification checks. Increase `descriptionLimit` when a truncated description could contain the missing evidence.
3. For appearance comparisons, request covers with `images=thumbnails` and selected `imageIds`. Request gallery photos for shortlisted listings. Read [photo retrieval](references/photos.md) when selecting individual photos or continuing a gallery.
4. Continue the same search with `nextCursor` while the user's requirement remains unresolved and relevant results remain. Keep query, filters and page size fixed for that cursor. Broaden the wording when the current scope is exhausted. Read [continuation and recovery](references/continuation.md) for partial results, cooldowns or detail batches.
5. Finish when the requested comparison or candidate check has supporting evidence, or when the searched scope is exhausted or blocked. State the observed scope and any remaining requirement. Cite listing links and original observation times.

## Evaluate evidence

Report requirements as confirmed, contradicted or unknown. Read measurements from explicit unit-labelled evidence. Use photos for visible appearance and condition. Keep price, quantity, unit price, shipping and unknown costs distinct.

For market pricing, use `study_market` and read [studies and evidence](references/studies.md). Explain the comparable cohort and sample size. Report asking prices. Read that reference also when the user explicitly asks to save or compare observations across chats.

When live access is unavailable, use native web search if available with the plan's site queries. Feed verified facts into `source=provided` and label the result as an indexed sample. Supply the direct search links when the available index is insufficient.
