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

### Actual ChatGPT installation and Chat-mode verification

The paired local-browser surface was unavailable in this session. The user
subsequently completed secure sign-in in the available cloud browser. The private
endpoint was created as Sellpy Studio, connected to the account, and visibly
listed as installed. Its page displayed version 1.0.0 and “Try in chat”. A new
Chat-mode conversation selected the plugin and invoked it for a three-item
Cottagecore search with original-photo inspection. Installation, actual ChatGPT
tool selection and a ChatGPT-hosted gallery have now been visibly verified.
Private account and conversation identifiers are kept out of this public record.

The request asked for three Cottagecore-inspired dresses in the Austrian market
up to EUR 80, with no size constraint for this test, relaxed style/category
retrieval, original-photo inspection, and a gallery showing each item's own
photo, price, size and reason. The completed response showed these observations:

| Item | Observed market price | Size | Gallery photographs |
|---|---|---|---|
| Amy Jane London, `PZv57Y9Eot` | EUR 28 | XS | 5 |
| Apricot, `zEeZQYpm0i` | EUR 7 | L | 4 |
| H&M, `kwPIDKhoUS` | EUR 11 | XS | 5 |

These are time-specific test observations, not enduring availability or price
claims. The response gave concrete visual reasons such as floral patterns,
puff sleeves, smocking and ruffles, with material uncertainty when appropriate.
It explicitly did not claim to have confirmed an actual category error in these
three items: all three were cataloged as dresses. Style relevance was presented
as a visual assessment. One selected candidate was reported through the relaxed
retrieval route.

The live MCP Apps panel rendered three distinct original-image cards, prices,
sizes, condition and explanations. Sorting, item navigation, source links and
refresh controls were present. The first card opened its five-photo viewer;
clicking “Nächstes Foto” visibly displayed the next original photo and “2 von 5”.
The installed-plugin page and rendered photo viewer were captured as private
browser evidence. They are not committed to this public repository.

ChatGPT's separate external-image Markdown fallback displayed its own
“Unverified image / Load image” control. The interactive gallery's original
images rendered successfully. This host behavior is distinct from a gallery
image failure. The complete model response displayed 2m58s elapsed; this is one
end-to-end observation, not a latency benchmark.

Candidate counts and timings are single live observations, not performance or
recall benchmarks. Incorrect-label recovery is verified by controlled
counterexamples and native relaxed routes, not exhaustive real-catalog labels.
