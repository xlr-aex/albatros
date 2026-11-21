# Synchronisation engine

The sync code runs in the Electron main process. It downloads feeds without blocking the renderer. It converts entries to one format, saves them, and records errors for fault finding.

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

Ordinary feeds use `fetch` in the main process. Reddit URLs use `session.fromPartition('persist:adblock').fetch()`. This Chromium session shares cookies with the built-in browser. It also reduces the rate limits that affect anonymous Node requests.

The main process downloads public YouTube channel pages and reads their video list. It checks each redirect. If YouTube returns a consent or anti-bot page, Albatros shows a sync error. Open the channel in the built-in browser, then try again. A sync does not replace a feed name that the user edited.

The private-host check blocks known local and private addresses. Check `ExternalUrlPolicy` before you change the redirect rules.

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

The engine completes these steps:

1. create a `sync_log` row and emit `syncing`;
2. wait for the relevant provider/host limiter;
3. issue a conditional request;
4. parse the response or handle `304`;
5. try conventional feed alternatives after a `404` when applicable;
6. batch-upsert normalised articles;
7. update feed metadata and its next schedule;
8. finish the log and emit the terminal status.

The engine runs at most five operations at one time. It sends at most two requests at one time to each ordinary host. It processes Reddit requests one at a time.

### `Scheduler.ts`

The scheduler:

- starts an initial due-feed refresh five seconds after application startup;
- checks due feeds every 60 seconds;
- prevents two scheduler ticks or full manual refreshes from overlapping;
- runs retention maintenance daily;
- recounts unread counters during maintenance to repair drift.

The toolbar's **Sync** action passes all active feeds, whereas normal ticks only pass rows whose `next_fetch_at` is due.

## Full refresh behaviour

Ordinary feeds start together, within the global and host limits. Reddit feeds use a separate queue and run one at a time. The engine checks Reddit feeds with no stored posts first. It then checks feeds with the oldest `last_fetched_at` value.

This design intentionally avoids two previously problematic patterns:

- firing dozens of subreddit requests in parallel, which triggers HTTP 429 responses;
- combining many subreddit names into one synthetic RSS URL, which may return entries for only part of the requested set.

At least 750 ms passes between Reddit request starts. After an HTTP 429 response, the engine waits before it sends more Reddit requests. A delayed feed keeps its stored posts.

## Retry and fallback behaviour

The engine tries a feed at most three times. It waits two seconds before each retry. On the last attempt, it does not send cache validators. This can recover a feed when a publisher sends an incorrect unchanged response.

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

Stored articles stay visible when a feed is `deferred` or has an `error`. Sidebar badges show stored article counts. They do not show the result of the last network request.
