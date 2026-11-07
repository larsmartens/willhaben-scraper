# Studies and evidence

Use `study_market` when the user needs deduplication across search variants, criterion checks or comparable asking-price cohorts. Choose explicit `queries`, `filters` and `criteria`. `maxPages` is the shared budget across all variants in that call. `maxDetails` controls detail work within the same call.

Read `coverage.queries` before describing search coverage. Each continuation points to `search_listings` and produces a separate observation. `remainingDetailIds` supports further selected detail checks. Saved reports describe the batch that produced them.

For a broader aggregate, collect the relevant pages, deduplicate the observations and analyze a supplied dataset with `source=provided`. Include each ID once and preserve its source link. Describe the supplied sample's observation period separately from the calculation time.

Use explicit attributes with units for requirements, such as `diameterMm=60`. Keep the evidence source with each claim. Unknown quantity, model, condition or shipping cost stays unknown in the comparison.

A comparable price cohort requires the same category, model, condition and known item basis. Report the sample size and returned median. `priceContext` expresses an offer's position within that observed cohort. Describe disappeared listings as availability changes and verify completed sales separately when needed.

## Saved observations

Use `save_study` when the user explicitly requests saving or later comparison. The response provides an expiry and a secret capability ID. Keep the ID private. Use `get_study` to read the original report and `compare_studies` to compare two saved observations.

Report changed search definitions, incomplete coverage and changes in cohort membership alongside price changes. The `fresh` option changes retrieval policy while preserving the semantic search definition.
