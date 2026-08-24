/**
 * @file services/ArticleService.ts
 * @description All database operations related to articles.
 *
 * Pagination uses a cursor-based approach (published_at + id) rather than
 * OFFSET, which degrades on large result sets.
 */

import type { Database } from 'better-sqlite3'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Article {
  id: number
  feed_id: number
  feed_title: string | null
  feed_favicon: string | null
  guid: string
  url: string | null
  title: string | null
  author: string | null
  content_html: string | null
  content_text: string | null
  excerpt: string | null
  enclosure_url: string | null
  enclosure_type: string | null
  word_count: number | null
  published_at: number | null
  fetched_at: number
  is_read: boolean
  is_starred: boolean
  is_saved: boolean
  thumbnail_url: string | null
  summary: string | null
  created_at: number
  comments?: Article[]
}

export interface GithubLink {
  url: string
  linkText: string
  articleId: number
  articleTitle: string
  feedTitle: string
  groupTitle?: string
}

/** A lightweight article summary shown in the list panel. */
export interface ArticleSummary {
  id: number
  feed_id: number
  feed_title: string | null
  feed_favicon: string | null
  title: string | null
  author: string | null
  excerpt: string | null
  published_at: number | null
  is_read: boolean
  is_saved: boolean
  thumbnail_url: string | null
}

export interface ArticleListParams {
  feed_id?: number // Filter to a specific feed (undefined = all feeds)
  group_id?: number // Filter to all feeds within a group
  unread_only?: boolean // If true, only return unread articles
  saved_only?: boolean // If true, only return saved articles
  today_only?: boolean // If true, only return articles from the last 24h
  /** Cursor: last seen published_at value (for pagination) */
  cursor_published_at?: number
  /** Cursor: last seen article id (tie-breaker) */
  cursor_id?: number
  limit?: number // Defaults to 50
}

export interface UpsertArticleInput {
  feed_id: number
  guid: string
  url?: string
  title?: string
  author?: string
  content_html?: string
  content_text?: string
  excerpt?: string
  enclosure_url?: string
  enclosure_type?: string
  word_count?: number
  published_at?: number
  thumbnail_url?: string
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ArticleService {
  constructor(private readonly db: Database) {
    this.migrateRedditComments()
  }

  /**
   * One-time structural migration designed to retroactively flag orphaned Subreddit comments
   * natively inside SQLite via NodeJS Regex mapping, hiding them from the chronological view.
   */
  private migrateRedditComments() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = '_reddit_comments_migrated'").get() as Record<string, unknown>
    if (row && row.value === '1') return

    const rows = this.db.prepare(`SELECT id, url FROM articles WHERE url LIKE '%reddit.com%' AND (enclosure_type IS NULL OR enclosure_type != 'reddit-comment')`).all() as Record<string, unknown>[]
    if (rows.length === 0) {
      this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('_reddit_comments_migrated', '1')").run()
      return
    }

    const transaction = this.db.transaction(() => {
      const updateStmt = this.db.prepare(`UPDATE articles SET enclosure_type = 'reddit-comment' WHERE id = ?`)
      for (const r of rows) {
        if (typeof r.url === 'string' && /\/comments\/[^/]+\/[^/]+\/[^/]+/.test(r.url)) {
          updateStmt.run(r.id)
        }
      }
      this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('_reddit_comments_migrated', '1')").run()
    })
    transaction()
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  list(params: ArticleListParams): ArticleSummary[] {
    const limit = params.limit ?? 50
    const conditions: string[] = []
    const bindings: (string | number)[] = []

    if (params.feed_id !== undefined) {
      conditions.push('a.feed_id = ?')
      bindings.push(params.feed_id)
    }
    if (params.group_id !== undefined) {
      conditions.push('f.group_id = ?')
      bindings.push(params.group_id)
    }
    if (params.unread_only) {
      conditions.push('a.is_read = 0')
    }
    if (params.saved_only) {
      conditions.push('a.is_saved = 1')
    }
    if (params.today_only) {
      const oneDayAgo = Math.floor(Date.now() / 1000) - 86400
      conditions.push('a.published_at >= ?')
      bindings.push(oneDayAgo)
    }

    if (params.cursor_published_at !== undefined && params.cursor_id !== undefined) {
      conditions.push('(COALESCE(a.published_at, a.created_at) < ? OR (COALESCE(a.published_at, a.created_at) = ? AND a.id < ?))')
      bindings.push(params.cursor_published_at, params.cursor_published_at, params.cursor_id)
    }

    conditions.push("(a.enclosure_type IS NULL OR a.enclosure_type != 'reddit-comment')")

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const sql = `
      SELECT
        a.id, a.feed_id,
        f.title  AS feed_title,
        f.favicon_url AS feed_favicon,
        a.title, a.author, a.excerpt, a.thumbnail_url,
        a.published_at, a.created_at, a.is_read, a.is_starred, a.is_saved
      FROM articles a
      JOIN feeds f ON f.id = a.feed_id
      ${where}
      ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
      LIMIT ?
    `
    bindings.push(limit)

    const rows = this.db.prepare(sql).all(...bindings) as Record<string, unknown>[]
    return rows.map(row => ({
      ...row,
      is_read: row.is_read === 1,
      is_saved: row.is_saved === 1,
    })) as ArticleSummary[]
  }

  getForDigest(params: ArticleListParams & { limit?: number; search_query?: string; timeframe?: string }): { id: number; url: string; title: string; content: string }[] {
    let limit = params.limit ?? 300
    let conditions: string[] = []
    let bindings: (string | number)[] = []
    let fromClause = 'FROM articles a JOIN feeds f ON f.id = a.feed_id'
    
    let selectContent = "COALESCE(a.summary, SUBSTR(COALESCE(a.content_text, a.excerpt, ''), 1, 800)) AS content"

    // Build base filter conditions (timeframe, feed, group) first
    if (params.feed_id !== undefined) {
      conditions.push('a.feed_id = ?')
      bindings.push(params.feed_id)
    }
    if (params.group_id !== undefined) {
      conditions.push('f.group_id = ?')
      bindings.push(params.group_id)
    }
    if (params.today_only || params.timeframe === 'today') {
      const offset = 86400
      conditions.push('a.published_at >= ?')
      bindings.push(Math.floor(Date.now() / 1000) - offset)
    } else if (params.timeframe === 'week') {
      const offset = 86400 * 7
      conditions.push('a.published_at >= ?')
      bindings.push(Math.floor(Date.now() / 1000) - offset)
    } else if (params.timeframe === 'month') {
      const offset = 86400 * 30
      conditions.push('a.published_at >= ?')
      bindings.push(Math.floor(Date.now() / 1000) - offset)
    }

    if (params.search_query) {
      const stopWords = new Set([
        'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'est', 'sont', 'a', 'à', 'en', 'pour', 
        'qui', 'que', 'quoi', 'dont', 'où', 'dans', 'sur', 'sous', 'vers', 'avec', 'sans', 'fais', 'fait', 'moi', 
        'peux', 'tu', 'je', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'pas', 'ne', 'plus', 'moins', 
        'très', 'trop', 'quel', 'quelle', 'quels', 'quelles', 'comment', 'pourquoi', 'quand', 'combien', 'ce', 
        'cet', 'cette', 'ces', 'mon', 'ton', 'son', 'ma', 'ta', 'sa', 'mes', 'tes', 'ses', 'notre', 'votre', 
        'leur', 'nos', 'vos', 'leurs', 'tout', 'tous', 'résumé', 'resumé', 'résume', 'resume', 'donne', 'parle', 
        'dis', 'actu', 'actualité', 'actualités', 'news', 'nouveau', 'nouveaux', 'nouvelles', 'article', 'articles',
        'qu', 'se', 'me', 'te', 'aux', 'par', 'mais', 'donc', 'car', 'ni', 'si', 'y', 'bien', 'aussi', 'comme', 
        'alors', 'puis', 'encore', 'ici', 'lors', 'même', 'peu', 'surtout', 'toute', 'toutes', 'faire', 'dois', 
        'doit', 'devrait', 'peut', 'peuvent', 'veux', 'veut', 'veulent', 'va', 'vont', 'ai', 'as', 'avons', 
        'avez', 'ont', 'suis', 'es', 'est', 'sommes', 'êtes', 'été', 'étiez', 'étaient', 'étais', 'était'
      ])

      const words = params.search_query.trim()
        .toLowerCase()
        .replace(/[^\w\s\u00C0-\u017F]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !stopWords.has(w))

      if (words.length > 0) {
        fromClause += ' JOIN articles_fts fts ON fts.docid = a.id'
        
        // Strategy: Try AND first, fall back to OR if few results found.
        // Bare prefix terms (FTS4 ignores a trailing * after a quoted term)
        const ftsQueryAnd = words.map(w => `${w}*`).join(' AND ')
        
        const tempConditions = [...conditions, 'articles_fts MATCH ?']
        const tempBindings = [...bindings, ftsQueryAnd]
        const tempWhere = tempConditions.length > 0 ? `WHERE ${tempConditions.join(' AND ')}` : ''
        const sqlAnd = `
          SELECT a.id
          ${fromClause}
          ${tempWhere}
          LIMIT 10
        `
        
        let hasEnoughAndResults = false
        try {
          const andRows = this.db.prepare(sqlAnd).all(...tempBindings)
          if (andRows.length >= 10) {
            hasEnoughAndResults = true
          }
        } catch (err) {
          console.error('[RAG] AND query pre-check failed:', err)
        }

        const ftsQuery = hasEnoughAndResults 
          ? ftsQueryAnd 
          : words.map(w => `${w}*`).join(' OR ')

        conditions.push('articles_fts MATCH ?')
        bindings.push(ftsQuery)
        
        selectContent = "snippet(articles_fts, '[[', ']]', '...', -1, 100) AS content"
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const sql = `
      SELECT a.id, a.url, a.title, ${selectContent}
      ${fromClause}
      ${where}
      ORDER BY a.published_at DESC
      LIMIT ?
    `
    bindings.push(limit)

    const rows = this.db.prepare(sql).all(...bindings) as Record<string, unknown>[]
    
    return rows.map(row => ({
      id: Number(row.id || 0),
      url: String(row.url || '#'),
      title: String(row.title || 'Unknown Title'),
      content: params.search_query && selectContent.includes('snippet') 
        ? String(row.content || '') 
        : String(row.content || '').substring(0, 800)
    }))
  }

  getById(id: number): Article | null {
    const sql = `
      SELECT
        a.*,
        f.title AS feed_title,
        f.favicon_url AS feed_favicon
      FROM articles a
      JOIN feeds f ON f.id = a.feed_id
      WHERE a.id = ?
    `
    const row = this.db.prepare(sql).get(id) as Record<string, unknown>
    if (!row) return null

    const article = {
        ...row,
        is_read: row.is_read === 1,
        is_starred: row.is_starred === 1,
        is_saved: row.is_saved === 1,
    } as Article

    if (article.url && article.url.includes('reddit.com/r/')) {
      const baseMatch = article.url.match(
        /^(https?:\/\/(?:www\.|old\.|np\.)?reddit\.com\/r\/[^/]+\/comments\/[^/]+\/[^/]+\/)/,
      )
      if (baseMatch) {
        const baseUrl = baseMatch[1]
        const commentRows = this.db.prepare(
          `SELECT
             a.*,
             f.title AS feed_title,
             f.favicon_url AS feed_favicon
           FROM articles a
           JOIN feeds f ON f.id = a.feed_id
           WHERE a.feed_id = ? AND a.enclosure_type = 'reddit-comment'`
        ).all(article.feed_id) as Record<string, unknown>[]

        article.comments = commentRows
            .map(r => ({
                ...r,
                is_read: r.is_read === 1,
                is_starred: r.is_starred === 1,
                is_saved: r.is_saved === 1,
            } as Article))
            .filter(c => c.url && c.url.startsWith(baseUrl) && c.id !== article.id)
            .sort((a, b) => (a.published_at || 0) - (b.published_at || 0))
      }
    }
    return article
  }

  totalUnreadCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM articles WHERE is_read = 0').get() as Record<string, unknown>
    return Number(row?.count ?? 0)
  }

  search(query: string): ArticleSummary[] {
    const q = query.trim()
    if (!q) return []

    const safeQuery = q.replace(/"/g, '""')
    // FTS4 ignores a trailing * after a quoted term, so emit bare prefix terms instead
    const matchQuery = safeQuery
      .split(/\s+/)
      .map(w => `${w.replace(/[*()]/g, '')}*`)
      .filter(w => w !== '*')
      .join(' ')
    const likeQuery = `%${q.replace(/[%_\\]/g, '\\$&')}%`

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
      WHERE f.title LIKE ? ESCAPE '\\' OR fg.name LIKE ? ESCAPE '\\'

      ORDER BY published_at DESC
      LIMIT 100
    `

    const rows = this.db.prepare(sql).all(matchQuery, likeQuery, likeQuery) as Record<string, unknown>[]
    return rows.map(row => ({
      ...row,
      is_read: row.is_read === 1,
      is_saved: row.is_saved === 1,
    })) as ArticleSummary[]
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  upsert(input: UpsertArticleInput): { id: number; isNew: boolean; updated: boolean } {
    const existing = this.db.prepare('SELECT id FROM articles WHERE feed_id = ? AND guid = ?').get(input.feed_id, input.guid) as { id: number } | undefined
    if (existing) {
      const info = this.db.prepare(
        `UPDATE articles SET
           title = COALESCE(?, title),
           content_html = COALESCE(?, content_html),
           content_text = COALESCE(?, content_text),
           excerpt = COALESCE(?, excerpt),
           enclosure_type = COALESCE(?, enclosure_type),
           thumbnail_url = COALESCE(?, thumbnail_url),
           url = COALESCE(?, url),
           author = COALESCE(?, author),
           enclosure_url = COALESCE(?, enclosure_url),
           published_at = COALESCE(?, published_at)
          WHERE id = ?
            AND (COALESCE(?, title) IS NOT title
              OR COALESCE(?, content_html) IS NOT content_html
              OR COALESCE(?, content_text) IS NOT content_text
              OR COALESCE(?, excerpt) IS NOT excerpt
              OR COALESCE(?, enclosure_type) IS NOT enclosure_type
              OR COALESCE(?, thumbnail_url) IS NOT thumbnail_url
              OR COALESCE(?, url) IS NOT url
              OR COALESCE(?, author) IS NOT author
              OR COALESCE(?, enclosure_url) IS NOT enclosure_url
              OR COALESCE(?, published_at) IS NOT published_at)`
      ).run(
          input.title ?? null,
          input.content_html ?? null,
          input.content_text ?? null,
          input.excerpt ?? null,
          input.enclosure_type ?? null,
          input.thumbnail_url ?? null,
          input.url ?? null,
          input.author ?? null,
          input.enclosure_url ?? null,
          input.published_at ?? null,
          existing.id,
          input.title ?? null,
          input.content_html ?? null,
          input.content_text ?? null,
          input.excerpt ?? null,
          input.enclosure_type ?? null,
          input.thumbnail_url ?? null,
          input.url ?? null,
          input.author ?? null,
          input.enclosure_url ?? null,
          input.published_at ?? null
      )

      return { id: existing.id, isNew: false, updated: info.changes > 0 }
    }

    const now = Math.floor(Date.now() / 1000)
    const info = this.db.prepare(
      `INSERT OR IGNORE INTO articles
         (feed_id, guid, url, title, author, content_html, content_text,
          excerpt, enclosure_url, enclosure_type, thumbnail_url, word_count, published_at,
          fetched_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
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
    )
    
    // In rare cases where IGNORE kicks in due to uniqueness violation not caught by SELECT
    if (info.changes === 0) {
        const fallBack = this.db.prepare('SELECT id FROM articles WHERE feed_id = ? AND guid = ?').get(input.feed_id, input.guid) as { id: number }
        return { id: fallBack.id, isNew: false, updated: false }
    }

    return { id: Number(info.lastInsertRowid), isNew: true, updated: false }
  }

  /** Upserts a feed batch in one SQLite transaction to avoid per-row commits. */
  upsertMany(inputs: UpsertArticleInput[]): { articlesNew: number; articlesUpdated: number } {
    let articlesNew = 0
    let articlesUpdated = 0
    const run = this.db.transaction(() => {
      for (const input of inputs) {
        if (!input.guid) continue
        const result = this.upsert(input)
        if (result.isNew) articlesNew++
        else if (result.updated) articlesUpdated++
      }
    })
    run()
    return { articlesNew, articlesUpdated }
  }

  setRead(id: number, value: boolean): void {
    this.db.prepare('UPDATE articles SET is_read = ? WHERE id = ?').run(value ? 1 : 0, id)
  }

  setSaved(id: number, value: boolean): void {
    this.db.prepare('UPDATE articles SET is_saved = ? WHERE id = ?').run(value ? 1 : 0, id)
    if (value) {
      this.db.prepare('INSERT OR IGNORE INTO read_later (article_id) VALUES (?)').run(id)
    } else {
      this.db.prepare('DELETE FROM read_later WHERE article_id = ?').run(id)
    }
  }

  setStarred(id: number, value: boolean): void {
    this.db.prepare('UPDATE articles SET is_starred = ? WHERE id = ?').run(value ? 1 : 0, id)
  }

  updateSummary(id: number, summary: string): void {
    this.db.prepare('UPDATE articles SET summary = ? WHERE id = ?').run(summary, id)
  }

  markAllRead(feedId?: number): number {
    let sql = 'UPDATE articles SET is_read = 1 WHERE is_read = 0'
    const params: number[] = []
    if (feedId !== undefined) {
      sql += ' AND feed_id = ?'
      params.push(feedId)
    }
    const info = this.db.prepare(sql).run(...params)
    return info.changes
  }

  applyRetention(retentionDays: number): number {
    const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400
    const info = this.db.prepare(
      `DELETE FROM articles
       WHERE published_at < ?
         AND is_starred = 0
         AND is_saved   = 0`
    ).run(cutoff)
    return info.changes
  }

  // ── GitHub Links Aggregator ───────────────────────────────────────────────

  getGithubLinks(): GithubLink[] {
    const rows = this.db.prepare(`
      SELECT a.id, a.title, f.title as feed_title, a.content_html, fg.name as group_title
      FROM articles a
      JOIN feeds f ON a.feed_id = f.id
      LEFT JOIN feed_groups fg ON f.group_id = fg.id
      WHERE a.content_html LIKE '%github.com/%'
      ORDER BY a.published_at DESC
      LIMIT 3000
    `).all() as Record<string, unknown>[]

    if (!rows.length) return []

    const links: GithubLink[] = []
    const regex = /href=["'](https?:\/\/(?:www\.)?github\.com\/([^/"']+)\/([^/"'?#]+)[^"']*)["']/gi

    for (const row of rows) {
      const articleId = Number(row.id)
      const articleTitle = String(row.title || 'Untitled')
      const feedTitle = String(row.feed_title || 'Unknown Feed')
      const html = String(row.content_html || '')
      const groupTitle = row.group_title ? String(row.group_title) : undefined

      let match
      regex.lastIndex = 0
      while ((match = regex.exec(html)) !== null) {
        const url = match[1]
        const org = match[2]
        const repo = match[3]

        const ignoreList = ['search', 'topics', 'trending', 'pricing', 'contact', 'about', 'login', 'join', 'pulls', 'issues']
        if (ignoreList.includes(org.toLowerCase()) || ignoreList.includes(repo.toLowerCase())) {
          continue
        }

        const linkText = `${org}/${repo}`

        links.push({
          url,
          linkText,
          articleId,
          articleTitle,
          feedTitle,
          groupTitle,
        })
      }
    }

    const uniqueLinks: GithubLink[] = []
    const seenUrls = new Set<string>()
    for (const link of links) {
      if (!seenUrls.has(link.url)) {
        seenUrls.add(link.url)
        uniqueLinks.push(link)
      }
    }

    return uniqueLinks
  }
}
