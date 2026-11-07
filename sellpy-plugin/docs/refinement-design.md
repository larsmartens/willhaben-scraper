# Evidence-aware refinement

## Observed gap and implemented behavior

The original retrieval ledger combines native search routes with reciprocal-rank
fusion. However, the include/exclude intent and later visual requirement verdicts
did not change that ranking. A highly fused short-sleeve dress could therefore
remain above a lower-ranked dress even after the former was explicitly assessed
as contradicting a long-sleeve requirement. The new refinement stage evaluates
the recorded candidates without issuing another provider request.

| Decision | Behavior |
|---|---|
| Required or avoided visual feature | Only an exact normalized requirement verdict in a current item-specific photo assessment supplies evidence. A title or source style label cannot confirm it. |
| Missing or contradictory evidence | Mark unknown. Keep the item unless the caller explicitly chooses to exclude unknowns. |
| Price, size, brand, material and measurements | Compare explicit source facts. Preserve currency and size systems; do not guess fit, composition percentages, measurement units or body circumference. |
| Source category error | A wrong source category does not defeat a visually confirmed garment requirement. Source metadata is preserved. |
| Explicit user feedback | Rejected items are hidden; shortlisted items receive a small preference bonus; neutral removes the feedback effect. A preference cannot override a failed hard constraint. |
| Diversity | MMR-style selection penalizes redundancy within a bounded leading window using metadata and recorded visual-feature overlap. This is not image-embedding similarity. |
| Continued research | A ranking window is not a total candidate cap. The store retains all candidates and is responsible for immutable snapshot pages and continuation. |

`evaluateCandidate` produces a pool-independent score and an evidence record for
one candidate, allowing the store to stream an arbitrarily growing ledger into
indexed SQLite rows. `rankCandidates` only diversifies the caller's explicit
leading window and may take a small previous-page context. It caches feature sets
and maintains each remaining item's maximum similarity to a selected item, so its
work is proportional to window size times output page size.

## Scoring semantics

The retrieval component is `rrf / (rrf + 1/61)`. The scaling is monotonic and does
not depend on the other candidates currently in memory. A soft preference
contributes at most ±0.2 in total; an explicit shortlist contributes +0.2. These
are transparent initial heuristics, not calibrated probabilities, measured
quality scores or learned weights. Verified hard requirements rank ahead of
unknown ones in the non-price modes. Unknown candidates remain available.

The price mode requires an explicit currency and uses `1 / (1 + price_major)` so
indexed descending scores produce ascending prices. It applies no preference or
diversity override to price order. Missing prices remain unknown; different
currencies are never silently compared or converted.

The default diversity parameter is 0.2 for balanced ranking, 0 for relevance and
0.45 for diverse ranking. These values are adjustable. Candidate similarity is
Jaccard overlap of explicit brand, color, material, type, garment attributes and
recorded matching features. Selection combines the base score with the maximum
overlap to already selected candidates. There is no hidden image model or extra
provider call.

## Query-plan correction

Identical route/query/filter requests no longer occupy multiple search arms.
With no category restriction, the same query in both the strict and relaxed
lists previously caused duplicate requests and two fusion votes. Deduplication
keeps the recovery marker but performs the request once. Distinct filters and
different native routes remain independent. The controlled repeated-query test
reduces four planned requests to two without losing a distinct request.

## Research basis and limits

- [Cormack, Clarke and Büttcher, SIGIR 2009](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf)
  motivates fusing heterogeneous ranks without comparing native score scales.
  The plugin already used RRF; refinement preserves it as the retrieval signal.
- [Goldstein and Carbonell, TIPSTER 1998](https://aclanthology.org/X98-1025/)
  describes trading query relevance against redundancy through marginal
  relevance. The implemented diversity step adapts this principle to explicit
  product attributes and a bounded presentation window.
- [Jung et al., SoFT, arXiv 2512.20781](https://arxiv.org/abs/2512.20781)
  separates desired and undesired constraints for composed-image retrieval.
  This supports making positive and negative intent explicit. The plugin does
  not reproduce SoFT's CLIP scoring or claim its published benchmark results;
  it consumes ChatGPT's recorded original-photo evidence.

The behavior tests cover counterexamples, not real-catalog recall. The local CPU
probe in `scripts/benchmark-refinement.mjs` uses synthetic observations and no
network access. A measured retrieval-quality claim still requires a suitable
labeled Sellpy cohort, user judgments and a comparison protocol.

## Durable state and response boundaries

A refinement freezes the discovered cohort's maximum sequence and copies explicit feedback at creation. It processes at most 256 candidate rows per call, storing the full normalized source attributes and original photo references needed for later evaluation. An observation is captured when its row is processed; its original observation timestamp remains visible. This is not an atomic snapshot of all source inventory.

Defaults inherit the verified market currency even when a candidate has no price. Native source facets become hard constraints only when every effective retrieval arm applies the same complete OR set. Deliberate category/style relaxation remains intact. Positive values use exact native OR semantics; leading-minus values exclude exact labels; a normalized field that lacks lossless source evidence remains unknown. Explicit `source_facets` overrides these defaults. Garment and style intents create exact visual criteria `Garment type: …` and `Style: …`.

Response receipts are immutable. Feedback changes, new source observations and additional photo assessments affect a new refinement, not published pages. Large duplicate evidence is omitted only from a response projection and identified through `response_omissions`; source snapshots and assessments remain complete. If one item still exceeds the per-page budget, `detail_only_items` exposes its ID, evaluated eligibility and score, and advances the cursor so subsequent items remain reachable. Original details and photos remain accessible separately. Large echoed preferences and excluded-example evidence are likewise explicitly omitted when necessary to keep the entire receipt bounded.

A legacy search's already observed baseline is backfilled lazily before its first history read or source refresh. No observations before that known timestamp are invented. Deletion clears a run and retained reference files and leaves a tombstone that prevents late work from resurrecting it.
