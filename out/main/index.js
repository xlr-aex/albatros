"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const adblockerElectron = require("@cliqz/adblocker-electron");
const fetch$1 = require("cross-fetch");
const initSqlJs = require("sql.js");
const fastXmlParser = require("fast-xml-parser");
const pLimit = require("p-limit");
const url = require("url");
const getDbPath = () => path.join(electron.app.getPath("userData"), "albatros.db");
let _db = null;
let _persistTimeout = null;
const PERSIST_DEBOUNCE_MS = 1e4;
async function getDatabase() {
  if (_db) return _db;
  const dataDir = electron.app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true });
  const SqlJs = await initSqlJs();
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    _db = new SqlJs.Database(fileBuffer);
  } else {
    _db = new SqlJs.Database();
  }
  applyPragmas(_db);
  return _db;
}
function persistDatabase() {
  if (!_db) return;
  if (_persistTimeout) return;
  _persistTimeout = setTimeout(() => {
    persistDatabaseNow();
  }, PERSIST_DEBOUNCE_MS);
}
function persistDatabaseNow() {
  if (!_db) return;
  if (_persistTimeout) {
    clearTimeout(_persistTimeout);
    _persistTimeout = null;
  }
  const data = _db.export();
  try {
    fs.writeFileSync(getDbPath(), Buffer.from(data));
  } catch (err) {
    console.error("[Database] Failed to persist:", err);
  }
}
function closeDatabase() {
  if (_db) {
    persistDatabaseNow();
    _db.close();
    _db = null;
  }
}
function applyPragmas(db) {
  db.run(`
    PRAGMA journal_mode = MEMORY;
    PRAGMA synchronous  = OFF;
    PRAGMA foreign_keys = ON;
    PRAGMA cache_size   = -32000;
    PRAGMA temp_store   = MEMORY;
  `);
}
const schemaSql = `-- =============================================================================
-- Albatros RSS Reader — Database Schema
-- SQLite via sql.js (WASM), version 1
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
-- content_html is stored sanitised (DOMPurify applied before INSERT).
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

  -- Full HTML body, sanitised at write time (DOMPurify in the sync engine)
  content_html   TEXT,

  -- Plain-text version of the content, used exclusively by FTS5 for search
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

-- ─── Full-Text Search (FTS4) ──────────────────────────────────────────────────
-- Virtual table that indexes title, content_text, and author.
-- Uses "content tables" so the actual text is NOT duplicated — FTS5 reads
-- from the parent \`articles\` table via content_rowid.
-- Trigram tokeniser enables partial-word matching ("quel" matches "quelque").

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
`;
const triggersSql = "-- =============================================================================\n-- Albatros RSS Reader — Database Triggers\n-- =============================================================================\n-- Two sets of triggers:\n--\n-- 1. FTS4 Synchronisation triggers\n--    FTS5 \"content tables\" mode means FTS5 itself doesn't store text, it\n--    reads from `articles`. But it doesn't auto-detect row changes, so we\n--    maintain the index manually via these three triggers.\n--\n-- 2. Denormalisation triggers for feeds.unread_count\n--    Keeping the count column up-to-date in the `feeds` table avoids an\n--    expensive COUNT(*) on every sidebar render.  The tradeoff is a tiny\n--    overhead on INSERT / UPDATE / DELETE — acceptable since article writes\n--    are relatively rare (only during sync).\n-- =============================================================================\n\n-- After INSERT: add the new article to the full-text index.\nCREATE TRIGGER IF NOT EXISTS articles_ai_fts\nAFTER INSERT ON articles BEGIN\n  INSERT INTO articles_fts (docid, title, content_text, author)\n  VALUES (new.id, new.title, new.content_text, new.author);\nEND;\n\n-- After DELETE: remove the article from the full-text index.\nCREATE TRIGGER IF NOT EXISTS articles_ad_fts\nAFTER DELETE ON articles BEGIN\n  DELETE FROM articles_fts WHERE docid = old.id;\nEND;\n\n-- After UPDATE: update the FTS row.\nCREATE TRIGGER IF NOT EXISTS articles_au_fts\nAFTER UPDATE ON articles BEGIN\n  UPDATE articles_fts SET title = new.title, content_text = new.content_text, author = new.author WHERE docid = new.id;\nEND;\n\n-- ─── Unread Count Denormalisation Triggers ────────────────────────────────────\n\n-- After a new unread article is inserted, increment the counter.\nCREATE TRIGGER IF NOT EXISTS feeds_unread_on_insert\nAFTER INSERT ON articles\nWHEN new.is_read = 0\nBEGIN\n  UPDATE feeds SET unread_count = unread_count + 1 WHERE id = new.feed_id;\nEND;\n\n-- After an article is deleted, decrement the counter if it was unread.\nCREATE TRIGGER IF NOT EXISTS feeds_unread_on_delete\nAFTER DELETE ON articles\nWHEN old.is_read = 0\nBEGIN\n  UPDATE feeds SET unread_count = MAX(0, unread_count - 1) WHERE id = old.feed_id;\nEND;\n\n-- After is_read flips, adjust the counter accordingly.\n-- WHEN guard ensures we only fire when the value actually changed.\nCREATE TRIGGER IF NOT EXISTS feeds_unread_on_update\nAFTER UPDATE OF is_read ON articles\nWHEN old.is_read != new.is_read\nBEGIN\n  UPDATE feeds\n  SET unread_count = MAX(0, unread_count + CASE WHEN new.is_read = 0 THEN 1 ELSE -1 END)\n  WHERE id = new.feed_id;\nEND;\n\n-- Also update feeds.updated_at whenever a column changes.\nCREATE TRIGGER IF NOT EXISTS feeds_updated_at\nAFTER UPDATE ON feeds\nBEGIN\n  UPDATE feeds SET updated_at = strftime('%s','now') WHERE id = new.id;\nEND;\n";
const MIGRATIONS = [
  {
    version: 1,
    name: "initial_schema",
    // schema.sql + triggers.sql are concatenated as a single migration
    get sql() {
      return schemaSql + "\n" + triggersSql;
    }
  },
  {
    version: 2,
    name: "add_group_icon",
    sql: `ALTER TABLE feed_groups ADD COLUMN icon TEXT DEFAULT NULL;`
  },
  {
    version: 3,
    name: "add_article_thumbnail",
    sql: `ALTER TABLE articles ADD COLUMN thumbnail_url TEXT DEFAULT NULL;`
  }
];
function runMigrations(db) {
  let currentVersion = 0;
  try {
    const rows = db.exec(
      "SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations"
    );
    if (rows.length > 0 && rows[0].values.length > 0) {
      currentVersion = Number(rows[0].values[0][0]);
    }
  } catch {
    currentVersion = 0;
  }
  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);
  if (pending.length === 0) return;
  for (const migration of pending) {
    console.warn(`[DB] Applying migration ${migration.version}: ${migration.name}`);
    try {
      db.run(migration.sql);
    } catch (err) {
      const error = err;
      if (error.message && error.message.includes("duplicate column name")) {
        console.warn(`[DB] Migration ${migration.version} skipped: column already exists.`);
      } else {
        throw err;
      }
    }
    try {
      db.run(
        `INSERT OR IGNORE INTO schema_migrations (version, name)
         VALUES (?, ?)`,
        [migration.version, migration.name]
      );
    } catch {
    }
  }
  persistDatabase();
  console.warn(`[DB] Migrations applied up to version ${MIGRATIONS[MIGRATIONS.length - 1].version}`);
}
function rowToFeed(columns, row) {
  const o = {};
  columns.forEach((col, i) => {
    o[col] = row[i];
  });
  return {
    ...o,
    is_active: o["is_active"] === 1,
    unread_count: Number(o["unread_count"] ?? 0)
  };
}
function rowToGroup(columns, row) {
  const o = {};
  columns.forEach((col, i) => {
    o[col] = row[i];
  });
  return {
    ...o,
    is_expanded: o["is_expanded"] === 1
  };
}
class FeedService {
  constructor(db) {
    this.db = db;
  }
  // ── Groups ────────────────────────────────────────────────────────────────
  /** Returns all feed groups ordered by sort_order. */
  getGroups() {
    const result = this.db.exec("SELECT * FROM feed_groups ORDER BY sort_order, name");
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map((row) => rowToGroup(columns, row));
  }
  /** Creates a new feed group. Returns its newly assigned id. */
  createGroup(name, skipPersist = false) {
    this.db.run("INSERT INTO feed_groups (name) VALUES (?)", [name]);
    const res = this.db.exec("SELECT last_insert_rowid() AS id");
    const id = Number(res[0].values[0][0]);
    if (!skipPersist) persistDatabase();
    return id;
  }
  /** Renames a group or changes its sort_order. */
  updateGroup(id, patch) {
    const sets = [];
    const params = [];
    if (patch.name !== void 0) {
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.icon !== void 0) {
      sets.push("icon = ?");
      params.push(patch.icon);
    }
    if (patch.sort_order !== void 0) {
      sets.push("sort_order = ?");
      params.push(patch.sort_order);
    }
    if (patch.is_expanded !== void 0) {
      sets.push("is_expanded = ?");
      params.push(patch.is_expanded ? 1 : 0);
    }
    if (sets.length === 0) return;
    params.push(id);
    this.db.run(`UPDATE feed_groups SET ${sets.join(", ")} WHERE id = ?`, params);
    persistDatabase();
  }
  /** Deletes a group (feeds inside are moved to NULL / ungrouped). */
  deleteGroup(id) {
    this.db.run("DELETE FROM feed_groups WHERE id = ?", [id]);
    persistDatabase();
  }
  // ── Feeds ─────────────────────────────────────────────────────────────────
  /** Returns all active feeds including their unread_count. */
  getAll() {
    const result = this.db.exec(`
      SELECT * FROM feeds
      WHERE is_active = 1
      ORDER BY group_id NULLS LAST, title COLLATE NOCASE
    `);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map((row) => rowToFeed(columns, row));
  }
  /** Returns a single feed by ID, or null if not found. */
  getById(id) {
    const result = this.db.exec("SELECT * FROM feeds WHERE id = ?", [id]);
    if (!result.length || !result[0].values.length) return null;
    return rowToFeed(result[0].columns, result[0].values[0]);
  }
  /** Returns a single feed by URL, or null if not found. */
  getByUrl(url2) {
    const result = this.db.exec("SELECT * FROM feeds WHERE url = ?", [url2]);
    if (!result.length || !result[0].values.length) return null;
    return rowToFeed(result[0].columns, result[0].values[0]);
  }
  /**
   * Inserts a new feed.  If a feed with the same URL already exists, returns
   * its existing ID without modifying the record (idempotent).
   */
  create(input, skipPersist = false) {
    const existing = this.getByUrl(input.url);
    if (existing) return existing.id;
    const now = Math.floor(Date.now() / 1e3);
    this.db.run(
      `INSERT INTO feeds
         (url, title, site_url, description, favicon_url, language, group_id,
          fetch_interval_sec, next_fetch_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.url,
        input.title ?? null,
        input.site_url ?? null,
        input.description ?? null,
        input.favicon_url ?? null,
        input.language ?? null,
        input.group_id ?? null,
        input.fetch_interval_sec ?? 900,
        now,
        // schedule first sync immediately
        now,
        now
      ]
    );
    const res = this.db.exec("SELECT last_insert_rowid() AS id");
    const id = Number(res[0].values[0][0]);
    if (!skipPersist) persistDatabase();
    return id;
  }
  /** Applies a partial update to a feed. */
  update(id, patch, skipPersist = false) {
    const sets = [];
    const params = [];
    if (patch.title !== void 0) {
      sets.push("title = ?");
      params.push(patch.title);
    }
    if (patch.site_url !== void 0) {
      sets.push("site_url = ?");
      params.push(patch.site_url);
    }
    if (patch.group_id !== void 0) {
      sets.push("group_id = ?");
      params.push(patch.group_id);
    }
    if (patch.fetch_interval_sec !== void 0) {
      sets.push("fetch_interval_sec = ?");
      params.push(patch.fetch_interval_sec);
    }
    if (patch.favicon_url !== void 0) {
      sets.push("favicon_url = ?");
      params.push(patch.favicon_url);
    }
    if (patch.is_active !== void 0) {
      sets.push("is_active = ?");
      params.push(patch.is_active ? 1 : 0);
    }
    if (sets.length === 0) return;
    params.push(id);
    this.db.run(`UPDATE feeds SET ${sets.join(", ")} WHERE id = ?`, params);
    if (!skipPersist) persistDatabase();
  }
  /**
   * Updates sync-related columns after a successful fetch attempt.
   * Called by the SyncEngine after processing a feed.
   */
  updateAfterSync(params, skipPersist = false) {
    this.db.run(
      `UPDATE feeds
       SET last_fetched_at = ?, next_fetch_at = ?, last_etag = ?,
           last_modified = ?, error_count = ?
       WHERE id = ?`,
      [
        Math.floor(Date.now() / 1e3),
        params.next_fetch_at,
        params.last_etag,
        params.last_modified,
        params.error_count,
        params.id
      ]
    );
    if (!skipPersist) persistDatabase();
  }
  /** Permanently deletes a feed and all its articles (CASCADE). */
  delete(id) {
    this.db.run("DELETE FROM feeds WHERE id = ?", [id]);
    persistDatabase();
  }
  /** Returns feeds whose next_fetch_at is in the past (ready for sync). */
  getDueForSync() {
    const now = Math.floor(Date.now() / 1e3);
    const result = this.db.exec(
      "SELECT * FROM feeds WHERE is_active = 1 AND (next_fetch_at IS NULL OR next_fetch_at <= ?)",
      [now]
    );
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map((row) => rowToFeed(columns, row));
  }
  /**
   * Recounts unread articles for a given feed and stores the result.
   */
  recountUnread(feedId, skipPersist = false) {
    this.db.run(
      `UPDATE feeds
       SET unread_count = (
         SELECT COUNT(*) FROM articles WHERE feed_id = ? AND is_read = 0
       )
       WHERE id = ?`,
      [feedId, feedId]
    );
    if (!skipPersist) persistDatabase();
  }
  /**
   * Efficiently recounts unread articles for ALL feeds in a single pass.
   * This is much faster than looping through every feed individually.
   */
  recountAllUnread() {
    this.db.run(`
      UPDATE feeds
      SET unread_count = (
        SELECT COUNT(*)
        FROM articles
        WHERE articles.feed_id = feeds.id AND articles.is_read = 0
      )
    `);
    persistDatabase();
  }
  /**
   * Resets error_count to 0 for all feeds.
   * Typically called at boot to avoid showing stale errors before a fresh sync attempt.
   */
  resetErrorCounts() {
    this.db.run("UPDATE feeds SET error_count = 0");
    persistDatabase();
  }
}
function rowToArticle(columns, row) {
  const o = {};
  columns.forEach((col, i) => {
    o[col] = row[i];
  });
  return {
    ...o,
    is_read: o["is_read"] === 1,
    is_saved: o["is_saved"] === 1
  };
}
function rowToSummary(columns, row) {
  const o = {};
  columns.forEach((col, i) => {
    o[col] = row[i];
  });
  return {
    ...o,
    is_read: o["is_read"] === 1,
    is_saved: o["is_saved"] === 1
  };
}
class ArticleService {
  constructor(db) {
    this.db = db;
    this.migrateRedditComments();
  }
  /**
   * One-time structural migration designed to retroactively flag orphaned Subreddit comments
   * natively inside SQLite via NodeJS Regex mapping, hiding them from the chronological view.
   */
  migrateRedditComments() {
    const rows = this.db.exec(
      `SELECT id, url FROM articles WHERE url LIKE '%reddit.com%' AND (enclosure_type IS NULL OR enclosure_type != 'reddit-comment')`
    );
    if (!rows.length || !rows[0].values.length) return;
    let updated = false;
    this.db.run("BEGIN TRANSACTION");
    for (const [id, url2] of rows[0].values) {
      if (typeof url2 === "string" && /\/comments\/[^/]+\/[^/]+\/[^/]+/.test(url2)) {
        this.db.run(`UPDATE articles SET enclosure_type = 'reddit-comment' WHERE id = ?`, [id]);
        updated = true;
      }
    }
    this.db.run("COMMIT");
    if (updated) {
      persistDatabase();
    }
  }
  // ── Queries ───────────────────────────────────────────────────────────────
  /**
   * Returns a paginated list of article summaries.
   * Uses cursor-based pagination for constant-time page loading regardless
   * of how many articles exist.
   */
  list(params) {
    const limit = params.limit ?? 50;
    const conditions = [];
    const bindings = [];
    if (params.feed_id !== void 0) {
      conditions.push("a.feed_id = ?");
      bindings.push(params.feed_id);
    }
    if (params.group_id !== void 0) {
      conditions.push("f.group_id = ?");
      bindings.push(params.group_id);
    }
    if (params.unread_only) {
      conditions.push("a.is_read = 0");
    }
    if (params.saved_only) {
      conditions.push("a.is_saved = 1");
    }
    if (params.cursor_published_at !== void 0 && params.cursor_id !== void 0) {
      conditions.push("(a.published_at < ? OR (a.published_at = ? AND a.id < ?))");
      bindings.push(params.cursor_published_at, params.cursor_published_at, params.cursor_id);
    }
    conditions.push("(a.enclosure_type IS NULL OR a.enclosure_type != 'reddit-comment')");
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `
      SELECT
        a.id, a.feed_id,
        f.title  AS feed_title,
        f.favicon_url AS feed_favicon,
        a.title, a.author, a.excerpt, a.thumbnail_url,
        a.published_at, a.is_read, a.is_starred, a.is_saved
      FROM articles a
      JOIN feeds f ON f.id = a.feed_id
      ${where}
      ORDER BY a.published_at DESC, a.id DESC
      LIMIT ?
    `;
    bindings.push(limit);
    const result = this.db.exec(sql, bindings);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map((row) => rowToSummary(columns, row));
  }
  /** Returns the full article (including HTML content) for the reader pane. */
  getById(id) {
    const sql = `
      SELECT
        a.*,
        f.title AS feed_title,
        f.favicon_url AS feed_favicon
      FROM articles a
      JOIN feeds f ON f.id = a.feed_id
      WHERE a.id = ?
    `;
    const result = this.db.exec(sql, [id]);
    if (!result.length || !result[0].values.length) return null;
    const article = rowToArticle(result[0].columns, result[0].values[0]);
    if (article.url && article.url.includes("reddit.com/r/")) {
      const baseMatch = article.url.match(
        /^(https?:\/\/(?:www\.|old\.|np\.)?reddit\.com\/r\/[^/]+\/comments\/[^/]+\/[^/]+\/)/
      );
      if (baseMatch) {
        const baseUrl = baseMatch[1];
        const commentRows = this.db.exec(
          `SELECT
             a.*,
             f.title AS feed_title,
             f.favicon_url AS feed_favicon
           FROM articles a
           JOIN feeds f ON f.id = a.feed_id
           WHERE a.feed_id = ? AND a.enclosure_type = 'reddit-comment'`,
          [article.feed_id]
        );
        if (commentRows.length && commentRows[0].values.length) {
          const { columns, values } = commentRows[0];
          article.comments = values.map((row) => rowToArticle(columns, row)).filter((c) => c.url && c.url.startsWith(baseUrl) && c.id !== article.id).sort((a, b) => (a.published_at || 0) - (b.published_at || 0));
        }
      }
    }
    return article;
  }
  /** Returns the total count of unread articles (across all feeds). */
  totalUnreadCount() {
    const result = this.db.exec("SELECT COUNT(*) FROM articles WHERE is_read = 0");
    return Number(result[0]?.values[0][0] ?? 0);
  }
  /**
   * Universal semantic search utilizing SQLite FTS4.
   * Computes matches over tokenized content, AND relational folder/feed names.
   */
  search(query) {
    const q = query.trim();
    if (!q) return [];
    const safeQuery = q.replace(/"/g, '""');
    const matchQuery = `"${safeQuery}"*`;
    const likeQuery = `%${q}%`;
    const sql = `
      SELECT
        a.id, a.feed_id, f.title AS feed_title, f.favicon_url AS feed_favicon,
        a.title, a.author, a.excerpt, a.thumbnail_url, a.published_at, a.is_read, a.is_starred, a.is_saved
      FROM articles a
      JOIN feeds f ON f.id = a.feed_id
      JOIN articles_fts fts ON fts.docid = a.id
      WHERE articles_fts MATCH ?

      UNION

      SELECT
        a.id, a.feed_id, f.title AS feed_title, f.favicon_url AS feed_favicon,
        a.title, a.author, a.excerpt, a.thumbnail_url, a.published_at, a.is_read, a.is_starred, a.is_saved
      FROM articles a
      JOIN feeds f ON f.id = a.feed_id
      LEFT JOIN feed_groups fg ON fg.id = f.group_id
      WHERE f.title LIKE ? OR fg.name LIKE ?

      ORDER BY published_at DESC
      LIMIT 100
    `;
    const result = this.db.exec(sql, [matchQuery, likeQuery, likeQuery]);
    if (!result.length) return [];
    return result[0].values.map((row) => rowToSummary(result[0].columns, row));
  }
  // ── Writes ────────────────────────────────────────────────────────────────
  /**
   * Inserts a new article, or ignores it silently if it already exists
   * (same feed_id + guid). Returns the article ID (existing or new).
   */
  upsert(input) {
    const existing = this.db.exec("SELECT id FROM articles WHERE feed_id = ? AND guid = ?", [
      input.feed_id,
      input.guid
    ]);
    if (existing.length && existing[0].values.length) {
      const existingId = Number(existing[0].values[0][0]);
      this.db.run(
        `UPDATE articles SET
           title = COALESCE(?, title),
           content_html = COALESCE(?, content_html),
           content_text = COALESCE(?, content_text),
           excerpt = COALESCE(?, excerpt),
           enclosure_type = COALESCE(?, enclosure_type),
           thumbnail_url = COALESCE(?, thumbnail_url)
         WHERE id = ?`,
        [
          input.title ?? null,
          input.content_html ?? null,
          input.content_text ?? null,
          input.excerpt ?? null,
          input.enclosure_type ?? null,
          input.thumbnail_url ?? null,
          existingId
        ]
      );
      if (input.thumbnail_url) {
        this.db.run(
          `UPDATE articles SET thumbnail_url = ? WHERE id = ? AND thumbnail_url IS NULL`,
          [input.thumbnail_url, existingId]
        );
      }
      return { id: existingId, isNew: false };
    }
    const now = Math.floor(Date.now() / 1e3);
    this.db.run(
      `INSERT OR IGNORE INTO articles
         (feed_id, guid, url, title, author, content_html, content_text,
          excerpt, enclosure_url, enclosure_type, thumbnail_url, word_count, published_at,
          fetched_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.feed_id,
        input.guid,
        input.url ?? null,
        input.title ?? null,
        input.author ?? null,
        input.content_html ?? null,
        input.content_text ?? null,
        input.excerpt ?? null,
        input.enclosure_url ?? null,
        input.enclosure_type ?? null,
        input.thumbnail_url ?? null,
        input.word_count ?? null,
        input.published_at ?? now,
        now,
        now
      ]
    );
    const res = this.db.exec("SELECT last_insert_rowid() AS id");
    return { id: Number(res[0].values[0][0]), isNew: true };
  }
  /** Marks a single article as read or unread. */
  setRead(id, value) {
    this.db.run("UPDATE articles SET is_read = ? WHERE id = ?", [value ? 1 : 0, id]);
    persistDatabase();
  }
  /** Saves or unsaves an article (Read Later queue). */
  setSaved(id, value) {
    this.db.run("UPDATE articles SET is_saved = ? WHERE id = ?", [value ? 1 : 0, id]);
    if (value) {
      this.db.run("INSERT OR IGNORE INTO read_later (article_id) VALUES (?)", [id]);
    } else {
      this.db.run("DELETE FROM read_later WHERE article_id = ?", [id]);
    }
    persistDatabase();
  }
  /**
   * Marks all articles in a feed as read (or all feeds if feedId is undefined).
   * After a bulk update the caller should call FeedService.recountUnread() to
   * resync the denormalised counter.
   */
  markAllRead(feedId) {
    let sql = "UPDATE articles SET is_read = 1 WHERE is_read = 0";
    const params = [];
    if (feedId !== void 0) {
      sql += " AND feed_id = ?";
      params.push(feedId);
    }
    this.db.run(sql, params);
    const res = this.db.exec("SELECT changes()");
    const affected = Number(res[0]?.values[0][0] ?? 0);
    persistDatabase();
    return affected;
  }
  /**
   * Deletes old articles according to the retention policy.
   * Articles that are starred or saved are never deleted.
   *
   * @param retentionDays - Delete articles older than this many days
   * @returns Number of deleted rows
   */
  applyRetention(retentionDays) {
    const cutoff = Math.floor(Date.now() / 1e3) - retentionDays * 86400;
    this.db.run(
      `DELETE FROM articles
       WHERE published_at < ?
         AND is_starred = 0
         AND is_saved   = 0`,
      [cutoff]
    );
    const res = this.db.exec("SELECT changes()");
    const deleted = Number(res[0]?.values[0][0] ?? 0);
    if (deleted > 0) persistDatabase();
    return deleted;
  }
  // ── GitHub Links Aggregator ───────────────────────────────────────────────
  /**
   * Scans the database for articles containing GitHub links, extracts them
   * via basic Regex, and returns an array mapping them to their sources.
   */
  getGithubLinks() {
    const result = this.db.exec(`
      SELECT a.id, a.title, f.title as feed_title, a.content_html, fg.name as group_title
      FROM articles a
      JOIN feeds f ON a.feed_id = f.id
      LEFT JOIN feed_groups fg ON f.group_id = fg.id
      WHERE a.content_html LIKE '%github.com/%'
      ORDER BY a.published_at DESC
      LIMIT 3000
    `);
    if (!result.length || !result[0].values.length) return [];
    const links = [];
    const regex = /href=["'](https?:\/\/(?:www\.)?github\.com\/([^/"']+)\/([^/"'?#]+)[^"']*)["']/gi;
    result[0].values.forEach((row) => {
      const articleId = Number(row[0]);
      const articleTitle = String(row[1] || "Untitled");
      const feedTitle = String(row[2] || "Unknown Feed");
      const html = String(row[3] || "");
      const groupTitle = row[4] ? String(row[4]) : void 0;
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(html)) !== null) {
        const url2 = match[1];
        const org = match[2];
        const repo = match[3];
        const ignoreList = [
          "search",
          "topics",
          "trending",
          "pricing",
          "contact",
          "about",
          "login",
          "join",
          "pulls",
          "issues"
        ];
        if (ignoreList.includes(org.toLowerCase()) || ignoreList.includes(repo.toLowerCase())) {
          continue;
        }
        const linkText = `${org}/${repo}`;
        links.push({
          url: url2,
          linkText,
          articleId,
          articleTitle,
          feedTitle,
          groupTitle
        });
      }
    });
    const uniqueLinks = [];
    const seenUrls = /* @__PURE__ */ new Set();
    for (const link of links) {
      if (!seenUrls.has(link.url)) {
        seenUrls.add(link.url);
        uniqueLinks.push(link);
      }
    }
    return uniqueLinks;
  }
}
class SearchService {
  constructor(db) {
    this.db = db;
  }
  /**
   * Runs a full-text search and returns matching articles sorted by relevance.
   * The query string is passed directly to FTS4 MATCH — see FTS4 docs for
   * supported syntax.  Returns an empty array for blank queries.
   *
   * @param query  - The search string (FTS5 MATCH expression)
   * @param limit  - Maximum results to return (default: 30)
   */
  search(query, limit = 30) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const words = trimmed.split(/\s+/).filter(Boolean).map((w) => `"${w.replace(/"/g, '""')}"*`);
    const matchQuery = words.join(" ");
    const likeQuery = `%${trimmed}%`;
    try {
      const result = this.db.exec(
        `
        SELECT
          a.id, a.feed_id,
          f.title      AS feed_title,
          f.favicon_url AS feed_favicon,
          a.title, a.author, a.excerpt,
          a.published_at, a.is_read, a.is_starred, a.is_saved,
          snippet(articles_fts, '[[[', ']]]', '…', 1, 15) AS snippet,
          (CASE WHEN a.title LIKE ? OR a.excerpt LIKE ? THEN -1 ELSE 1 END) AS exact_match,
          0 AS rank
        FROM articles_fts fts
        JOIN articles a ON a.id = fts.rowid
        JOIN feeds    f ON f.id = a.feed_id
        WHERE articles_fts MATCH ?

        ORDER BY exact_match ASC, rank ASC, published_at DESC
        LIMIT ?
        `,
        [likeQuery, likeQuery, matchQuery, limit]
      );
      if (!result.length) return [];
      const { columns, values } = result[0];
      return values.map((row) => {
        const o = {};
        columns.forEach((col, i) => {
          o[col] = row[i];
        });
        const rawSnippet = String(o["snippet"] ?? "");
        return {
          ...o,
          is_read: o["is_read"] === 1,
          is_starred: o["is_starred"] === 1,
          is_saved: o["is_saved"] === 1,
          rank: Number(o["rank"]),
          snippet: rawSnippet.replace(/\[\[\[|\]\]\]/g, "")
        };
      });
    } catch (err) {
      console.error("[SearchService] FTS4 query error:", err);
      return [];
    }
  }
}
class SettingsService {
  constructor(db) {
    this.db = db;
  }
  /** Returns the raw string value of a setting, or null if not found. */
  get(key) {
    const result = this.db.exec("SELECT value FROM settings WHERE key = ?", [key]);
    if (!result.length || !result[0].values.length) return null;
    const raw = result[0].values[0][0];
    return raw !== null ? String(raw) : null;
  }
  /** Returns all settings as a plain object. */
  getAll() {
    const result = this.db.exec("SELECT key, value FROM settings");
    if (!result.length) return {};
    const out = {};
    for (const [key, value] of result[0].values) {
      if (key !== null) out[String(key)] = value !== null ? String(value) : "";
    }
    return out;
  }
  /** Sets a single key.  Upserts if the key already exists. */
  set(key, value) {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, strftime('%s','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                       updated_at = excluded.updated_at`,
      [key, value]
    );
    persistDatabase();
  }
  // ── Typed convenience getters ─────────────────────────────────────────────
  get theme() {
    return this.get("theme") ?? "dark";
  }
  get readingPane() {
    return this.get("reading_pane") ?? "right";
  }
  get markReadOnOpen() {
    return this.get("mark_read_on_open") === "1";
  }
  get retentionDays() {
    return parseInt(this.get("retention_days") ?? "30", 10);
  }
  get defaultIntervalSec() {
    return parseInt(this.get("default_interval_sec") ?? "900", 10);
  }
}
const MAX_IMPORT_FEEDS = 1e3;
class OpmlService {
  constructor(feedService) {
    this.feedService = feedService;
  }
  // ── Import ────────────────────────────────────────────────────────────────
  /**
   * Parses an OPML XML string and imports all found feed subscriptions.
   * Top-level `<outline>` elements that contain nested outlines are treated
   * as category folders (feed groups).
   *
   * @param xml - Raw OPML XML string
   * @returns Number of feeds successfully imported
   * @throws If the XML is malformed or the import cap is exceeded
   */
  import(xml) {
    const parser = new fastXmlParser.XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: false,
      allowBooleanAttributes: true
    });
    const parsed = parser.parse(xml);
    const body = parsed?.opml?.body;
    if (!body) throw new Error("Invalid OPML: missing <body> element");
    const feeds = this.extractFeeds(body?.outline ?? []);
    if (feeds.length > MAX_IMPORT_FEEDS) {
      throw new Error(`Import cap exceeded: ${feeds.length} feeds found, max is ${MAX_IMPORT_FEEDS}`);
    }
    let imported = 0;
    for (const feed of feeds) {
      if (!feed.xmlUrl) continue;
      let groupId;
      if (feed.category) {
        const existing = this.feedService.getGroups().find((g) => g.name.toLowerCase() === feed.category.toLowerCase());
        groupId = existing?.id ?? this.feedService.createGroup(feed.category, true);
      }
      this.feedService.create({
        url: feed.xmlUrl,
        title: feed.title ?? void 0,
        site_url: feed.htmlUrl ?? void 0,
        group_id: groupId
      }, true);
      imported++;
    }
    if (imported > 0) {
      persistDatabase();
    }
    return imported;
  }
  // ── Export ────────────────────────────────────────────────────────────────
  /**
   * Generates an OPML 2.0 XML document from the current feed list.
   * Feeds are grouped by their feed group (category).
   */
  export() {
    const groups = this.feedService.getGroups();
    const feeds = this.feedService.getAll();
    const byGroup = /* @__PURE__ */ new Map();
    byGroup.set(null, []);
    for (const g of groups) byGroup.set(g.id, []);
    for (const f of feeds) {
      const bucket = byGroup.get(f.group_id) ?? byGroup.get(null);
      bucket.push(f);
    }
    const outlines = [];
    for (const feed of byGroup.get(null) ?? []) {
      outlines.push({
        "@_type": "rss",
        "@_title": feed.title ?? feed.url,
        "@_xmlUrl": feed.url,
        "@_htmlUrl": feed.site_url ?? ""
      });
    }
    for (const group of groups) {
      const children = (byGroup.get(group.id) ?? []).map((feed) => ({
        "@_type": "rss",
        "@_title": feed.title ?? feed.url,
        "@_xmlUrl": feed.url,
        "@_htmlUrl": feed.site_url ?? ""
      }));
      if (children.length === 0) continue;
      outlines.push({
        "@_title": group.name,
        "@_text": group.name,
        outline: children
      });
    }
    const builder = new fastXmlParser.XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      format: true,
      indentBy: "  "
    });
    return builder.build({
      "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
      opml: {
        "@_version": "2.0",
        head: {
          title: "Albatros RSS Subscriptions",
          dateCreated: (/* @__PURE__ */ new Date()).toUTCString()
        },
        body: { outline: outlines }
      }
    });
  }
  // ── Private helpers ───────────────────────────────────────────────────────
  /** Recursively walks the outline tree and collects feed entries. */
  extractFeeds(outlines, category = null) {
    const items = Array.isArray(outlines) ? outlines : [outlines];
    const result = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const o = item;
      const xmlUrl = o["@_xmlUrl"] ?? "";
      const title = o["@_title"] ?? o["@_text"] ?? null;
      const htmlUrl = o["@_htmlUrl"] ?? null;
      const type = o["@_type"] ?? "";
      if (xmlUrl && (type === "rss" || type === "atom")) {
        result.push({ title, xmlUrl, htmlUrl, category });
      } else if (o["outline"]) {
        const groupName = title ?? null;
        result.push(...this.extractFeeds(o["outline"], groupName));
      }
    }
    return result;
  }
}
const BLOCKED_PREFIXES = [
  "10.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.168.",
  "127.",
  "169.254.",
  // Link-local
  "::1",
  // IPv6 loopback
  "fc",
  "fd"
  // IPv6 unique-local
];
function isPrivateHost(hostname) {
  for (const prefix of BLOCKED_PREFIXES) {
    if (hostname.startsWith(prefix)) return true;
  }
  if (hostname === "localhost") return true;
  return false;
}
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Albatros/1.0";
const RESPONSE_TIMEOUT_MS = 45e3;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
async function fetchFeed(url$1, lastEtag = null, lastModified = null) {
  let parsed;
  try {
    parsed = new url.URL(url$1);
  } catch {
    throw new Error(`Invalid feed URL: ${url$1}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(`Blocked: URL resolves to a private address (${parsed.hostname})`);
  }
  const headers = {
    "User-Agent": USER_AGENT,
    "Accept": "application/rss+xml, application/atom+xml, application/json, application/xml, text/xml, */*;q=0.8"
  };
  if (lastEtag) headers["If-None-Match"] = lastEtag;
  if (lastModified) headers["If-Modified-Since"] = lastModified;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESPONSE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url$1, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "follow"
    });
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`Fetch failed for ${url$1}: ${err instanceof Error ? err.message : String(err)}`);
  }
  clearTimeout(timeout);
  const statusCode = response.status;
  if (statusCode === 304) {
    return {
      status: 304,
      body: "",
      etag: extractHeader(response.headers.get("etag")),
      lastModified: extractHeader(response.headers.get("last-modified")),
      contentType: null
    };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${statusCode} fetching ${url$1}`);
  }
  const bodyText = await response.text();
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    throw new Error(`Feed body exceeds size limit (${MAX_BODY_BYTES} bytes): ${url$1}`);
  }
  return {
    status: statusCode,
    body: bodyText,
    etag: extractHeader(response.headers.get("etag")),
    lastModified: extractHeader(response.headers.get("last-modified")),
    contentType: extractHeader(response.headers.get("content-type"))
  };
}
function extractHeader(value) {
  if (value === void 0 || value === null) return null;
  return Array.isArray(value) ? value[0] : value;
}
const xmlParser = new fastXmlParser.XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  allowBooleanAttributes: true,
  // Treat CDATA sections as text
  cdataPropName: "__cdata",
  // Always return arrays for these elements to avoid single-item vs array
  // inconsistencies
  isArray: (name) => ["item", "entry", "link", "category", "author"].includes(name)
});
function parseFeed(body, contentType) {
  const isJson = contentType?.includes("json") || body.trimStart().startsWith("{");
  if (isJson) return parseJsonFeed(body);
  let parsed;
  try {
    parsed = xmlParser.parse(body);
  } catch {
    return { format: "unknown", meta: emptyMeta(), articles: [] };
  }
  if (parsed["rss"]) return parseRss(parsed["rss"]);
  if (parsed["feed"]) return parseAtom(parsed["feed"]);
  return { format: "unknown", meta: emptyMeta(), articles: [] };
}
function parseRss(rss) {
  const channel = rss["channel"] ?? {};
  const meta = {
    title: coerceText(channel["title"]),
    site_url: coerceText(channel["link"]),
    description: coerceText(channel["description"]),
    language: coerceText(channel["language"])
  };
  const rawItems = asArray(channel["item"]);
  const siteUrl = meta.site_url;
  const articles = rawItems.map((item) => parseRssItem(item, siteUrl));
  return { format: "rss", meta, articles };
}
function parseRssItem(item, siteUrl) {
  const guid = coerceText(item["guid"]) ?? coerceText(item["link"]) ?? "";
  const link = coerceText(item["link"]);
  const title = coerceText(item["title"]);
  const contentEncoded = coerceText(item["content:encoded"]);
  const description = coerceText(item["description"]);
  let rawHtml = contentEncoded ?? description;
  if (link && link.includes("reddit.com") && rawHtml) {
    rawHtml = fixRedditContent(rawHtml);
  }
  const isHackerNews = guid?.includes("news.ycombinator.com") || link?.includes("news.ycombinator.com") || rawHtml && /Comments URL:.*news\.ycombinator\.com/i.test(rawHtml) || rawHtml && /Points?:\s*\d+/i.test(rawHtml) && /#?\s*Comments?:\s*\d+/i.test(rawHtml);
  if (rawHtml && isHackerNews) {
    rawHtml = fixHackerNewsContent(rawHtml, item);
  }
  const author = extractRssAuthor(item);
  const enclosure = item["enclosure"];
  const enclosureUrl = enclosure?.["@_url"] ?? null;
  let enclosureType = enclosure?.["@_type"] ?? null;
  if (link && link.includes("reddit.com") && /\/comments\/[^/]+\/[^/]+\/[^/]+/.test(link)) {
    enclosureType = "reddit-comment";
  }
  const publishedAt = parseDateToUnix(coerceText(item["pubDate"]));
  const contentText = rawHtml ? stripHtml(rawHtml) : null;
  const excerpt = contentText ? truncate(contentText, 160) : null;
  const wordCount = contentText ? countWords(contentText) : null;
  return {
    guid,
    url: link,
    title,
    author,
    content_html: rawHtml,
    content_text: contentText,
    excerpt,
    enclosure_url: enclosureUrl,
    enclosure_type: enclosureType,
    word_count: wordCount,
    published_at: publishedAt,
    thumbnail_url: extractRssThumbnail(item, rawHtml, siteUrl)
  };
}
function extractRssThumbnail(item, html, siteUrl) {
  const mediaThumb = item["media:thumbnail"];
  if (mediaThumb?.["@_url"]) return resolveUrl(mediaThumb["@_url"], siteUrl);
  const mediaContent = asArray(item["media:content"]);
  for (const mc of mediaContent) {
    if (mc?.["@_url"] && (mc?.["@_medium"] === "image" || mc?.["@_type"]?.startsWith("image/"))) {
      return resolveUrl(mc["@_url"], siteUrl);
    }
  }
  if (html) return getFirstImageFromHtml(html, siteUrl);
  return null;
}
function extractRssAuthor(item) {
  const creator = coerceText(item["dc:creator"]);
  if (creator) return creator;
  const author = coerceText(item["author"]);
  if (author) return author;
  return null;
}
function parseAtom(feed) {
  const meta = {
    title: coerceText(feed["title"]),
    site_url: extractAtomLink(feed),
    description: coerceText(feed["subtitle"]),
    language: feed["@_xml:lang"] ?? null
  };
  const rawEntries = asArray(feed["entry"]);
  const siteUrl = meta.site_url;
  const articles = rawEntries.map((entry) => parseAtomEntry(entry, siteUrl));
  return { format: "atom", meta, articles };
}
function parseAtomEntry(entry, siteUrl) {
  const guid = coerceText(entry["id"]) ?? extractAtomLink(entry) ?? "";
  const link = extractAtomLink(entry);
  const title = coerceText(entry["title"]);
  let contentRaw = coerceText(entry["content"]) ?? coerceText(entry["summary"]);
  if (link && link.includes("reddit.com") && contentRaw) {
    contentRaw = fixRedditContent(contentRaw);
  }
  const ytVideoIdObj = entry["yt:videoId"];
  const ytVideoId = typeof ytVideoIdObj === "string" ? ytVideoIdObj : coerceText(ytVideoIdObj);
  if (ytVideoId) {
    const mediaGroup = entry["media:group"];
    const mediaDesc = coerceText(mediaGroup?.["media:description"]) || "";
    const mediaCommunity = mediaGroup?.["media:community"];
    const mediaStats = mediaCommunity?.["media:statistics"];
    const views = mediaStats?.["@_views"] ? Number(mediaStats["@_views"]).toLocaleString() : null;
    const starRating = mediaCommunity?.["media:starRating"];
    const likes = starRating?.["@_count"] ? Number(starRating["@_count"]).toLocaleString() : null;
    let extraHtml = "";
    if (views || likes) {
      extraHtml += `<div style="display: flex; gap: 16px; margin: -12px 0 24px; font-size: 0.85em; color: var(--text-muted); font-weight: var(--weight-medium);">`;
      if (views)
        extraHtml += `<span style="display: flex; align-items: center; gap: 4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${views}</span>`;
      if (likes)
        extraHtml += `<span style="display: flex; align-items: center; gap: 4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> ${likes}</span>`;
      extraHtml += `</div>`;
    }
    if (mediaDesc) {
      const formattedDesc = mediaDesc.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(
        /(https?:\/\/[^\s]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
      ).replace(/\n/g, "<br/>");
      extraHtml += `<div style="padding: 1rem 1.25rem; background: var(--bg-elevated); border-radius: var(--radius-md); font-size: 0.9em; line-height: 1.6; color: var(--text-secondary); word-break: break-word; white-space: pre-wrap;">${formattedDesc}</div>`;
    }
    contentRaw = fixYoutubeContent(ytVideoId) + extraHtml;
  }
  const authorObj = asArray(entry["author"])[0];
  const author = coerceText(authorObj?.["name"]) ?? coerceText(entry["author"]);
  const updatedRaw = coerceText(entry["updated"]);
  const publishedRaw = coerceText(entry["published"]) ?? updatedRaw;
  const publishedAt = parseDateToUnix(publishedRaw);
  const contentText = contentRaw ? stripHtml(contentRaw) : null;
  const excerpt = contentText ? truncate(contentText, 160) : null;
  const wordCount = ytVideoId ? null : contentText ? countWords(contentText) : null;
  let enclosureType = null;
  if (link && link.includes("reddit.com") && /\/comments\/[^/]+\/[^/]+\/[^/]+/.test(link)) {
    enclosureType = "reddit-comment";
  }
  return {
    guid,
    url: link,
    title,
    author,
    content_html: contentRaw,
    content_text: contentText,
    excerpt,
    enclosure_url: null,
    enclosure_type: enclosureType,
    word_count: wordCount,
    published_at: publishedAt,
    thumbnail_url: extractAtomThumbnail(entry, contentRaw, siteUrl)
  };
}
function extractAtomThumbnail(entry, html, siteUrl) {
  const mediaGroup = entry["media:group"];
  const mediaThumb = entry["media:thumbnail"] ?? mediaGroup?.["media:thumbnail"];
  if (mediaThumb?.["@_url"]) return resolveUrl(mediaThumb["@_url"], siteUrl);
  const ytVideoId = findYoutubeVideoId(entry);
  if (ytVideoId) return `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`;
  if (html) return getFirstImageFromHtml(html, siteUrl);
  return null;
}
function extractAtomLink(obj) {
  const links = asArray(obj["link"]);
  if (!links.length) return null;
  for (const l of links) {
    if (typeof l === "object" && l?.["@_rel"] === "alternate") {
      return l?.["@_href"] ?? null;
    }
  }
  const first = links[0];
  if (typeof first === "string") return first;
  if (typeof first === "object") return first?.["@_href"] ?? null;
  return null;
}
function parseJsonFeed(body) {
  let obj;
  try {
    obj = JSON.parse(body);
  } catch {
    return { format: "unknown", meta: emptyMeta(), articles: [] };
  }
  if (!obj["version"]?.toString().startsWith("https://jsonfeed.org/version/")) {
    return { format: "unknown", meta: emptyMeta(), articles: [] };
  }
  const meta = {
    title: obj["title"] ?? null,
    site_url: obj["home_page_url"] ?? null,
    description: obj["description"] ?? null,
    language: obj["language"] ?? null
  };
  const items = asArray(obj["items"]);
  const articles = items.map(parseJsonItem);
  return { format: "jsonfeed", meta, articles };
}
function parseJsonItem(item) {
  const guid = item["id"] ?? "";
  const link = item["url"] ?? null;
  const title = item["title"] ?? null;
  const contentHtml = item["content_html"] ?? null;
  const contentText = item["content_text"] ?? null;
  const summary = item["summary"] ?? null;
  const textBody = contentText ?? (contentHtml ? stripHtml(contentHtml) : summary);
  const datePublished = item["date_published"] ?? null;
  const authorObj = item["author"];
  const author = authorObj?.["name"] ?? null;
  return {
    guid,
    url: link,
    title,
    author,
    content_html: contentHtml,
    content_text: textBody,
    excerpt: textBody ? truncate(textBody, 160) : null,
    enclosure_url: null,
    enclosure_type: null,
    word_count: textBody ? countWords(textBody) : null,
    published_at: parseDateToUnix(datePublished),
    thumbnail_url: item["image"] || (contentHtml ? getFirstImageFromHtml(contentHtml) : null)
  };
}
function coerceText(val) {
  if (!val) return null;
  if (typeof val === "string") return val || null;
  if (typeof val === "number") return String(val);
  if (Array.isArray(val)) return coerceText(val[0]);
  if (typeof val === "object") {
    const o = val;
    const t = o["__cdata"] ?? o["#text"] ?? o["_"] ?? null;
    return t ? coerceText(t) : null;
  }
  return null;
}
function asArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}
function parseDateToUnix(dateStr) {
  if (!dateStr) return null;
  const ms = Date.parse(dateStr);
  return isNaN(ms) ? null : Math.floor(ms / 1e3);
}
function stripHtml(html) {
  return html.replace(/<(br|p|div|li|h[1-6])[^>]*>/gi, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.8 ? cut.slice(0, lastSpace) : cut) + "…";
}
function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}
function getFirstImageFromHtml(html, siteUrl = null) {
  const match = /<img[^>]+src=["']([^"'>]+)["']/i.exec(html);
  if (!match) return null;
  let src = match[1];
  if (!src || src.startsWith("data:") || src.startsWith("//")) return null;
  return resolveUrl(src, siteUrl);
}
function resolveUrl(relative, base) {
  if (!base) return relative;
  if (relative.startsWith("http://") || relative.startsWith("https://")) return relative;
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}
function findYoutubeVideoId(obj) {
  const ytKey = Object.keys(obj).find((k) => {
    const lower = k.toLowerCase();
    return lower.includes("yt:videoid") || lower.includes("ytvideoid") || lower === "yt:videoid";
  });
  if (ytKey) {
    const val = obj[ytKey];
    return typeof val === "string" ? val : coerceText(val);
  }
  return null;
}
function fixYoutubeContent(videoId) {
  return `
    <div class="youtube-player-container">
      <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer" class="youtube-player-preview">
        <img src="https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg" 
             onerror="this.src='https://i.ytimg.com/vi/${videoId}/hqdefault.jpg'" 
             alt="YouTube Video" />
        <div class="youtube-player-overlay">
          <div class="youtube-play-button">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
          <div class="youtube-pill">YouTube</div>
        </div>
      </a>
    </div>
  `;
}
function fixRedditContent(html) {
  if (!html) return html;
  return html.replace(/<\/?table[^>]*>/g, "").replace(/<\/?tr[^>]*>/g, "").replace(/<td[^>]*>/g, '<div style="margin-bottom: 1em;">').replace(/<\/td>/g, "</div>").replace(
    /src=["'](https?:\/\/preview\.redd\.it\/[^"'>?]+)\?[^"'>]*["']/gi,
    (match, previewUrl) => {
      if (!previewUrl.includes("/external/")) {
        return `src="${previewUrl.replace("preview.redd.it", "i.redd.it")}"`;
      }
      return `src="${previewUrl}"`;
    }
  );
}
function fixHackerNewsContent(html, item) {
  if (!html) return html;
  const commentsUrl = coerceText(item["comments"]);
  const articleUrlMatch = html.match(/Article URL:.*?href="([^"]+)"/i) || html.match(/href="(https?:\/\/[^"]+)"/i);
  const pointsMatch = html.match(/Points?:\s*(\d+)/i);
  const commentsCountMatch = html.match(/#\s*Comments?:\s*(\d+)/i);
  const articleUrl = articleUrlMatch?.[1] ?? null;
  const points = pointsMatch?.[1] ?? "0";
  const commentsCount = commentsCountMatch?.[1] ?? "0";
  let content = '<div class="hackernews-content">';
  if (articleUrl) {
    content += `<p><strong>Article:</strong> <a href="${articleUrl}" target="_blank" rel="noopener noreferrer">${articleUrl}</a></p>`;
  }
  content += `<div style="display: flex; gap: 16px; margin: 12px 0; font-size: 0.9em; color: var(--text-muted);">`;
  content += `<span><strong>⬆ ${points}</strong> points</span>`;
  content += `<span><strong>💬 ${commentsCount}</strong> comments</span>`;
  content += `</div>`;
  if (commentsUrl) {
    content += `<p><a href="${commentsUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; background: var(--brand-500); color: white; border-radius: var(--radius-md); text-decoration: none; font-weight: var(--weight-medium);">`;
    content += `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
    content += `View Comments on Hacker News</a></p>`;
  }
  content += "</div>";
  return content;
}
function emptyMeta() {
  return { title: null, site_url: null, description: null, language: null };
}
function getFaviconUrl(siteUrl, feedUrl) {
  try {
    const url2 = siteUrl || feedUrl;
    if (!url2) return null;
    const hostname = new URL(url2).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch {
    return null;
  }
}
const MAX_CONCURRENT = 5;
const INTERVAL = {
  MIN: 300,
  // 5 minutes (most active feeds)
  MAX: 86400,
  // 24 hours (very quiet or errored feeds)
  DEFAULT: 900,
  // 15 minutes
  BACKOFF_MAX: 86400
  // Max backoff on repeated errors
};
class SyncEngine {
  constructor(feedService, articleService) {
    this.feedService = feedService;
    this.articleService = articleService;
    this.limiter = pLimit(MAX_CONCURRENT);
  }
  // ── Public API ────────────────────────────────────────────────────────────
  /**
   * Syncs a list of feeds concurrently (up to MAX_CONCURRENT at a time).
   * Emits `sync:update` IPC events to all renderer windows as feeds complete.
   *
   * @param feeds - Feeds to sync (defaults to all feeds due for sync)
   */
  async syncMany(feeds) {
    const toSync = feeds ?? this.feedService.getDueForSync();
    if (toSync.length === 0) return [];
    const tasks = toSync.map((feed) => this.limiter(() => this.syncOne(feed, true)));
    const results = await Promise.all(tasks);
    persistDatabase();
    return results;
  }
  /**
   * Syncs a single feed by ID.  Useful for "refresh now" triggered from the UI.
   */
  async syncFeedById(feedId) {
    const feed = this.feedService.getById(feedId);
    if (!feed)
      return {
        feedId,
        articlesNew: 0,
        articlesUpdated: 0,
        status: "error",
        error: "Feed not found"
      };
    return this.syncOne(feed);
  }
  // ── Core sync logic ───────────────────────────────────────────────────────
  async syncOne(feed, skipPersist = false) {
    const logId = this.insertSyncLog(feed.id, skipPersist);
    this.emitStatus({ feedId: feed.id, status: "syncing" });
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 2e3;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`[SyncEngine] Retrying feed ${feed.id} (attempt ${attempt}/${MAX_ATTEMPTS})...`);
        }
        const useCache = attempt < MAX_ATTEMPTS;
        const response = await fetchFeed(
          feed.url,
          useCache ? feed.last_etag : null,
          useCache ? feed.last_modified : null
        );
        if (response.status === 304) {
          const nextFetch3 = this.adaptiveInterval(feed, 0, false);
          this.feedService.updateAfterSync(
            {
              id: feed.id,
              last_etag: response.etag ?? feed.last_etag,
              last_modified: response.lastModified ?? feed.last_modified,
              next_fetch_at: nextFetch3,
              error_count: 0
            },
            skipPersist
          );
          this.finishSyncLog(logId, 0, 0, "success", void 0, skipPersist);
          this.emitStatus({ feedId: feed.id, status: "not_modified" });
          return { feedId: feed.id, articlesNew: 0, articlesUpdated: 0, status: "not_modified" };
        }
        let parsed = parseFeed(response.body, response.contentType);
        const isContentMissing = parsed.articles.length === 0 || parsed.articles.every(
          (a) => !a.content_html && !a.content_text && (!a.excerpt || a.excerpt.length < 50)
        );
        if (isContentMissing) {
          let fallbackUrl = null;
          if (feed.url.endsWith(".rss")) fallbackUrl = feed.url.replace(/\.rss$/, ".atom");
          else if (feed.url.endsWith(".atom")) fallbackUrl = feed.url.replace(/\.atom$/, ".rss");
          else if (feed.url.endsWith("/rss")) fallbackUrl = feed.url.replace(/\/rss$/, "/atom");
          else if (feed.url.endsWith("/atom")) fallbackUrl = feed.url.replace(/\/atom$/, "/rss");
          if (fallbackUrl) {
            try {
              const fbRes = await fetchFeed(fallbackUrl);
              if (fbRes.status === 200) {
                const fbParsed = parseFeed(fbRes.body, fbRes.contentType);
                if (fbParsed.articles.length > 0) {
                  parsed = fbParsed;
                }
              }
            } catch (fallbackErr) {
            }
          }
        }
        if (parsed.articles.length === 0) {
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            continue;
          } else {
            throw new Error("Feed has 0 articles (even after forced reload)");
          }
        }
        const faviconUrl = getFaviconUrl(parsed.meta.site_url, feed.url);
        if (parsed.meta.title || parsed.meta.site_url || faviconUrl !== feed.favicon_url) {
          this.feedService.update(
            feed.id,
            {
              title: parsed.meta.title ?? void 0,
              site_url: parsed.meta.site_url ?? void 0,
              favicon_url: faviconUrl ?? void 0
            },
            skipPersist
          );
        }
        let articlesNew = 0;
        for (const article of parsed.articles) {
          if (!article.guid) continue;
          const { isNew } = this.articleService.upsert({
            feed_id: feed.id,
            guid: article.guid,
            url: article.url ?? void 0,
            title: article.title ?? void 0,
            author: article.author ?? void 0,
            content_html: article.content_html ?? void 0,
            content_text: article.content_text ?? void 0,
            excerpt: article.excerpt ?? void 0,
            enclosure_url: article.enclosure_url ?? void 0,
            enclosure_type: article.enclosure_type ?? void 0,
            word_count: article.word_count ?? void 0,
            published_at: article.published_at ?? void 0,
            thumbnail_url: article.thumbnail_url ?? void 0
          });
          if (isNew) articlesNew++;
        }
        if (!skipPersist) persistDatabase();
        const nextFetch2 = this.adaptiveInterval(feed, articlesNew, true);
        this.feedService.updateAfterSync(
          {
            id: feed.id,
            last_etag: response.etag,
            last_modified: response.lastModified,
            next_fetch_at: nextFetch2,
            error_count: 0
          },
          skipPersist
        );
        this.finishSyncLog(logId, articlesNew, 0, "success", void 0, skipPersist);
        this.emitStatus({ feedId: feed.id, status: "success", articlesNew });
        return { feedId: feed.id, articlesNew, articlesUpdated: 0, status: "success" };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
      }
    }
    const message = lastError?.message || "Sync failed";
    console.error(`[SyncEngine] Persistent error for feed ${feed.id}:`, message);
    const newErrorCount = (feed.error_count ?? 0) + 1;
    const backoff = Math.min(INTERVAL.DEFAULT * Math.pow(2, newErrorCount), INTERVAL.BACKOFF_MAX);
    const nextFetch = Math.floor(Date.now() / 1e3) + backoff;
    this.feedService.updateAfterSync(
      {
        id: feed.id,
        last_etag: feed.last_etag,
        last_modified: feed.last_modified,
        next_fetch_at: nextFetch,
        error_count: newErrorCount
      },
      skipPersist
    );
    if (newErrorCount >= 10) {
      this.feedService.update(feed.id, { is_active: false }, skipPersist);
    }
    this.finishSyncLog(logId, 0, 0, "error", message, skipPersist);
    this.emitStatus({ feedId: feed.id, status: "error", error: message });
    return {
      feedId: feed.id,
      articlesNew: 0,
      articlesUpdated: 0,
      status: "error",
      error: message
    };
  }
  // ── Adaptive interval ─────────────────────────────────────────────────────
  /**
   * Computes the next poll time using adaptive backoff / speedup logic.
   *
   *  - If many articles were found → poll sooner (multiply by 0.8, floor at MIN)
   *  - If no articles found → poll later (multiply by 1.2, cap at MAX)
   *  - If 304 → poll later (multiply by 1.5, cap at MAX)
   *
   * @param feed          - Current feed record
   * @param articlesFound - Number of new articles discovered
   * @param didFetch      - false if server returned 304 (didn't re-download body)
   */
  adaptiveInterval(feed, articlesFound, didFetch) {
    let interval = feed.fetch_interval_sec ?? INTERVAL.DEFAULT;
    if (!didFetch) {
      interval = Math.min(interval * 1.5, INTERVAL.MAX);
    } else if (articlesFound >= 10) {
      interval = Math.max(interval * 0.8, INTERVAL.MIN);
    } else if (articlesFound === 0) {
      interval = Math.min(interval * 1.2, INTERVAL.MAX);
    }
    return Math.floor(Date.now() / 1e3) + Math.round(interval);
  }
  // ── Sync log helpers ──────────────────────────────────────────────────────
  insertSyncLog(_feedId, skipPersist = false) {
    try {
      const db = this.feedService.db;
      db.run(`INSERT INTO sync_log (feed_id, status) VALUES (?, 'running')`, [_feedId]);
      const res = db.exec("SELECT last_insert_rowid()");
      if (!skipPersist) persistDatabase();
      return Number(res[0].values[0][0]);
    } catch {
      return 0;
    }
  }
  finishSyncLog(_logId, _articlesNew, _articlesUpdated, _status, _error, skipPersist = false) {
    if (_logId === 0) return;
    try {
      const db = this.feedService.db;
      db.run(
        `UPDATE sync_log SET finished_at = strftime('%s','now'), articles_new = ?, articles_updated = ?, status = ?, error_message = ? WHERE id = ?`,
        [_articlesNew, _articlesUpdated, _status, _error ?? null, _logId]
      );
      if (!skipPersist) persistDatabase();
    } catch {
    }
  }
  // ── IPC emission ──────────────────────────────────────────────────────────
  /**
   * Broadcasts a sync status update to all renderer windows via IPC.
   * The renderer subscribes to 'sync:update' to update its loading indicators.
   */
  emitStatus(payload) {
    const windows = electron.BrowserWindow?.getAllWindows?.() ?? [];
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send("sync:update", payload);
      }
    }
  }
}
const TICK_INTERVAL_MS = 6e4;
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1e3;
class Scheduler {
  constructor(db, syncEngine, feedService, articleService, settings) {
    this.db = db;
    this.syncEngine = syncEngine;
    this.feedService = feedService;
    this.articleService = articleService;
    this.settings = settings;
    this.tickTimer = null;
    this.maintenanceTimer = null;
    this.isRunning = false;
  }
  /**
   * Starts the scheduler.  Triggers an initial sync immediately on startup
   * so the user sees fresh content right away.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.warn("[Scheduler] Starting...");
    setTimeout(() => {
      if (this.isRunning) void this.tick();
    }, 5e3);
    setTimeout(() => {
      if (this.isRunning) void this.runMaintenance();
    }, 3e4);
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance();
    }, MAINTENANCE_INTERVAL_MS);
  }
  /**
   * Stops all timers.  Should be called on `app.on('before-quit')`.
   */
  stop() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.tickTimer = null;
    this.maintenanceTimer = null;
    this.isRunning = false;
    console.warn("[Scheduler] Stopped.");
  }
  /**
   * Manually triggers a sync for all feeds (called by the "Refresh All" button
   * in the toolbar via IPC).
   */
  async refreshAll() {
    await this.tick(true);
  }
  /**
   * Forces an immediate sync for a single feed (called by right-click →
   * "Refresh Feed" in the sidebar).
   */
  async refreshFeed(feedId) {
    await this.syncEngine.syncFeedById(feedId);
  }
  // ── Private ───────────────────────────────────────────────────────────────
  /**
   * One scheduler tick: queries feeds due for sync and dispatches them to the
   * SyncEngine.
   *
   * @param forceAll - If true, syncs ALL active feeds regardless of schedule
   */
  async tick(forceAll = false) {
    try {
      const feeds = forceAll ? this.feedService.getAll() : this.feedService.getDueForSync();
      if (feeds.length === 0) return;
      console.warn(`[Scheduler] tick: syncing ${feeds.length} feed(s)`);
      await this.syncEngine.syncMany(feeds);
    } catch (err) {
      console.error("[Scheduler] tick error:", err);
    }
  }
  /**
   * Daily maintenance:
   *  1. Delete expired articles (retention policy)
   *  2. Rebuild FTS5 index after mass deletions
   *  3. Recount unread_count for all feeds (drift correction)
   */
  async runMaintenance() {
    try {
      const retention = this.settings.retentionDays;
      const deleted = this.articleService.applyRetention(retention);
      if (deleted > 0) {
        console.warn(`[Scheduler] Maintenance: deleted ${deleted} expired articles`);
      }
      this.feedService.recountAllUnread();
      console.warn("[Scheduler] Maintenance: unread counts resynced");
    } catch (err) {
      console.error("[Scheduler] Maintenance error:", err);
    }
  }
}
function registerFeedHandlers(feedService, opmlService, scheduler2) {
  electron.ipcMain.handle("groups:list", () => feedService.getGroups());
  electron.ipcMain.handle("groups:create", (_event, name) => {
    if (!name?.trim()) throw new Error("Group name cannot be empty");
    return feedService.createGroup(name.trim());
  });
  electron.ipcMain.handle("groups:update", (_event, id, patch) => {
    feedService.updateGroup(id, patch);
  });
  electron.ipcMain.handle("groups:delete", (_event, id) => {
    feedService.deleteGroup(id);
  });
  electron.ipcMain.handle("feeds:list", () => feedService.getAll());
  electron.ipcMain.handle("feeds:add", async (_event, url2, groupId) => {
    const trimmedUrl = url2?.trim();
    if (!trimmedUrl) throw new Error("Feed URL cannot be empty");
    try {
      new URL(trimmedUrl);
    } catch {
      throw new Error(`Invalid URL: ${trimmedUrl}`);
    }
    const id = feedService.create({ url: trimmedUrl, group_id: groupId });
    void scheduler2.refreshFeed(id);
    return id;
  });
  electron.ipcMain.handle("feeds:update", (_event, id, patch) => {
    feedService.update(id, patch);
  });
  electron.ipcMain.handle("feeds:delete", (_event, id) => {
    feedService.delete(id);
  });
  electron.ipcMain.handle("opml:import", async (event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender) ?? null;
    const result = await electron.dialog.showOpenDialog(win, {
      title: "Import OPML Subscriptions",
      filters: [{ name: "OPML Files", extensions: ["opml", "xml"] }],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) return 0;
    const xml = fs.readFileSync(result.filePaths[0], "utf-8");
    const count = opmlService.import(xml);
    void scheduler2.refreshAll();
    return count;
  });
  electron.ipcMain.handle("opml:export", async (event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender) ?? null;
    const result = await electron.dialog.showSaveDialog(win, {
      title: "Export OPML Subscriptions",
      defaultPath: `albatros-export-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.opml`,
      filters: [{ name: "OPML Files", extensions: ["opml"] }]
    });
    if (result.canceled || !result.filePath) return false;
    const xml = opmlService.export();
    fs.writeFileSync(result.filePath, xml, "utf-8");
    return true;
  });
}
function registerArticleHandlers(articleService, searchService, feedService) {
  electron.ipcMain.handle("articles:list", (_event, params) => {
    return articleService.list(params);
  });
  electron.ipcMain.handle("articles:get", (_event, id) => {
    return articleService.getById(id);
  });
  electron.ipcMain.handle("articles:total-unread", () => {
    return articleService.totalUnreadCount();
  });
  electron.ipcMain.handle("articles:mark", (_event, id, action, value) => {
    switch (action) {
      case "read":
        articleService.setRead(id, value);
        break;
      case "saved":
        articleService.setSaved(id, value);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  });
  electron.ipcMain.handle("articles:mark-all-read", (_event, feedId) => {
    const affected = articleService.markAllRead(feedId);
    if (feedId !== void 0) {
      feedService.recountUnread(feedId);
    } else {
      feedService.getAll().forEach((f) => feedService.recountUnread(f.id));
    }
    return affected;
  });
  electron.ipcMain.handle("search:query", (_event, query, limit) => {
    return searchService.search(query, limit);
  });
  electron.ipcMain.handle("articles:get-github-links", () => {
    return articleService.getGithubLinks();
  });
  electron.ipcMain.handle("articles:get-reddit-comments", async (_event, url2) => {
    try {
      if (!url2.includes("reddit.com")) return [];
      const jsonUrl = url2.replace(/\/$/, "") + ".json";
      const res = await fetch(jsonUrl, {
        headers: { "User-Agent": "Albatros/1.0.0 (Node.js)" }
      });
      if (!res.ok) return [];
      const json = await res.json();
      const commentsData = json[1]?.data?.children || [];
      const parseComment = (child) => {
        if (child.kind === "t1" && child.data && child.data.body) {
          let html = child.data.body_html || "";
          html = html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
          const replies = [];
          if (child.data.replies && child.data.replies.data && child.data.replies.data.children) {
            for (const replyNode of child.data.replies.data.children) {
              const reply = parseComment(replyNode);
              if (reply) replies.push(reply);
            }
          }
          return {
            id: child.data.id,
            author: child.data.author,
            content_html: html || child.data.body,
            published_at: child.data.created_utc,
            score: child.data.score || 0,
            is_submitter: child.data.is_submitter || false,
            replies
          };
        }
        return null;
      };
      const comments = commentsData.map(parseComment).filter(Boolean);
      let selftextHtml = null;
      const postData = json[0]?.data?.children?.[0]?.data;
      if (postData && postData.selftext_html) {
        selftextHtml = postData.selftext_html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      }
      return { comments, selftextHtml };
    } catch (err) {
      console.warn("[IPC] Failed to fetch reddit comments:", err);
      return { comments: [], selftextHtml: null };
    }
  });
}
function registerSettingsHandlers(settings) {
  electron.ipcMain.handle("settings:get-all", () => settings.getAll());
  electron.ipcMain.handle("settings:get", (_event, key) => settings.get(key));
  electron.ipcMain.handle("settings:set", (_event, key, value) => {
    settings.set(key, value);
  });
}
function registerSyncHandlers(scheduler2) {
  electron.ipcMain.handle("sync:refresh-all", async () => {
    await scheduler2.refreshAll();
  });
  electron.ipcMain.handle("sync:refresh-feed", async (_event, feedId) => {
    await scheduler2.refreshFeed(feedId);
  });
}
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0f1117",
    // Dark background to avoid white flash
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      // Required for security
      nodeIntegration: false,
      // Never allow node in renderer
      sandbox: false,
      // Needed for sql.js WASM in preload
      webviewTag: true
      // Enable <webview> for embedded browser
    }
  });
  win.webContents.setWindowOpenHandler(({ url: url2 }) => {
    void electron.shell.openExternal(url2);
    return { action: "deny" };
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
let scheduler = null;
async function bootstrap() {
  try {
    const enginePath = path.join(electron.app.getPath("userData"), "adblocker-engine.bin");
    const blocker = await adblockerElectron.ElectronBlocker.fromPrebuiltAdsAndTracking(fetch$1, {
      path: enginePath,
      read: fs.promises.readFile,
      write: fs.promises.writeFile
    });
    blocker.enableBlockingInSession(electron.session.defaultSession);
    console.log("[Adblock] Engine loaded and active");
  } catch (err) {
    console.error("[Adblock] Failed to initialise:", err);
  }
  const db = await getDatabase();
  runMigrations(db);
  const feedService = new FeedService(db);
  feedService.resetErrorCounts();
  const articleService = new ArticleService(db);
  const searchService = new SearchService(db);
  const settingsService = new SettingsService(db);
  const opmlService = new OpmlService(feedService);
  const syncEngine = new SyncEngine(feedService, articleService);
  scheduler = new Scheduler(db, syncEngine, feedService, articleService, settingsService);
  registerFeedHandlers(feedService, opmlService, scheduler);
  registerArticleHandlers(articleService, searchService, feedService);
  registerSettingsHandlers(settingsService);
  registerSyncHandlers(scheduler);
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  scheduler.start();
}
void electron.app.whenReady().then(bootstrap);
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", () => {
  scheduler?.stop();
  closeDatabase();
});
