# Sellpy Studio 1.2 release verification

Verified on 7 November 2026. **Server 1.2.1 is deployed and the existing installed ChatGPT plugin reports package version 1.2.1.** The package now includes one app and one Sellpy workflow skill. The same existing private connection and durable namespaces remain in use. No second confirmation was requested for the owner-authorized upload.

## Delivered behavior

Ordinary presentation opens all discovered candidates without requiring the model to enumerate their IDs. The default is twelve cards; the app offers twenty-four. Indexed keyset navigation preserves collection membership and order across restart and later discovery. New collections can include newly discovered candidates. Item facts retain their actual observation times; fixed membership is not a claim of an instantaneous catalog snapshot.

The app replaces its current page, retains three page payloads, and limits simultaneously selected comparison columns to four. Its original-photo cache holds at most 48 entries within a 12 MiB estimated budget. Only visible covers enter a four-request queue; at most two covers are embedded in the initial response. These bounds keep ordinary browsing proportional to one page, without imposing a total collection-membership ceiling.

One shared fact projector supplies cards, details and comparison. It removes exact display duplication, including size tokens already embedded in titles, repeated brands and category ancestor paths. Structured criteria distinguish confirmed, contradicted and unknown. Original descriptions, observed history and selection notes load on demand. A saved or displayed photo is not automatically an assistant image assessment.

New native capabilities are Sellpy search-link import, similar-brand discovery, public image references routed through native upload, and exact stored-item photo inputs. Existing catalog, semantic, similarity, source-image, upload and outfit routes remain supported. Public completed observations are coordinated with durable ownership leases; explicit current-detail checks bypass this short-lived cache.

## Source and runtime verification

| Gate | Observed result |
|---|---|
| Full Node suite | **163 passed**, none failed or skipped |
| Full actual Workers suite | **35 passed** across seven files |
| Backend/UI typechecks | Passed |
| Worker and gallery build | Passed |
| Browser traversal | **10,137 unique synthetic offers across 423 pages** |
| Browser bounds | ≤24 cards, ≤3 cached pages, ≤48 photos, ≤4 concurrent cover requests |
| Browser behavior | Global views, 12/24 paging, descriptions/history, photo continuation, comparison, feedback and legacy navigation passed |
| Stale responses | Page/photo/detail/refresh/feedback races passed, including same-run/same-collection replacement |
| Partial assessment refresh | Failed canonical follow-up preserves unknown; older page replay cannot clear it; explicit retry recovers |
| Responsive layout | 360, 390 and 1120 pixels; zero browser errors |
| Actual ingest scale | **10,001 synthetic provider observations across 101 source pages**, exact full traversal and owner reconstruction |
| Cold public-read coalescing | Four independent provider instances in four distinct DO request contexts caused **one controlled catalog request** |
| Access/evidence boundaries | Foreign owner, deleted-run reuse, forged cursor and widget-versus-model evidence tests passed |
| Private connection scan | No private endpoint or token in the 112 inspected publishable files |

Synthetic scale tests exercise actual ingestion, SQLite/DO and browser code against controlled provider/tool responses. They do not establish discovery of 10,000 actual Sellpy offers, native retrieval recall or arbitrary production capacity. Browser tests use real Chromium and the MCP Apps bridge with a simulated host; installed ChatGPT is checked separately.

The coalescing test counts the actual controlled catalog loader invocation, not merely cache lookups. The owner also fetched two public configuration resources. All callers received the same normalized data and original source timestamp, including after cache actor eviction. Cache error, isolation, lease recovery, partial-detail and explicit-refresh paths have separate assertions.

## Independent review

Two non-author review boundaries covered backend collections and native/cache/UI behavior. The reviewers reproduced and resolved one P1 memory issue and P2 migration, evidence-freshness and asynchronous error-adapter issues. See [the independent review record](scale-review.md). No unresolved P1/P2 finding remained at publication. The final browser pass includes the last older-page/unknown-assessment regression, which was still running when the second reviewer wrote its bounded review summary.

The large-row fix matters: preparing a price sort previously transferred about 147 MB of complete descriptions into one Worker step. It now reads scalar price/status/assessment/time fields. The retained canonical observations remain available separately.

## Live Sellpy and protocol checks

All **nine recorded gates** in [scale-live-verification.json](scale-live-verification.json) passed between 16:41:49 and 16:42:58 UTC on the exact deployed artifact:

1. Official SDK 2.4.0 negotiated protocol `2026-07-28`; the server exposed 27 tools, including 26 model tools and one app-only browsing tool. Canonical gallery-v3 returned 748,282 bytes.
2. A native AT search URL preserved query and EUR 60 maximum, returned 50 actual items, explicitly restarted a source-page-2 link from the first plugin page, and rejected an unknown restrictive parameter.
3. Default presentation showed twelve cards. A fixed 50-member collection remained stable after source continuation discovered 100 candidates. Traversal reached all 50 without duplicates; a new collection contained all 100 and returned 24 cards when requested.
4. A shortlist containing an off-first-page item was found across the complete collection. Stored detail identities matched. Shortlisting did not create visual evidence.
5. Native similar-brand discovery for COS returned five names: Arket, & Other Stories, Jouur, Uniqlo and Seaside Tones. The response explicitly said inventory had not been checked.
6. Stored-item photo search and public-reference upload each returned twelve native candidates. The public reference was retained for the actual native upload route.
7. The matched initial-page measurement below completed without error.
8. Legacy SDK 1.32.2 listed the same 27 tools and resumed the modern client's run through the unchanged private owner.
9. All three disposable runs created by the live harness were deleted. The pre-existing benchmark run and user preference profile were retained.

## Initial-page performance

The comparison uses the **same twelve actual item IDs**, with canonical details already loaded before measurement. The 1.1.1 baseline embedded all twelve covers; 1.2.0 embeds two and loads remaining visible covers through the app. It measures the first useful twelve-card tool response, **not full completion of all twelve photos or total ChatGPT response time**.

| Measurement | 1.1.1 | 1.2.0 |
|---|---:|---:|
| Three elapsed samples, ms | 6,056 / 2,829 / 2,957 | 777 / 733 / 730 |
| Median, ms | **2,957** | **733** |
| Response bytes | **1,201,576** | **128,089** |
| Cards | 12 | 12 |
| Initially embedded covers | 12 | 2 |

For this observation the initial-response median fell by about **75.2%**, and initial response bytes by **89.3%**. These are three before/after samples, not an interleaved randomized benchmark. Network conditions, cache state, source inventory and later image loading can affect the result. No claim of universal SOTA superiority follows from this measurement.

## Initial 1.2.0 release identity

| Identity | Value |
|---|---|
| Server/package version | 1.2.0 / 1.2.0 |
| Reviewed local production commit | `7e32bec971f00e3259013f8bced3b91e9cd0b050` |
| Corresponding remote production commit | `25c6116de649c692882c998e79f6baa36ca87ac5` |
| Matching production tree | `f7eb87b7120cbe30428fbd86f7df9fe9199974b2` |
| Worker bytes | 1,649,792 |
| Worker SHA-256 | `ebea9156ab91e4f93c2ec63ada9304e90898e3f99ac0d1e82fd344afb9b4c189` |
| Gallery HTML bytes | 748,282 |
| Gallery HTML SHA-256 | `a62c48cc538fad2923f60b4778c2391b0b6e3675025839fb3af1d2ab9bdf100f` |
| Cloudflare version ID | `f6f0db826a98406bb777928eea3bec4a` |
| Published UTC | 2026-11-07 16:40:58 |
| Installed update ZIP bytes | 9,802 |
| Installed update ZIP SHA-256 | `a002b7e9de4fabe80ca739cd185c40de323ba69937a752c27341fba7c9493087` |

Direct Worker download reproduced the exact reviewed SHA-256 and byte count. The original SearchRun and OriginGate namespace identities, inherited credential binding, AT/de defaults, compatibility settings, disabled invocation-URL logging and disabled tracing were verified after upload. Source code and generated gallery were already published to the existing feature branch/PR before deployment.

## Installed package and real host

Both authorized package uploads (1.2.0 and the final 1.2.1 correction) completed with **“New version uploaded.”** The existing plugin page now displays **version 1.2.1**, **Apps 1**, **Skills 1**, the new German description, updated example prompts and the Sellpy workflow skill. The existing app reference was preserved byte-for-byte. No new connection credential or permission scope was introduced.

The first installed-host acceptance found stale connection discovery: the package showed 1.2.0 but the connected app retained the old 24-tool catalogue. The initial gallery loaded, while its new internal navigation failed with a host resource-not-found error. **Refresh tools** on the existing connected app exposed all 27 tools. Reloading the existing chat resolved the app-only navigation; no navigation-code change was needed. This separate catalogue step is now part of the release instructions. In the observed host, refreshing tools also reset interface descriptions/prompts, so the final release refreshed discovery before the final package metadata upload.

The actual chat collected 100 real AT offers under a EUR 60 ceiling from two source pages, then opened the complete collection with twelve cards. The app changed to 24 cards and reached ranges **1–24, 25–48, 49–72, 73–96 and 97–100**. The next button was disabled at the end; previous returned to 73–96. Changing to twelve preserved the anchor, showing 73–84. Those app actions did not append another user message or model response.

The expanded scope showed 100 item facts delivered to the model, zero model photos, zero saved assessments and separately counted widget photos. The real cards used original item images, deduplicated display titles and labeled price/status/size/condition. This test is a shop-data overview, not a new proof of style-classification accuracy.

The expanded scope also exposed duplicated English explanatory notes and raw filter JSON. The final 1.2.1 correction replaces those with localized labeled facts, removes duplicate assessment and route information, and makes the footer structured. The canonical UI resource is v4; v3 and v2 remain compatible aliases. No candidate, persistence, provider or assessment behavior changed.

### Final 1.2.1 artifact and patch checks

| Identity | Value |
|---|---|
| Server/package version | 1.2.1 / 1.2.1 |
| Reviewed local production commit | `fd07e32e14c5e19bd2aaea86d88425c035a2d1b1` |
| Corresponding remote production commit | `91a3fe6bae4b1d952a510663db8d45eb0f9b01b3` |
| Matching production tree | `fef93538bd9292ee3c1c002bd5987637840dda5f` |
| Worker bytes | 1,652,738 |
| Worker SHA-256 | `f45cf4ece375275b9557bfcfea1166827bc817d62af67be5deea88fce2aef323` |
| Gallery HTML bytes | 751,147 |
| Gallery HTML SHA-256 | `c223254bb2feca3f4d05a4be80b34b037f76d987ac7d4e9ecb4383fe5acc628d` |
| Cloudflare version ID | `7025d59d96314f1ba9f91a5fa873e7ae` |
| Published UTC | 2026-11-07 17:07:26 |
| Installed update ZIP bytes | 9,802 |
| Installed update ZIP SHA-256 | `844d784ab8c049b83ba417d7e2014c192f7f392816d91d2102905cca4cdfa019` |

The final 1.2.1 build passed **163/163 Node tests**, **35/35 actual Workers tests**, both typechecks and the independent non-author review. A focused real Chromium pass verified German/English at 360/1120 pixels, exact filter values including zero, false and negative selections, unknown counts, native limits and safe text. There were no browser errors or horizontal overflow. See [coverage-browser-verification.json](coverage-browser-verification.json).

Direct download of the final deployed Worker matched its reviewed SHA-256 and byte count. The [read-only live UI release probe](ui-release-verification.json) negotiated the current protocol, listed all 27 tools, preserved the private authentication boundary, and read all three UI resource addresses. Every resource matched the built HTML byte-for-byte. Existing durable namespaces, inherited secret binding and privacy-related logging settings were unchanged.

The final installed **1.2.1** host check reopened the same existing 100-member research through `present_items`, without another source search or image assessment. The canonical v4 gallery opened at **1–12/100**, displayed the corrected labeled scope and footer, switched to **1–24/100**, advanced to **25–48/100** and returned to **1–24/100**. The scope preserved two observed source pages, 100 item facts delivered to the model, zero model photos, 38 separately counted gallery photos and zero current assessments. It rendered the category and maximum price as labeled facts, without raw filter JSON or the duplicated explanatory notes. Page actions did not append chat messages. The installed plugin page independently reported 1.2.1 with one app and one skill.

The 423-page traversal, nine native live gates and before/after measurements above belong to the 1.2.0 core. They were not relabeled as new 1.2.1 measurements. The patch received targeted browser checks, fresh full Node/Workers suites, exact live artifact reads and its own final host check. Private conversation identifiers and screenshots are not published in this repository.

## Practical limits

- No plugin-imposed lifetime count ceiling for discovered candidates or collection members. Native source windows, rate limits and platform storage/execution limits remain real.
- First upgrade of a historical run has a one-time scalar O(N) metrics aggregate. Normal pages and derived batches are bounded; extremely large historical production migrations were not benchmarked.
- Unrecorded historical deliveries remain unknown. An exceptionally large single historical selection entry has an explicit retained-record conversion error.
- Native category-relaxed retrieval improves opportunities to find mislabeled garments; exhaustive recall and style-classification accuracy have not been measured against a labeled Sellpy corpus.
- Native automatic segmentation and joint image/text editing have no verified integration contract here. Account purchases/reservations and background notification schedules are outside these research tools.
- The public-reference downloader's network boundary relies on the deployed global Workers public-network proxy. Re-evaluate it before a runtime move or private-network binding.
