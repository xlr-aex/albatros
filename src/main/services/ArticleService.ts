/**
 * @file services/ArticleService.ts
 * @description All database operations related to articles.
 *
 * Pagination uses a cursor-based approach (published_at + id) rather than
 * OFFSET, which degrades on large result sets.  The caller passes the last
 * seen (published_at, id) pair; the next page returns rows strictly before
 * that cursor.
 */

import type { Database, SqlValue } from 'sql.js'
import { persistDatabase } from '../db/connection'

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToArticle(columns: string[], row: SqlValue[]): Article {
  const o: Record<string, unknown> = {}
  columns.forEach((col, i) => {
    o[col] = row[i]
  })
  return {
    ...(o as unknown as Article),
    is_read: o['is_read'] === 1,
    is_starred: o['is_starred'] === 1,
    is_saved: o['is_saved'] === 1,
  }
}

function rowToSummary(columns: string[], row: SqlValue[]): ArticleSummary {
  const o: Record<string, unknown> = {}
  columns.forEach((col, i) => {
    o[col] = row[i]
  })
  return {
    ...(o as unknown as ArticleSummary),
    is_read: o['is_read'] === 1,
    is_saved: o['is_saved'] === 1,
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ArticleService {
  constructor(private readonly db: Database) {
    this.migrateRedditComments()
  }

  /**
   * One-time structural migration designed to retroactively flag orphaned Subreddit comments
   * natively inside SQLite via NodeJS Regex mapping, hiding them from the chronological view.
   * Uses a settings flag so it only runs once, not on every startup.
   */
  private migrateRedditComments() {
    // Check if we've already run this migration
    const flag = this.db.exec("SELECT value FROM settings WHERE key = '_reddit_comments_migrated'")
    if (flag.length && flag[0].values.length && flag[0].values[0][0] === '1') return

    const rows = this.db.exec(
      `SELECT id, url FROM articles WHERE url LIKE '%reddit.com%' AND (enclosure_type IS NULL OR enclosure_type != 'reddit-comment')`,
    )
    if (!rows.length || !rows[0].values.length) {
      // Mark as done even if nothing to migrate
      this.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('_reddit_comments_migrated', '1')")
      persistDatabase()
      return
    }

    let updated = false
    this.db.run('BEGIN TRANSACTION')
    for (const [id, url] of rows[0].values) {
      if (typeof url === 'string' && /\/comments\/[^/]+\/[^/]+\/[^/]+/.test(url)) {
        this.db.run(`UPDATE articles SET enclosure_type = 'reddit-comment' WHERE id = ?`, [id])
        updated = true
      }
    }
    this.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('_reddit_comments_migrated', '1')")
    this.db.run('COMMIT')

    if (updated) {
      persistDatabase()
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /**
   * Returns a paginated list of article summaries.
   * Uses cursor-based pagination for constant-time page loading regardless
   * of how many articles exist.
   */
  list(params: ArticleListParams): ArticleSummary[] {
    const limit = params.limit ?? 50
    const conditions: string[] = []
    const bindings: (string | number)[] = []

    // ── Filters ────────────────────────────────────────────────────────────
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

    // ── Cursor ─────────────────────────────────────────────────────────────
    // Returns rows that come after the cursor position.
    // The compound (published_at, id) pair ensures stable pagination even
    // when multiple articles share the same published_at timestamp.
    if (params.cursor_published_at !== undefined && params.cursor_id !== undefined) {
      conditions.push('(a.published_at < ? OR (a.published_at = ? AND a.id < ?))')
      bindings.push(params.cursor_published_at, params.cursor_published_at, params.cursor_id)
    }

    // Hide flagged reddit comments from chronological flows
    conditions.push("(a.enclosure_type IS NULL OR a.enclosure_type != 'reddit-comment')")

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

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
    `
    bindings.push(limit)

    const result = this.db.exec(sql, bindings)
    if (!result.length) return []
    const { columns, values } = result[0]
    return values.map(row => rowToSummary(columns, row))
  }

  /**
   * Récupère un lot d'articles tronqués pour les injecter dans un RAG/Digest.
   */
  getForDigest(params: ArticleListParams & { limit?: number; search_query?: string; timeframe?: string }): { id: number; url: string; title: string; content: string }[] {
    let limit = params.limit ?? 10000 // Scan massif jusqu'à 10 000 articles
    let conditions: string[] = []
    let bindings: (string | number)[] = []
    let fromClause = 'FROM articles a JOIN feeds f ON f.id = a.feed_id'
    
    // Troncation plus agressive (150 au lieu de 400) pour permettre d'injecter 10x plus d'articles.
    let selectContent = 'SUBSTR(COALESCE(a.content_text, a.excerpt, ""), 1, 150) AS content'

    if (params.search_query) {
      // Filtrage des Stopwords français basiques et ponctuation pour transformer une phrase naturelle en requête de mots-clés FTS
      const stopWords = new Set(['le','la','les','un','une','des','de','du','et','ou','est','sont','a','à','en','pour','qui','que','quoi','dont','où','dans','sur','sous','vers','avec','sans','fais','fait','moi','peux','tu','je','il','elle','on','nous','vous','ils','elles','pas','ne','plus','moins','très','trop','quel','quelle','quels','quelles','comment','pourquoi','quand','combien','ce','cet','cette','ces','mon','ton','son','ma','ta','sa','mes','tes','ses','notre','votre','leur','nos','vos','leurs', 'quoi', 'tout', 'tous', 'résumé', 'resumé', 'résume', 'resume', 'donne', 'parle', 'dis', 'actu', 'actualité', 'actualités', 'news', 'nouveau', 'nouveaux', 'nouvelles', 'article', 'articles'])

      const words = params.search_query.trim()
        .toLowerCase()
        .replace(/[^\w\s\u00C0-\u017F]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !stopWords.has(w))

      if (words.length > 0) {
        fromClause += ' JOIN articles_fts fts ON fts.docid = a.id'
        const ftsQuery = words.map(w => `"${w}"*`).join(' OR ')
        conditions.push('articles_fts MATCH ?')
        bindings.push(ftsQuery)
        
        // Snippet FTS4 plus court pour la recherche profonde
        selectContent = "snippet(articles_fts, '[[', ']]', '...', -1, 40) AS content"
        limit = 10000 
      }
    }

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

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const sql = `
      SELECT a.id, a.url, a.title, ${selectContent}
      ${fromClause}
      ${where}
      ORDER BY a.published_at DESC
      LIMIT ?
    `
    bindings.push(limit)

    const result = this.db.exec(sql, bindings)
    if (!result.length || !result[0].values.length) return []
    
    return result[0].values.map(row => ({
      id: Number(row[0] || 0),
      url: String(row[1] || '#'),
      title: String(row[2] || 'Unknown Title'),
      // Si c'est un snippet, c'est déjà condensé. Sinon on truncate à 800 caractères.
      content: params.search_query && selectContent.includes('snippet') 
        ? String(row[3] || '') 
        : String(row[3] || '').substring(0, 800)
    }))
  }

  /** Returns the full article (including HTML content) for the reader pane. */
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
    const result = this.db.exec(sql, [id])
    if (!result.length || !result[0].values.length) return null
    const article = rowToArticle(result[0].columns, result[0].values[0])

    // Hydrate Reddit comments natively by correlating URLs
    if (article.url && article.url.includes('reddit.com/r/')) {
      const baseMatch = article.url.match(
        /^(https?:\/\/(?:www\.|old\.|np\.)?reddit\.com\/r\/[^/]+\/comments\/[^/]+\/[^/]+\/)/,
      )
      if (baseMatch) {
        const baseUrl = baseMatch[1]
        const commentRows = this.db.exec(
          `SELECT
             a.*,
             f.title AS feed_title,
             f.favicon_url AS feed_favicon
           FROM articles a
           JOIN feeds f ON f.id = a.feed_id
           WHERE a.feed_id = ? AND a.enclosure_type = 'reddit-comment'`,
          [article.feed_id],
        )
        if (commentRows.length && commentRows[0].values.length) {
          const { columns, values } = commentRows[0]
          article.comments = values
            .map(row => rowToArticle(columns, row))
            .filter(c => c.url && c.url.startsWith(baseUrl) && c.id !== article.id)
            .sort((a, b) => (a.published_at || 0) - (b.published_at || 0))
        }
      }
    }
    return article
  }

  /** Returns the total count of unread articles (across all feeds). */
  totalUnreadCount(): number {
    const result = this.db.exec('SELECT COUNT(*) FROM articles WHERE is_read = 0')
    return Number(result[0]?.values[0][0] ?? 0)
  }

  /**
   * Universal semantic search utilizing SQLite FTS4.
   * Computes matches over tokenized content, AND relational folder/feed names.
   */
  search(query: string): ArticleSummary[] {
    const q = query.trim()
    if (!q) return []

    // Map strict prefixes for FTS text indexing and unindexed LIKE bounds
    const safeQuery = q.replace(/"/g, '""')
    const matchQuery = `"${safeQuery}"*`
    const likeQuery = `%${q}%`

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
    `

    const result = this.db.exec(sql, [matchQuery, likeQuery, likeQuery])
    if (!result.length) return []
    return result[0].values.map(row => rowToSummary(result[0].columns, row))
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /**
   * Inserts a new article, or ignores it silently if it already exists
   * (same feed_id + guid). Returns the article ID (existing or new).
   */
  upsert(input: UpsertArticleInput): { id: number; isNew: boolean } {
    // Check for existing article first
    const existing = this.db.exec('SELECT id FROM articles WHERE feed_id = ? AND guid = ?', [
      input.feed_id,
      input.guid,
    ])
    if (existing.length && existing[0].values.length) {
      const existingId = Number(existing[0].values[0][0])

      // Update the textual content in case the RSS feed changed or our parser improved
      // Always update thumbnail_url when we have a new value (overwrite NULL)
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
          existingId,
        ],
      )

      return { id: existingId, isNew: false }
    }

    const now = Math.floor(Date.now() / 1000)
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
        now,
      ],
    )
    // Note: persistDatabase() is NOT called here — the sync engine batches
    // multiple upserts and calls persist once at the end for performance.
    const res = this.db.exec('SELECT last_insert_rowid() AS id')
    return { id: Number(res[0].values[0][0]), isNew: true }
  }

  /** Marks a single article as read or unread. */
  setRead(id: number, value: boolean): void {
    this.db.run('UPDATE articles SET is_read = ? WHERE id = ?', [value ? 1 : 0, id])
    persistDatabase()
  }

  /** Saves or unsaves an article (Read Later queue). */
  setSaved(id: number, value: boolean): void {
    this.db.run('UPDATE articles SET is_saved = ? WHERE id = ?', [value ? 1 : 0, id])
    if (value) {
      // Add to read_later queue
      this.db.run('INSERT OR IGNORE INTO read_later (article_id) VALUES (?)', [id])
    } else {
      this.db.run('DELETE FROM read_later WHERE article_id = ?', [id])
    }
    persistDatabase()
  }

  /**
   * Marks all articles in a feed as read (or all feeds if feedId is undefined).
   * After a bulk update the caller should call FeedService.recountUnread() to
   * resync the denormalised counter.
   */
  markAllRead(feedId?: number): number {
    let sql = 'UPDATE articles SET is_read = 1 WHERE is_read = 0'
    const params: number[] = []
    if (feedId !== undefined) {
      sql += ' AND feed_id = ?'
      params.push(feedId)
    }
    this.db.run(sql, params)

    // Count affected rows via changes()
    const res = this.db.exec('SELECT changes()')
    const affected = Number(res[0]?.values[0][0] ?? 0)
    persistDatabase()
    return affected
  }

  /**
   * Deletes old articles according to the retention policy.
   * Articles that are starred or saved are never deleted.
   *
   * @param retentionDays - Delete articles older than this many days
   * @returns Number of deleted rows
   */
  applyRetention(retentionDays: number): number {
    const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400
    this.db.run(
      `DELETE FROM articles
       WHERE published_at < ?
         AND is_starred = 0
         AND is_saved   = 0`,
      [cutoff],
    )
    const res = this.db.exec('SELECT changes()')
    const deleted = Number(res[0]?.values[0][0] ?? 0)
    if (deleted > 0) persistDatabase()
    return deleted
  }

  // ── GitHub Links Aggregator ───────────────────────────────────────────────

  /**
   * Scans the database for articles containing GitHub links, extracts them
   * via basic Regex, and returns an array mapping them to their sources.
   */
  getGithubLinks(): GithubLink[] {
    const result = this.db.exec(`
      SELECT a.id, a.title, f.title as feed_title, a.content_html, fg.name as group_title
      FROM articles a
      JOIN feeds f ON a.feed_id = f.id
      LEFT JOIN feed_groups fg ON f.group_id = fg.id
      WHERE a.content_html LIKE '%github.com/%'
      ORDER BY a.published_at DESC
      LIMIT 3000
    `)

    if (!result.length || !result[0].values.length) return []

    const links: GithubLink[] = []

    // Aggressive regex to find any href pointing to a GitHub repo (org/repo)
    // We ignore inner HTML because RSS feeds often put linebreaks inside <a>...</a>
    const regex = /href=["'](https?:\/\/(?:www\.)?github\.com\/([^/"']+)\/([^/"'?#]+)[^"']*)["']/gi

    result[0].values.forEach(row => {
      const articleId = Number(row[0])
      const articleTitle = String(row[1] || 'Untitled')
      const feedTitle = String(row[2] || 'Unknown Feed')
      const html = String(row[3] || '')
      const groupTitle = row[4] ? String(row[4]) : undefined

      let match
      regex.lastIndex = 0
      while ((match = regex.exec(html)) !== null) {
        const url = match[1]
        const org = match[2]
        const repo = match[3]

        // Exclude system pages
        const ignoreList = [
          'search',
          'topics',
          'trending',
          'pricing',
          'contact',
          'about',
          'login',
          'join',
          'pulls',
          'issues',
        ]
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
    })

    // Remove total duplicates across all articles (people reposting the exact same github link)
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
