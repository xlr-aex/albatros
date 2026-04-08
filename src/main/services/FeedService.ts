/**
 * @file services/FeedService.ts
 * @description All database operations related to feeds and feed groups.
 *
 * Every public method is synchronous with respect to SQLite (sql.js runs
 * synchronously).  After any write the caller is responsible for calling
 * `persistDatabase()` — or the service will do it automatically when the
 * `autoFlush` option is true (default).
 */

import type { Database, SqlValue } from 'sql.js'
import { persistDatabase } from '../db/connection'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeedGroup {
  id: number
  name: string
  icon: string | null
  sort_order: number
  is_expanded: boolean
  created_at: number
}

export interface Feed {
  id: number
  group_id: number | null
  url: string
  title: string | null
  site_url: string | null
  description: string | null
  favicon_url: string | null
  language: string | null
  unread_count: number
  error_count: number
  last_etag: string | null
  last_modified: string | null
  last_fetched_at: number | null
  next_fetch_at: number | null
  fetch_interval_sec: number
  is_active: boolean
  created_at: number
  updated_at: number
}

export interface CreateFeedInput {
  url: string
  title?: string
  site_url?: string
  description?: string
  favicon_url?: string
  language?: string
  group_id?: number
  fetch_interval_sec?: number
}

export interface UpdateFeedInput {
  title?: string
  site_url?: string
  group_id?: number | null
  fetch_interval_sec?: number
  favicon_url?: string
  is_active?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Converts a sql.js exec() result row array into a typed object. */
function rowToFeed(columns: string[], row: SqlValue[]): Feed {
  const o: Record<string, unknown> = {}
  columns.forEach((col, i) => { o[col] = row[i] })
  return {
    ...(o as unknown as Feed),
    is_active: o['is_active'] === 1,
    unread_count: Number(o['unread_count'] ?? 0),
  }
}

function rowToGroup(columns: string[], row: SqlValue[]): FeedGroup {
  const o: Record<string, unknown> = {}
  columns.forEach((col, i) => { o[col] = row[i] })
  return {
    ...(o as unknown as FeedGroup),
    is_expanded: o['is_expanded'] === 1,
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class FeedService {
  constructor(private readonly db: Database) {}

  // ── Groups ────────────────────────────────────────────────────────────────

  /** Returns all feed groups ordered by sort_order. */
  getGroups(): FeedGroup[] {
    const result = this.db.exec('SELECT * FROM feed_groups ORDER BY sort_order, name')
    if (!result.length) return []
    const { columns, values } = result[0]
    return values.map(row => rowToGroup(columns, row))
  }

  /** Creates a new feed group. Returns its newly assigned id. */
  createGroup(name: string, skipPersist = false): number {
    this.db.run('INSERT INTO feed_groups (name) VALUES (?)', [name])
    const res = this.db.exec('SELECT last_insert_rowid() AS id')
    const id = Number(res[0].values[0][0])
    if (!skipPersist) persistDatabase()
    return id
  }

  /** Renames a group or changes its sort_order. */
  updateGroup(id: number, patch: { name?: string; icon?: string | null; sort_order?: number; is_expanded?: boolean }): void {
    const sets: string[] = []
    const params: (string | number | null)[] = []

    if (patch.name        !== undefined) { sets.push('name = ?');        params.push(patch.name) }
    if (patch.icon        !== undefined) { sets.push('icon = ?');        params.push(patch.icon) }
    if (patch.sort_order  !== undefined) { sets.push('sort_order = ?');  params.push(patch.sort_order) }
    if (patch.is_expanded !== undefined) { sets.push('is_expanded = ?'); params.push(patch.is_expanded ? 1 : 0) }

    if (sets.length === 0) return
    params.push(id)
    this.db.run(`UPDATE feed_groups SET ${sets.join(', ')} WHERE id = ?`, params)
    persistDatabase()
  }

  /** Deletes a group (feeds inside are moved to NULL / ungrouped). */
  deleteGroup(id: number): void {
    this.db.run('DELETE FROM feed_groups WHERE id = ?', [id])
    persistDatabase()
  }

  // ── Feeds ─────────────────────────────────────────────────────────────────

  /** Returns all active feeds including their unread_count. */
  getAll(): Feed[] {
    const result = this.db.exec(`
      SELECT * FROM feeds
      WHERE is_active = 1
      ORDER BY group_id NULLS LAST, title COLLATE NOCASE
    `)
    if (!result.length) return []
    const { columns, values } = result[0]
    return values.map(row => rowToFeed(columns, row))
  }

  /** Returns a single feed by ID, or null if not found. */
  getById(id: number): Feed | null {
    const result = this.db.exec('SELECT * FROM feeds WHERE id = ?', [id])
    if (!result.length || !result[0].values.length) return null
    return rowToFeed(result[0].columns, result[0].values[0])
  }

  /** Returns a single feed by URL, or null if not found. */
  getByUrl(url: string): Feed | null {
    const result = this.db.exec('SELECT * FROM feeds WHERE url = ?', [url])
    if (!result.length || !result[0].values.length) return null
    return rowToFeed(result[0].columns, result[0].values[0])
  }

  /**
   * Inserts a new feed.  If a feed with the same URL already exists, returns
   * its existing ID without modifying the record (idempotent).
   */
  create(input: CreateFeedInput, skipPersist = false): number {
    // Check for existing feed
    const existing = this.getByUrl(input.url)
    if (existing) return existing.id

    const now = Math.floor(Date.now() / 1000)
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
        now, // schedule first sync immediately
        now,
        now,
      ],
    )
    const res = this.db.exec('SELECT last_insert_rowid() AS id')
    const id = Number(res[0].values[0][0])
    if (!skipPersist) persistDatabase()
    return id
  }

  /** Applies a partial update to a feed. */
  update(id: number, patch: UpdateFeedInput, skipPersist = false): void {
    const sets: string[] = []
    const params: (string | number | null)[] = []

    if (patch.title             !== undefined) { sets.push('title = ?');              params.push(patch.title) }
    if (patch.site_url          !== undefined) { sets.push('site_url = ?');           params.push(patch.site_url) }
    if (patch.group_id          !== undefined) { sets.push('group_id = ?');           params.push(patch.group_id) }
    if (patch.fetch_interval_sec !== undefined) { sets.push('fetch_interval_sec = ?'); params.push(patch.fetch_interval_sec) }
    if (patch.favicon_url       !== undefined) { sets.push('favicon_url = ?');        params.push(patch.favicon_url) }
    if (patch.is_active         !== undefined) { sets.push('is_active = ?');          params.push(patch.is_active ? 1 : 0) }

    if (sets.length === 0) return
    params.push(id)
    this.db.run(`UPDATE feeds SET ${sets.join(', ')} WHERE id = ?`, params)
    if (!skipPersist) persistDatabase()
  }

  /**
   * Updates sync-related columns after a successful fetch attempt.
   * Called by the SyncEngine after processing a feed.
   */
  updateAfterSync(params: {
    id: number
    last_etag: string | null
    last_modified: string | null
    next_fetch_at: number
    error_count: number
  }, skipPersist = false): void {
    this.db.run(
      `UPDATE feeds
       SET last_fetched_at = ?, next_fetch_at = ?, last_etag = ?,
           last_modified = ?, error_count = ?
       WHERE id = ?`,
      [
        Math.floor(Date.now() / 1000),
        params.next_fetch_at,
        params.last_etag,
        params.last_modified,
        params.error_count,
        params.id,
      ],
    )
    if (!skipPersist) persistDatabase()
  }

  /** Permanently deletes a feed and all its articles (CASCADE). */
  delete(id: number): void {
    this.db.run('DELETE FROM feeds WHERE id = ?', [id])
    persistDatabase()
  }

  /** Returns feeds whose next_fetch_at is in the past (ready for sync). */
  getDueForSync(): Feed[] {
    const now = Math.floor(Date.now() / 1000)
    const result = this.db.exec(
      'SELECT * FROM feeds WHERE is_active = 1 AND (next_fetch_at IS NULL OR next_fetch_at <= ?)',
      [now],
    )
    if (!result.length) return []
    const { columns, values } = result[0]
    return values.map(row => rowToFeed(columns, row))
  }

  /**
   * Recounts unread articles for a given feed and stores the result.
   */
  recountUnread(feedId: number, skipPersist = false): void {
    this.db.run(
      `UPDATE feeds
       SET unread_count = (
         SELECT COUNT(*) FROM articles WHERE feed_id = ? AND is_read = 0
       )
       WHERE id = ?`,
      [feedId, feedId],
    )
    if (!skipPersist) persistDatabase()
  }

  /**
   * Efficiently recounts unread articles for ALL feeds in a single pass.
   * This is much faster than looping through every feed individually.
   */
  recountAllUnread(): void {
    this.db.run(`
      UPDATE feeds
      SET unread_count = (
        SELECT COUNT(*)
        FROM articles
        WHERE articles.feed_id = feeds.id AND articles.is_read = 0
      )
    `)
    persistDatabase()
  }

  /**
   * Resets error_count to 0 for all feeds.
   * Typically called at boot to avoid showing stale errors before a fresh sync attempt.
   */
  resetErrorCounts(): void {
    this.db.run('UPDATE feeds SET error_count = 0')
    persistDatabase()
  }
}
