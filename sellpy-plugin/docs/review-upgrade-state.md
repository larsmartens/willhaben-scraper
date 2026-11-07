# Independent Sellpy Studio 1.1 state review

## Verdict: PASS+NOTES

This state-management lane independently verified candidate `ab81ce075205dae3da8a30604fe17e2995c47e56` against its direct parent `92ac6218496d4057626ddcc58621687c8dc9dcc3`. No unresolved defect remained in the exercised storage, refinement, feedback, history, or deletion behavior.

The reviewer did not author or modify production code. The reviewer wrote `test/research.test.ts`, reproduced failures before their fixes, and reran the affected behavior after the implementation author corrected it. This is an independent GPT-agent review, without a claim of different model families or formal verification.

The verdict covers the source and actual SQLite executions described below. Workers RPC, the deployed endpoint, and the ChatGPT gallery are separate evidence lanes; a Node SQLite pass does not establish their behavior.

## Exact revision and execution evidence

| Evidence | Observed result |
|---|---|
| Direct parent | `92ac6218496d4057626ddcc58621687c8dc9dcc3` |
| Reviewed head | `ab81ce075205dae3da8a30604fe17e2995c47e56` |
| Reviewed repository tree | `2c6702b0f4219d19f73729aebc5659f70f6db56e` |
| Existing Worker bundle SHA-256, independently read | `91ebd6188d02b3ea73c8f6f3f2619646fb18f3553c740f7441a0aecf472add48` |
| Parent behavior | `node --import tsx --test test/search.test.ts`, run from an isolated archive of the parent: **16 passed**, exit 0, approximately 1.23 seconds |
| Exact-head behavior | `node --import tsx --test test/search.test.ts test/research.test.ts`: **32 passed**, exit 0, approximately 3.83 seconds |

The parent archive was isolated from the current working files and used the installed dependencies. It was removed after the run. The existing 16 search tests were exercised on both revisions; the 16 new research tests exercise capabilities absent from the parent. Production and tests were frozen during the final run. An unrelated untracked release-verification script was present and was not part of this lane's execution.

The Worker hash identifies the observed release artifact; this lane did not independently rebuild or deploy it. Runtime test results reported by the author are not counted as this reviewer's independent execution.

## Scope and verified behavior

The review read `research-store.ts`, `observations.ts`, changes to `search-store.ts` and `search-run.ts`, and the relevant tool/schema integration. The evaluator and evidence boundaries were inspected where they determine saved refinement results. Tests use real `node:sqlite` databases, SQL transactions with rollback, persistence through reopening, and controlled provider promises.

| User-facing behavior | Distinguishing execution |
|---|---|
| Continue through large discovered sets | A 650-item cohort starts with exactly 256 evaluated candidates, continues through bounded scans, and eventually returns every eligible ID once. |
| Keep a stable cohort | An item discovered after refinement creation is absent from that refinement and present in a new one. |
| Replay results reliably | Repeated continuation calls return deeply identical saved receipts. Later source observations, feedback changes, and evidence invalidation do not rewrite published pages. |
| Preserve price order | All 650 results remain globally ascending by their exact source price in price mode. |
| Apply explicit decisions consistently | Feedback is captured when the refinement starts. A later rejection or neutral decision affects a new refinement, not later pages of the old one. Inherited decisions do not overwrite newer explicit choices. |
| Keep unknown distinct from failure | Confirmed, contradicted, and unknown visual requirements produce distinct outcomes. Strict unknown exclusion removes only candidates lacking required confirmation. |
| Preserve item-specific photo evidence | An assessment based on the second original photo remains valid after snapshot projection. All three photo identities remain present, including when the source category is misleading. |
| Invalidate stale evidence | Replacing the assessed canonical photo invalidates new eligibility while the original receipt remains unchanged. |
| Preserve deferred diversity candidates | A 321-item diversity refinement returns every candidate once and leaves original discovery pages and their counters unchanged. |
| Respect response bounds without losing IDs | Ordinary byte-budget pagination, explicit duplicate-evidence omission, detail-only entries, and large metadata omission all preserve continuation and canonical data. Complete tested receipts stay at or below 1,250,000 bytes. |
| Persist preferences and decisions | Profiles survive database reopening; identical writes retain their timestamps; independent stores remain separate. Paginated feedback reaches every stored decision. |
| Report observed history | Accepted source observations retain their actual timestamps and prices. Unchanged values may coalesce, stale updates are ignored, and unknown items do not acquire invented history. |
| Preserve existing data during upgrade | A legacy candidate without rows in the new history table retains its previously observed baseline before its first changed observation is stored. |
| Delete retained research conclusively | Deletion during both an in-flight provider request and a pending reference-image digest prevents the late work from recreating candidates, references, feedback, jobs, or history. The tombstone prevents reuse of the deleted run. |

The unchanged search suite additionally checks source-page draining, more than 200 successive pages, lease recovery, concurrent duplicate continuation, full Retry-After handling, malformed/future/cross-run cursors, fusion, reference persistence, and immutable presentation selections.

## Reproduced defects and corrections

### Legacy history lost an already observed baseline

The first review version created the new history table but did not seed it from an existing candidate before replacement. In a valid legacy run, a stored EUR 20.00 observation followed by a fresh EUR 14.00 observation produced a correct change response but history containing only EUR 14.00. The former observation disappeared from its only stored location.

The permanent regression recreates that upgrade state and expects both actual observations with their original timestamps. The author added `ensureHistoryBaseline`, invoked before replacement and for legacy history reads. The regression failed before this change and passed afterward and at the frozen head.

### A valid large assessment blocked all later refinement candidates

A public-schema-valid request containing 180 distinct long requirements and confirmed photo evidence fit the MCP request limit. Repeating that evidence in both the candidate assessment and its evaluation made the first ranked response exceed the item budget. `item_response_too_large` rolled back scan progress and the next-step counter, so the same refinement could not reach a second ordinary candidate.

The author replaced that permanent failure with an explicit response projection. Duplicate evaluation evidence can be omitted with a field, count, and retention descriptor; the complete assessment and original photos remain intact in the reproduced case. A still-oversized item is exposed through `detail_only_items`, with its ID, actual eligibility, score, and separate-inspection instruction, while continuation advances. Large echoed preferences and excluded-example evidence also have explicit omission descriptors. Full canonical records and saved evaluation data remain retained.

Three focused regressions prove the correction: the original validated 180-requirement case reaches both IDs and preserves the full assessment; a candidate with 1,000 long original photo references remains explicitly reachable without blocking an ordinary candidate; and 250 large criteria still produce the correct failed/unknown decisions when their echoed metadata is omitted. All three also check complete response size and immutable replay.

## Notes and limits

- The snapshot fixes the discovered cohort and explicit feedback. Candidate observations are captured as the bounded scan evaluates them; it is not a claim of one catalog-wide instant in time. New evidence or criteria require a new refinement.
- Diversity is a disclosed heuristic over stored metadata and observed features. These tests do not establish image-embedding similarity, full-catalog recall, or a numerical SOTA advantage.
- The tests establish no cumulative loss for the exercised continuation paths. Per-call resource bounds and upstream service windows remain real. An explicit detail-only entry is a returned item identity requiring separate evidence retrieval, not a silently discarded result.
- Independent local stores are checked here. Authentication and per-principal Durable Object routing require the separate runtime lane; the review does not substitute local database isolation for an authorization test.
- The reviewer observed the author's plain-object feedback serialization correction in source. Actual Workers RPC serialization is covered by the runtime lane, not inferred from these Node executions.
- This verdict is tied to the reviewed production revision. A later production change requires a scoped behavioral recheck. A report-only addition does not alter the source behavior exercised here.
