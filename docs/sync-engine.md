# Synchronisation engine

The synchronisation stack runs entirely in the Electron main process. Its job is to fetch heterogeneous feeds without blocking the renderer, normalise entries and commit them efficiently while keeping enough history to diagnose failures.

## Components

### `HttpClient.ts`

`fetchFeed()` validates and downloads one URL. It provides:

- HTTP/HTTPS-only URL validation;
- lightweight blocking of loopback, link-local and RFC 1918 literal addresses;
- `ETag` and `Last-Modified` conditional headers;
- redirect following;
- a 45-second response timeout;
- a 10 MiB response limit, checked from `Content-Length` and again after reading;
- structured `FeedHttpError` values containing status and parsed `Retry-After` delay.

Ordinary feeds use the main process `fetch`. Reddit URLs use `session.fromPartition('persist:adblock').fetch()`. That persistent Chromium session shares browser networking behaviour and cookies with the embedded reader and avoids the severe rate limiting seen with anonymous Node requests.

The private-host check is intentionally described as lightweight: it rejects obvious literal hosts but does not perform a DNS resolution audit for every redirect.

### `FeedParser.ts`

The parser auto-detects RSS 2.0, Atom 1.0 and JSON Feed. It maps each format to one article representation containing a GUID, URL, title, author, HTML/plain content, excerpt, dates, enclosure and thumbnail.

Notable normalisation rules include:

- resolving relative and protocol-relative media URLs against the article/feed URL;
- selecting explicit media thumbnails before falling back to the first usable body image;
- ignoring inline `data:` images as thumbnails;
- recognising Reddit content and media links;
- preserving raw HTML for render-time sanitisation.

Parser unit tests live beside the implementation in `FeedParser.test.ts`.

### `SyncEngine.ts`

The engine orchestrates fetch, parse and persistence:

1. create a `sync_log` row and emit `syncing`;
2. wait for the relevant provider/host limiter;
3. issue a conditional request;
4. parse the response or handle `304`;
5. try conventional feed alternatives after a `404` when applicable;
6. batch-upsert normalised articles;
7. update feed metadata and its next schedule;
8. finish the log and emit the terminal status.

Global concurrency is capped at five operations. Each ordinary host is capped at two concurrent requests. All Reddit hostnames share a single limiter and are processed serially.

### `Scheduler.ts`

The scheduler:

- starts an initial due-feed refresh five seconds after application startup;
- checks due feeds every 60 seconds;
- prevents two scheduler ticks or full manual refreshes from overlapping;
- runs retention maintenance daily;
- recounts unread counters during maintenance to repair drift.

The toolbar's **Sync** action passes all active feeds, whereas normal ticks only pass rows whose `next_fetch_at` is due.

## Full refresh behaviour

Ordinary feeds start concurrently within global/per-host limits. Reddit feeds form a separate serial queue that runs alongside ordinary providers. Reddit subscriptions with no stored posts are sorted first, then older `last_fetched_at` values are preferred.

This design intentionally avoids two previously problematic patterns:

- firing dozens of subreddit requests in parallel, which triggers HTTP 429 responses;
- combining many subreddit names into one synthetic RSS URL, which may return entries for only part of the requested set.

Reddit request starts are spaced by at least 750 ms. A provider-wide cooldown is honoured after a 429 response, and deferred feeds keep their cached posts rather than being treated as broken.

## Retry and fallback behaviour

One feed may be attempted up to three times. Retries wait two seconds. The final attempt ignores cached validators, which handles publishers that return an incorrect empty/unchanged response.

If parsed content is empty or unusably short, the engine may try the corresponding `.rss`/`.atom` or `/rss`/`/atom` endpoint. A `404` can also trigger conventional alternatives such as `/feed/`.

HTTP 429 is not retried immediately. `Retry-After` is honoured when present; otherwise a bounded fallback delay is used. Rate limiting produces a `deferred` result rather than incrementing the permanent feed error counter.

Other persistent failures increment `error_count` — atomically in SQL (`UPDATE … RETURNING`) so a scheduled tick and a manual refresh racing on the same feed cannot lose an increment — and schedule exponential backoff. After ten consecutive failures, the feed is disabled to stop an invalid subscription from being retried forever.

## Adaptive schedule

The starting interval is normally 15 minutes and remains bounded between five minutes and 24 hours.

| Result | Next interval behaviour |
|---|---|
| 10 or more new articles | Current interval × 0.8, floor 5 minutes. |
| Some new articles | Keep current interval. |
| Successful fetch with zero new articles | Current interval × 1.2, cap 24 hours. |
| HTTP 304 | Current interval × 1.5, cap 24 hours. |
| Persistent error | `15 minutes × 2^error_count`, cap 24 hours. |
| HTTP 429 | Defer to the provider cooldown without recording a permanent error. |

## Persistence

`ArticleService.upsertMany()` performs a prepared batch transaction. `(feed_id, guid)` is unique, so existing articles are updated without duplicating reading-state rows. The update branch refreshes content fields and fills previously missing metadata (`url`, `author`, `enclosure_url`, `published_at`) via `COALESCE`, so a feed that initially published incomplete entries is corrected on later syncs. `articlesUpdated` counts only rows whose UPDATE actually changed a value — rows skipped for a missing GUID or identical content are not counted. `better-sqlite3` writes synchronously; the legacy `persistDatabase()` call remains a no-op for compatibility with the former sql.js implementation.

## UI events

The main process broadcasts `sync:update` to every live window.

```ts
type SyncUpdate = {
  feedId: number
  status: 'syncing' | 'success' | 'not_modified' | 'deferred' | 'error'
  scope?: 'feed' | 'batch'
  articlesNew?: number
  error?: string
}
```

`scope: 'batch'` with `feedId: 0` controls the toolbar animation. The renderer rotates the icon for the entire batch and plays three green completion flashes only after the final active operation ends. Per-feed events refresh counters and expose failures without leaving stale red state after a transient rate limit.

## Diagnosing a failed feed

Inspect the latest rows in `sync_log` and distinguish:

- `success`: body processed; `articles_new` may still be zero;
- `not_modified`: cached content remains valid;
- `deferred`: provider throttling or a scheduled cooldown;
- `error`: retries were exhausted and `error_count` increased.

A feed with existing articles should continue displaying them during `deferred` or `error` states. Sidebar badges represent stored unread/total article counts, not whether the last network request succeeded.
