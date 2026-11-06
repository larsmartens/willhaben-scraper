# Verification record

This is an appendable evidence record. Fixture, native-source, Workers, MCP-client and live ChatGPT checks are distinct.

## Implementation checkpoint, 2026-11-06

| Surface | Command or action | Observed result |
|---|---|---|
| Type integration | `npm run typecheck` | Passed against generated Workers runtime types. |
| Pure/domain/provider/presentation | `npm test` | 45 tests passed. Includes 205 source pages, exact deduplication, immutable replay, stalled source offsets, retry times, over-budget draining, price units, native upload contracts and privacy allowlists. |
| Real Workers | `npm run test:runtime` | Initial 7 tests passed; a subsequent real RPC-field probe passed as the fifth SearchRun test. Full final count is recorded below when rerun. |
| Build | `npm run build` | Bundled the official MCP Apps UI and official SDK v2 Worker. |
| Browser | `SELLPY_UI_CHROMIUM_PATH=<installed Chromium> SELLPY_UI_PHOTO_PATH=<local JPEG> node test/ui.browser.mjs` | 17 scenarios passed in a simulated MCP Apps host at 360/390/1120 px. Screenshots were visually inspected. |
| Native Sellpy | Implemented provider called catalog, semantic, seed similarity, source image, multipart upload, outfit and two-alias detail query | All succeeded; sanitized IDs, offsets and contracts are recorded in provider-contracts.md. |

The native upload test used a public Sellpy JPEG as its reference and proved distinct results at offsets 0 and 2. No private personal reference image was used for that test. The browser fixtures use synthetic listing data and are not recommendations.

## Release evidence

### Exact reviewed and deployed source

- Local production revision: `65db1e76c29b4b35dea55966aabfc6a7655ce960`.
- Production `src/` tree: `e6c795d3954b6bc64f7550c2eae920b0aba63636`.
- Worker SHA-256: `d5146c95a952aa58d015a055a6748eaf22fd19d2bdafeb001ef1564a86b38a89`.
- Gallery SHA-256: `561134938bd1f205adfe5a3cf5e43288df0314fa775ab64643bbaad5eb8fe9f3`.
- Worker base: `https://sellpy-studio.lars-e82.workers.dev`.
- Cloudflare deployment: `9a4d81431a5d4d81b35368d7d253eeb9`.
- Cloudflare upload ETag: `2c43088d6394778c4bdc77aaf698b544e87e298ac91833c5581b21d622189584`.
- Independent source verdict: **PASS+NOTES**, including focused follow-ups for canonical photo enrichment and regional stale-asset recovery. See independent-review.md.

The reviewed bundle was compressed for transport, decompressed in the deployment
tool and SHA-256 checked before upload. No secret or personal capability URL is
included in this repository. The public MCP path rejects unauthenticated calls.

### Final verification surfaces

| Surface | Observed result |
|---|---|
| Type integration | `npm run typecheck` passed for server and browser UI. |
| Node/domain/provider/presentation | `npm test`: **52 passed**, including three regional asset-recovery regressions. |
| Workers runtime | Independent complete suite on photo-enriched revision: **12 passed across 3 files**. The later config-only delta has a separate independent **18/18 provider** recheck and deployed verification. |
| Browser component | **18 scenarios** passed at mobile and desktop sizes in real Chromium with a simulated official MCP Apps host, including same-run selection races. |
| Modern remote MCP | Official client 2.4.0 explicitly enables version negotiation; negotiated **2026-07-28**. |
| Legacy remote MCP | Official SDK 1.32.2 negotiated **2025-11-25**, authenticated through the Bearer path and resumed the modern client's same private run. |
| Remote registration | All **16 tools**, reference-file schema metadata, and the 701,667-byte gallery resource read successfully. |
| Access control | Health 200; unauthenticated MCP 401; unrelated browser origin 403. |
| Ordinary search | AT/EUR price-filtered query returned 50 items; next page another 50 without overlap. Replaying its cursor returned exactly the same structured response. |
| German market | Separate live DE/de price-ascending query returned five DE/EUR items within the price bound, each with its German-market listing URL; see live-market-verification.json. |
| Native routes | Default-size similarity, source-image and multipart reference-image each returned 50 candidates. Upload continuation returned another 50. Outfit returned 50 + 9. Style returned 12 candidates with recorded strict and relaxed arms. |
| Details/photos | Canonical photo enrichment, duplicate-ID detail continuation, actual model image bytes, widget-only hydration, illustrated selection pagination and exact image identities passed. |
| Evidence gate | Recording an assessment after widget-only hydration was correctly rejected. After the assistant actually viewed an original front photo, a concrete assessment was accepted and status reported one assessed item. |
| Private saved search | A clearly labeled technical verification search was saved and listed successfully. |

The repeatable live harness writes [live-verification.json](live-verification.json)
with 29 passing checks. Its deliberately rejected evidence request is a positive
access-control test, not a failed release. A separate assistant-observed visual
check is recorded in [live-visual-verification.json](live-visual-verification.json).
Images and credential files remain private and ignored by Git.

The first remote call correctly exposed a missing-config failure caused by stale
regional HTML referencing a retired asset. That deployment was not declared
complete. The exact cause, bounded correction and independent recheck are
documented in provider-contracts.md and independent-review.md; the final remote
run passed after redeployment.

### ChatGPT installation boundary

The paired local-browser surface was unavailable in this session. The available
cloud browser displayed a signed-out ChatGPT page and its sign-in dialog. No
account login, plugin installation, real ChatGPT tool-selection run or
ChatGPT-hosted gallery success is claimed by the direct-client and simulated-host
tests. Connecting the ready private endpoint to the user's account remains the
last account-specific step; the personal setup sheet supplies its exact URL.

Candidate counts and timings are single live observations, not performance or
recall benchmarks. Incorrect-label recovery is verified by controlled
counterexamples and native relaxed routes, not exhaustive real-catalog labels.
