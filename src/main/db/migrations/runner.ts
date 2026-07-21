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
