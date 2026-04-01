/**
 * @file connection.ts
 * @description SQLite database connection singleton powered by sql.js (WASM).
 *
 * sql.js runs SQLite entirely as a WebAssembly binary inside Node.js — no
 * native compilation required. The database is persisted as a regular .db
 * file on disk; sql.js loads it into memory, and we flush it back to disk
 * after each write operation via `persistDatabase()`.
 *
 * PRAGMAS applied on open:
 *  - journal_mode = MEMORY   (WAL not supported in sql.js, MEMORY is fastest)
 *  - synchronous  = OFF      (writes are safe because we flush manually)
 *  - foreign_keys = ON
 *  - cache_size   = -32000   (~32 MB page cache)
 *  - temp_store   = MEMORY
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import initSqlJs, { type Database } from 'sql.js'

// ─── Constants ───────────────────────────────────────────────────────────────

/** Absolute path to the SQLite database file. */
const getDbPath = () => path.join(app.getPath('userData'), 'albatros.db')

// ─── Module-level singleton ───────────────────────────────────────────────────

let _db: Database | null = null

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the initialised sql.js database, creating it if it doesn't yet exist.
 * Safe to call multiple times — only one Database instance is ever created.
 */
export async function getDatabase(): Promise<Database> {
  if (_db) return _db

  // Ensure the data directory exists
  const dataDir = app.getPath('userData')
  fs.mkdirSync(dataDir, { recursive: true })

  // Initialise sql.js with the bundled WASM binary
  const SqlJs = await initSqlJs()

  // Load existing file or start with an empty database
  const dbPath = getDbPath()
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    _db = new SqlJs.Database(fileBuffer)
  } else {
    _db = new SqlJs.Database()
  }

  applyPragmas(_db)
  return _db
}

/**
 * Writes the current in-memory database state to disk.
 * Must be called after any write operation (INSERT / UPDATE / DELETE).
 */
export function persistDatabase(): void {
  if (!_db) return
  const data = _db.export()
  fs.writeFileSync(getDbPath(), Buffer.from(data))
}

/**
 * Closes the database and clears the singleton reference.
 * Should be called on `app.on('before-quit')`.
 */
export function closeDatabase(): void {
  if (_db) {
    persistDatabase()
    _db.close()
    _db = null
  }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/** Applies performance and safety PRAGMAs right after opening. */
function applyPragmas(db: Database): void {
  db.run(`
    PRAGMA journal_mode = MEMORY;
    PRAGMA synchronous  = OFF;
    PRAGMA foreign_keys = ON;
    PRAGMA cache_size   = -32000;
    PRAGMA temp_store   = MEMORY;
  `)
}
