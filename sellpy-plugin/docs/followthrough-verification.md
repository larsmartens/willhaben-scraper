# Sellpy Studio 1.1.1 follow-through verification

Verified on 7 November 2026. The existing personal ChatGPT connection reports **1.1.1** and exposes the same **24 tools**. This patch makes the transition from original-image inspection to saved evidence explicit. It adds no tool or database migration.

## Problem and correction

A previous real ChatGPT comparison fetched original photos and described visible garment details, but did not save an assessment. The gallery therefore correctly showed no saved visual evidence, and strict visual refinement could not use the prose.

Model-directed image responses now identify the exact run, item, successfully delivered image IDs and search-intent criteria. They instruct the assistant to inspect those images, save its actual findings and use a fresh gallery or refinement. The context explicitly covers search intent only. A current refinement's returned criteria remain authoritative when a profile or explicit override changes them.

Gallery responses identify selected items without a current saved assessment. The follow-up applies to visual recommendations; a catalog or price selection remains valid without image analysis. The German gallery says "Bildbewertung offen" until an assessment is saved. The comparison explains that no current assessment is stored. The chat button asks the assistant to retain checked visual details and open questions in the selection.

Delivery, widget hydration, shortlist decisions and a confident free-text reason still cannot create visual evidence. Failed images and previously delivered images are excluded from the new same-batch context.

## Independent review and regression checks

The non-author reviewer independently ran the new tests on an isolated old checkout and on the candidate. The old production code failed all three new presentation assertions and three of the four Workers checks because the handoff fields were absent. Widget isolation already passed.

| Candidate check | Result |
| --- | --- |
| Presentation and refinement | 35 Node tests passed |
| Actual Workers handoff and research storage/RPC | 11 tests passed |
| Backend and UI typechecks | Passed |
| Live-check syntax and diff whitespace | Passed |
| Exact built artifact checks | Worker and gallery hashes matched the review |

See [independent review](followthrough-review.md). These scoped checks are distinct from the historical 1.1.0 release gates in [upgrade-verification.md](upgrade-verification.md).

The local Playwright browser executable was absent. Its standard official installer received HTML instead of a usable ZIP. No new local browser-suite pass is claimed. The deployed ChatGPT UI is checked separately below.

## Live server checks

All five checks in [the live report](followthrough-live-verification.json) passed against this deployment:

1. Server version 1.1.1, all 24 tools, and the exact new gallery resource.
2. Widget-only image loading returns neither model image blocks nor assessment context.
3. Model image loading returns one actual image, its same-batch ID and the four exact intent requirements for the test search.
4. Ordinary presentation remains usable without a fabricated assessment. Its card stays unassessed and the run's assessed count stays zero.
5. Explicit requirements replace the default criteria without changing override semantics.

The live script deleted only its own disposable run. It wrote no visual assessment or preference profile. The actual connected ChatGPT capability tool independently reported 1.1.1 after deployment.

## Actual ChatGPT acceptance

The acceptance chat first selected two available floral dresses under EUR 40 using shop data. The first gallery showed "Bildbewertung offen" for both items. ChatGPT then fetched front and back original photographs, saved two assessments, and issued a new gallery. The new cards showed 2/4 and 2/5 examined photographs.

An independent read through the connected tools found two stored assistant assessments in a six-candidate run. Each referenced two exact photo IDs and contained visible matching features and uncertainties. The comparison UI displayed those saved features and kept missing material, measurement and personal-fit facts separate from observed appearance.

The comparison's "Im Chat besprechen" action sent both selected item IDs and their run ID to the same chat, together with the new request to retain findings. The completed reply inspected available label photos and updated the gallery to 3/4 and 4/5 checked photographs. One unavailable additional image for each item remained explicitly unassessed. No user preference profile was changed by the test operations performed by this release owner.

A strict refinement for the new requirement "Lange Ärmel" initially returned no eligible candidates and six unknowns. The existing general photo assessments had no verdict for that exact requirement; prose describing sleeves was correctly insufficient.

A natural follow-up then required long sleeves and excluded unknown cases in the same research. ChatGPT inspected all six discovered candidates and saved an exact requirement judgment for each: three confirmed and three contradicted. An independent tool call using the same strict preferences returned exactly three eligible candidates, three exclusions and zero unknowns for that criterion. Each included candidate's criterion source was `visual_assessment`. A separate non-author read confirmed all six persisted assessments and their 15 checked-photo references.

The completed ChatGPT reply displayed all three confirmed candidates in a new gallery. The earlier sleeveless item was excluded. One included item's intended use remained uncertain: Sellpy called it a hooded dress, while its photographs looked more like a house dress or robe. That uncertainty stayed visible; confirmation of long sleeves did not silently confirm every other property. Previously recorded label findings and open questions were preserved.

This is one observed workflow, not a statistical estimate of assistant reliability, classification accuracy or full-catalog recall. Private chat URLs, run IDs and screenshots are excluded from the public repository.

## Exact release identity

| Identity | Value |
| --- | --- |
| Server version | 1.1.1 |
| Local reviewed production commit | `0ce03efd768d1d14694f0e351851568ca64c0009` |
| Corresponding remote production commit | `bac593a917479ce12b569d5af5872dec1263b3db` |
| Exact production tree | `cd6fa52cc8b61739b83c1d308e57c402f8e3a007` |
| Worker bytes | 1,549,780 |
| Worker SHA-256 | `395520fc8be0b8dfe812b14fd6be24e672f57a77c97158e5b0065ef30461b1d0` |
| Gallery bytes | 720,764 |
| Gallery SHA-256 | `ce19b2c74c33e6a8755ce51deb729988beb686d1947e2d351effc687587b3bdc` |
| Deployment | `b97064d032b84a4482fc7134237ae2e4` |
| Deployed at UTC | 2026-11-07 12:21:10 |

Direct Worker download after deployment reproduced the reviewed hash and byte count. Existing namespace IDs, credential binding, market/language settings and logging settings were preserved. The patch adds one status RPC for each model-directed image batch; no latency improvement is claimed for that read.

## Installed package label

The installed plugin page still shows 1.0.0. Automatic approval review rejected a new ZIP upload because the earlier upload had been aborted and its continuation note prohibited another attempt. No new upload occurred. A concrete 736-byte package with version 1.1.1 and the same existing app reference is prepared, but a retry requires explicit user approval. This does not prevent the connected 1.1.1 server or its 24 tools from operating.
