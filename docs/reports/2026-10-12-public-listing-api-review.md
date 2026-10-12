# Public listing APIs and CAPTCHA repository review

Date: 2026-10-12. Package inspected: `tools/lead-tui`, released version 0.1.2. This was a read-only investigation; the app and releases were not modified.

## Outcome

Anonymous listing reads were verified for Housing.com GraphQL and NoBroker REST. 99acres redirected the Mumbai search to its security check, so no working listing API was established there. The supplied CAPTCHA repository uses an audio-challenge transcription route rather than our current image-grid route.

"Public" below means these specific read requests worked without cookies, authentication headers or an API key during this check. It does not mean the sites publish a stable, supported integration contract or that every operation is accessible.

## Method

- Used the T3 collaborative browser to load the portals' normal public pages, inspect resource timing and page state, and observe listing navigation/scrolling.
- Read only JavaScript assets actually loaded by those pages; downloaded source was inspected as text and never executed.
- Replayed observed listing requests with browser `credentials: "omit"`.
- Independently repeated successful requests with curl, without a cookie jar or authorization header, to distinguish anonymous access from a successful browser session.
- Queried only public listing fields. No lead/contact mutation, OTP action, account operation or real property enquiry was submitted.
- Resource timing for cross-origin and cached assets is incomplete; it was not treated as a full download-byte benchmark.

## Verified endpoints

| Site | Observed endpoint | Verification |
|---|---|---|
| Housing.com | `https://mightyzeus-mum.housing.com/api/gql` | Anonymous POST returned listing URL, title, ID and pagination metadata |
| NoBroker | `https://www.nobroker.in/api/v3/multi/property/BUY/filter` | Anonymous GET replay of the observed Mumbai page-2 search returned 26 distinct listings |
| 99acres | Not established | `/search/property/buy/mumbai` redirected to `/load/verifycaptcha` |

Housing also used `/api/gql/stale` and `/api/gql/network-first` in normal page traffic. The tested listing request used the plain `/api/gql` route. NoBroker used REST in the observed search flow; no GraphQL endpoint was observed there.

## Measurements

All measurements are single observations, not a reliability or throughput benchmark.

| Request | Status | Listings | Response size | Elapsed |
|---|---:|---:|---:|---:|
| Housing browser minimal listing query | 200 | 30 | 4,012 decoded bytes | 530 ms |
| Housing browser page 1 with cursor metadata | 200 | 30 | 4,133 decoded bytes | 471 ms |
| Housing browser page 2 carrying page-1 metadata | 200 | 30 | 4,144 decoded bytes | 376 ms |
| Housing independent curl listing request | 200 | 30 | 1,041 downloaded compressed bytes; 4,134 decoded bytes | 0.678 s |
| NoBroker browser replay of page 2 | 200 | 26 | 344,626 decoded bytes | 49 ms |
| NoBroker independent curl replay | 200 | 26 | 46,448 downloaded compressed bytes; 344,626 decoded bytes | 0.255 s |
| Housing independent curl HTML page | 406 | — | 3,656 downloaded bytes of rejection response | 0.281 s |

Housing's two successful browser pages contained 60 distinct listing IDs. NoBroker's 26 records contained 26 distinct IDs and `detailUrl` values, all matching the observed `/property/buy/.../detail` route. A generic NoBroker `url` field is not the listing detail URL and repeated across these records; an adapter must use `detailUrl` and `propertyTitle`.

The HTML request failed, so its small rejection response cannot be compared to API payload size as a successful full-page baseline. No percentage bandwidth or end-to-end speed saving is established. A minimal Housing listing response is nevertheless demonstrably small and avoids fetching listing photos, ads and UI bundles for each subsequent API page.

## Housing query and pagination

The query shape was found in the page's [loaded search source](https://c.housingcdn.com/demand/s/client/75177.98563ea9.m.d.js), then verified live:

```graphql
query PublicListings(
  $hash: String!
  $service: String!
  $category: String!
  $city: CityInput
  $pageInfo: PageInfoInput
  $meta: JSON
) {
  searchResults(
    hash: $hash
    service: $service
    category: $category
    city: $city
    pageInfo: $pageInfo
    meta: $meta
  ) {
    properties { url title listingId }
    meta
  }
}
```

Variables were taken from the page's public filter state: Mumbai's search hash, selected city, service `buy`, category `residential`, and page size 30. The next request carried the previous response's `meta.api` cursor/offset object. Both requests were anonymous. Other cities, rent searches and 100–300-item API batches were not tested.

One trial included `config { totalCount }`; the server returned HTTP 400 because `SearchConfig` has no such field. Removing that unsupported selection produced the successful requests above. Future integration must inspect GraphQL errors rather than assume HTTP success or guessed field names establish useful listing data.

## NoBroker request and limits

Observed query parameters included `city=mumbai`, `pageNo=2`, `propType=AP` and the public page's encoded `searchParam`. Replay preserved those parameters.

The site's [loaded list-page source](https://assets.nobroker.in/nb-new/listPage/listPage.e563a6dd2fbaa74c5f26.chunk.js) increments `pageNo` using the current search filters. It also shows a sign-in UI for progression after the second page when no logged-in user exists. This review did not attempt to cross that UI gate or establish anonymous access to later pages. The tested page-2 request demonstrates only that specific anonymous listing read.

The [loaded card source](https://assets.nobroker.in/nb-new/ListPageListViews/ListPageListViews.c0b7053076e97205f160.chunk.js) uses `detailUrl` and `propertyTitle`, consistent with the verified response. Separate user/nudge/contact endpoints are not listing APIs and were not replayed.

## Supplied CAPTCHA repository

[sarperavci/GoogleRecaptchaBypass](https://github.com/sarperavci/GoogleRecaptchaBypass) was inspected at commit `73a60d3ddfb8f60fc650e18a25a00d08b5c5b717`.

Its [solver](https://github.com/sarperavci/GoogleRecaptchaBypass/blob/73a60d3ddfb8f60fc650e18a25a00d08b5c5b717/RecaptchaSolver.py) clicks the checkbox, switches to an audio challenge, downloads MP3 audio, converts it to WAV through pydub/ffmpeg, transcribes it with SpeechRecognition's `recognize_google`, and submits the transcription. It is not a GraphQL or CAPTCHA-token bypass, and does not use the user's OpenAI subscription.

It requires Python, DrissionPage, pydub, SpeechRecognition and ffmpeg. Installing it wholesale would add another browser/runtime and an external transcription service to this Node/Playwright package. The repository's success check examines the checkbox checkmark styling; it does not establish that the property portal cleared its gate. Its advertised five-second result was not benchmarked here.

GitHub repository metadata reported `license: null`; no license declaration was found in the root, README or package metadata. The code was not copied into this project's MIT release. The main branch's latest push was 2026-08-13, with the latest inspected solver change dated 2025-01-04. No repository code was executed and no audio CAPTCHA attempt was made.

## Recommended integration

Use API-first listing discovery where these public reads are verified, then retain Playwright for contact forms, explicit enquiry submission, authentication and site verification. Reuse the existing project URL normalization, queue limits and duplicate handling. Preserve public-page filter/city state and cursor metadata, validate response shapes and same-site property URLs, and fall back to the current browser discovery on unsupported responses or refused access.

A lighter first step is consuming listing data already embedded in Housing's `__INITIAL_STATE__.searchResults` and NoBroker's initial page state, then fetching additional public API pages. This can reduce scrolling and repeated full-page loads without replacing the established enquiry flow.

The audio approach is a possible independently implemented fallback, subject to actual live availability and a suitable transcription route. It has not been integrated. Network discovery, measured public listing reads and source review are complete; no claim is made that the TUI currently uses these endpoints.
