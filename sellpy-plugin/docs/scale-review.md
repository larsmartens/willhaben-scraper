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

Two related error paths were fixed before release. Explicit refresh now clears old summary counts and retains an unknown assessment status if its canonical follow-up fails; a delayed older page cannot clear that newer unknown state, and retry recovers it. The browser regression checks failure, old-page replay and recovery. Both new asynchronous image-start branches now use `return await` inside the error adapter; two actual Workers RPC regressions preserve the original structured error code, retryability and corrective action. The non-author reviewer independently passed 30 UI/data/presentation checks and six tool-flow Workers checks. No P1/P2 issue remains in the reviewed scope.

## Review boundary

The backend review confirmed principal/run scoping, collection membership checks, deletion tombstones, canonical refinement order and stable membership with honestly timestamped current facts. Ten collection regressions cover 10,001 **synthetic** provider observations through the actual ingestion path, owner reconstruction, concurrent feedback, large projections and signed cursor rejection. These are scale/invariant tests, not evidence of finding 10,001 actual Sellpy items.

An existing run's first upgrade performs a one-time scalar O(N) counter aggregate. Ordinary navigation then uses persisted counters and indexed seeks. Production timeout behavior for exceptionally large historical runs has not been established. An exceptionally large single legacy selection entry has an explicit conversion budget error, with the original retained; it is not silently discarded. Old delivery counts that were never recorded stay unknown.

Actual Sellpy service calls, exact artifact readback, installed-package version and real ChatGPT interactions are separate release gates. A simulated host, successful source compilation or reviewer approval alone does not establish those outcomes.
