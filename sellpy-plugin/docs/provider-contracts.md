# Sellpy provider contracts and live evidence

Verified **2026-11-06, 22:31 UTC**, against first-party frontend release
`a3f361d92d68c0aac28e373573978596738012d9`. These are the public website's current
service contracts. Sellpy has not provided this project with a published partner
API agreement or a stability guarantee. Route availability here is supported by
successful requests, not merely the presence of a URL in JavaScript.

`src/sellpy/client.ts` exports `createSellpyProvider()`, implementing
`SellpyProvider` from `src/domain.ts`. It uses `context.fetch` for **every** network
request, including frontend discovery and reference-image downloads. The caller
therefore controls allowlists, pacing, retries, redirects, cancellation and the
deadline. The provider does not access a Sellpy account, session or checkout.

## First-party evidence

| Source | Contract established |
|---|---|
| [Search HTML](https://www.sellpy.com/search) | Current public configuration chunk is discoverable from module preloads. |
| [Public configuration](https://www.sellpy.com/market/config.prod.C-K-4R31.bundle.js) | Locale-specific Algolia applications and index names; public GraphQL and native ML endpoints. No values from the public key fields are committed. |
| [Algolia adapter](https://www.sellpy.com/market/algolia.2xf3DadQ.bundle.js) | Current SDK 5.45.0, flat multi-search request parameters, exact object-lookup body, configured sort indices and 1,000-object request batch bound. |
| [Item hydration](https://www.sellpy.com/market/algoliaItems.CxxMV2F8.bundle.js) | Market availability checks use `price_<region>.amount > 0`; optional reserved exclusion requires `isReserved === false`. |
| [Native ML adapter](https://www.sellpy.com/market/mlProvider.DYIBChwE.bundle.js) | Text, item-ID and image-URL requests; score envelopes; offsets; English metadata filters; base-unit currency ranges; source `hasMore` behavior. |
| [Labs text UI](https://www.sellpy.com/market/CLIPSearch.Cqd0HFZJ.bundle.js) | Current Labs search uses the native text provider. A configured legacy CLIP URL alone is not used as evidence of a working route. |
| [Product detail UI](https://www.sellpy.com/market/BuyerPDPPage.CQkv4AJ9.bundle.js) | `getPdpItem`, original image/photo fields, public English metadata, complementary recommendations, measured dimensions and shopper metadata. |
| [Shared Sellpy definitions](https://www.sellpy.com/market/npm.sellpy-commons.CckBL0yS.bundle.js) | Region/currency/domain registry, default catalog price gate, URL filter mappings and price unit conversion. |

Configuration is discovered at runtime, parsed as bounded **static literals**,
and never executed. Parsed data may be cached for 30 minutes in a provider
instance; no pending fetch or other I/O promise is retained across requests.
Endpoints must match the observed first-party hosts and paths. A changed format
or endpoint fails explicitly instead of sending public keys to an unknown host.
Public configuration is not returned in tools, fixtures, errors or logs.

### Observed regional stale-asset recovery

The first deployed capability call exposed a real regional difference: the edge
received 255,057-byte search HTML referencing `config.prod.CY9fKIHd.bundle.js`.
That retired asset returned HTTP 200 with 11,585-byte SPA HTML instead of
JavaScript. The returned HTML referenced `config.prod.C-K-4R31.bundle.js`, whose
9,756-byte JavaScript contained the valid current configuration. The provider now
follows only observed, quoted relative or exact first-party asset references,
tracks visited paths and attempts at most three distinct assets per call. It
rediscovers paths only from HTML and caches only successfully parsed JavaScript.
Malformed JavaScript still fails explicitly. A temporary diagnostic Worker was
deleted after confirming this cause; no public keys were logged or committed.

## Search, sorting and facets

The current catalog endpoint is:

```http
POST https://<public-application-id>-dsn.algolia.net/1/indexes/*/queries
Content-Type: application/json
x-algolia-application-id: <runtime public configuration>
x-algolia-api-key: <runtime public configuration>
```

```json
{
  "requests": [{
    "indexName": "<configured locale and sort index>",
    "query": "Blumenkleid",
    "hitsPerPage": 50,
    "page": 0,
    "filters": "price_AT.amount > 0 AND isReserved:false",
    "facetFilters": [["metadata.brand:Cellbes", "metadata.brand:Other brand"], "metadata.color:-Black"],
    "numericFilters": ["price_AT.amount>=1500", "price_AT.amount<=5000"]
  }]
}
```

The first-party adapter sends flattened request parameters in the `requests`
array. `relevance`, `newest`, `price_asc` and `price_desc` select the respective
current configured indices. Search requests restrict returned attributes to
shopper data; normalization separately applies a strict output allowlist.

`SearchFilters.price_min` and `price_max` are **base currency units**: `25.50`
means EUR 25.50 in AT. Catalog numeric filters use integer minor units (`2550`).
Every returned `Money.amount_minor` is an integer minor-unit amount from the
exact requested market. There is no fallback to Swedish prices or currency
conversion. An absent/mismatched market price remains `null` in details and is
excluded from search results. `original_price` stays `null` because the observed
`pricing` field is not established as an original retail price.

Positive values within one facet are OR-ed; different facets are AND-ed. A value
prefixed with `-` excludes that value. Shopper facet names are allowlisted; unknown
or internal attributes cause an explicit unsupported-filter error. An arm with
`category_relaxed` drops type/category constraints while retaining other hard
constraints. Measurement ranges are centimeters; the observed names include
`lengthInCm`, `innerLegLengthInCm`, `waistInCm`, `widthInCm`, `heightInCm` and
`heelHeightInCm`.

Facet discovery uses the same catalog query with `hitsPerPage: 0` and `facets:
["*"]`, then returns only allowlisted shopper facets. Numeric price statistics
are converted to **base units**, matching `SearchFilters`; measurement statistics
remain centimeters. Internal storage, proximity and employee-related fields are
never exposed. Algolia's default facet-value window still applies; returned facet
values are not claimed to be an exhaustive dictionary.

Catalog `nbHits`, `nbPages` and page size define the accessible query window. The
provider distinguishes an exhausted result set from an upstream pagination
window and warns when Sellpy labels the total approximate. A live AT catalog
request returned `nbHits: 619744` (estimated), a 2,400-hit accessible window and
`next_offset: 2`. This is a source/query observation, not a hardcoded plugin cap.

## Native semantic, similar and image-URL retrieval

All three currently use `POST`, JSON, and the public configuration field's
`X-SimilarItems-Key`. Each route is independently live-proved.

| Route | URL | Route-specific body |
|---|---|---|
| `semantic` | `https://services.sellpy.net/similar-items-app/get-similar-by-text` | `{"texts":["cottagecore floral dress puff sleeves"]}` |
| `similar` | `https://services.sellpy.net/similar-items-app/get-similar` | `{"objectids":["va0uL6CUOK"]}` |
| `image` | `https://services.sellpy.net/similar-items-app/get-similar-image` | `{"images":["<observed public Sellpy image URL>"]}` |

Each body also contains `nItems`, zero-based `offset`, an honest
`request_source: "sellpy-chatgpt-plugin"`, and optional native filters. Responses
have `results`, one result per input, and ordered `items` with `objectid` and
`score`. Text results identify the input with `text`; ID/image results use
`objectid`. Scores are retained as source provenance, not added across routes.
Ranks are absolute 1-based positions within the retrieval arm. With multiple
seed IDs in one arm, an item retains its best native seed rank; separate seed
arms provide clearer independent ranking provenance.

Native IDs are hydrated using the exact public object-lookup endpoint:

```http
POST https://<public-application-id>-dsn.algolia.net/1/indexes/*/objects
```

```json
{"requests":[{"indexName":"<configured newest index>","objectID":"va0uL6CUOK"}]}
```

The response is an ordered `results` array, with `null` for missing objects.
Hydration applies the requested market gate and all hard filters. Batches of
1,000 objects are a per-request transport constraint, not a cumulative limit.

Native price filters are **base units**, e.g. `"price.EUR": [15, 50]`. The source
uses `Number.MAX_SAFE_INTEGER` when the upper bound is open. Native metadata
filters use English values. Brand and size codes are language independent;
supported English filters may be sent directly. Unsupported/localized facet
constraints are applied after hydration against the selected locale, with an
explicit warning. No invented German-to-English taxonomy is used.

An entirely filtered-out source page still advances by its raw native offset;
it is not treated as exhaustion. Native services expose no complete catalog
total. A short native response is reported as an `upstream_window`, matching
the observable retrieval limit without claiming that every Sellpy item was
searched. Native routes retain native relevance; global newest/price ordering
requires a catalog arm.

## Uploaded reference images

The live-proved native upload endpoint is:

```http
POST https://services.sellpy.net/similar-items-app/get-similar-user-image
X-SimilarItems-Key: <runtime public configuration>
Content-Type: multipart/form-data; boundary=<generated by fetch>
```

Multipart fields are `image` (binary file), `nItems`, `offset` and
`request_source`. The response is a **bare ordered array of item-ID strings**.
There is no score envelope or public upload URL. A JSON body with an `image`
field returned validation error 422 and is not used.

The provider calls `context.read_reference(reference)` first. The run layer can
therefore retain the authorized reference privately, so continuation does not
depend on an expired ChatGPT download URL. If no prepared bytes are available,
the provider downloads through `context.fetch`. It does not cache private image
bytes, put them in plans/model output, or create an image-hosting service.

JPEG, PNG and WebP signatures are checked from bytes; a declared MIME type is
insufficient. The shared runtime/provider **per-file** transfer bound is 10 MiB.
This is not a cumulative image or results cap. Actual native live probes used
JPEG. The provider sends all hard filters through post-hydration checks because
native multipart filter semantics have not been verified.

### Confirmed native upload pagination

The same public dress photograph was submitted twice through the implemented
provider, with `nItems: 2`:

| Offset | Raw native response | Provider ranks | Next offset |
|---|---|---|---|
| 0 | `va0uL6CUOK`, `N2tn7C6yru` | 1, 2 | 2 |
| 2 | `66eICtkEt4`, `aR8IyszSih` | 3, 4 | 4 |

The responses had no overlap. This verifies that the multipart offset is acted
on; its presence in a request alone would not establish pagination support.

## Public item details and image identity

```http
POST https://sellpy-parse-prod.herokuapp.com/graphql?_=SellpyPluginItems
Content-Type: application/json
X-Parse-Application-Id: <runtime public configuration>
region: AT
```

```graphql
query SellpyPluginItems($locale: String!, $id0: ID!, $id1: ID!) {
  item0: getPdpItem(itemId: $id0) {
    objectId createdAt itemStatus paidAt metadata_en
    localizedMetadata(locale: $locale)
    images { ... on Element { value } }
    photos { ... on Element { value } }
  }
  item1: getPdpItem(itemId: $id1) {
    objectId createdAt itemStatus paidAt metadata_en
    localizedMetadata(locale: $locale)
    images { ... on Element { value } }
    photos { ... on Element { value } }
  }
}
```

No account/session token is required by the observed public buyer query. A live
two-alias request returned two details, with five and six images respectively.
The provider batches ten aliases per request and preserves `remaining_ids` when
its time budget ends. GraphQL errors inside HTTP 200, missing items and partial
detail failures remain explicit. Prices still come from the selected market's
catalog object; no GraphQL status-code meanings are invented.

Only allowlisted shopper metadata and photo URL/type are retained. Raw photo
objects may contain employee and warehouse fields; none are returned or
committed. Catalog and detail lists can expose the same object path through
different observed first-party hosts. The exact existing catalog URL wins for
that path; additional detail URLs are retained literally. No image URL is
constructed by replacing a host, inventing an angle, or incrementing a filename.

Image IDs are deterministic 64-bit URL fingerprints, independent of array
position. The same URL keeps its ID across search and details; a changed URL
gets a different ID. The actual URL is always retained. `index` is separate.
Photo roles are copied from the source (`robot`, `brand`, `material`, `type`);
the adapter does not infer a front/back view from an index.

## Outfit recommendations

```http
POST https://services.sellpy.net/complementary-recommendations
Content-Type: application/json
COMPLEMENTARY-RECOMMENDATIONS-API-Key: <runtime public configuration>
```

```json
{
  "item_objectid": "va0uL6CUOK",
  "item_metadata_en": {"type":"Maxi dress","demography":"Women","size":"WMN-INT-XL"},
  "item_images": ["<observed public source image URL>"],
  "filters": {"demography":["Women","Unisex (Adults)"]},
  "limit_per_part": 2
}
```

Response: `{"success":true,"data":{"recommendations":[{"objectid":"…"}]}}`.
The implemented provider's live test returned six recommendations for the
three available parts at `limit_per_part: 2`. It retained all six and reported
`next_offset: null`, `end_reason: "upstream_window"`.

No outfit offset/cursor is verified. The adapter does not invent one or report
catalog exhaustion. A new seed or changed per-part request is a new arm. The
provider uses public English seed metadata, source images, native demographic
defaults, optional native size constraints and post-hydration hard filters.

## Market and language registry

| Market | Currency | Verified search-index languages |
|---|---|---|
| AT, DE | EUR | de, en |
| BE | EUR | nl, fr, en |
| CZ | CZK | cs, en |
| DK | DKK | da, en |
| EU | EUR | en |
| FI | EUR | fi, en |
| FR | EUR | fr, en |
| NL | EUR | nl, en |
| PL | PLN | pl, en |
| RO | RON | ro, en |
| SE | SEK | sv, en |

`EU` is the general European market. A configured Norwegian language index is
not treated as evidence of a Norwegian market: the current shared region
registry contains no `NO` market. Unsupported market/language combinations
fail explicitly rather than presenting an English/Swedish price as localized
data for another market.

## Regression checks and live outcomes

Run `node --import tsx --test test/provider.test.ts`. The suite covers config
parsing/endpoint rejection, exact request contracts, money units and market
isolation, safe filters, source windows, empty post-filter pages, native ranks,
persisted-reference multipart upload, outfit behavior, detail alias batching,
stable photos, privacy allowlists, deadline continuation, facets and rate limits.
Fixtures contain only sanitized public product fields and synthetic config
values. No live public config keys or employee fields are stored.

Live calls through the implemented provider succeeded for all six routes and
public detail aliases on the verification date. Representative results:

| Route | Observed result |
|---|---|
| Catalog | Two AT/EUR hits; 2,400-hit query window; source total explicitly estimated. |
| Semantic | `OLXEAvYGGA`, `fyhrJAq2Ko`; next offset 2. |
| Similar item | `hMkFuml2ER`, `ER67TR4MxU`; next offset 2. |
| Image URL | `va0uL6CUOK`, `aR8IyszSih`; next offset 2. |
| Upload | Distinct offset-0 and offset-2 pages, as recorded above. |
| Outfit | Six hydrated recommendations; explicit finite upstream window. |
| Detail aliases | `va0uL6CUOK`: five photos, EUR 24.00; `A1L1chQ2Js`: six photos, EUR 98.00. |

Remaining external uncertainties are source stability, native retrieval recall,
image formats beyond the JPEG live sample, unverified multipart filters, and the
absence of an outfit cursor. These are surfaced as constraints; they do not turn
into invented API contracts or a promise of exhaustive catalog coverage.

## Final deployed-route confirmation

The deployed official SDK v2 check uses protocol **2026-07-28** and default page
size 50 for normal, similar, image-URL, uploaded-image and outfit requests.
Observed results: 50 catalog items plus a disjoint 50-item continuation; 50 similar
items; 50 source-image matches; 50 uploaded-image matches plus 50 further matches;
59 hydrated outfit items drained as 50 + 9 from the finite native window of 60;
and a 12-item style page across strict and category-relaxed retrieval arms. These
are observed candidates, not a claim that all meet a subjective style.

The independently reproduced native outfit validation establishes
`limit_per_part <= 20`. The adapter requests 20 per part independently of the
display page size; the frontend's ten was only its own default. One native
recommendation in the live 60-item window was explicitly excluded by market or
hard-filter hydration. The source supplies no outfit continuation cursor.

Canonical detail enrichment expanded the first remotely tested item from three
catalog photo references to four. Its actual image bytes were WebP despite the
original `.jpg` URL; byte-signature detection identified the format correctly.
The public-reference upload succeeded with those actual WebP bytes. This adds a
live WebP observation to the earlier JPEG probe; PNG upload remains contract and
fixture coverage rather than a claimed live format test.
