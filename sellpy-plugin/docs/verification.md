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

Exact candidate commit, independent verdict, remote deployment version, modern/legacy MCP smoke test and ChatGPT installation observations are appended during release verification. Their absence is not a successful deployment claim.
