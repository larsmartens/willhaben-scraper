# Marktplatz-Studie

A read-only marketplace research plugin for regular ChatGPT chats. Run the full local suite with Node 22 or newer using `npm test` from this directory. The Worker has no package or build dependencies.

## Connect

On ChatGPT web, open Plugins, choose **Add custom MCP server**, and register **Marktplatz-Studie** with `https://marktplatz-studie.lars-e82.workers.dev/mcp`. The public installation uses **No authentication**. Install it and select it with @ in a fresh chat. The same connection can be tested on Android. Open `/health` to check the version and live availability. The portable plugin manifest and bilingual research skill are under `plugin/`.

## Data and evidence

- A real buying request begins with `plan_search`. It returns direct willhaben searches, query variants for native web search and any constraints requiring detail checks. The Worker never sends that planning request to willhaben. Indexed, user-supplied and synthetic records have distinct provenance.
- Pass `source: "provided"` with up to 300 distinct records to analyze material the user can process. Each record requires an ID, title and numeric asking price or null. Retain listing links and use typed attributes for evidence. Photos and missing measurements have different evidentiary value.
- Invoke `source: "demo"` only to demonstrate the workflow. The included BANKAMP and smartphone examples are synthetic. `discover_filters`, `search_listings` and `inspect_listings` support drilldown. `study_market` searches up to eight variants and checks independent criteria with explicit unknowns. Query exhaustion describes only the source and variants at the observation time. Large studies can reach their page/detail budgets.
- Studies group comparable asking prices by category, model, condition and known unit basis. The default minimum cohort size for a median is five. Shipping-inclusive metrics require known shipping. An absent listing is not proof of a sale.
- `study_market` is request-scoped. Explicit `save_study` retains the computed report, terms and criteria in Cloudflare KV for 24 hours. A random capability ID permits reading; keep it private. `get_study` and `compare_studies` use the saved observations. Cross-region KV reads may briefly lag a save.
- The hosted setup uses no willhaben credentials. Automated live retrieval requires the platform's appropriate access grant, operator configuration `LIVE_ACCESS=authorized` and an operator-managed `MCP_BEARER_TOKEN`. Photos also require `IMAGE_ACCESS=authorized`. Store tokens as secrets. Verify live fixtures and scoped permissions before enabling. A private OAuth or an API-key-capable connection is required to use a protected route from a hosted client. There is no periodic crawling.

## Cloudflare deployment

The deployment consists of the four ES modules in `src/`. Upload them as JavaScript modules with their basenames, using the Workers Scripts API multipart upload and `deployment/metadata.json`. Replace the placeholder with a dedicated KV namespace ID and select a rate-limit namespace unused by your other Workers. Enable the Worker subdomain for public HTTPS. Leave live and image activation unset for a deployment equivalent to the public version. Review existing bindings and secrets before updating a customized installation.

The metadata is the template used by the Cloudflare connector. No third-party handler, account-wide route, scheduled task, or browser extension is required.

## Try it

- „Suche nach matten, kugelförmigen Ersatzgläsern mit 60 mm Durchmesser. Zeige nur bestätigte Maße und separat die Kandidaten mit offenen Fragen.“
- „Teste das mit dem BANKAMP-Demokatalog. Vergleiche Ersatzglas, Lampengläser und Ersatzschirm und prüfe diameterMm, openingMm, shape und finish.“
- “Compare these provided listings by unit price and confirmed shipping. Mark unknown measurements. Save the result for tomorrow.”

## References

- Existing local SDK audit: https://github.com/larsmartens/smartphone-market-monitor/blob/19478a50cbb08d56d4350e8ec297921393909cb3/docs/research/marketplace-options.md
- Filter and pricing reference: https://github.com/taneron/willmehr/tree/908a82eebc6c204eeae3ccad346f7152dcc0ea4f
- Detail, photos and pagination reference: https://github.com/Samxel/willhaben-mcp/tree/757459c55ea5a7e87a34cce0910780ea4c0465dd
- Embedded-page shape and bounded research reference: https://github.com/aliildan/willhaben-mcp/tree/3ddd9a39176a7e72ca255b7e8116b61b5fc6da73
- Access conditions: https://www.willhaben.at/iad/nutzungsbedingungen and https://www.willhaben.at/robots.txt
