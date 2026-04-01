# SQLite Architecture

Albatros relies on a raw `sql.js` WASM build executing entirely in the Electron Main process memory, which flushes its ArrayBuffer to disk (`~/.config/albatros/database.sqlite`) whenever writes occur.

## Tables

### 1. `feeds`
The core subscription entity.
- Tracks `url` and `last_etag` / `last_modified` headers.
- Caches denormalised `unread_count` for lightning-fast sidebar rendering.
- Manages sync scheduling via `fetch_interval_sec`, `next_fetch_at`, and `error_count` (exponential backoff).

### 2. `feed_groups`
Simple folder structure. Feeds link here via nullable `group_id`.
- Support `sort_order` and boolean `is_expanded` state.
- Cascades on delete (`SET NULL` on child feeds).

### 3. `articles`
Contains individual entries parsed from feeds.
- Primary key is `id`, but uniqueness is strictly enforced on `(feed_id, guid)`.
- Replaces incoming raw DB values (`content:encoded`, `summary`) with parsed standard text fields (`content_html`, `content_text`).
- Houses UI state: `is_read`, `is_starred`, `is_saved`.
- Indexed heavily for rapid list queries (`idx_articles_published_feed`, `idx_articles_unread`).

### 4. `articles_fts` (FTS4 Virtual Table)
Powers the full text search engine.
- Tokenizes `title`, `author`, and `content_text` (raw text only).
- Matches `articles.id`.
- Extracts dynamic semantic snippets natively via FTS4 `snippet(articles_fts, '[[[', ']]]', '…', 1, 15)`.

### 5. `settings`
Simple internal Key/Value store.
- Supports typed JSON payload storage.
- Stores variables such as `theme` or `retention_days`.

### 6. `sync_log`
For detailed debug tracing.
- Appended on every cron execution for feeds syncing.
- Rotated out by `SyncEngine` when database size approaches max boundaries.

## Triggers

The most complex SQL logic exists inside `src/main/db/triggers.sql`. We use triggers to remove application layer logic, guaranteeing database integrity even if migrations crash.

1. **FTS Synchronisation (`articles_ai`, `articles_au`, `articles_ad`)**
   Ensures the `articles_fts` virtual table always matches `articles` row insertions, updates (on content), and deletions.

2. **Sidebar Counters (`update_feed_unread_insert`, `..._update`, `..._delete`)**
   Any time an article `is_read` flips from `0` -> `1`, or an unread article arrives, the parent feed's `unread_count` increments or decrements natively at the DB level. This means `SELECT * FROM feeds` requires zero `COUNT()` joins.

## WASM & Persistence

Because `better-sqlite3` fails to compile out-of-the-box on Windows machines missing MSBuild headers, the app resorts to `sql.js`.

**Workflow:**
1. Loads `.sqlite` blob into an `Uint8Array`.
2. Initialises the WASM backend, instantiating an in-memory db pointer.
3. Every operation modifying schema or records (`INSERT`, `UPDATE`, `DELETE`) flags a dirty state.
4. `persistDatabase()` exports the WASM array and overwrites the physical `.sqlite` file atomically via `fs.writeFileSync`.
