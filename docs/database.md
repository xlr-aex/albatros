# Database architecture

Albatros uses native SQLite through `better-sqlite3` in the Electron main process. The old sql.js/WASM design is no longer used; legacy `persistDatabase()` functions remain as no-op compatibility shims.

## Location and lifecycle

The database path is:

```ts
path.join(app.getPath('userData'), 'albatros.db')
```

Typical paths:

- Windows: `%APPDATA%\albatros\albatros.db`
- Linux: `~/.config/albatros/albatros.db`
- macOS: `~/Library/Application Support/albatros/albatros.db`

One singleton connection is opened during bootstrap and closed during `before-quit`.

## Connection pragmas

Immediately after opening, Albatros applies:

| Pragma | Value | Reason |
|---|---:|---|
| `journal_mode` | `WAL` | Concurrent readers and resilient writes. |
| `synchronous` | `NORMAL` | Good durability/performance balance for a desktop cache. |
| `foreign_keys` | `ON` | Enforce feed/article/group relationships. |
| `cache_size` | `-32000` | Approximately 32 MiB page cache. |
| `temp_store` | `MEMORY` | Keep temporary query structures in memory. |

Writes are synchronous and immediately owned by SQLite. There is no in-memory database export step.

## Tables

### `feed_groups`

Stores folders, order, optional icon and expanded/collapsed state. Deleting a group sets child `feeds.group_id` to `NULL`.

### `feeds`

Stores the canonical feed URL, publisher metadata, favicon, scheduling/cache headers and state:

- `unread_count` is denormalised and maintained by triggers;
- `error_count` controls retry backoff and automatic disabling;
- `last_etag` and `last_modified` enable conditional GET;
- `last_fetched_at`, `next_fetch_at` and `fetch_interval_sec` drive scheduling;
- `is_active` pauses or disables a feed.

`article_count` is not stored. Feed queries compute it with a correlated count while excluding rows tagged internally as `reddit-comment`.

### `articles`

Stores normalised entries and local interaction state. The identity constraint is `UNIQUE(feed_id, guid)`. Important fields include:

- raw `content_html` and plain `content_text`;
- list `excerpt` and `thumbnail_url`;
- enclosure URL/type for media;
- publication/fetch timestamps;
- `is_read`, `is_starred`, `is_saved`;
- optional local-AI `summary`.

Raw HTML is deliberately stored unsanitised. DOMPurify runs in the reader immediately before rendering.

### `articles_fts`

An FTS4 virtual table indexes title, plain content and author. Triggers mirror insert, update and delete operations. Search code builds conservative MATCH expressions and can fall back from all-term to broader matching when needed.

### `article_tags` and `read_later`

These tables support article labels and saved-article metadata. `read_later.article_id` is unique and cascades when the article is deleted.

### `settings`

A text key/value store. Known settings cover theme, accent, font sizes, pane layout, retention, feed interval and local AI provider/model/prompts. Callers perform type conversion.

### `sync_log`

One row per feed attempt, including start/end timestamps, inserted/updated counts, terminal status and an optional error. Current statuses include `running`, `success`, `not_modified`, `deferred` and `error`.

### `schema_migrations`

Records applied version/name pairs. The migration runner applies embedded SQL in ascending order and skips known duplicate-column cases from older installations.

## Indexes

The schema includes indexes for:

- due active feeds and group membership;
- feed-scoped publication order;
- feed-scoped unread lists;
- global publication cursor `(published_at, id)`;
- unread global publication order;
- starred and saved partial indexes;
- articles waiting for summaries;
- tags and per-feed sync history.

Article lists should remain cursor-based. Avoid large `OFFSET` pagination because it becomes increasingly expensive as the library grows.

## Triggers

### FTS mirroring

`articles_ai_fts`, `articles_au_fts` and `articles_ad_fts` keep `articles_fts` aligned with the source article row.

### Unread counters

Insert/delete/update triggers increment or decrement `feeds.unread_count`. Daily maintenance also recounts all feeds, providing a recovery path if an interrupted migration or older build caused drift.

### Feed timestamps

`feeds_updated_at` updates `updated_at` after mutations and guards against recursively firing itself.

## Migrations

Never edit an already-applied migration to change an existing installation. Add a new monotonically increasing entry to `MIGRATIONS` in `src/main/db/migrations/runner.ts`, make it idempotent where practical, and test both a new database and an upgraded copy.

Current migrations add group icons, thumbnails, corrected timestamps, article summaries and query indexes after the initial schema.

## Transactions and retention

Article batches are upserted in a `better-sqlite3` transaction. Fetching/parsing occurs outside the transaction so network latency never holds a database write lock.

Daily maintenance removes expired content according to `retention_days`, while preserving state according to `ArticleService` rules, and then repairs unread counters.

## Backup and recovery

Close Albatros before copying the database. WAL mode may place the newest committed pages in `albatros.db-wal` while the app is running. A safe manual backup either:

1. exits the application and copies `albatros.db`; or
2. uses SQLite's online backup mechanism from a future in-app backup feature.

OPML export is useful for subscription portability but does not include articles, summaries or reading state.
