/**
 * @file connection.ts
 * @description SQLite database connection singleton powered by better-sqlite3.
 *
 * It uses WAL (Write-Ahead Logging) for high performance and concurrency.
 * Reads and writes are immediate and automatic.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import type { Database as BetterSqlite3Database } from 'better-sqlite3'

// ─── Constants ───────────────────────────────────────────────────────────────

/** Absolute path to the SQLite database file. */
const getDbPath = () => path.join(app.getPath('userData'), 'albatros.db')

// ─── Module-level singleton ───────────────────────────────────────────────────

let _db: BetterSqlite3Database | null = null

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the initialised database, creating it if it doesn't yet exist.
 * Kept strictly async to maintain compatibility with legacy sql.js signature.
 */
export async function getDatabase(): Promise<BetterSqlite3Database> {
  if (_db) return _db

  // Ensure the data directory exists
  const dataDir = app.getPath('userData')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = getDbPath()
  _db = new Database(dbPath)

  applyPragmas(_db)
  return _db
}

/**
 * No-op for better-sqlite3 since writes are synchronous and automatic.
 */
export function persistDatabase(): void {
  // Legacy stub — do nothing. 
}

/**
 * No-op for better-sqlite3 since writes are synchronous and automatic.
 */
export function persistDatabaseNow(): void {
  // Legacy stub — do nothing.
}

/**
 * Closes the database and clears the singleton reference.
 * Should be called on `app.on('before-quit')`.
 */
export function closeDatabase(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/** Applies performance and safety PRAGMAs right after opening. */
function applyPragmas(db: BetterSqlite3Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('cache_size = -32000') // ~32 MB page cache
  db.pragma('temp_store = MEMORY')
}
