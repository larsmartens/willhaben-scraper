# Provider efficiency and freshness evidence

Verified on 7 November 2026 (Europe/Vienna). The machine-readable record uses UTC.

## Measured result

Five alternating, paired live observations of the same three-item canonical
detail workload returned equivalent normalized results with zero errors. Only
`observed_at` is excluded from the equivalence check. Prices, availability,
metadata, item identities, complete original-photo references, failures and
remaining IDs are included.

| Metric | V1 baseline | Candidate |
|---|---:|---:|
| Samples | 5 | 5 |
| Median elapsed time | 17,332 ms | 5,852 ms |
| Minimum–maximum | 14,774–20,606 ms | 5,779–10,406 ms |
| Source requests per detail call | 4 | 2 |
| Response bytes per detail call | 36,523 | 10,778 |
| Maximum simultaneous source requests | 1 | 2 |
| Failures or unprocessed IDs | 0 | 0 |

The observed median reduction is **66.2%** for this workload. These are direct
Node-to-source observations in one environment, without production OriginGate
pacing. They are **not** ChatGPT response times, deployed-edge percentiles, or a
general performance guarantee. All samples, including the slower candidate
observations, are retained in [provider-performance.json](provider-performance.json).

The baseline is local revision `92ac6218496d4057626ddcc58621687c8dc9dcc3`, whose
tree matches the published V1 release `0f870b0373ded434e602f2e7e6c7d3d19395c2a5`.
The record contains the source-file hashes and both frozen benchmark bundle
hashes. The measured candidate provider source SHA-256 is
`21ffe5721383788ffad894dd3e538c6dc546d55d29db323b867f01e676005f44`; its bundled
runtime SHA-256 is `01416068f5e6a45bfdcfb6aad000cf2e31bccd5e91b8fcdf187ab06262469d21`.
Both were compared with the current checkout after the run and matched.

## Work eliminated

The baseline recreated a provider for each stateless detail tool, discarding its
existing parsed-public-configuration cache. It then fetched the catalog objects
and canonical GraphQL detail in sequence. The candidate:

1. Reuses `sharedSellpyProvider` for stateless tools. Its existing 30-minute
   configuration cache contains only parsed public configuration data. It never
   shares requests, response bodies, streams, or pending I/O promises between
   invocations. SearchRun continues to own a separate provider instance.
2. Starts the two independent detail sources together, bounded to two requests.
   `Promise.allSettled` waits for both outcomes. Individual failures, incomplete
   IDs, cancellation and the latest observed retry time are preserved.
3. Requests only the shopper attributes needed for normalization and filtering
   from Algolia, plus the exact market price and first-offered timestamp. For
   the three measured items, object-response bytes fell from 8,519 to 4,115;
   the canonical GraphQL response remained 6,663 bytes. The same normalized
   output was retained.
4. Reuses completed native-search object observations inside the same request,
   including missing-object results. Keys include application/index, market and
   item ID; the index distinguishes language. Each arm reapplies its own hard
   filters. Original object-observation timestamps are preserved. The temporary
   memo holds at most 2,000 entries, evicting old entries without limiting search
   coverage. A new request begins with no such item cache. Concurrent in-flight
   hydration requests are not shared across requests or coalesced.

**Current detail checks always bypass the search memo.** They make new catalog
and canonical requests; old prices are never promoted to fresh observations by
this optimization. The measured detail improvement does not depend on an item
or price response cache. No reference-image bytes are stored in the provider
memo.

The overall benchmark compares the intended stateless-tool workflow after a
capabilities call. V1 still constructs a new provider at the next tool call;
the candidate retains plain configuration. Warm-up calls are recorded but
excluded from the detail timing samples. The experiment measures the combined
configuration, concurrency and field-selection changes, not an independently
estimated contribution from each.

## Behavioral checks

`node --import tsx --test test/provider.test.ts` passed **31 tests**. The added
regressions cover:

- A controlled barrier proving the two independent sources actually overlap and
  both settle before the method returns.
- Canonical HTTP 500 fallback without concealing its failure; catalog and
  canonical HTTP 429; simultaneous failures retaining the latest retry time;
  timeout and cancellation retaining all unprocessed IDs.
- Field-selection equivalence with the full object, including filters on
  measurements and brand; ordered object-identity validation.
- Overlapping native arms reusing completed observations, retaining original
  timestamps and reapplying different hard filters.
- Request, market and language isolation, plus fresh-price validation bypass.
- Shared plain configuration across contexts while both detail sources are
  fetched anew in every context.

The unchanged earlier cases cover canonical photo identity/enrichment, privacy
allowlists, source windows, native upload and outfit contracts, stale regional
configuration recovery, market prices and continuation. The server TypeScript
check also passed. Full release and deployment verification is recorded by the
integration owner separately.

## Reproduce

Use a locally available V1 revision whose package tree corresponds to the
published V1 release, or fetch that public revision first:

```sh
node scripts/benchmark-provider.mjs \
  --baseline-ref 0f870b0373ded434e602f2e7e6c7d3d19395c2a5 \
  --samples 5 \
  --ids PZv57Y9Eot,zEeZQYpm0i,kwPIDKhoUS \
  --market AT \
  --language de \
  --output artifacts/private/provider-benchmark.json
```

The harness freezes both source variants before building them, alternates A/B
order, records `uptime` and `nproc`, and stores source/artifact hashes, elapsed
time, request count, response bytes, concurrency, errors and output equivalence.
It uses public source access and never reads the private MCP credential. Replace
sold or changed sample items with current public item IDs and report that new
workload explicitly. Any mismatched output or failed pair makes the comparison
inconclusive instead of reporting an accepted improvement.

## Primary technical sources

- [Algolia: Retrieve records](https://www.algolia.com/doc/rest-api/search/get-objects)
  documents ordered multi-object retrieval and per-object `attributesToRetrieve`.
- [Cloudflare: Errors and exceptions](https://developers.cloudflare.com/workers/observability/errors/)
  explains request-bound I/O and explicitly distinguishes caching plain data
  from caching response/stream objects across invocations.
- [Cloudflare: Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
  documents the limit of six simultaneous connections awaiting response headers.
  The detail path here deliberately uses only two independent source requests.
- [Observed Sellpy contracts](provider-contracts.md) records the first-party
  endpoints, public configuration discovery and field semantics. Measurements
  and `sizeEstimated` were already supported. No historical or original-retail
  price field has been established by these changes; price differences must
  remain comparisons between actual saved observations.
