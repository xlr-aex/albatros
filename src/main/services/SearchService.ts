/**
 * @file services/SearchService.ts
 * @description Full-text search over articles using SQLite FTS4.
 *
 * The FTS4 virtual table `articles_fts` indexes title, content_text, and
 * author.  It uses the "content table" mode so text is not duplicated on disk.
 */

import type { Database } from 'better-sqlite3'
import type { ArticleSummary } from './ArticleService'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchResult extends ArticleSummary {
  /** HTML snippet with matched terms wrapped in <mark> tags. */
  snippet: string
  /** FTS5 relevance rank (lower is more relevant). */
  rank: number
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class SearchService {
  constructor(private readonly db: Database) {}

  /**
   * Runs a full-text search and returns matching articles sorted by relevance.
   * The query string is passed to FTS4 MATCH.
   *
   * @param query  - The search string
   * @param limit  - Maximum results to return (default: 30)
   */
  search(query: string, limit = 30): SearchResult[] {
    const trimmed = query.trim()
    if (!trimmed) return []

    // Map strict prefixes for FTS text indexing. 
    // Stripping unbalanced quotes and weird FTS symbols to prevent crashes
    const safeQuery = trimmed.replace(/["*()]/g, '')
    const words = safeQuery.split(/\s+/).filter(Boolean).map(w => `"${w}"*`)
    if (!words.length) return []
    
    const matchQuery = words.join(' ')
    const likeQuery = `%${safeQuery}%`

    try {
      const stmt = this.db.prepare(`
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
      `)

      const rows = stmt.all(likeQuery, likeQuery, matchQuery, limit) as Record<string, unknown>[]

      return rows.map(row => {
        const rawSnippet = String(row.snippet ?? '')
        return {
           id: row.id,
           feed_id: row.feed_id,
           feed_title: row.feed_title,
           feed_favicon: row.feed_favicon,
           title: row.title,
           author: row.author,
           excerpt: row.excerpt,
           published_at: row.published_at,
           is_read: row.is_read === 1,
           is_starred: row.is_starred === 1,
           is_saved: row.is_saved === 1,
           thumbnail_url: row.thumbnail_url || null,
           rank: Number(row.rank),
           snippet: rawSnippet.replace(/\[\[\[|\]\]\]/g, ''),
        }
      })
    } catch (err) {
      console.error('[SearchService] FTS4 query error:', err)
      return []
    }
  }
}
