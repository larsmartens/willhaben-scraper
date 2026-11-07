# Sellpy approaches in willhaben 1.5

The Sellpy development session demonstrated a useful follow-up workflow. Six discovered dresses were re-evaluated after long sleeves became mandatory. Three photo-confirmed candidates remained, and earlier label findings appeared in the updated gallery. The willhaben transfer supports the same progression for marketplace requirements. [Observed Sellpy conversation](https://chatgpt.com/c/6aef1828-87c4-83ed-8657-81031a9aaf31)

## Compared implementation

The willhaben baseline is `2c3f621eab6047bdae3f65f2e036d6044caf8764`, version 1.4.2. Sellpy is version 1.1.1 at local commit `62b195886a142e9362fcd306678ba8d5d7cfef62`. The relevant source files have matching Git blob hashes at remote commit `93f6a50a014321f642d991d6f5219b99158c4555`. [Sellpy source](https://github.com/larsmartens/willhaben-scraper/tree/93f6a50a014321f642d991d6f5219b99158c4555/sellpy-plugin)

| Area | Sellpy implementation | willhaben decision |
| --- | --- | --- |
| MCP transport | Official server and client 2.4.0, MCP Apps 2.0.4 | Use the existing matching libraries and Fetch handler |
| Types and validation | TypeScript, Zod 4.6.7, typed domain modules | Add pure requirement and refinement functions to the existing JavaScript and JSON Schema implementation |
| Persistent research | Research-owned SQLite candidates, assessments, feedback and evaluation jobs | Extend ResearchSession and its existing collections |
| Photo findings | Exact original-image identities and requirement verdicts | Bind successful model deliveries to canonical photo identities and a relevant-facts fingerprint |
| Follow-up selection | Required, avoided and preferred features, explicit unknown handling | Evaluate retained candidates in repeatable steps of at most 256 |
| User decisions | Shortlist, reject and neutral | Persist research-scoped feedback with identity-bound acknowledgements and revisions |
| Presentation | Comparison table, review badges and explicit chat handoff | Add cross-page comparison, compact evidence, feedback controls and a fullscreen return action |
| Image loading | Selected-page photo hydration | Use two initial covers and batches of four visible covers with targeted DOM updates |
| Testing | Node behavior tests, workerd and Chromium | Extend the existing matching-runtime suites with the concrete follow-up and comparison regressions |

Sellpy-specific clothing profiles and retrieval routes depend on its catalog and provider contract. The transfer centers on reusable research behavior. Marketplace preferences are scoped to the current research and the user's explicit decisions.

## Evidence and refinement share the research owner

The pure review module normalizes requirement labels, preserves negation and evaluates eligibility. SQLite stores model-delivered photo receipts, the latest judgment for each exact requirement, feedback revisions and refinement step responses. Free-form historical review text remains available in the audit. Structured eligibility uses saved requirement verdicts and their validated photo receipts.

A judgment identifies the exact original photos that support it. An accepted observation invalidates affected receipts and judgments when relevant facts or photo identities change. A later source reversion keeps those judgments stale until a new photo check supplies valid evidence. A delayed older judgment preserves the newer saved result.

A refinement fixes its cohort, criteria and feedback watermark at creation. Each bounded step evaluates the retained observations available at that step and keeps their original observation times. The completed ordered collection contains all eligible IDs. Repeated cursors return the stored response, including when requests overlap.

Using ResearchSession keeps owner isolation, inactivity expiry, audit records and collection navigation under one boundary. A separate refinement service would add ownership checks and cross-service failure cases. A full observation-version store would serve historical snapshots, while this workflow reports evaluation-time observations explicitly.

## The gallery hands off selected offers explicitly

Comparison selection survives page changes. Feedback acknowledgements must match the research and listing identity. A newer revision survives older page responses. The local comparison uses the selected cards' facts and current saved requirement evidence.

Detail responses use the same server-side card projection as the overview, including collection criteria, unit prices and shipping totals. The app replaces a card's facts with a newer complete observation. Missing current fields clear their previous values. Older detail responses retain the newer visible observation and its original timestamp.

The chat action sends exact research, collection and listing IDs after a user click. The optional model-context update precedes the message when the host supports it. The text message carries the IDs even if that optional update fails. Rendering and photo hydration stay local to the app.

## Agent instructions follow the implemented contracts

AXI shapes compact defaults, precise continuation, explicit counts and recoverable next actions. Card previews carry bounded requirement text and photo indices. Targeted research reads return complete saved evidence. Successful model-photo responses supply the identities needed by `record_review` and the current requirement labels.

Writing for Agents keeps the main skill focused on choosing the user's workflow. Its refinement reference handles stricter follow-ups, unknown policy and persisted feedback. The photo reference ends with recording actual findings and opening the resulting selection. The plugin packages that source-controlled skill with its implementation.

The pstack review uses independent GPT agents and actual Workers and browser behavior. The parent selected the research-owned architecture after the independent comparisons. The available review agents belong to the GPT model family.

## Verification

On 2026-11-07, the release checks passed 155 Node tests, six workerd and SQLite suites, and 40 Chromium behavior groups. The repository commands are `npm test`, `npm run test:runtime` and `npm run test:browser` with the configured Chromium executable.

The refinement suite checks 650 retained candidates, bounded steps, frozen feedback, cursor replay, strict photo requirements, unknown authenticity, older overlapping reviews and permanent evidence invalidation. The tool suite exercises the actual photo-to-review-to-refinement-to-gallery calls. It also covers three directly inspected lamp IDs with zero search queries, partial image success and a fully failed image batch.

An independent workerd reproduction evaluated 1,105 candidates in five steps and reached every result ID with zero provider requests during refinement. A retained-price filter produced 553 eligible and 552 excluded candidates. Independent checks also passed for concurrent cursor replay, exact and negated requirements, preservation of two photo findings, audience and owner binding, and price or original-photo changes.

The UI regression reproduces partially stale evidence. Before the correction, the card lost its still-valid finding and the comparison marked the confirmed green shade unknown. The corrected card keeps valid criteria visible alongside the stale warning and identifies the stale criterion separately. Additional browser cases verify cross-page selection, feedback identity and revisions, explicit chat handoff, delayed responses, fullscreen return, narrow screens and bounded image loading.

Independent review also reproduced a detail refresh that left outdated price, availability and quantity in the comparison. The Workers regression changes an offer from 120 euros and two pieces to a sold 75-euro offer with one piece. It checks current criteria, 10-euro shipping and the 85-euro total. A subsequent observation removes quantity and shipping fields so their derived values become unknown. Browser checks exercise the same complete-card contract and protect newer observations against older responses. Matching original-photo identities preserve the existing image element. A changed photo clears its previous gallery and discards in-flight responses for the old image.

The bundled skill passes frontmatter validation and all ten internal reference checks across its eight Markdown files.
