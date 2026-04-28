/**
 * @file services/FeedService.ts
 * @description All database operations related to feeds and feed groups.
 *
 * It uses better-sqlite3 for synchronous and high performance operations.
 */

import type { Database } from 'better-sqlite3'

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

// ─── Service ─────────────────────────────────────────────────────────────────

export class FeedService {
  constructor(private readonly db: Database) {}

  // ── Groups ────────────────────────────────────────────────────────────────

  /** Returns all feed groups ordered by sort_order. */
  getGroups(): FeedGroup[] {
    const stmt = this.db.prepare('SELECT * FROM feed_groups ORDER BY sort_order, name')
    const rows = stmt.all() as Record<string, unknown>[]
    return rows.map(row => ({
      ...row,
      is_expanded: row.is_expanded === 1
    })) as FeedGroup[]
  }

  /** Creates a new feed group. Returns its newly assigned id. */
  createGroup(name: string, _skipPersist = false): number {
    const stmt = this.db.prepare('INSERT INTO feed_groups (name) VALUES (?)')
    const info = stmt.run(name)
    return Number(info.lastInsertRowid)
  }

  /** Renames a group or changes its sort_order. */
  updateGroup(id: number, patch: { name?: string; icon?: string | null; sort_order?: number; is_expanded?: boolean }): void {
    const sets: string[] = []
    const params: unknown[] = []

    if (patch.name        !== undefined) { sets.push('name = ?');        params.push(patch.name) }
    if (patch.icon        !== undefined) { sets.push('icon = ?');        params.push(patch.icon) }
    if (patch.sort_order  !== undefined) { sets.push('sort_order = ?');  params.push(patch.sort_order) }
    if (patch.is_expanded !== undefined) { sets.push('is_expanded = ?'); params.push(patch.is_expanded ? 1 : 0) }

    if (sets.length === 0) return
    params.push(id)
    this.db.prepare(`UPDATE feed_groups SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  /** Deletes a group (feeds inside are moved to NULL / ungrouped). */
  deleteGroup(id: number): void {
    this.db.prepare('DELETE FROM feed_groups WHERE id = ?').run(id)
  }

  // ── Feeds ─────────────────────────────────────────────────────────────────

  /** Returns all active feeds including their unread_count. */
  getAll(): Feed[] {
    const stmt = this.db.prepare(`
      SELECT * FROM feeds
      WHERE is_active = 1
      ORDER BY group_id NULLS LAST, title COLLATE NOCASE
    `)
    const rows = stmt.all() as Record<string, unknown>[]
    return rows.map(row => ({
      ...row,
      unread_count: Number(row.unread_count ?? 0),
      is_active: row.is_active === 1
    })) as Feed[]
  }

  /** Returns a single feed by ID, or null if not found. */
  getById(id: number): Feed | null {
    const stmt = this.db.prepare('SELECT * FROM feeds WHERE id = ?')
    const row = stmt.get(id) as Record<string, unknown>
    if (!row) return null
    return {
      ...row,
      unread_count: Number(row.unread_count ?? 0),
      is_active: row.is_active === 1
    } as Feed
  }

  /** Returns a single feed by URL, or null if not found. */
  getByUrl(url: string): Feed | null {
    const normalized = normalizeUrl(url)
    const stmt = this.db.prepare('SELECT * FROM feeds WHERE url = ? OR url = ?')
    const row = stmt.get(url, normalized) as Record<string, unknown>
    if (!row) return null
    return {
      ...row,
      unread_count: Number(row.unread_count ?? 0),
      is_active: row.is_active === 1
    } as Feed
  }

  create(input: CreateFeedInput, _skipPersist = false): number {
    // Check for existing feed (handles both raw and normalized versions)
    const normalized = normalizeUrl(input.url)
    const existing = this.getByUrl(normalized)
    if (existing) return existing.id

    const now = Math.floor(Date.now() / 1000)
    const stmt = this.db.prepare(`
       INSERT INTO feeds
         (url, title, site_url, description, favicon_url, language, group_id,
          fetch_interval_sec, next_fetch_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const info = stmt.run(
        normalized, // Always store normalized version for consistency
        input.title ?? null,
        input.site_url ?? null,
        input.description ?? null,
        input.favicon_url ?? null,
        input.language ?? null,
        input.group_id ?? null,
        input.fetch_interval_sec ?? 900,
        now, // schedule first sync immediately
        now,
        now
    )
    return Number(info.lastInsertRowid)
  }

  /** Applies a partial update to a feed. */
  update(id: number, patch: UpdateFeedInput, _skipPersist = false): void {
    const sets: string[] = []
    const params: unknown[] = []

    if (patch.title             !== undefined) { sets.push('title = ?');              params.push(patch.title) }
    if (patch.site_url          !== undefined) { sets.push('site_url = ?');           params.push(patch.site_url) }
    if (patch.group_id          !== undefined) { sets.push('group_id = ?');           params.push(patch.group_id) }
    if (patch.fetch_interval_sec !== undefined) { sets.push('fetch_interval_sec = ?'); params.push(patch.fetch_interval_sec) }
    if (patch.favicon_url       !== undefined) { sets.push('favicon_url = ?');        params.push(patch.favicon_url) }
    if (patch.is_active         !== undefined) { sets.push('is_active = ?');          params.push(patch.is_active ? 1 : 0) }

    if (sets.length === 0) return
    params.push(id)
    this.db.prepare(`UPDATE feeds SET ${sets.join(', ')} WHERE id = ?`).run(...params)
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
  }, _skipPersist = false): void {
    this.db.prepare(`
       UPDATE feeds
       SET last_fetched_at = ?, next_fetch_at = ?, last_etag = ?,
           last_modified = ?, error_count = ?
       WHERE id = ?
    `).run(
        Math.floor(Date.now() / 1000),
        params.next_fetch_at,
        params.last_etag,
        params.last_modified,
        params.error_count,
        params.id
    )
  }

  /** Permanently deletes a feed and all its articles (CASCADE). */
  delete(id: number): void {
    this.db.prepare('DELETE FROM feeds WHERE id = ?').run(id)
  }

  /** Returns feeds whose next_fetch_at is in the past (ready for sync). */
  getDueForSync(): Feed[] {
    const now = Math.floor(Date.now() / 1000)
    const stmt = this.db.prepare('SELECT * FROM feeds WHERE is_active = 1 AND (next_fetch_at IS NULL OR next_fetch_at <= ?)')
    const rows = stmt.all(now) as Record<string, unknown>[]
    return rows.map(row => ({
      ...row,
      unread_count: Number(row.unread_count ?? 0),
      is_active: row.is_active === 1
    })) as Feed[]
  }

  /**
   * Recounts unread articles for a given feed and stores the result.
   */
  recountUnread(feedId: number, _skipPersist = false): void {
    this.db.prepare(`
       UPDATE feeds
       SET unread_count = (
         SELECT COUNT(*) FROM articles WHERE feed_id = ? AND is_read = 0
       )
       WHERE id = ?
    `).run(feedId, feedId)
  }

  /**
   * Efficiently recounts unread articles for ALL feeds in a single pass.
   * This is much faster than looping through every feed individually.
   */
  recountAllUnread(): void {
    this.db.prepare(`
      UPDATE feeds
      SET unread_count = (
        SELECT COUNT(*)
        FROM articles
        WHERE articles.feed_id = feeds.id AND articles.is_read = 0
      )
    `).run()
  }

  /**
   * Resets error_count to 0 for all feeds.
   * Typically called at boot to avoid showing stale errors before a fresh sync attempt.
   */
  resetErrorCounts(): void {
    this.db.prepare('UPDATE feeds SET error_count = 0').run()
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalises a URL for duplicate detection.
 * - Trims whitespace
 * - Lowercases hostname
 * - Removes trailing slash if path is empty or /
 * - Keeps protocol, query params, and fragments
 */
export function normalizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr.trim())
    url.hostname = url.hostname.toLowerCase()
    // Normalise trailing slash: /foo/ -> /foo, but / -> /
    if (url.pathname.endsWith('/') && url.pathname.length > 1) {
      url.pathname = url.pathname.slice(0, -1)
    }
    return url.toString()
  } catch {
    return urlStr.trim()
  }
}
