/**
 * @file migrations/runner.ts
 * @description Database migration runner.
 *
 * On startup the runner reads the `schema_migrations` table to find the
 * highest applied version, then applies any pending SQL scripts in order.
 * All scripts are embedded as TypeScript string constants so they are bundled
 * into the Electron app without extra file-system reads at runtime.
 *
 * To add a new migration:
 *   1. Add a new entry to the MIGRATIONS array below.
 *   2. Bump the version number.
 *   3. The runner will automatically apply it on next launch.
 */

import type { Database } from 'better-sqlite3'

// ─── Migration scripts ───────────────────────────────────────────────────────

/** Each migration is a version number, a human-readable name, and the SQL. */
interface Migration {
  version: number
  name: string
  sql: string
}

// Migrations are defined inline so they are part of the compiled bundle.
// SQL is imported as raw strings via the Vite ?raw suffix.
// Since we are in the main process (Node), we use fs.readFileSync instead.
import schemaSql from '../schema.sql?raw'
import triggersSql from '../triggers.sql?raw'

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    // schema.sql + triggers.sql are concatenated as a single migration
    get sql() {
      return schemaSql + '\n' + triggersSql
    },
  },
  {
    version: 2,
    name: 'add_group_icon',
    sql: `ALTER TABLE feed_groups ADD COLUMN icon TEXT DEFAULT NULL;`,
  },
  {
    version: 3,
    name: 'add_article_thumbnail',
    sql: `ALTER TABLE articles ADD COLUMN thumbnail_url TEXT DEFAULT NULL;`,
  },
  {
    version: 4,
    name: 'fix_feeds_updated_at_trigger',
    sql: `
      DROP TRIGGER IF EXISTS feeds_updated_at;
      CREATE TRIGGER IF NOT EXISTS feeds_updated_at
      AFTER UPDATE ON feeds
      WHEN old.updated_at = new.updated_at
      BEGIN
        UPDATE feeds SET updated_at = strftime('%s','now') WHERE id = new.id;
      END;
    `,
  },
  {
    version: 5,
    name: 'add_article_summary',
    sql: `ALTER TABLE articles ADD COLUMN summary TEXT DEFAULT NULL;`,
  },
  {
    version: 6,
    name: 'add_article_query_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_articles_pub_global_id ON articles (published_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_articles_unread_pub ON articles (is_read, published_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_articles_summary_pub ON articles (summary, published_at DESC, id DESC);
    `,
  },
  {
    version: 7,
    name: 'add_laya_folders',
    sql: `
      CREATE TABLE IF NOT EXISTS laya_folders (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      ALTER TABLE articles ADD COLUMN laya_folder_id INTEGER DEFAULT NULL;
      CREATE INDEX IF NOT EXISTS idx_articles_laya_folder ON articles (laya_folder_id, published_at DESC, id DESC);
    `,
  },
  {
    version: 8,
    name: 'add_laya_scope_controls',
    sql: `
      ALTER TABLE laya_folders ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE IF NOT EXISTS laya_feed_scopes (
        feed_id INTEGER PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1
      );
    `,
  },
  {
    version: 9,
    name: 'make_laya_feed_scopes_per_folder',
    sql: `
      CREATE TABLE IF NOT EXISTS laya_folder_feed_scopes (
        folder_id INTEGER NOT NULL REFERENCES laya_folders(id) ON DELETE CASCADE,
        feed_id   INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
        enabled   INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (folder_id, feed_id)
      );
      CREATE INDEX IF NOT EXISTS idx_laya_folder_feed_scopes_feed
        ON laya_folder_feed_scopes (feed_id, enabled);
      -- Preserve the user's existing global selection for every current folder.
      INSERT OR IGNORE INTO laya_folder_feed_scopes (folder_id, feed_id, enabled)
      SELECT folders.id, feeds.id, COALESCE(scopes.enabled, 1)
      FROM laya_folders AS folders
      CROSS JOIN feeds
      LEFT JOIN laya_feed_scopes AS scopes ON scopes.feed_id = feeds.id;
    `,
  },
  {
    version: 10,
    name: 'make_laya_scopes_feed_groups',
    sql: `
      CREATE TABLE IF NOT EXISTS laya_folder_group_scopes (
        folder_id INTEGER NOT NULL REFERENCES laya_folders(id) ON DELETE CASCADE,
        group_id  INTEGER NOT NULL REFERENCES feed_groups(id) ON DELETE CASCADE,
        enabled   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (folder_id, group_id)
      );
      CREATE INDEX IF NOT EXISTS idx_laya_folder_group_scopes_group
        ON laya_folder_group_scopes (group_id, enabled);
      -- A group remains selected when at least one of its feeds was selected
      -- in the previous per-feed configuration.
      INSERT OR IGNORE INTO laya_folder_group_scopes (folder_id, group_id, enabled)
      SELECT folders.id, groups.id,
             CASE WHEN MAX(COALESCE(scopes.enabled, 0)) = 1 THEN 1 ELSE 0 END
      FROM laya_folders AS folders
      CROSS JOIN feed_groups AS groups
      JOIN feeds ON feeds.group_id = groups.id
      LEFT JOIN laya_folder_feed_scopes AS scopes
        ON scopes.folder_id = folders.id AND scopes.feed_id = feeds.id
      GROUP BY folders.id, groups.id;
    `,
  },
  {
    version: 11,
    name: 'add_laya_article_memberships',
    sql: `
      -- An article may belong to several Laya folders. Keep the legacy
      -- articles.laya_folder_id column during the transition, but do not use
      -- it for new reads or classifications.
      CREATE TABLE IF NOT EXISTS article_laya_memberships (
        article_id    INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        folder_id     INTEGER NOT NULL REFERENCES laya_folders(id) ON DELETE CASCADE,
        score         REAL,
        decision      TEXT NOT NULL CHECK (decision IN ('include', 'exclude', 'uncertain')),
        model_version TEXT,
        classified_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        run_id        TEXT,
        evidence      TEXT,
        PRIMARY KEY (article_id, folder_id)
      );
      CREATE INDEX IF NOT EXISTS idx_laya_memberships_folder_decision_article
        ON article_laya_memberships (folder_id, decision, article_id);
      CREATE INDEX IF NOT EXISTS idx_laya_memberships_article
        ON article_laya_memberships (article_id);

      -- Preserve existing positive decisions. The old -1 sentinel meant only
      -- "not assigned to any single winner" and contains no per-folder answer,
      -- so it is intentionally re-evaluated instead of being guessed here.
      INSERT OR IGNORE INTO article_laya_memberships
        (article_id, folder_id, score, decision, model_version, evidence)
      SELECT articles.id, articles.laya_folder_id, NULL, 'include', 'legacy-single-folder',
             'Migrated from the legacy single-folder assignment.'
      FROM articles
      JOIN laya_folders ON laya_folders.id = articles.laya_folder_id
      WHERE articles.laya_folder_id > 0;
    `,
  },
]

// ─── Runner ──────────────────────────────────────────────────────────────────

/**
 * Applies all pending migrations to `db` in version order.
 * This function is idempotent — already-applied versions are skipped.
 *
 * @param db - An open better-sqlite3 Database instance
 */
export function runMigrations(db: Database): void {
  // Find the highest applied version (0 if table doesn't exist yet)
  let currentVersion = 0
  try {
    const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number } | undefined
    if (row && typeof row.v === 'number') {
      currentVersion = row.v
    }
  } catch {
    // Table doesn't exist yet — we're on a fresh database
    currentVersion = 0
  }

  // Apply pending migrations in ascending version order
  const pending = MIGRATIONS.filter(m => m.version > currentVersion)
  if (pending.length === 0) return

  for (const migration of pending) {
    console.warn(`[DB] Applying migration ${migration.version}: ${migration.name}`)
    try {
      db.exec(migration.sql)
    } catch (err) {
      const error = err as Error
      if (error.message && error.message.includes('duplicate column name')) {
        console.warn(`[DB] Migration ${migration.version} skipped: column already exists.`)
      } else {
        throw err
      }
    }

    // Record that this migration was applied (if schema_migrations table exists)
    try {
      db.prepare(
        `INSERT OR IGNORE INTO schema_migrations (version, name)
         VALUES (?, ?)`
      ).run(migration.version, migration.name)
    } catch {
      // May fail if schema_migrations was created in *this* migration —
      // that's fine, migration v1 inserts the row itself.
    }
  }

  console.warn(`[DB] Migrations applied up to version ${MIGRATIONS[MIGRATIONS.length - 1].version}`)
}
