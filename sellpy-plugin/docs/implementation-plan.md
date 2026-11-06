# Sellpy plugin implementation

## Goal

Build a complete personal Sellpy plugin for ordinary ChatGPT chats. Search, style discovery, reference images, incorrectly described or categorized garments, detail inspection, and illustrated comparisons must work through bounded, repeatable calls without an artificial cumulative ceiling on pages, items, or photographs.

## Definition of done

- The deployed MCP endpoint is discoverable through the official MCP client and exposes strict input schemas.
- Ordinary AT/EUR and DE/EUR search, effective filters, independent follow-up pages, details, and all available image indices work against current Sellpy data.
- Native text, item-similarity, image-upload, and complementary-item routes are implemented only from observed contracts and are tested individually. Any unavailable route is reported precisely, never silently substituted or claimed to work.
- Style search combines independently traceable retrieval arms, includes category-relaxed attribute queries, deduplicates results, and continues without replaying completed work or losing unreturned records.
- Original catalog metadata is separate from assistant visual assessments, with checked image identities and uncertainty. An image URL does not count as a visual check.
- Every individually recommended item has its own original image or an explicit image failure state. Mobile gallery, details, and follow-up photos work through the MCP Apps contract and have a text fallback.
- Retries, upstream windows, deadlines, body budgets, stale items, and partial failures preserve honest continuation. There is no fixed total pages/details/photos ceiling.
- Source, a repeatable verification harness, exact evidence, and operating documentation are persisted in GitHub. Deployment and client installation are reported separately according to observed facts.

## pstack workflow checklist

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [x] Phase C: Run the loop.
- [x] Phase D: Keep the audit trail.
- [ ] Phase E: Verify and hand back.

The run uses figure-it-out plus autonomous-run discipline. The requested unit is one new plugin, not a standing multi-day orchestration program. Two independent architecture sketches compare stateful search runs with signed stateless cursors. Available agents are independent GPT agents; the prescribed Claude/Grok families are not exposed, so no cross-family verdict is claimed.

## Delivery units

1. Observe current Sellpy request contracts and choose typed domain and continuation boundaries. Capture a small public-data fixture with no credentials or public frontend keys committed.
2. Implement and verify the ordinary provider, public item details, images, market handling, and retry-aware pacing.
3. Implement native semantic/similarity/image retrieval and resumable multi-arm style search. Verify failure recovery and category-relaxed recall logic against fixtures and native examples.
4. Implement the official SDK MCP transport, strict schemas, progressive output, optional personal state, and illustrated MCP Apps gallery. Test through the real client and a simulated host browser.
5. Independently review behavior and reproduce material findings. Deploy an isolated personal Worker, verify exact source and live calls, persist source and evidence in a scoped PR, and install the Chat connection if the available interface permits it.

## Scope and throughput checkpoint

The initial estimate is approximately 12 to 16 focused tools, one provider, one search-state owner, one gallery, and four verification surfaces: domain contracts, Workers runtime, MCP client, and browser rendering. Separate ownership is used for provider contracts, domain/transport integration, and gallery implementation. Uncertain native upload semantics are the first dependency to resolve. Optional server-side embedding infrastructure is justified by a measured retrieval need; it is not a substitute for implementing native routes.

## Existing system grounding

Willhaben PR 1 at e377ee85aa911a689148ba220bc33f2d3203ff9d provides progressive search, image retrieval, coordinated pacing and a versioned MCP Apps gallery. Its request path authenticates a personal connection, invokes a typed tool contract, gathers provider observations, returns compact model-visible evidence and places presentation hydration in widget-only metadata. This informs user experience and operating behavior. Sellpy remains a separate package on a branch from main, so this work does not modify the in-flight Willhaben implementation.

Current release observations: the isolated `sellpy-studio` Worker is deployed at `https://sellpy-studio.lars-e82.workers.dev`. Official SDK v2 negotiates MCP 2026-07-28; SDK v1 negotiates 2025-11-25. Both authenticate and resume the same private search owner. The complete remote workflow passes; see the verification record. The available ChatGPT browser is signed out, so actual account installation and ChatGPT-hosted gallery rendering remain a distinct final handoff.

## Explicit boundaries

This plugin supports shopping research and comparison. It does not purchase or contact sellers. Per-request memory, time and upstream rate bounds are implementation requirements, not limits on the total user research. Original product text is untrusted data. No private user credentials or concrete personal capability URLs enter the source repository.

## Verification record

Append actual commands, revision, expected behavior and observed outcome in verification.md. Log material decisions in decisions.tsv. A proposed or fixture-only test is not evidence of a native route working live.
