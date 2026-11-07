# Sellpy Studio 1.1.1 independent follow-through review

Reviewed on 7 November 2026 by a non-author agent. The last artifact check was at 12:18 UTC. Production files were read and executed, not edited by the reviewer.

## Verdict

**PASS for the scoped response contract and evidence boundary. No blocking production finding.** The independent baseline/candidate runs establish that the new handoff is present, retains exact identities and requirements, and cannot manufacture a visual assessment.

**Actual ChatGPT follow-through remains an acceptance gate.** A tool response can request a saved assessment; these deterministic tests cannot establish that a future assistant will follow that request. The release owner must observe original-image inspection, a successful assessment write, and the resulting gallery/refinement on the deployed revision. No agent-reliability percentage is claimed.

## Revision and artifacts

- Baseline production: `e60d0afa608841032050c2c9d4893375286b9778`.
- Tests-first commit: `e4f9cc8e1aecb143b561b437e8a2e86efc59e65f`.
- Reviewed production was the frozen working-tree patch over that baseline in `src/tools.ts`, `src/refinement.ts`, `src/presentation.ts`, `ui/gallery.ts` and `ui/comparison.ts`, with the UI/package version set to 1.1.1.
- SHA-256 of `git diff e60d0af -- src/tools.ts src/refinement.ts src/presentation.ts ui/gallery.ts ui/comparison.ts`, executed from the package directory: `efd1011f9e818dc877b558ce22501b0d56e7e68c88da301f1dee9a31e13f85c4`.

| Built artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist/worker.js` | 1,549,780 | `395520fc8be0b8dfe812b14fd6be24e672f57a77c97158e5b0065ef30461b1d0` |
| `ui/generated/gallery.html` | 720,764 | `ce19b2c74c33e6a8755ce51deb729988beb686d1947e2d351effc687587b3bdc` |

The reviewer independently read both artifacts and verified their byte counts and hashes. Compiled German/English labels and the extended chat prompt are present. JavaScript character escapes were decoded for the string comparison; the initial literal umlaut check did not match the expected esbuild escape. That check did not identify a product defect.

## Independent behavioral evidence

The reviewer created an isolated detached baseline worktree, copied the current regression tests into it, and used the existing dependency installation. It was removed after the counterfactual runs. The shared production working tree was not reset or modified.

| Command, relative to `sellpy-plugin` | Revision | Observed result |
| --- | --- | --- |
| `node --import tsx --test --test-name-pattern 'mixed visual selection\|catalog-only selection\|fully assessed selection' test/presentation.test.ts` | Baseline plus current regression tests | 3 failures: missing `visual_review` |
| `npm run test:runtime -- test/assessment-flow.runtime.ts` | Baseline plus current regression tests | 3 failures: missing `assessment_context`; widget isolation passed |
| `node --import tsx --test test/presentation.test.ts test/refinement.test.ts` | Candidate | 35 passed |
| `npm run test:runtime -- test/assessment-flow.runtime.ts test/research.runtime.ts` | Candidate | 11 passed |
| `npm run typecheck` | Candidate | Backend and UI passed |
| `node --check scripts/verify-followthrough.mjs` | Candidate | Passed |
| `git diff --check` | Candidate | Passed |

The Workers runs use real `invokeTool`, image loading and Durable Object storage/RPC with controlled HTTP image responses. They are not a live Sellpy or model-vision accuracy test. Expected negative-path RPC errors appeared in the runtime output and were asserted successfully.

## What was verified

1. Model image context includes only successful image IDs from the current batch. Previously delivered IDs, failed images and unrequested images do not enter that context. Delivery alone leaves the candidate assessment absent and strict visual requirements unknown.
2. Widget-only hydration returns no model image blocks or assessment context. Attempting to record that widget image is rejected by the actual evidence guard.
3. Failed-only model delivery requests another image attempt and retains unknown evidence. It does not ask the model to record an empty assessment or mark an item assessed.
4. `searchIntentRequirements()` preserves the prior criterion labels, priorities and ordering. The image context says `search_intent_only`. Profiles still merge with intent criteria, and explicit `preferences.requirements` still replace that merged list.
5. Gallery handoff identifies the selected cards that lack a current saved assessment. Hydration, a confident free-text selection reason and shortlist feedback cannot create evidence. Ordinary catalog/price selections remain usable, and a fully assessed selection has no outstanding recording action.
6. The German and English negative labels accurately describe missing saved evidence. The chat prompt asks to retain findings without exposing tool names in the product flow. Positive evidence semantics are unchanged.

## Live harness and review limits

`scripts/verify-followthrough.mjs` was inspected and syntax-checked. It checks the deployed version/resource, widget/model separation, same-batch context, absence of invented assessments, and explicit requirement replacement. It creates one disposable run, disables profile use for the refinement, writes no profile or visual assessment, and attempts to delete only that owned run in `finally`. Its public report redacts the private endpoint/token. The reviewer did not run this harness before deployment.

The patch adds one status RPC for a model-directed image batch. That status operation also computes coverage. No performance improvement is claimed for this additional read, and this review does not substitute a benchmark for the scoped behavior checks.

The release owner reported that the local Playwright browser binary was unavailable and its standard installer returned invalid/truncated archives. No fresh local browser regression pass is credited. Built-resource checks and typechecking do not establish rendered interaction behavior; the planned deployed ChatGPT gallery/comparison check remains necessary.

The scoped comment audit found no added production comments or suppressions: zero deletion requests, zero `MUST KILL` flags. Existing comments and unrelated 1.1.0 features were outside this patch review.

This verdict covers code behavior at the artifact identities above. It does not establish deployment, PR merge readiness, a forge landing, or completion of the separately blocked plugin-package upload.

## Post-deployment consistency check

At 12:34 UTC on 7 November 2026, the same non-author reviewer performed a bounded, read-only follow-up. **PASS for the reported deployed workflow and release consistency.** This section updates the pre-deployment acceptance status above.

The actual connected capability tool returned version 1.1.1. Independent `get_search_status` and `list_search_items` calls returned the complete six-candidate cohort and six saved assistant assessments. Every assessment matched its item ID and retained concrete evidence and uncertainties. The exact requirement `Lange Ärmel` had three confirmed and three contradicted verdicts, with no unknown verdict. Checked-photo counts were 3, 2, 4, 2, 2 and 2.

The retained release-owner checkpoint shows the same strict requirement with `unknown_policy: exclude` before and after the host interaction: initially zero eligible candidates and six unknowns; afterward three eligible, three excluded and zero unknowns. The reviewer checked that all three returned criterion records cite `visual_assessment`, and that their item identities exactly match the independently read live confirmed records. The checkpoint also preserves the earlier two saved assessments with two checked photographs each. This follow-up made no assessment, refinement or preference writes.

All five checks in `followthrough-live-verification.json` passed, including deletion of its disposable run. Local production commit `0ce03efd768d1d14694f0e351851568ca64c0009` and the GitHub commit object `bac593a917479ce12b569d5af5872dec1263b3db` independently resolve to tree `cd6fa52cc8b61739b83c1d308e57c402f8e3a007`. Both local artifact hashes remain identical to the reviewed values above. The release owner's direct Worker readback reports that same Worker hash for deployment `b97064d032b84a4482fc7134237ae2e4` at 12:21:10 UTC.

The verification document's then-pending criterion paragraph can now record the observed before/after result. The release owner owns the actual ChatGPT UI interaction and final gallery screenshot; the reviewer independently established the persisted state and its agreement with the retained refinement. This is one observed host workflow. It does not establish statistical reliability, independent visual-label accuracy, full-catalog recall, a new local browser-suite pass, a PR merge or completion of the blocked metadata upload. Private run IDs, chat URLs and screenshots are deliberately absent from this report.
