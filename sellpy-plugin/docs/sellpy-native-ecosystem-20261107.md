# Sellpy native capabilities and ecosystem audit

Research date: **7 November 2026**. Baseline: Sellpy Studio **1.1.1**, checkout
`62b195886a142e9362fcd306678ba8d5d7cfef62`. This report records research and
implementation recommendations; it does not claim that recommendations have
already shipped. The release owner records implementation and deployment
separately.

## Findings that change the implementation plan

1. **The main native search integration is already present.** Catalog, text
   semantics, similar items, product-image search, uploaded-reference search and
   complementary outfits all have source contracts and prior live verification.
   Replacing these with a browser scraper or an Apify actor would duplicate work.
   The connected provider still reports all six routes available, frontend release
   `a3f361d92d68c0aac28e373573978596738012d9`, observed at
   `2026-11-07T15:49:49.918Z`. See [provider contracts](provider-contracts.md),
   [provider implementation](../src/sellpy/client.ts) and
   [native configuration](../src/sellpy/config.ts).
2. **The clearest result-volume bottleneck is presentation.** Baseline retrieval
   defaults to 50 results per call and permits 200, with durable continuation.
   `present_items` defaults to six and requires an explicit selection or a
   selection cursor. The scalable next step is a gallery that can browse a stored
   result cohort directly, with a larger initial page and bounded rendering.
   Merely raising the six-card default does not remove the selection bottleneck.
   Evidence: [schemas](../src/schemas.ts), [presentation](../src/presentation.ts),
   [refinement design](refinement-design.md).
3. **There is a useful additional native endpoint: similar brands.** Its current
   frontend caller and a small live request were both verified in this audit.
   This can answer requests such as “alternatives to COS” and seed a normal
   inventory search. It must not silently replace an exact brand constraint.
   Details and primary source links appear below.
4. **Sellpy search-link import is a concrete missing convenience.** Sellpy's
   current common library defines URL query, category, price, measurement,
   exclusion and sorting semantics. Several external tools accept search/category
   URLs, while the baseline plugin accepts structured criteria only. A safe,
   loss-aware parser can reuse the current catalog pipeline. It need not fetch
   the supplied URL. See the native URL contract below and
   [baseline tool schemas](../src/schemas.ts).
5. **Native app image segmentation is a real product feature but not yet a
   verified integration contract.** Sellpy's own engineering post describes
   splitting one outfit photo into garments and browsing matches for each.
   Neither the current inspected web callers nor the verified upload response
   establishes that segmented app contract. Do not present a guessed endpoint,
   generic upload cropper or CMS outfit segments as that capability.
   [Sellpy engineering post](https://www.linkedin.com/posts/sellpy_tech-engineering-ai-activity-7465665472206888961-LzIY).

## Evidence classes and research method

| Class | Meaning | Appropriate implementation use |
|---|---|---|
| Official product documentation | Sellpy describes a user-visible feature | Establish product intent; does not establish an API contract |
| Observed native frontend contract | Current first-party script shows endpoint, request and response use | Implement behind a narrow adapter and contract checks |
| Live public verification | A bounded read request succeeded with the observed contract | Establish the tested request shape and response, not an SLA |
| Third-party source code | Project author publishes implementation | Feature comparison and design lessons; not authority for Sellpy internals |
| Third-party product listing | Author describes a commercial actor/API | Discover ideas; distinguish advertised behavior from independently tested behavior |

The audit first read the existing schemas, planner, provider, normalizer,
presentation and performance/contract reports. It then searched current
first-party Sellpy pages and GitHub repositories, inspected relevant repository
files, followed actual frontend asset references, and made small public reads.
GitHub repository queries included `sellpy`, `sellpy scraper`, `sellpy api`,
`sellpy cli` and `sellpy mcp`. The broad query returned many interviews,
prototypes and unrelated same-name projects; these were not counted as usable
marketplace integrations. Empty results for the narrower repository queries do
not prove that no private, unindexed or differently named implementation exists.
[GitHub repository search](https://github.com/search?q=sellpy&type=repositories).

No public, documented, supported Sellpy developer API/SDK contract was located
in the inspected first-party material. That is a scoped research result, not a
claim about private partner arrangements. Sellpy's public GitHub organization
mainly exposes infrastructure, UI utilities, examples and interview projects;
its `stockholm-ai` repository is an MNIST model-serving example, not a shopping
API. [Sellpy organization](https://github.com/sellpy),
[stockholm-ai README](https://github.com/sellpy/stockholm-ai/blob/master/README.md).

No Sellpy account credentials, customer sessions, cart actions, purchases,
notifications or external messages were used in this audit. Public configuration
values were parsed as data; key values were not retained in this report.

## Native feature coverage

Sellpy's shopping guide explicitly documents saved-search alerts, app photo
search, favorite price alerts, granular filters, similar-item search and outfit
recommendations. Its support page ties personal favorites, monitored searches
and weekly recommendations to a Sellpy profile. These are product capabilities;
they do not make the account operations part of the anonymous catalog contract.
[Shopping guide](https://www.sellpy.com/blog/sellpy-shopping-guide-6-hacks),
[profile help](https://intercom.help/sellpy/en/articles/3185225-how-do-i-use-my-sellpy-profile).

| User need | Native evidence | Baseline plugin | Decision |
|---|---|---|---|
| Ordinary search, sort, source filters | Catalog frontend/Algolia contract | Implemented | Improve entry and presentation, retain adapter |
| Aesthetic/theme search | Sellpy Labs uses native text route | Implemented as multiple catalog/semantic arms | Retain explicit visible-feature queries and category relaxation |
| Similarity to an existing item | Current ML provider and product UI | Implemented | Retain original IDs and route provenance |
| Similarity to a product photo | Current ML provider | Implemented | Retain source-photo identity |
| Uploaded reference photo | Native multipart route, prior live upload proof | Implemented with private retained input | Improve discoverability; no third-party image hosting needed |
| Separate garment matches from an outfit photo | Sellpy engineering announcement | No verified segmented native contract | Research gate; do not advertise as shipped |
| Complementary outfit pieces | Native complementary service | Implemented | Preserve finite per-part source window |
| Measurement, material, condition and defect filtering | Native filter registry | Implemented shopper subset | Use source values; do not infer body fit or repair cost |
| Similar brands | Native caller and fresh live success | Missing in baseline | Small, useful addition |
| Paste an existing filtered search link | Native URL registry | Missing in baseline | Implement loss-aware URL import |
| Saved criteria, shortlist and preferences | Native profile UX; local plugin state | Implemented privately in plugin | Explain that this does not synchronize the Sellpy account |
| Observed price/availability history | Current source reads plus stored observations | Implemented | Surface compact changes; do not invent pre-observation history |
| Scheduled arrival/price alerts | Native account UX | Refresh exists; background monitoring does not | Separate scheduler integration with explicit user schedule |

Implementation evidence for the baseline column:
[schemas](../src/schemas.ts), [planning](../src/planning.ts),
[normalization](../src/sellpy/normalize.ts), [provider](../src/sellpy/client.ts),
[refinement](refinement-design.md). Product references:
[Sellpy Labs](https://www.sellpy.com/sellpy-labs/search),
[measurement and defects guide](https://www.sellpy.com/blog/3-hidden-sellpy-search-hacks),
[favorites, profiles and edits](https://www.sellpy.com/blog/tips-tricks-second-hand-sellpy).

### Native search contracts: retain the verified integration

The runtime configuration still exposes the existing service paths. The current
`CLIPSearch` component uses `mlProvider` with a text source, which calls
`/similar-items-app/get-similar-by-text`. The current web implementation therefore
supports retaining the already integrated text route; a legacy-looking
`clip_combined` name in configuration is not evidence of a superior active
composed-image API. Sources:
[runtime config](https://www.sellpy.com/market/config.prod.C-K-4R31.bundle.js),
[CLIPSearch](https://www.sellpy.com/market/CLIPSearch.Cqd0HFZJ.bundle.js),
[ML provider](https://www.sellpy.com/market/mlProvider.DYIBChwE.bundle.js).

The plugin's existing canonical item hydration, market-specific money,
photo identity, public-field allowlists, independent route ranks, post-hydration
hard constraints and continuation remain valuable. The catalog's exposed
pagination window is distinct from its reported hit estimate. Native image/text
routes do not establish complete inventory totals. Outfit recommendations have
a tested finite per-part window rather than an invented continuation cursor.
These are already documented with reproducible evidence in
[provider-contracts.md](provider-contracts.md).

### Newly verified: native similar brands

The current first-party source contains both an older single-brand helper and a
multi-brand ML helper. Prefer the latter when adding a capability because its
request and result handling are explicit and it accepts a group of seed brands.
[Single-brand helper](https://www.sellpy.com/market/fetchSimilarBrands.CLR_ev5v.bundle.js),
[multi-brand helper](https://www.sellpy.com/market/useSimilarBrandsFromBrands.BaoqUfNF.bundle.js).

| Contract field | Observed value |
|---|---|
| Endpoint | `https://services.sellpy.net/similar-items-app/get-similar-brands` |
| Method | `POST` |
| Authentication source | Public native `ml.similarBrands` configuration |
| Header | `X-SimilarItems-Key` |
| JSON request | `brand_groups`, `n_items`, `request_source` |
| Group shape | Array of arrays of exact seed brand strings |
| Response | One result array per input group; entries contain `brand`, `objectid`, `score` |
| Frontend default | 30 requested alternatives |
| Verified pagination | None; no continuation claim |

A bounded live request on the research date used the single group `COS` and
requested three alternatives. HTTP 200 returned:

| Brand | Native brand-object ID | Native score |
|---|---|---:|
| Arket | `tHdNaT9JNC` | 0.78240293 |
| & Other Stories | `Rf2FNH05iB` | 0.7497928 |
| Jouur | `kxYKj1o6mm` | 0.7325551 |

These are **brand objects**, not item IDs. A brand recommendation is neither a
visual assessment of a garment nor proof of stock in the chosen market. The
frontend subsequently checks brand-index existence with a popularity condition
of `freq > 50`; this is a front-end selection rule, not proof of a total API
limit. [Brand validation helper](https://www.sellpy.com/market/validateBrandExistence.BcM3aCHr.bundle.js).

Recommended implementation: exact seeds; modest bounded response; preserve
native order and scores as source-specific metadata; deduplicate names; exclude
seed names; clearly indicate inventory validation status. Searching any returned
brand uses the ordinary market-filtered catalog tool. Do not import the brand
object IDs into the item ledger, compare these scores with item scores, or
silently relax exact-brand requirements. Cache only completed non-private
results if measurements demonstrate a benefit; keep request/cancellation state
local to its call.

### Search-link import: verified parser rules

Sellpy's current common bundle defines the registry and conversion functions.
The important mapping is below; the existing provider's shopper allowlist must
remain the final authority for supported fields.
[Current native common bundle](https://www.sellpy.com/market/npm.sellpy-commons.CckBL0yS.bundle.js),
[plugin allowlist](../src/sellpy/normalize.ts).

| Native URL element | Plugin interpretation |
|---|---|
| `query` | Catalog query |
| `sortBy=relevance`, `price_asc`, `price_desc` | Corresponding catalog sort |
| `sortBy=saleStartedAt_desc` | Plugin `newest` |
| `/search/<category path>` | Deepest `categories.lvlN` with joined category path |
| `brand`, `type`, `color`, `material`, `condition` | Matching `metadata.*` facets |
| `fabric`, `pattern`, `season`, `demography`, garment descriptors | Corresponding allowlisted `metadata.*` facets |
| `sizes`, `style`, `brandGroups`, `materials`, `saleType` | Same-named allowlisted facets |
| `minPrice`, `maxPrice` | Base currency amounts; provider converts to source minor units |
| `minWaist`, `minInnerLegLength`, `minHeelHeight`, etc. | Corresponding supported centimetre range; `max*` analogously |
| Repeated values for a facet | Alternatives within that facet |
| Leading-minus value | Explicit source exclusion |
| `page` | Native browsing position, separate from new plugin-run continuation |

Native category slugs use hyphens for spaces and underscores for literal
hyphens, in addition to URI decoding. Import must preserve this distinction.
The native registry includes internal fields which must not be made available
merely because they occur in a copied URL. Implementation should parse locally,
allow only exact supported Sellpy hosts and paths, reject userinfo and malformed
encodings, and return a structured list of unhandled or conflicting parameters.
It must never silently broaden a restrictive pasted search. Explicitly state
whether a new run starts from its first page; native page numbers are not plugin
cursor tokens. These are design requirements derived from the native contract,
not additional claims about a supported public API.

### Reference photos and segmentation

Sellpy announced app photo search on **18 March 2026**; its own description
allows an existing photo or a camera photo. A subsequent engineering post
describes automatic separation of outfit components. These support the user
value of per-garment reference searches.
[Sellpy launch announcement](https://via.tt.se/pressmeddelande/4261609/sellpy-lanserar-bildsok-nu-ar-cirkular-shopping-enklare-an-nagonsin?publisherId=3237048),
[engineering description](https://www.linkedin.com/posts/sellpy_tech-engineering-ai-activity-7465665472206888961-LzIY).

The inspected web `ImageUpload` bundle is a generic upload component with an
optional cropper. The main bundle's `outfitSegments` field belongs to CMS outfit
curations. Neither demonstrates the app segmentation service. The verified
plugin multipart route returns an ordered flat array of item IDs. It already
uses an actual native Sellpy visual-search service; calling it “the complete
segmented app flow” would go beyond the evidence.
[Upload component](https://www.sellpy.com/market/ImageUpload.DOrRsIzB.bundle.js),
[main bundle](https://www.sellpy.com/market/index.DZGY3w4k.bundle.js),
[upload verification](provider-contracts.md).

A future multi-reference feature should model each selected garment as a
separate search intent with its own reference, hard criteria and continuation.
This prevents results for a bag from being mixed into a dress shortlist. A
verified native segmented contract would be preferable; otherwise an explicitly
selected image region can feed the existing native uploader. Do not change
source-image evidence or claim that a generated image is the original item.

### Convenient references without reconstructing image URLs

An item-plus-photo-index input is a useful small addition to `search_by_image`.
It should resolve the requested zero-based index from canonical item details,
retain the resolved image ID and literal source URL, and invoke the existing
native image route. Out-of-range indices should return the observed image count
and an explicit error, never silently substitute the first photograph. Existing
image IDs are the durable identity; the index is only a selection convenience.
[Current image identity contract](provider-contracts.md),
[image tools](../src/schemas.ts), [normalization](../src/sellpy/normalize.ts).

This matches the native architecture: the current product page can supply an
actual product image to the same ML provider that otherwise accepts an item ID.
Its fallback decision uses the item's `paidAt` value; it should not be confused
with a universal creation-date rule. The audit did not live-test an old-item
fallback cohort. [Product page](https://www.sellpy.com/market/BuyerPDPPage.CQkv4AJ9.bundle.js),
[ML provider](https://www.sellpy.com/market/mlProvider.DYIBChwE.bundle.js).

For a user-supplied external public HTTPS photo, keep the native-service
allowlist unchanged. Use a separate bounded, uncredentialed reference downloader
with checks on the initial URL and every redirect, a redirect budget, byte and
time limits, actual image signature validation, and private-address protection.
It must not forward provider or user credentials, become an arbitrary fetch
proxy, or treat a filename/Content-Type header as proof of image format. Once
downloaded, retain the validated bytes privately with the search and use the
already verified native multipart upload route. Continuation should not depend
on the original public URL still working. These are implementation requirements;
this audit has not shipped or live-validated such an external downloader.

## External projects: actual useful lessons

Repository content was inspected, not executed or installed. The table
distinguishes functioning code paths from README claims. No third-party code
was copied into the plugin by this audit.

| Project | What the inspected source establishes | Useful lesson for this plugin | Reuse decision |
|---|---|---|---|
| [cqann/Sellpy-Suit-Filter](https://github.com/cqann/Sellpy-Suit-Filter) | Selenium/BeautifulSoup scraper; input search URL; measurement ranges; persisted checked/fitting URLs | Exact measurement constraints, resumability and deduplication matter | Already substantially covered natively; adopt URL convenience, not DOM scraping |
| [bombsimon/sellpy-visualizer](https://github.com/bombsimon/sellpy-visualizer) | Personal sales/orders/Circle views; filters, pagination and summaries; account GraphQL uses session credentials | Structured browsable records and explicit provenance | UI ideas only; private seller/order access is a different integration scope |
| [RebeccaAlbo/sellpy-status-monitor](https://github.com/RebeccaAlbo/sellpy-status-monitor) | Puppeteer watcher distinguishes available/reserved/sold; README advertises notifications and experimental auto-cart | Availability changes are useful decision information | Reuse the concept with current provider observations; do not inherit auto-cart or browser polling |
| [rislah/sellpy-lens](https://github.com/rislah/sellpy-lens) | Userscript opens Google Lens with the current product image and title | Optional external investigation of uncertain item identity | Low priority: the requested native Sellpy visual retrieval is already available |
| [ValerieHabbel/sellpy](https://github.com/ValerieHabbel/sellpy) | Small Python code uses the public Algolia query backend | Confirms independent interest in direct catalog access | No missing strategic feature established by this code |
| [westmaticmax-hue/Sellpy-Smart-Finder](https://github.com/westmaticmax-hue/Sellpy-Smart-Finder) | Static page imports CSV, filters rows and ranks supplied price/value data | Import/export and explicit source data can help comparisons | Never fabricate resale value or retail price; optional export can reuse the ledger |
| [fraulueneburg/sellpy-list-total-calculator](https://github.com/fraulueneburg/sellpy-list-total-calculator) | Browser popup sums prices from the current DOM page | A shortlist subtotal can be useful | Compute from typed same-currency observations, not scraped localized labels |

Source files behind the assessment:
[suit scraper](https://github.com/cqann/Sellpy-Suit-Filter/blob/main/sellpy_scraper.py),
[visualizer scraper](https://github.com/bombsimon/sellpy-visualizer/blob/main/lib/scraper.ts),
[visualizer account client](https://github.com/bombsimon/sellpy-visualizer/blob/main/lib/sellpy-client.ts),
[watcher](https://github.com/RebeccaAlbo/sellpy-status-monitor/blob/main/src/watcher.js),
[Lens userscript](https://github.com/rislah/sellpy-lens/blob/master/src/scripts/content.user.js),
[catalog Python](https://github.com/ValerieHabbel/sellpy/blob/main/functions/scraping.py),
[CSV finder](https://github.com/westmaticmax-hue/Sellpy-Smart-Finder/blob/main/index.html),
[subtotal popup](https://github.com/fraulueneburg/sellpy-list-total-calculator/blob/main/popup.js).

Two comparisons need particular care. The suit scraper reads four measurements
positionally, whereas the plugin maps verified named source fields; copying the
positional approach would reduce reliability. The visualizer exposes account
and seller-oriented details, including photo staff metadata. The shopping
plugin's existing public-field allowlist should continue to exclude those.
[Suit source](https://github.com/cqann/Sellpy-Suit-Filter/blob/main/sellpy_scraper.py),
[visualizer source](https://github.com/bombsimon/sellpy-visualizer/blob/main/lib/scraper.ts),
[plugin normalization](../src/sellpy/normalize.ts).

The similarly named `gabrueldev/Sellpy-Agent` is a WhatsApp bookkeeping assistant
for sales/expenses, not an integration with this secondhand marketplace.
`xamnotna/sellpyextd` describes a school UX prototype using placeholder data.
Neither is evidence of a mature competing Sellpy shopping MCP.
[Agent README](https://github.com/gabrueldev/Sellpy-Agent/blob/main/README.md),
[prototype README](https://github.com/xamnotna/sellpyextd/blob/main/README.md).

### Commercial API/CLI/MCP offerings

Apify lists two relevant community actors. `mrdoe/sellpy-scraper` advertises URL
input, item-ID deduplication, structured rows and dataset export. Its source
description correctly distinguishes Sellpy's previous asking price from an
original retail price. `accountable_eel/sellpy-search-lookup` advertises keyword
and filter search plus persisted new-item/price-change alerts. Apify exposes
actor invocation through API, CLI and MCP wrappers. These are third-party
delivery interfaces, not an official Sellpy developer API.
[mrdoe actor](https://apify.com/mrdoe/sellpy-scraper),
[lookup actor](https://apify.com/accountable_eel/sellpy-search-lookup),
[MCP wrapper](https://apify.com/accountable_eel/sellpy-search-lookup/api/mcp),
[CLI wrapper](https://apify.com/accountable_eel/sellpy-search-lookup/api/cli).

No actor was purchased, run or performance-tested in this audit. Advertised
speed, monitoring completeness and discount fields should not become plugin
guarantees. The useful additions are URL entry, structured export and explicit
observed deltas. A new paid intermediary is unnecessary for routes the plugin
already reads directly.

## Large-result and compact-UI design

The baseline already separates search continuation, stored candidates,
refinement and selected-item presentation. Its durable ledger and response
receipts are a sound basis for large browsing. The next work should connect
those pieces without materializing all candidates in one tool result.
[Architecture](architecture.md), [schemas](../src/schemas.ts),
[refinement design](refinement-design.md).

| Concern | Recommended behavior | Why |
|---|---|---|
| Initial visible choice | Default around 12 cards when that many suitable items exist | More useful breadth than six without excessive payload |
| Very large runs | Gallery cursor over a frozen observed cohort or explicit ranked snapshot | All retained results reachable; stable replay |
| Source continuation | Distinct action from browsing already stored results | Avoid repeated network work and false total counts |
| DOM and image memory | Bounded visible page/window; lazy photo hydration | Memory depends on current view rather than lifetime discoveries |
| Ordering | Stable tie-break by item ID/sequence, clear ranking provenance | Prevent duplicate or skipped cards between pages |
| Item identity | Deduplicate by canonical Sellpy item ID | Multiple retrieval arms must not create duplicate cards |
| Facts | One canonical location per price, size, condition, brand and availability | Structured information without repetitive title/attribute text |
| Evidence | Brief feature/uncertainty rows, with details on demand | Keep source facts distinct from actual visual findings |
| Counts | Separate discovered unique items, source estimate, displayed page and reviewed items | Do not imply exhaustive inventory coverage or full visual review |
| Failure/retry | Preserve last successful page and explicit resumable cursor | A temporary upstream failure must not erase browsing context |
| Accessibility | Keyboard-operable navigation and predictable focus on page change | Large result sets must remain usable beyond pointer interactions |

Suggested compact card grammar:

| Area | Example content |
|---|---|
| Heading | Brand · garment type |
| Main facts | €24 · M · Sehr gut |
| Verified features | Puffärmel · Blumenmuster · Knopfleiste |
| Uncertainty | Materialanteil unbekannt |
| Category disagreement, only when relevant | Quelle: Unterwäsche · Bildprüfung: Kleid |
| Actions | Original · Fotos · Merken · Vergleichen |

A browse card need not claim that it is a final style recommendation. Requiring
individual visual inspection of every catalog result before displaying the
results would make broad browsing expensive. Preserve the existing stricter
rule for actual visual claims and hard visual refinement: original photo pixels
must precede an assistant assessment. A UI-displayed image alone is not that
evidence. [Evidence module](../src/evidence.ts),
[presentation contract](../src/presentation.ts).

For clothing mislabeled by style or category, keep the existing relaxed
retrieval arms and independent visual requirement verdicts. A source category
is an observation to display, not a reason to discard a visually confirmed
garment. Likewise, a metadata-only match must not be upgraded into visual
certainty. [Planner](../src/planning.ts),
[evidence-aware refinement](refinement-design.md).

## Performance and validation priorities

The existing performance report already measures useful concrete work removal:
shared parsed public configuration, concurrent independent detail reads,
shopper-field projection, and request-local completed-object reuse. It records
five paired live detail observations and explicitly excludes a general
production latency guarantee. Preserve these optimizations and their freshness
boundaries rather than replacing them to obtain a newer library label.
[Provider performance evidence](provider-performance.md).

For the next release, the meaningful gates are:

1. Browse beyond the initial page through a substantially larger synthetic
   cohort; assert complete unique coverage, bounded payload/DOM and stable
   replay. Test feedback changes and overlapping native arms.
2. Import representative real native links with categories, price/measurement
   ranges, repeated positive and negative facets, encoded brand names and sort.
   Surface unsupported parameters and conflicting values; reject non-Sellpy
   hosts and unsupported paths.
3. Contract-test similar-brand response groups, malformed data, duplicates,
   unavailable service and source limits. Retain the bounded live probe as
   evidence, not as a broad recall benchmark.
4. Recheck actual MCP host rendering and continuation using the deployed result
   format. A successful unit test alone does not prove the ChatGPT host renders
   all intended cards.
5. Keep source failure, cancellation and `Retry-After` behavior observable.
   Broader result browsing should consume stored rows without increasing source
   traffic. Native endpoint additions must use the existing request controls.

These are recommendations, not claims that this audit ran new production load
tests. “No plugin cumulative item cap” must remain distinct from finite upstream
windows, per-call budgets, retained-storage costs and host rendering limits.
[Existing operating bounds](provider-contracts.md),
[request controls](../src/http.ts), [traffic coordination](../src/traffic.ts).

## Coherent implementation scope

| Priority | Work | Release rationale |
|---|---|---|
| P0 | Large stored-result browsing, larger initial page, compact canonical facts | Directly satisfies the latest explicit requirement |
| P0 | Preserve original-photo evidence and source limits in that browsing flow | Prevents breadth from weakening recommendation quality |
| P1 | Search-link import | Removes repetitive filter reconstruction; native contract verified |
| P1 | Native similar-brand discovery | Adds a genuine source-backed capability with a small adapter |
| P2 | History/availability details in the UI; same-currency shortlist subtotal | Reuses existing state and helps decisions without new account access |
| P2 | Paged export of observed results, if needed by the user workflow | Useful research handoff; must state coverage and observation times |
| Separate feature | Explicit scheduled watches | Requires a scheduler, deduplicated changes and a user-defined notification policy |
| Research gate | Native multi-garment segmentation | Product exists; current accessible integration contract remains unverified |
| Separate account integration | Native favorites, orders, selling, cart or checkout | Requires account-scoped authentication and distinct product semantics |

The selected scope should improve the full search-to-decision path, not increase
tool count for its own sake. Every extra endpoint must earn its place through a
clear user request it can answer, a verified contract, bounded operations and an
honest presentation of evidence. Current MCP library and transport choices are
reviewed in the companion engineering audit; this report does not label an
implementation “SOTA” merely because it uses the newest package version.

## Provider implementation handoff

Following this audit, the verified provider additions were implemented in
`src/sellpy/client.ts`, `src/sellpy/config.ts`, `src/search-url.ts` and
`src/public-reference.ts`, with focused contracts in
`test/native-extensions.test.ts`. MCP tool, run-state, gallery and deployment
integration remain the release owner's responsibility; this is not a deployed
version claim. The existing five native item routes remain unchanged. Similar
brands is optional configuration outside that route enumeration.

The public-reference downloader uses a separate uncredentialed GET transport,
manual redirect validation, a four-redirect budget, 10 MiB byte budget, image
signature checks and a download deadline of at most 15 seconds within the
call's remaining deadline. Production must use the **native global Workers
fetch** in the current `workers.dev` deployment, never a VPC/service binding or
an unprotected server-side Node fetch. Cloudflare documents outbound-proxy
checks that exclude internal network services, with a separate exception for a
Worker zone's own origin. No such zone-origin or private-network route appears
in the inspected deployment configuration. This platform boundary handles
resolved-address isolation; the JavaScript hostname checks alone do not prove
DNS-rebinding resistance.
[Workers security model](https://developers.cloudflare.com/workers/reference/security-model/),
[manual redirect and header behavior](https://developers.cloudflare.com/workers/runtime-apis/request/),
[deployment configuration](../wrangler.jsonc).

Validation: all **16 new native-extension tests and 31 existing provider tests
passed**; server TypeScript compilation passed. The new tests cover optional
configuration, brand identity/order, response and rate-limit errors, faithful
and rejected URL imports, uncredentialed download requests, unsafe redirects,
streaming byte limits, cancellation and deadline behavior. Network isolation is
the documented production platform boundary, not a behavior proved by a
mock-based DNS test. No package version, deployment or commit was changed by
this implementation handoff.

### Completed public-observation coordination

The provider now wraps public search, complete canonical details, facets and
native brand discovery in `withCachedObservation`. Completed normalized JSON
is stored in SQLite through the existing `OriginGate` Durable Object class.
Atomic claim/commit/release leases coordinate different Worker request
contexts; there is no global live Response, stream or in-flight I/O Promise.
The production design follows the documented
[SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
and is exercised using the official
[Durable Object request and eviction test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/).

| Operation | Maximum reuse age | Freshness basis |
| --- | ---: | --- |
| Public search | 15 seconds | Earliest original page/item observation |
| Complete details | 5 seconds | Earliest original item observation |
| Facets | 60 seconds | Original facet observation |
| Native brand alternatives | 60 seconds | Original brand observation |

Exact semantic request data is SHA-256 hashed; the only excluded search-arm
field is the run-local arm identity. Market, language, query, hard filters,
sort, pagination, seeds and public image identity remain part of the key.
Echoed `applied_filters` and `seed_brands` are removed from persisted results
and restored for the exact caller. Uploads, retained private references,
account data, profiles and collections are outside this shared store.
Failed/partial detail batches retain their retry metadata and continuation
IDs and are never cached.

Sixteen hash shards each allow at most 128 observations, 8 MiB of serialized
observation content, 512 KiB per entry and 256 concurrent ownership leases.
Indexed expiry deletion, bounded eviction and Durable Object alarms reclaim
expired records; a lease lasts no more than 45 seconds. Expired or superseded
owners cannot publish stale results or release a newer owner's lease.
`withoutObservationCache(context)` provides a forced source refresh and is
used by explicit item-refresh integration. A still-fresh cache hit is allowed
during an origin cooldown because it performs no upstream request; cache
misses retain the existing origin pacing and Retry-After behavior.

Validation: **57 focused Node tests** (10 cache, 16 native extension and 31
existing provider tests) and **6 actual Workers runtime tests** pass, along
with server TypeScript and whitespace checks. The runtime test launches four
separate Durable Object request contexts with independent provider instances;
all four cold identical catalog calls cause exactly **one catalog request**.
The stored result survives actor eviction with identical page and item
timestamps. Runtime checks also cover market/filter/pagination separation,
explicit refresh, partial-detail exclusion, facets and brand reuse, lease
replacement, origin cooldown persistence and private-reference bypass. This
proves the controlled concurrency contract, not a production latency or
throughput benchmark. No deployment or commit is part of this handoff.
