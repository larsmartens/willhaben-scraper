# willhaben 1.4 implementation record

Baseline is `97c90e0a4654b19a7f5f8920ad4b20c2b5547e12`, deployed as 1.3.3. The requested outcome is a working ChatGPT app with native visual search, a larger progressive result overview, and a precise research audit.

## Verification predicates

- Current and three previously supported MCP revisions discover tools, execute a search and read a valid UI resource through the official SDK in workerd.
- A native visual search accepts a listing photo, a public image URL and a ChatGPT attachment descriptor. Its continuation retains the original visual search and filter scope.
- An overview starts with 12 cards, supports 24 per page and loads further observed results through app-only calls. Galleries expose every available photo in bounded batches.
- A research task reports each query, native totals, fetched pages, unique IDs, projected descriptions, model-delivered photo indices and app-delivered images separately.
- Parallel updates preserve audit records. Parallel identical cold searches use one upstream fetch. Origin pacing, cooldown and deadlines remain effective.
- Production testing includes the three original lamp listings and the rendered ChatGPT app, followed by a native visual-search call.

## Work sequence

1. Read pstack principles and reproduce baseline failures. Completed before implementation. Four simultaneous identical cold searches produced four upstream requests in a real SQLite/workerd fixture.
2. Test the riskiest integration choices in isolated prototypes. SDK 2.4.0 passed four wire revisions. Native JPEG upload returned 196 matches and a filtered second page returned 50 of 171 matches.
3. Implement independent units in separate git worktrees. Transport and build, visual provider and request coalescing, and the research session each have one writer. The integration worktree owns tools, presentation, branding and docs.
4. Integrate and run unit, workerd and browser regression suites. Review the diff independently against the pinned parent.
5. Apply AXI and Writing for Agents to the final tool and skill surface. Deploy through Cloudflare, update the installed plugin and test in a fresh ChatGPT conversation.

## Architecture decisions

| Question | Considered approaches | Selected approach and reason |
| --- | --- | --- |
| ChatGPT integration | MCP Apps, GPT Actions/OpenAPI, dedicated web application with Responses API | MCP supplies tool discovery, ChatGPT's `openai/fileParams` supplies attachment descriptors, and MCP Apps supplies embedded cards. A standalone app would add a separate application and chat session. |
| MCP implementation | Official SDK 2.4.0, Cloudflare Agents 0.33.0, Vercel mcp-handler 2.3.1, mcp-lite 0.10.0 | Official Fetch handler removes handwritten protocol validation and serialization. The existing Worker already owns routing and authorization. |
| Research state | Per-call counts, round-tripped full ledger, per-task SQLite Durable Object | A task-scoped object provides atomic deduplication and paged records without enlarging every model call. Explicit research IDs prevent different chats on the same connection from mixing. |
| Large overview | Eager images, infinite retained DOM with virtualization, bounded pages with lazy images | Twelve cards initially and at most 24 DOM cards per page. Photo bytes load for visible cards and requested galleries. |
| Image normalization | Client-only canvas, bundled image codecs, Cloudflare Images binding | The binding processes attachment and URL bytes directly. The observed willhaben frontend preprocesses reference images as JPEG with a maximum dimension of 300 pixels and quality 0.9. |

## Evidence

- Official MCP TypeScript SDK 2.4.0, release 2026-10-23, commit `951fe5603a7ec0b2dcb6a0b95d92cd86f93ad9e5`.
- Official MCP Apps 2.0.4, release 2026-10-27, commit `7af9a75da720b8a81be0f9aff47b25f75e9530ad`.
- Vercel mcp-handler 2.3.1, release 2026-11-05, commit `cfec693ee9327f59c4eb87cbc156f9f4dfc7347e`.
- Swarsel/shopservatory commit `7847da9aaf70ade9f6294ead6d756101ef802c56` independently implements native image upload.
- willhaben's current frontend chunk `9032.9fdd97819881e2f5.js` confirms raw JPEG upload and its 300-pixel preprocessing.
- Samxel/willhaben-mcp commit `757459c55ea5a7e87a34cce0910780ea4c0465dd` provides comparison points for category filters and seller context.

Package size measurements from isolated spikes are preliminary. Performance claims require a comparable baseline and head workload, identical output and failure accounting.

## Agent interface pass

AXI and Writing for Agents were applied after the feature integration. Search output has bounded projections and counts. Descriptions expose retained and total lengths. Typed input errors identify allowed fields before upstream work. `continuation.arguments` carries the next call's scope and research ID. Provided catalogs are requested through `repeatArguments` to avoid repeating their contents. App pagination stays in the app. Standard MCP JSON carries the typed contract.

The portable skill routes text search, reference images, pasted URLs and known listings separately. Its core workflow points to branch-specific visual-search, coverage, photo, continuation and study references. The successful presentation instruction keeps offer photos, facts and links together in app cards and specifies the short accompanying answer.

The native icon assets come from willhaben's public frontend. The 192-pixel asset is exposed at `/icon.png` in MCP server metadata. The same square 192-pixel asset is included in plugin package metadata as its logo and composer icon.

## Primary implementation references

- [Official SDK 2.4.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.4.0)
- [MCP Apps 2.0.4](https://github.com/modelcontextprotocol/ext-apps/releases/tag/v2.0.4)
- [Cloudflare Agents 0.33.0](https://github.com/cloudflare/agents/releases/tag/agents%400.33.0)
- [Vercel mcp-handler 2.3.1](https://github.com/vercel-labs/mcp-handler/releases/tag/v2.3.1)
- [Native image-upload reference](https://github.com/Swarsel/shopservatory/tree/7847da9aaf70ade9f6294ead6d756101ef802c56)
- [willhaben MCP comparison](https://github.com/Samxel/willhaben-mcp/tree/757459c55ea5a7e87a34cce0910780ea4c0465dd)
- [ChatGPT file-parameter contract](https://developers.openai.com/plugins/reference)
- [ChatGPT MCP app architecture](https://developers.openai.com/plugins/build/mcp-server)
- [GPT Actions](https://help.openai.com/en/articles/9442513-configuring-actions-in-gpts)
- [WebMCP](https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/webmcp)

## Automated verification

On 2026-11-07, 150 Node unit tests passed for 1.4.2. The complete OriginGate, provider, four-revision MCP and research workerd suites passed. The tool integration covers native image-search continuation, source-detail auditing through a later failure, criteria across overview pages, metadata-only app photos and executable continuation arguments. Both Chromium suites passed all 25 groups using the official bridge with a controlled host.

An independent reviewer repeated the ledger, visual-provider, coalescing and continuation regressions. The review found no remaining confirmed P1/P2 issue in that scope. The controlled coalescing test establishes four concurrent cold calls sharing one upstream request under an identical synthetic upstream workload.

## Production verification

The 1.4.0 API verification completed on 2026-11-07 at 14:17 UTC against Worker version `db8485b5-826a-4d0e-8a97-17fb0c0b3a9f`, published from commit `94461c6e37cc4ecb6840a87f6ca55e5579898b24`. Cloudflare confirmed that version serving 100 percent of traffic during verification.

The deployment exposed 16 tools across four MCP revisions. Text search returned 50 of 90 matches. Three original lamp listings were inspected. The overview returned two 12-card pages, two eager covers and four lazy covers. Native listing-photo search returned 50 of 198 matches. Public-image URL search and the attachment-descriptor pipeline each returned 30 of 196 matches. This API descriptor test used a public listing image and a synthetic file ID.

The combined audit counted four search calls, 160 returned rows, 128 unique listings, three descriptions delivered to the model, two model photo blocks and six app photos. The URL and attachment variants retain separate query identities even when willhaben assigns their shared image bytes the same native picture key.

## ChatGPT client acceptance and 1.4.1 follow-up

A fresh ChatGPT web conversation rendered twelve lamp cards with original photos and expandable research coverage. Its six search scopes covered 158 unique retrieved listings. The displayed audit reported 16 descriptions, 19 model-delivered photos and 13 recorded reviews. Individual records exposed description lengths, field lists, precise photo indices and recorded findings.

A second conversation uploaded an actual public listing photo through ChatGPT's file picker. Native image search returned 196 matches, a category-filtered search found the original lamp, and an alternative original photo returned 195 similarity matches. The app displayed twelve selected offers and separate uploaded-image and listing-photo query records. Its seven-photo reference gallery loaded in two batches, with every original image decoded at 300 by 400 pixels.

The client run exposed two follow-ups included in 1.4.1. Detail-gallery thumbnails were only 56 pixels wide, so app covers now prefer each observed main-image URL with the existing byte-budget thumbnail fallback and a fallback for an unavailable main image. The two eager covers, four-cover lazy batches and app-only image delivery remain covered by regression tests. The willhaben logo also appears inside the result header.

The agent workflow now completes an overview from the first useful search page and leaves detailed inspection to verification, purchase advice and studies. The initial audit displays the actual counts, including zero detailed inspections. The installed plugin package includes the revised skill. Its manifest and server metadata contain the willhaben icon. The ChatGPT plugin directory still displayed its generic fallback icon during the observed 1.4.1 package check.

## Collection lifetime correction in 1.4.2

A longer ChatGPT study exposed a mismatch between seven-day collection membership and five-minute shared search observations. After the cache expired, a 51-ID collection displayed only five cards in its first twelve slots. The model recovered by refreshing evidence, but app-only navigation could still leave incomplete pages.

ResearchSession now stores bounded, normalized listing observations atomically with search and detail events. Presentation and cover calls resolve only the selected page or cover subset against those research-owned facts. Original observation times, whole-observation ordering and deletion evidence are preserved. Access renews the research's seven-day inactivity period. Expiry cleanup removes its retained observations. Search and detail freshness retain their existing five- and fifteen-minute policies.

The workerd regression covers all 100 IDs after cache expiry and restart, their original times, lazy covers, negative-cache timestamp preservation, newer search recovery and old collections with missing observations. An independent 50-ID reproduction returns 12/12/12/12/2 cards after expiry and restart, with four lazy covers and zero extra detail requests. Missing data in older collections now has a visible recovery notice. Page ranges use the requested slots and remain accurate when some rows are unavailable.
