# Sellpy Studio 1.1 implementation plan

## Goal and done predicate

Make the installed Chat-mode plugin better at finding useful clothing, applying the user's actual constraints, comparing candidates and continuing research, while reducing repeated work. Done means the deployed reviewed artifact passes source and runtime regressions, a repeatable live MCP workflow exercises the new state and ranking tools, and the gallery's new interactions work in a real browser host. Performance claims require matched baseline/candidate observations with equivalent successful work.

Baseline local revision is `92ac6218496d4057626ddcc58621687c8dc9dcc3`. The corresponding remote revision is `0f870b0373ded434e602f2e7e6c7d3d19395c2a5`. Their repository trees match. Existing credentials, saved research and the installed plugin connection must continue to work.

## pstack checklist

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [x] Phase C: Run the loop.
- [x] Phase D: Keep the audit trail.
- [x] Phase E: Verify and hand back.

The earlier pstack mode continues. Model the Domain changes the design to explicit tri-state constraints and separate user feedback, source observations and assistant evidence. Explain the Number requires repeated matched successful requests and a deterministic work-count regression for gallery updates. Prove It Works requires the deployed MCP endpoint and actual gallery interactions, not compilation alone. Available independent workers are GPT agents; no unavailable model family is claimed.

## Grounding

The existing provider normalizes Sellpy's native catalog, semantic, item/image similarity and outfit routes. Each durable SearchRun owns an exact SQLite candidate ledger, source offsets and immutable continuation receipts. Tool adapters expose compact model facts and separate image pixels from widget hydration. The official MCP Apps gallery consumes the latter through the host bridge.

Observed gaps are concrete. Stored include/exclude requirements and recorded visual contradictions currently do not affect server ranking. Canonical detail retrieval waits for independent Algolia and GraphQL requests sequentially. Stateless tool adapters recreate providers, losing their plain-data configuration cache. Updating one photo currently recreates every visible card. The product has no persistent feedback, comparison view or reusable preference profiles.

## Delivery units and ownership

1. **Evidence-aware refinement.** A pure evaluator distinguishes confirmed, contradicted and unknown hard requirements, soft preferences and explicit user shortlist/reject decisions. A durable refinement snapshot processes every discovered candidate through bounded calls and preserves deferred results. Weighted rank fusion remains retrieval evidence; diversity uses disclosed metadata/features, not invented image embeddings.
2. **Research state.** Named reusable preference profiles, per-run feedback, observed item-change history, explicit fresh validation and restarting a saved search with fresh inventory. Add deliberate deletion of a run and retained reference files. No background monitoring or external notifications are enabled by this implementation.
3. **Useful gallery.** Persistent shortlist/reject controls, side-by-side comparison, visible evidence status, exact item identity and targeted card updates. Context/message integration is capability-gated and follows an explicit click.
4. **Provider performance.** Parallel independent detail sources, selected Algolia fields, request-scoped reuse for overlapping native search arms, and shared parsed configuration data. Fresh detail validation bypasses search memoization.
5. **Verification and release.** Behavioral counterexamples, no-cumulative-cap continuation, actual Workers RPC, modern/legacy MCP, browser interaction, independent review and deployment on the existing private endpoint.

The root owns domain types, state, MCP tools, integration and release. Retrieval, provider and gallery writers own disjoint modules. The independent reviewer receives the exact integrated revision and does not author production changes.

## Architecture alternatives and synthesis

**Recompute every page from live state.** Small initial code, but changing feedback or newly discovered items can move page boundaries, duplicate or skip candidates, and repeat expensive evaluation. Loading the complete ledger into memory also contradicts the no-cumulative-cap goal.

**Persist a refinement snapshot.** Fix the cohort at the maximum discovered sequence, stream candidate evaluation into indexed SQLite rows and keep immutable response receipts. Bound work and the diversity window per call, retain unreturned candidates, and start a new snapshot when criteria or feedback change. This adds state but isolates pagination from concurrent discovery and keeps memory bounded. This is the chosen design, following the retrieval worker's pure-function proposal and the root's state-boundary analysis.

## Throughput and evidence checkpoint

The scope is approximately three independently implemented subsystems plus one integration/state subsystem, eight new focused tools, and the existing four verification surfaces. Current dependencies and protocol versions are retained. No new vector database, hosted model, full-catalog crawl or paid external API is introduced without measured retrieval evidence justifying it. The three-item provider baseline and 137-card gallery scenario are captured before their changes.

Source latency is variable. Report five alternating matched samples per side with median, range, request count, errors and semantic output equivalence. Separate direct-source timings from deployed end-to-end observations. Ranking tests demonstrate specific ordering and constraint properties; they are not a measured claim of SOTA superiority on the full Sellpy catalog.

## Release conditions

All existing source search routes and continuation contracts remain supported. Existing data is migrated additively. Original source metadata is never overwritten by user feedback or model interpretation. Unknown fit/material facts stay unknown. Every new state-changing tool has correct MCP annotations and owner isolation. Independent review must resolve material findings before deployment. The public source and private setup record must describe the observed release accurately.

## Completed release

Version 1.1.0 was deployed on 7 November 2026 with the existing connection and state namespaces preserved. Independent release and state reviews passed for their documented scopes. All source/runtime/browser gates and both live harnesses passed; a new ChatGPT Chat-mode workflow exercised refinement, saved feedback, comparison and the explicit chat bridge. The existing plugin shell still shows its older 1.0.0 package label after an optional metadata-upload attempt stalled and was aborted; the connected server identifies as 1.1.0 and exposes all 24 tools. This cosmetic limitation does not claim an unobserved package update. The exact source, artifact identities, measured performance and acceptance evidence are in [upgrade-verification.md](upgrade-verification.md).
