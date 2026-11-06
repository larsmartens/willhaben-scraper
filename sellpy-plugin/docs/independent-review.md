# Independent implementation review

## Verdict: PASS+NOTES

Latest covered source revision: `65db1e76c29b4b35dea55966aabfc6a7655ce960`, after the scoped photo-enrichment and release-discovery rechecks below.

Initial corrected source revision: `2ca1426c1603bb55e9f4fcaf6b4cfcdcef732911`.

Baseline: `108507225e51860bb58cabdef5ecef8d49271509`. The baseline contains no `sellpy-plugin/` tree. The reviewed change adds this package without modifying paths outside it. The comparison is therefore an additive plugin review, not a claim that an earlier Sellpy service was migrated in place.

The independent coordinator and two review lanes did not author production code. They read the actual implementation and constructed private reproduction probes. The implementation author made the corrections and committed corresponding permanent regressions. All reviewers were separate GPT agents; no cross-family judgment or formal verification is claimed.

No unresolved implementation defect was found within the reviewed scope after the corrections below. This verdict covers the source and local Workers/browser behavior identified here. Deployment and an installed ChatGPT run remain separate evidence gates.

## Reviewed artifact identity

An independent `npm run build` on the reviewed revision completed successfully and left the tracked source tree clean.

| Artifact | Identity |
|---|---|
| Worker bundle, `dist/worker.js` | SHA-256 `9a13b8c5e0dccc9220a982a148c8a3fb61db53d2f78a3b49f9660e9546899c92` |
| Gallery, `ui/generated/gallery.html` | SHA-256 `561134938bd1f205adfe5a3cf5e43288df0314fa775ab64643bbaad5eb8fe9f3` |
| `src/` Git tree | `461541e6ef2f39cb677fa8fa636e5ff958419dd0` |
| `ui/` Git tree | `f9832457f4365299aba8038d77a5b5b9f776c0cb` |
| `package-lock.json` Git blob | `c472ec9fa58841c9e24dc1974aeb6332d8d8078c` |

These identities allow a repository transport or later documentation-only commit to be compared with the reviewed runtime. A changed runtime bundle requires review of the changed behavior; a different commit identifier alone does not establish either equivalence or a regression.

## Findings and corrections

Eight concrete defects were reproduced against initial candidate `85ea2135830bb03afb923da48763841340a91b95` and corrected before this verdict.

| Finding | Original observation | Verified correction | Permanent regression |
|---|---|---|---|
| Incorrect style labels blocked recovery | A `style=cottagecore` source facet remained in every retrieval arm. An item labeled `bohemian` could not enter even the relaxed pool. | Dedicated discovery arms remove unreliable style metadata as well as source taxonomy constraints, while preserving the requested style in intent. Strict arms retain their original constraints. | `test/planning.test.ts` |
| Detail rate limits lost their pause | A GraphQL 429 with `Retry-After:120` became an empty detail result containing only remaining IDs. | Remaining IDs and actionable failures now coexist; the full retry timestamp survives. | `test/provider.test.ts` |
| Missing canonical items looked available | A stale indexed item with a price and `getPdpItem:null` received a fresh observation timestamp and `availability=available`. | The item is explicitly `unknown` for availability and carries the canonical-detail failure. | `test/provider.test.ts` |
| Default outfit requests failed | A default display page of 50 became `limit_per_part:50`; the live native service returned HTTP 422. | The native request uses the complete verified maximum of 20 per part, independently of display pagination. The durable ledger drains all returned recommendations. | `test/provider.test.ts`; live evidence below |
| Async tool errors escaped the contract | Upload preparation and presentation rejections bypassed the enclosing error handler because their promises were returned without awaiting. | Those branches are awaited and return structured corrective errors. | `test/tool-flow.runtime.ts` |
| Duplicate detail IDs broke continuation | With raw IDs `a..k,a..i`, the provider processed ten unique IDs and left `k`; the wrapper returned `next_index=19`, skipping `k` when the documented continuation was followed. | The wrapper deduplicates consistently before slicing and indexing. Following `next_index` reaches every requested unique ID. | `test/tool-flow.runtime.ts` |
| Reserved requests ignored a later cooldown | Request B reserved a slot before request A received a 120-second 429, then still dispatched during the newly persisted cooldown. | The paced fetch rechecks the current cooldown after waiting and re-reserves only when newly blocked. The reproduction now dispatches only A; both callers receive `rate_limited`. | `test/http.test.ts` |
| Same-run selection replacement mixed galleries | An older selection's pending next page resolved after a replacement selection for the same run. Old cards, title and continuation contaminated the new selection. | A local presentation generation guards asynchronous results, including same-run replacements. The reproduced gallery remains only `new-only` with the replacement title. | `test/ui.browser.mjs` |

## Independent execution

The review exercised real implementation code, with the following distinctions between native, runtime and simulated-host evidence.

| Check | Observed result | Scope |
|---|---|---|
| `npm run build` | Exit 0; Worker 1,485,520 bytes; gallery 701,667 bytes; hashes above | Actual bundled release inputs |
| `npm run test:runtime` | 11 tests in 3 files passed, exit 0 | Actual Workers runtime, SQLite/RPC, durable eviction, cursor replay/draining, image-evidence gate, private actor isolation, MCP registration and structured errors |
| Independent tool-flow probe | All 3 formerly failing cases passed | Actual tool/DO flow; provider timing fixture for partial detail work |
| Provider/planning suite | 17 tests passed, exit 0 | Real provider/planner code with controlled upstream contracts |
| Corrected provider probes | Incorrect-style recovery, 120-second pause propagation and missing-detail availability all passed | Controlled counterexamples against real provider/planner code |
| Concurrent pacing probe | One network request dispatched; no request started with an active cooldown | Actual `pacedFetch` with an origin-gate contract fixture |
| Selection replacement probe | Only `new-only` remained; title stayed `Replacement selection` | Real Chromium and actual generated gallery, using an MCP Apps host fixture |
| Default-size native outfit search | 59 hydrated AT items from a native window of 60, one explicitly excluded market/filter mismatch, `next_offset:null`, `end_reason:upstream_window`, approximately 23.8 seconds | Live Sellpy service through the implemented provider |

The rejected outfit request's sanitized validation identified `body.limit_per_part`, type `less_than_equal`, and maximum `20`. The first-party frontend used ten, but that was not the service maximum. The corrected provider requests the complete available twenty-per-part window. The raw validation stack trace was kept out of the repository.

Expected rejection logs appear in the Workers tests for deliberately unknown runs, unproven visual assessments and immutable presentation conflicts. The final run reported no unhandled test errors.

## Standards and boundaries

The review inspected the typed provider boundary, SQL ownership and operation receipts, authentication, origin validation, fetch/redirect policy, image transfer, MCP schemas, and gallery parsing and rendering. No additional concrete blocker emerged in those inspected paths.

Relevant protections include parameterized SQL, exact per-owner actor routing, fail-closed personal authentication, restricted HTTPS upstream hosts, rejection of cross-origin POST redirects, public-field allowlists, literal DOM text insertion, separately validated image and listing URLs, and distinct model-visible versus widget-only image channels. Visual assessments require exact previously delivered image identities. These observations are not a security certification.

## Notes that remain part of the verdict

- The review did not install or operate this plugin inside a signed-in ChatGPT client. A simulated MCP Apps host proves the bridge and UI behavior it exercises, not a completed ChatGPT installation.
- Native APIs were derived from current first-party frontend behavior. Their future stability is not guaranteed. Source changes must continue to produce explicit failures rather than fabricated success.
- Native semantic/image retrieval exposes source windows rather than an exhaustive catalog total. The plugin has no cumulative page, item or photo count ceiling, but cannot enlarge an upstream service's finite window.
- Mislabel recovery was demonstrated with controlled source-label counterexamples. No exhaustive real-catalog recall benchmark or numerical SOTA superiority was measured.
- Every photograph remains addressable through continuation, subject to explicit per-call and per-file transfer bounds. “No cumulative cap” does not imply unbounded memory in a single response or unlimited Cloudflare storage.
- The independent live regression in this review was the default outfit route. Other native routes have author-supplied live evidence and were inspected through source/contracts here; deployed modern/legacy MCP checks remain the release operator's next step.

## Scoped photo-enrichment recheck

The author identified one additional completeness issue before deployment: an image request could use a catalog-only observation, omitting photos available from canonical detail until another tool explicitly refreshed the item. The reviewer agreed that the image tool should perform that enrichment itself.

The production delta from `2ca1426c1603bb55e9f4fcaf6b4cfcdcef732911` to `2c5ddaa81a7187d3c31d55efadd29c4a7cd91cff` changes only the `get_item_images` branch in `src/tools.ts`: it now requests the existing detail-refresh path and includes refresh warnings in its structured response. The existing 120-second detail freshness rule still avoids repeated unnecessary refreshes. The gallery bundle is unchanged.

The independent reviewer inspected that exact delta and reran `npm run test:runtime -- test/tool-flow.runtime.ts`: **4 tests passed, exit 0**. The new case begins with one catalog thumbnail, supplies a canonical detail containing an additional source photo, invokes the image tool, and verifies both image references are retained in the durable candidate and reported by the tool. It tests enrichment and reporting; transfer of the actual photo bytes remains covered by the separate image/provider and release checks.

**The PASS+NOTES verdict extends to this corrected revision**, with the same scope limits above. Updated artifact identities:

| Artifact | Identity |
|---|---|
| Worker bundle, `dist/worker.js` | SHA-256 `9e333c1781fe9ee91187b60cc0b9219c04a4935f71e09bec7dbf8033eaf2d9fc` |
| Gallery, `ui/generated/gallery.html` | SHA-256 `561134938bd1f205adfe5a3cf5e43288df0314fa775ab64643bbaad5eb8fe9f3` |
| `src/` Git tree | `0d8a9e4134495d3961d0a333cfb627da134b13a1` |

The earlier local revision `2ca1426` was uploaded as remote revision `4923edce6a25f8a9ad725d04626c0bcfb92e2672` with an identical Git tree, as reported by the release operator. The final photo-enrichment revision's remote commit identity is to be recorded by the release operator together with its source-tree and bundle equivalence.

## Final complete Workers-suite confirmation

At source revision `2c5ddaa81a7187d3c31d55efadd29c4a7cd91cff`, the independent reviewer ran `npm run test:runtime` once more after the photo-enrichment fix. The run started on 2026-11-06 at 23:53:15 UTC and completed in 9.24 seconds: **3 test files passed, 12 tests passed, exit 0**. This settles the complete final Workers-suite count; the earlier 11-test result and scoped 4-test recheck remain historical checkpoints. Deliberately rejected operations produced the expected exception logs, with no unhandled test error reported. No production file was changed during this confirmation.

## Scoped release-discovery recheck

The first deployed smoke test exposed a source-discovery difference that the original local native requests had not exercised. The release operator's sanitized edge diagnostic found that stale `/search` HTML referenced `config.prod.CY9fKIHd.bundle.js`. That retired asset returned HTTP 200 with current SPA HTML, not JavaScript; the fallback HTML referenced the working `config.prod.C-K-4R31.bundle.js`. Passing the fallback HTML to the static JavaScript parser correctly failed with missing `algolia` configuration.

The independent reviewer compared the current 9,756-byte source body, SHA-256 `dd5bf7ac39115098e3a96b0604b0d396b4c3d4d831421c7d486a66281925e56f`, against both the TypeScript parser and its minified browser/Workers build. Both parsed eleven locales and five native services successfully. No decompression or parser-grammar change was justified by that evidence.

The exact production delta from `2c5ddaa81a7187d3c31d55efadd29c4a7cd91cff` to `65db1e76c29b4b35dea55966aabfc6a7655ce960` changes only configuration discovery. It follows quoted, observed relative or exact first-party configuration-asset references, tracks visited paths, and permits at most three distinct asset fetches within the existing request deadline. Only an HTML response can introduce fresh fallback candidates. A successfully parsed configuration is cached; downloaded JavaScript is never executed, external asset links are excluded, and malformed JavaScript still produces the contract-change error.

The independent reviewer inspected that exact committed diff and ran `node --import tsx --test test/provider.test.ts`: **18 tests passed, exit 0**. The three new cases verify retired-asset recovery and successful caching, termination of repeated HTML references without external fetching, and explicit failure for malformed JavaScript. This is a scoped provider verification; no unrelated production path changed.

**The PASS+NOTES source verdict extends to revision `65db1e76c29b4b35dea55966aabfc6a7655ce960`.** Redeployment and an observed successful remote capability/search call remain the release operator's subsequent live evidence.

| Artifact | Identity |
|---|---|
| Worker bundle, `dist/worker.js` | SHA-256 `d5146c95a952aa58d015a055a6748eaf22fd19d2bdafeb001ef1564a86b38a89` |
| Gallery, `ui/generated/gallery.html` | SHA-256 `561134938bd1f205adfe5a3cf5e43288df0314fa775ab64643bbaad5eb8fe9f3` |
| `src/` Git tree | `e6c795d3954b6bc64f7550c2eae920b0aba63636` |
