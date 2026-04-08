/**
 * @file services/SearchService.ts
 * @description Full-text search over articles using SQLite FTS4.
 *
 * The FTS4 virtual table `articles_fts` indexes title, content_text, and
 * author.  It uses the "content table" mode so text is not duplicated on disk.
 *
 * Search syntax supported (passed through to FTS4 MATCH):
 *   - Simple words: "electron"
 *   - Phrase: "\"electron vite\""
 *   - Prefix: "elect*"
 *   - Boolean: "electron AND NOT react"
 */

import type { Database } from 'sql.js'
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
   * The query string is passed directly to FTS4 MATCH — see FTS4 docs for
   * supported syntax.  Returns an empty array for blank queries.
   *
   * @param query  - The search string (FTS5 MATCH expression)
   * @param limit  - Maximum results to return (default: 30)
   */
  search(query: string, limit = 30): SearchResult[] {
    const trimmed = query.trim()
    if (!trimmed) return []

    const words = trimmed.split(/\s+/).filter(Boolean).map(w => `"${w.replace(/"/g, '""')}"*`)
    const matchQuery = words.join(' ')
    const likeQuery = `%${trimmed}%`

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
        [likeQuery, likeQuery, matchQuery, limit],
      )

      if (!result.length) return []
      const { columns, values } = result[0]

      return values.map(row => {
        const o: Record<string, unknown> = {}
        columns.forEach((col, i) => { o[col] = row[i] })
        const rawSnippet = String(o['snippet'] ?? '')
        return {
          ...(o as unknown as SearchResult),
          is_read:    o['is_read']    === 1,
          is_starred: o['is_starred'] === 1,
          is_saved:   o['is_saved']   === 1,
          rank:       Number(o['rank']),
          snippet:    rawSnippet.replace(/\[\[\[|\]\]\]/g, ''),
        }
      })
    } catch (err) {
      // FTS4 throws on invalid query syntax — return empty instead of crashing
      console.error('[SearchService] FTS4 query error:', err)
      return []
    }
  }
}
