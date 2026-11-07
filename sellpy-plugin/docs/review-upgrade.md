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
`0f870b0373ded434e602f2e7e6c7d3d19395c2a5`. Final approval applies only after the
integration owner supplies and the reviewer checks the frozen candidate.

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
| Provider, refinement, planning, presentation and source-facet tests | 69 passed, zero failures. |
| Original R3/R4 counterexamples through actual Workers RPC | 2 passed after the fixes; each previously failed against the earlier candidate. |
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

Focused scope verdict: **PASS after the five corrections**, subject to the final
frozen revision/build matching this reviewed implementation. This is not a
deployment, host-installation or full-catalog quality verdict.

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
