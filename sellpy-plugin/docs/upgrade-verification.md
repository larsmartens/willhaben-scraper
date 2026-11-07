# Sellpy Studio 1.1 — release verification

Verified on **7 November 2026**. Machine-readable timestamps are UTC. The existing personal ChatGPT connection now uses the deployed **1.1.0** server and **24 tools**. Eight research tools were added to the original 16. The original source and image-search paths remain supported.

## Released identity

| Artifact | Identity |
|---|---|
| Reviewed local production commit | `b28f0a6e4ee42ca5137d2a3268253630b2697962` |
| Published production commit | [`a4ba814f5245a1415fab5c499d9d7ef3013df292`](https://github.com/larsmartens/willhaben-scraper/commit/a4ba814f5245a1415fab5c499d9d7ef3013df292) |
| Exact production repository tree | `95c6e1e484de8ef8edaeade1966a565362b9a8cf` |
| Worker SHA-256 | `bd41185af3106312a9c6211e96a4bf5bcbfc1083a79f97f07751b8e960bb295a` |
| Worker size | 1,547,956 bytes |
| Gallery SHA-256 | `15c42277e38b1c2e20354a6dee2a4c253871d4863a2795d531c7ae49ca30b015` |
| Gallery size | 720,570 bytes |
| Deployment ID | `2fe97e62cf36486d89d7797a0e08e154` |
| Deployed at | `2026-11-07T00:29:31.782644Z` |
| Public health endpoint | <https://sellpy-studio.lars-e82.workers.dev/health> |
| Existing source PR | [#2](https://github.com/larsmartens/willhaben-scraper/pull/2), branch `feat/sellpy-plugin` |

The existing Durable Object namespaces, migration tag and private credential binding were preserved. Schema changes are additive. Invocation URL logging and request traces are disabled. Private credentials and user test-chat identifiers are not included in this public record.

Before publication, all 48 changed Git blobs were individually checked against the frozen local source. The complete remote tree—97 entries, including 84 files—matched exactly before the branch was moved with an expected-head lease and `force: false`. Subsequent documentation and test-harness commits do not alter the deployed Worker or gallery.

## Verification surfaces

| Surface | Observed result | Scope |
|---|---|---|
| Node behavior tests | **110 passed** | Provider normalization/failures, exact image identity, retrieval planning, refinement, durable state, source facets and presentation. |
| Actual Cloudflare Workers tests | **19 passed** | Durable Object RPC, persistence, tool schemas, annotations, private routing and MCP boundary. |
| Actual Chromium gallery scenarios | **33 passed**, independently rerun | Desktop/mobile layouts, photos, feedback, comparison, continuation, refresh, race handling and chat bridge. |
| Deployed general MCP harness | **29 checks passed** | Modern and legacy SDK sessions, all native retrieval routes, continuation, original photos and evidence separation. |
| Deployed upgrade harness | **7 workflows passed**, all eight new tools exercised | Preferences, feedback, refinement, actual history, refresh, deletion and fixture isolation. |
| Independent release review | **PASS** | Exact source and artifact identity; all five reproduced findings corrected. |
| Independent state review | **PASS+NOTES** | Real SQLite behavior on the reviewed base, including 650-item continuation, oversized evidence and deletion races. |
| Actual ChatGPT Chat mode | **Passed** | New refinement call, rendered original photographs, persisted shortlist, side-by-side comparison and message handoff followed by a completed comparison answer. |

The complete source/runtime/browser gates ran on the reviewed 1.1 base. The final two-file production successor fixes omission of `refresh_search.page_size` and adds a targeted actual Workers regression. An independent reviewer reproduced the old schema behavior, checked the corrected input boundary, reran the affected Workers behavior and rebuilt the exact final Worker. The state implementation and independently tested gallery artifact were unchanged. Both remote harnesses ran against the final deployed successor.

See [independent release review](review-upgrade.md), [state review](review-upgrade-state.md), [general live report](live-verification.json), [upgrade live report](upgrade-live-verification.json) and [deployment record](upgrade-deployment.json). A passed test establishes its stated behavior, not full-catalog retrieval quality or future availability of third-party services.

## Deployed research workflows

The upgrade harness used two newly created disposable runs and one dedicated technical profile. It read the default profile before and after the run, without changing it.

1. **Contract and named preferences.** The server reported 1.1.0 with all eight additions. A named profile persisted its ranking mode, currency, budget, reservation policy and handling of unknown requirements; explicit call preferences overrode the profile.
2. **Observed history.** A live 12-item catalog search supplied an actual baseline. Canonical refresh added real observations. An unknown item had no manufactured history, and repeated unchanged prices did not produce a fictitious price drop.
3. **Refinement and decisions.** EUR price ordering held across pages. Rejecting a candidate affected a new refinement; neutral feedback restored it. Previously published pages replayed identically. No visual assessments were fabricated by the harness.
4. **Gallery evidence separation.** Shortlist and rejection appeared on the cards without becoming photographic confirmation of any property.
5. **Fresh research with the same criteria.** Refresh retained the original page size and criteria, kept the old run, inherited explicit decisions and correctly separated previously encountered from newly encountered IDs. A newly encountered ID is not asserted to be newly listed by Sellpy.
6. **Scoped deletion.** Forgetting one owned run blocked subsequent state/history/refinement access, retained the other run and profile, and did not rewrite an already published refresh page. Repeat deletion was safe.
7. **Cleanup and isolation.** Both disposable runs were deleted and the technical profile cleared. The default profile was unchanged.

The harness runs from `scripts/verify-upgrade.mjs`. It completed from `00:29:32.849Z` to `00:29:57.653Z`. The final general harness completed from `01:12:04.414Z` to `01:13:13.016Z`; its modern SDK used protocol `2026-07-28`, and its legacy SDK used `2025-11-25`. Both observed 24 tools and the same owner namespace.

## Actual ChatGPT acceptance

After refreshing the existing connection's tools, a **new Chat-mode conversation** requested four current dresses on Sellpy AT under EUR 60, with no size filter. This was a technical interaction test rather than a style recommendation. It explicitly used `refine_search` with `use_profile: false` and ascending EUR prices.

The assistant refined 12 discovered candidates and rendered four original-photo cards with exact Sellpy links. The host visibly displayed the cards. Clicking **Merken** on one card showed both the selected state and the successful persistence message. Selecting two candidates and clicking **Vergleichen (2)** displayed their original photographs, prices, sizes, conditions, source categories and missing material information side by side.

Clicking **Im Chat besprechen** displayed the handoff acknowledgement and inserted the two exact item IDs plus the explicit shortlist decision into the same chat. The assistant then completed a fresh comparison. It distinguished a source-reported fading defect from a missing defect description, flagged contradictory length metadata, kept fiber composition and garment measurements unknown, and stated which photographs it could inspect. The follow-up gallery preserved the acknowledged shortlist.

The private setup guide contains the actual account-specific chat link. A screenshot of the comparison and successful handoff was retained for the user's handback. No private chat link or run ID is published here.

### Remaining package-label limitation

The existing custom-plugin shell still displayed **1.0.0**. Updating that shell's downloaded ZIP metadata to 1.1.0 stalled during the browser file upload and was aborted. The attempt was not repeated, and no successful ZIP replacement is claimed. This affects the displayed package label; the live server handshake, refreshed tool registry and actual new-tool Chat-mode workflow all established the working **1.1.0** implementation. Existing credentials and connection remain valid.

## Performance evidence

Five alternating matched A/B pairs measured the same three-item canonical-detail workload, with equivalent normalized outputs and zero errors or unprocessed IDs:

| Metric | Version 1.0 | Version 1.1 |
|---|---:|---:|
| Median elapsed time | 17,332 ms | 5,852 ms |
| Minimum–maximum | 14,774–20,606 ms | 5,779–10,406 ms |
| Source requests | 4 | 2 |
| Response bytes | 36,523 | 10,778 |

That is an observed **66.2% lower median** for this workload. These are direct Node-to-source measurements, not ChatGPT response times or production-edge latency percentiles. The measured provider source and bundle match the released implementation; the reviewer independently checked methodology, arithmetic and artifact identity, without claiming an independent repeat of the live latency experiment. Full samples and limitations are in [provider-performance.md](provider-performance.md).

The gallery's 137-card regression replaces **one** card for a single-photo update, retaining the other 136, where the previous implementation recreated all 137. This is a measured reduction in DOM work, not a 137-fold frame-rate claim. Detail refresh still retrieves fresh source data; optimization never relabels an old price as a new observation.

## Product and evidence boundaries

- Hard requirements, soft preferences, source facts, actual photographic assessments and user choices are separate. Missing or conflicting evidence stays **unknown**. Inferred visual style never overwrites Sellpy's original category or label.
- Refinement freezes the discovered cohort and user-feedback decisions, then evaluates candidates in bounded batches. Observations have their own timestamps; this is not one instantaneous full-catalog snapshot.
- Search continuation, refinement, feedback and saved research have no artificial cumulative item/page quota. Per-call resource budgets and upstream service windows still apply. Deferred candidates remain reachable, including explicit detail-only entries for oversized evidence.
- Diversity uses a disclosed metadata/feature heuristic. No independent image-embedding model, fine-tuned model, vector database or full-catalog index was added. Native visual retrieval plus actual model-visible photographs remains the implemented route.
- There is no measured full-Sellpy recall/NDCG benchmark, no numerical claim of SOTA superiority and no guarantee that all mislabeled items can be found.
- Refresh and price/status comparisons run when requested. Background monitoring, automatic alerts, checkout and purchasing were not introduced.
- This is a private personal deployment. A capability credential grants its holder the same personal namespace. Broad public distribution would need separate per-user authentication and retention controls.

The release is a completed functional upgrade with the above observed scope and one explicitly recorded package-label limitation.
