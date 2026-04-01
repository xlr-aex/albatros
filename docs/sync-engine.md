# Sync Engine Architecture

The Albatros sync engine is responsible for periodically polling RSS, Atom, and JSON feeds, parsing their content, and gracefully merging new articles into the SQLite database.

## Components

The engine is split into four distinct modules running in the Electron **main process**:

1. **`HttpClient` (`src/main/sync/HttpClient.ts`)**
   Wraps Node's native `undici` to fetch feed XML/JSON.
   - Built-in **SSRF protection** to block private IP addresses.
   - Enforces 10MB body size limits and timeout constraints.
   - Implements **Conditional GET** using `ETag` and `Last-Modified` headers to return an empty 304 response when a feed hasn't changed.

2. **`FeedParser` (`src/main/sync/FeedParser.ts`)**
   Uses `fast-xml-parser` to parse XML and raw JSON.
   - Auto-detects RSS 2.0, Atom 1.0, and JSON Feed 1.1 formats.
   - Normalises all formats into a single `ParseResult` object.
   - Coerces edge-case discrepancies (e.g. `content:encoded` vs `description`, `published` vs `updated`).
   - Does *not* sanitise HTML (this is done strictly on the frontend reader view to ensure the latest DOMPurify rules apply).

3. **`SyncEngine` (`src/main/sync/SyncEngine.ts`)**
   The orchestrator. Dispatches `HttpClient` and `FeedParser`, then uses `ArticleService` to persist results.
   - Uses `p-limit` to heavily throttle concurrent requests (max `5` by default) to avoid network congestion and CPU blocking.
   - Implements **Adaptive Polling Intervals** (see below).
   - Emits real-time `sync:update` IPC events to the renderer to power UI loading spinners.
   - Write sync history to the `sync_log` table (useful for debugging).

4. **`Scheduler` (`src/main/sync/Scheduler.ts`)**
   The timer loop.
   - A `setInterval` tick running every 60 seconds queries the DB for `feeds` where `next_fetch_at <= strftime('%s', 'now')`.
   - Dispatches due feeds to `SyncEngine`.
   - Runs a massive daily maintenance routine (`runMaintenance()`):
     - Executing the user's article retention policy (deleting old un-saved articles).
     - Running `INSERT INTO articles_fts(articles_fts) VALUES('rebuild')` to defragment the FTS4 index.
     - Re-syncing the denormalised `unread_count` on all feeds to correct any drift.

## Adaptive Polling Intervals

To avoid hammering servers, the `SyncEngine` adjusts the `fetch_interval_sec` dynamically after every sync attempt:

1. **Default:** Starts at 15 minutes.
2. **High Traffic / Rapid Updates:** If > 10 new articles are found in one poll, the interval shrinks by 20% (down to a floor of 5 minutes).
3. **Quiet Feeds:** If `0` new articles are found, the interval grows by 20%.
4. **Not Modified (304):** If the server answers 304, the interval is aggressively multiplied by 1.5.
5. **Errors (Exponential Backoff):** If the fetch fails (timeout, 404, 500, invalid XML), the new interval becomes `Default * (2 ^ error_count)`.
   - Max backoff is 24 hours.
   - After 10 consecutive failures, `is_active` is toggled to `false` automatically.

## HTML Sanitisation Strategy

A critical security decision in RSS readers is when and how to sanitise feed content:

Albatros **does not sanitise HTML at the database level**.

We store raw `content_html` from the feed parser in SQLite. When the user selects an article, the React `<ArticleReader>` component runs the raw HTML through `DOMPurify` instantly before rendering.

**Why?**
- Prevents database lock-in to older sanitisation rules (if DOMPurify updates its XSS filters, older articles in the DB are automatically subjected to the stricter rules upon view).
- Drastically reduces CPU overhead during the background sync loop.

## Transactional Boundaries

To ensure SQLite doesn't lock up or corrupt:
- Fetching and parsing happen outside database transactions.
- Insertion into `articles` happens within `ArticleService.upsert()` which uses `INSERT OR IGNORE`.
- Real persistence only flushes when `persistDatabase()` is called after all articles for a single feed are evaluated (in-memory WASM buffer dump to disk).
- FTS index synchronization is handled natively by pure SQLite triggers (`articles_ai`, `articles_ad`, `articles_au`).
