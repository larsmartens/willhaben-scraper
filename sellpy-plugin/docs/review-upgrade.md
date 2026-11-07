# Independent review — Sellpy Studio 1.1

## Scope and independence

This review was performed by a separate GPT reviewer who did not author or edit
the production implementation. It covers the provider changes, retrieval-plan
deduplication, evidence-aware refinement semantics and the gallery's new
feedback/comparison interactions. A second independent reviewer covers durable
SQLite snapshots, history, pagination and deletion. No cross-model-family review
or independent repetition of the live latency experiment is claimed.

The comparison baseline is local revision
`92ac6218496d4057626ddcc58621687c8dc9dcc3`, with the same tree as published revision
`0f870b0373ded434e602f2e7e6c7d3d19395c2a5`.

## Final frozen candidate

**Final independent verdict: PASS for the reviewed scope.** No unresolved
blocking finding remains in the provider, planning, refinement semantics or
gallery changes examined here. The final identity check was performed on
7 November 2026 against:

| Artifact | Exact identity |
|---|---|
| Candidate commit | `b28f0a6e4ee42ca5137d2a3268253630b2697962` |
| Candidate Git tree | `95c6e1e484de8ef8edaeade1966a565362b9a8cf` |
| Worker bundle SHA-256 | `bd41185af3106312a9c6211e96a4bf5bcbfc1083a79f97f07751b8e960bb295a` |
| Worker bundle size | 1,547,956 bytes |
| Gallery HTML SHA-256 | `15c42277e38b1c2e20354a6dee2a4c253871d4863a2795d531c7ae49ca30b015` |

The reviewer confirmed the commit/tree and absence of tracked implementation
changes, then independently rebuilt the Worker in memory with the release
settings. Its hash matched the existing bundle exactly. The gallery hash is
identical to the artifact that passed the independent 33-scenario browser run;
the provider runtime still matches the measured benchmark artifact.

The base reviewed candidate, `ab81ce075205dae3da8a30604fe17e2995c47e56`
(tree `2c6702b0f4219d19f73729aebc5659f70f6db56e`), passed the reviewer's repeat
execution of the 69 focused source tests, the two original Workers RPC
counterexamples, and all three real Workers MCP boundary tests. The latter
include the final non-idempotent annotation for creation of a refinement, the
24-tool schema and the gallery resource. The narrow successor was reviewed as
described below; the unchanged browser artifact retains its exact identity.

### Live-gate correction: omitted refresh page size

The integration owner's live test discovered that `refresh_search({run_id})`
replaced the original page size with 50. The shared page-size schema contained a
nested Zod default, which still applied inside its optional wrapper. Commit
`b28f0a6e4ee42ca5137d2a3268253630b2697962` changes only that input to a standalone
optional bounded integer and adds an actual Workers regression before the
existing explicit-override assertion.

The reviewer independently reproduced the old schema returning 50 for omission
and verified the corrected schema leaves the field absent. Explicit values
1, 7 and 200 remain valid; null, zero, negative, fractional, oversized and string
inputs remain invalid. The targeted actual Workers test passed: omission retains
the original stored page size, and an explicit 7 still overrides it. No broader
suite was repeated for this two-file delta. An independent in-memory rebuild
matched the successor Worker hash/size above. **Narrow-delta verdict: PASS.**

This record identifies the reviewed candidate; adding this review record or
other release documentation afterwards does not change the approved runtime
artifact. Production deployment, installation and live-host acceptance remain
the integration owner's separate gates. The separate state review is recorded
in [review-upgrade-state.md](review-upgrade-state.md).

## Counterexamples found during review

The initial focused suite passed 65 tests, but independent probes still exposed
the following behavioral defects. The probes used actual Workers RPC for tool
integration and real Chromium with a local MCP Apps host for gallery behavior.

| Finding | Reproduction and consequence | Required correction |
|---|---|---|
| R1: stale visual evidence after refresh | A checked cotton item changed from available at EUR 24 to reserved at EUR 21 with material Polyester and unchanged photo IDs. The gallery retained its checked badge and green cotton confirmation although the server invalidated that assessment. | Reuse the server's assessment-validity rule before replacing the gallery observation. |
| R2: contradictory requirement displayed as confirmed | Two valid records for the same long-sleeve requirement, one confirmed and one contradicted, correctly evaluated as unknown but the comparison displayed the first green confirmation. | Share normalized requirement resolution across ranking, comparison and card details; preserve explicit unknowns and conflicts. |
| R3: original hard source facets lost during refinement | An M/Cotton search initially stored a matching item. Fresh canonical details changed it to L/Polyester. A refinement with no explicit replacement preferences returned eligibility `pass`, with only availability/currency evidence. | Retain exact nonrelaxed source constraints, including positive OR and negative semantics, while preserving intentional category/style recovery. |
| R4: missing first price prevented otherwise valid refinement | An AT search with a EUR 30 budget had a first item with a missing current price and a second available EUR 20 item. Currency defaulting from the first item caused `currency_required` instead of a usable ranking. | Default currency from the verified market registry, with no inferred FX conversion; preserve explicit overrides. |
| R5: late appended page reverted acknowledged feedback | A held next-page response contained an overlapping card with older neutral feedback. After a successful shortlist write, resolving that response reset the displayed button to neutral while persisted feedback remained shortlist. | Merge overlapping cards by observation and feedback freshness, retaining assessment validity against the chosen observation. |

All five counterexamples were independently rerun successfully after correction.
R1 clears the checked badge and stale comparison claim; R2 displays conflicts as
unknown; R3 retains the original size/material constraints; R4 evaluates the
available EUR item despite the first missing price; R5 keeps both the displayed
and stored shortlist after the older appended response. The explicit style
intent now also becomes a recorded-photo criterion, independent of source tags.

A separate suspected pending-feedback race was disproved. The reviewer held an
old response, replaced the gallery within the same run, started another held
write and then completed the old response. Generation-scoped pending keys kept
the current button disabled and only the current write changed the selection.

## Independently executed validation

| Check | Result |
|---|---|
| Provider, refinement, planning, presentation and source-facet tests | 69 passed, zero failures; repeated on the base reviewed commit `ab81ce0`. |
| Original R3/R4 counterexamples through actual Workers RPC | 2 passed on `ab81ce0`; each previously failed against the earlier candidate. |
| Actual Workers MCP boundary tests | 3 passed on `ab81ce0`, including final annotations and gallery resource. |
| Omitted refresh page-size regression | Targeted actual Workers test passed on successor `b28f0a6`; original size and explicit override both verified. |
| Full gallery suite in Chromium using the real photo fixture | 33 scenarios passed, zero page errors. |
| Original R1/R2/R5 private counterexamples | Corrected outcomes independently observed; assertions for stale evidence and append feedback passed. |
| Pending-feedback generation isolation probe | Passed; suspected defect disproved. |
| Provider benchmark arithmetic and current artifact identity | Passed; see the scope below. |

The browser suite covers mobile and desktop layouts, dark mode, original image
containment, image-ID preservation, rate-limit retries, partial image failures,
14-photo reachability, failed and successful fresh details, continuation,
untrusted text, cross-run and same-run generations, feedback persistence,
comparison unknowns, and an explicit user-triggered chat bridge. It also proves
the targeted update replaces one card in a 137-card gallery, versus all 137 in
the previous full-render path. This is a deterministic DOM work count, not a
claimed frame-rate or end-to-end latency improvement.

The independently tested gallery HTML SHA-256 is:

`15c42277e38b1c2e20354a6dee2a4c253871d4863a2795d531c7ae49ca30b015`

Focused scope verdict: **PASS after the five corrections**, with the frozen
revision/build identity verified above. This is not a deployment,
host-installation or full-catalog quality verdict.

## Provider and planning assessment

The changed provider behavior passed independent execution of the focused source
tests. Review checked fresh detail calls bypassing the request-local item memo,
market/language isolation, exact ordered object identity validation, filter
reapplication, source observation timestamps, bounded two-source concurrency,
explicit partial failures, cancellation and cooldown preservation.

The deduplication identity includes route, query, seeds/reference, canonicalized
filters and sort. It removes duplicate retrieval votes while retaining distinct
requests and the category-recovery marker. There is no newly imposed cumulative
result cap.

The latency harness was inspected and its recorded arithmetic was independently
recomputed: all five alternating paired records are retained, successful normalized
outputs have matching hashes within each pair, HTTP status/error/request/byte
totals agree, and median/minimum/maximum values match the retained samples.

The current provider was independently rebuilt using the harness's bundle
settings. Its SHA-256 matched the measured candidate exactly:

`01416068f5e6a45bfdcfb6aad000cf2e31bccd5e91b8fcdf187ab06262469d21`

The provider source SHA-256 also matched:

`21ffe5721383788ffad894dd3e538c6dc546d55d29db323b867f01e676005f44`

The reported median improvement from 17,332 ms to 5,852 ms is supported for that
three-item, direct Node-to-source workload. It includes configuration reuse,
concurrent independent detail requests and selected catalog fields. It is not a
ChatGPT latency measurement, deployed-edge percentile, broad catalog retrieval
benchmark or general guarantee. See [the benchmark methodology and retained
samples](provider-performance.md).

## Limits of the review

The local browser host exercises the official Apps SDK protocol and real DOM
behavior, but is not the production ChatGPT host. Installation, connected-tool
refresh and deployed live workflows belong to the integration owner's release
verification. The reviewer did not access private connection credentials.

Behavioral tests demonstrate the stated constraint, identity, error and
continuation properties. They do not establish recall or ranking superiority on
the full Sellpy catalog. Metadata diversity remains a disclosed heuristic rather
than image-embedding similarity, and actual visual judgments still require
model-visible original photographs.
