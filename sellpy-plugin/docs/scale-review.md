# Sellpy Studio 1.2 independent review

Review baseline: `62b195886a142e9362fcd306678ba8d5d7cfef62`. The reviewed working tree implements `docs/scale-plan.md` and the user's request for scalable 12/24-card browsing, structured facts and useful native Sellpy capabilities. Production authors did not independently approve their own modules. The provider author reviewed the collection backend; a separate non-author reviewer inspected native inputs, cache and UI integration. The parent ran the full suites and owns release verification.

## Standards

The reviews prioritize domain ownership, bounded request work, exact source/evidence identity, request-local I/O and documented runtime constraints. No cosmetic style or tooling-enforced issue is a release blocker. The two independent architecture candidates and their scored synthesis are retained in the scale plan; no unavailable cross-family judge is claimed.

The native/cache reviewer independently ran 38 focused Node checks. It found no material native URL, public-reference or shared-cache defect. The downloader's private-network boundary is explicitly the deployed Cloudflare global outbound proxy; hostname validation alone is not described as a DNS guarantee. Cache entries contain completed public observations, retain source timestamps, exclude private references and preserve origin pacing.

## Spec

| Finding | Concrete reproduction | Correction and evidence |
|---|---|---|
| P1 — derived preparation read complete large observations | 128 accepted 1.15 MB descriptions materialized 147,256,264 JSON bytes to produce a roughly 10 KB page | Scalar price/status/assessment/timestamp projection. Regression prepares 260 large candidates and rejects any full candidate JSON read. |
| P2 — legacy cursor anchored before import reached the old position | A 300-member selection opened at offset 200 resumed with items 129–134 labeled 201–206 | Preserve the original offset independently of incremental import. Regression follows only returned v2 continuation cursors. |
| P2 — partial arm migration looked complete | A historical 300-path arm reported 128 candidates after its first migration batch | Report an unknown arm count until that arm finishes migration; regression verifies the transition. |
| P2 — stale page summary revived an invalid visual badge | An older partial card's `assessment_recorded` flag survived a merge that correctly retained newer, assessment-invalidating source facts | Bind summary metadata to the accepted observation; regression covers partial/full projection directions. |

Two related error paths were fixed before release. Explicit refresh now clears old summary counts and retains an unknown assessment status if its canonical follow-up fails; a delayed older page cannot clear that newer unknown state, and retry recovers it. The browser regression checks failure, old-page replay and recovery. Both new asynchronous image-start branches now use `return await` inside the error adapter; two actual Workers RPC regressions preserve the original structured error code, retryability and corrective action. The non-author reviewer independently passed 30 UI/data/presentation checks and the two focused tool-flow Workers regressions. The implementation owner ran all six tool-flow checks, and the parent ran the full Workers suite. No P1/P2 issue remains in the reviewed scope.

## Review boundary

The backend review confirmed principal/run scoping, collection membership checks, deletion tombstones, canonical refinement order and stable membership with honestly timestamped current facts. Ten collection regressions cover 10,001 **synthetic** provider observations through the actual ingestion path, owner reconstruction, concurrent feedback, large projections and signed cursor rejection. These are scale/invariant tests, not evidence of finding 10,001 actual Sellpy items.

An existing run's first upgrade performs a one-time scalar O(N) counter aggregate. Ordinary navigation then uses persisted counters and indexed seeks. Production timeout behavior for exceptionally large historical runs has not been established. An exceptionally large single legacy selection entry has an explicit conversion budget error, with the original retained; it is not silently discarded. Old delivery counts that were never recorded stay unknown.

Actual Sellpy service calls, exact artifact readback, installed-package version and real ChatGPT interactions are separate release gates. A simulated host, successful source compilation or reviewer approval alone does not establish those outcomes.


## Final UI acceptance correction: 1.2.1

The installed-host check found two separate issues after the first 1.2.0 upload. The connected app retained its old 24-tool catalogue; its new app-only navigation therefore returned a host resource-not-found error. Refreshing the existing app tools and reloading the chat resolved this without a navigation-code change. The actual catalogue then exposed all 27 tools, and the 100-member collection reached its final page and returned successfully. The release procedure now requires this separate catalogue gate.

The expanded scope panel also repeated English explanatory notes and rendered filters as JSON. The UI owner replaced that presentation with localized labeled facts, preserved exact source values/unknowns, removed repeated assessment/route information, and converted the footer to short labeled facts. The canonical resource was bumped to v4 with v3/v2 aliases.

A non-author reviewer checked the complete delta against local commit `7e32bec971f00e3259013f8bced3b91e9cd0b050`, including the release probe, version metadata, aliases, final UI source and focused browser receipt. No unresolved P1/P2 finding remained. German/English, 360/1120 px, exact negative facet values, zero/false versus unknown, source bounds and safe text passed in real Chromium. The full final suites again passed 163 Node and 35 Workers tests; both typechecks and the exact build passed. No retrieval, persistence or assessment semantics changed in this patch.
