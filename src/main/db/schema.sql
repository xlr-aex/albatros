-- =============================================================================
-- Albatros RSS Reader — Database Schema
-- SQLite via better-sqlite3, version 1
-- =============================================================================
-- Naming conventions:
--   Tables   : snake_case, plural
--   Columns  : snake_case
--   Indexes  : idx_<table>_<cols>
--   Triggers : <table>_<event>_<action>  (e.g. articles_ai_fts)
-- =============================================================================

-- ─── Feed Groups ─────────────────────────────────────────────────────────────
-- Logical folders that group related feeds in the sidebar.

CREATE TABLE IF NOT EXISTS feed_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,  -- Lower = higher in sidebar
  is_expanded INTEGER NOT NULL DEFAULT 1,  -- 0 = collapsed, 1 = expanded
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- ─── Feeds ───────────────────────────────────────────────────────────────────
-- A feed represents a single RSS / Atom / JSON Feed subscription.
-- Counters and metadata are kept denormalised here for fast sidebar rendering.

CREATE TABLE IF NOT EXISTS feeds (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id           INTEGER REFERENCES feed_groups(id) ON DELETE SET NULL,
  url                TEXT    NOT NULL UNIQUE,   -- The feed URL (canonical)
  title              TEXT,                       -- Human-readable title
  site_url           TEXT,                       -- Link back to the publisher site
  description        TEXT,
  favicon_url        TEXT,                       -- Local cache path or data-URI
  language           TEXT,

  -- Denormalised counter — maintained by triggers (see triggers.sql)
  -- Avoids expensive COUNT(*) on every sidebar render
  unread_count       INTEGER NOT NULL DEFAULT 0,

  -- Consecutive error counter; used to trigger backoff or auto-disable
  error_count        INTEGER NOT NULL DEFAULT 0,

  -- HTTP cache headers — sent on subsequent requests to avoid re-downloading
  -- unchanged feeds, dramatically reducing bandwidth.
  last_etag          TEXT,
  last_modified      TEXT,

  -- Polling schedule
  last_fetched_at    INTEGER,                    -- Unix timestamp of last attempt
  next_fetch_at      INTEGER,                    -- Scheduled next attempt
  fetch_interval_sec INTEGER NOT NULL DEFAULT 900, -- Default: 15 minutes

  is_active          INTEGER NOT NULL DEFAULT 1, -- 0 = paused / errored out
  created_at         INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at         INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_feeds_next_fetch ON feeds (next_fetch_at)
  WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_feeds_group      ON feeds (group_id);

-- ─── Articles ────────────────────────────────────────────────────────────────
-- One row per article / entry in a feed.
-- content_html is stored raw and sanitised with DOMPurify at render time.
-- content_text is the plain-text version used by the FTS4 virtual table.

CREATE TABLE IF NOT EXISTS articles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id        INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,

  -- guid is the unique identifier from the feed item (<guid> in RSS,
  -- <id> in Atom).  Falls back to the article URL if absent.
  guid           TEXT    NOT NULL,
  url            TEXT,
  title          TEXT,
  author         TEXT,

  -- Full HTML body; sanitised immediately before display in the renderer
  content_html   TEXT,

  -- Plain-text version of the content, used exclusively by FTS4 for search
  content_text   TEXT,

  -- 160-char excerpt shown in the article list panel
  excerpt        TEXT,

  -- Podcast / media attachment
  enclosure_url  TEXT,
  enclosure_type TEXT,   -- e.g. "audio/mpeg"
  thumbnail_url  TEXT,   -- Image URL for the article list

  word_count     INTEGER,

  -- Unix timestamps
  published_at   INTEGER,
  fetched_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),

  -- User interaction flags
  is_read        INTEGER NOT NULL DEFAULT 0,
  is_starred     INTEGER NOT NULL DEFAULT 0,
  is_saved       INTEGER NOT NULL DEFAULT 0,
  summary        TEXT DEFAULT NULL,

  created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),

  -- Prevent duplicate insertion: same feed + same guid = same article
  UNIQUE (feed_id, guid)
);

-- Article lookup patterns (feed panel, unread filter, starred view)
CREATE INDEX IF NOT EXISTS idx_articles_feed_pub   ON articles (feed_id,    published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_feed_unread ON articles (feed_id,   is_read, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_starred     ON articles (is_starred, published_at DESC)
  WHERE is_starred = 1;
CREATE INDEX IF NOT EXISTS idx_articles_saved       ON articles (is_saved,   published_at DESC)
  WHERE is_saved = 1;
CREATE INDEX IF NOT EXISTS idx_articles_pub_global  ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_pub_global_id ON articles (published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_articles_unread_pub ON articles (is_read, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_articles_summary_pub ON articles (summary, published_at DESC, id DESC);

-- ─── Full-Text Search (FTS4) ──────────────────────────────────────────────────
-- Virtual table that indexes title, content_text, and author.
-- Uses "content tables" so the actual text is NOT duplicated — FTS4 reads
-- from the parent `articles` table via content_rowid.
-- Note: FTS4 uses a simpler tokeniser than FTS5; partial-word matching is limited.

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts4 (
  title,
  content_text,
  author
);

-- ─── Article Tags ─────────────────────────────────────────────────────────────
-- User-applied or rule-applied labels on articles.

CREATE TABLE IF NOT EXISTS article_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag        TEXT    NOT NULL,
  UNIQUE (article_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_article_tags_article ON article_tags (article_id);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag     ON article_tags (tag);

-- ─── Read Later ───────────────────────────────────────────────────────────────
-- Saved articles queue.  An article appears here only when is_saved = 1.
-- reminder_at is optional — for future "remind me" functionality.

CREATE TABLE IF NOT EXISTS read_later (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id  INTEGER NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
  saved_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  reminder_at INTEGER
);

-- ─── Settings ────────────────────────────────────────────────────────────────
-- Simple key-value store for user preferences.

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('theme',                'dark'),    -- 'dark' | 'light'
  ('font_size',            '16'),
  ('reading_pane',         'right'),   -- 'right' | 'bottom' | 'off'
  ('mark_read_on_open',    '1'),       -- 1 = mark as read when article is opened
  ('default_interval_sec', '900'),     -- Global default poll interval (15 min)
  ('retention_days',       '30'),      -- Auto-delete articles older than N days
  ('max_articles_per_feed','500');     -- Per-feed cap

-- ─── Sync Log ────────────────────────────────────────────────────────────────
-- Records the outcome of each feed synchronisation attempt.
-- Used for the Settings > Feed Health view.

CREATE TABLE IF NOT EXISTS sync_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id          INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  started_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  finished_at      INTEGER,
  articles_new     INTEGER NOT NULL DEFAULT 0,
  articles_updated INTEGER NOT NULL DEFAULT 0,
  status           TEXT    NOT NULL DEFAULT 'running', -- 'running'|'success'|'error'
  error_message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_log_feed ON sync_log (feed_id, started_at DESC);

-- ─── Schema Migrations ────────────────────────────────────────────────────────
-- Tracks which migration scripts have been applied.  The migration runner
-- checks this table before executing any SQL script.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (1, 'initial_schema');
