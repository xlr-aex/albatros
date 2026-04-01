/**
 * @file ipc/articles.ts
 * @description IPC handlers for article queries and user interaction flags.
 */

import { ipcMain } from 'electron'
import type { ArticleService, ArticleListParams } from '../services/ArticleService'
import type { SearchService } from '../services/SearchService'
import type { FeedService } from '../services/FeedService'

export function registerArticleHandlers(
  articleService: ArticleService,
  searchService:  SearchService,
  feedService:    FeedService,
): void {
  /**
   * Returns a paginated list of article summaries.
   * Uses cursor-based pagination — pass cursor_published_at + cursor_id from
   * the last item in the previous page for the next page.
   */
  ipcMain.handle('articles:list', (_event, params: ArticleListParams) => {
    return articleService.list(params)
  })

  /** Returns the full article including HTML content. */
  ipcMain.handle('articles:get', (_event, id: number) => {
    return articleService.getById(id)
  })

  /** Returns the total unread count (for the app badge / toolbar). */
  ipcMain.handle('articles:total-unread', () => {
    return articleService.totalUnreadCount()
  })

  /**
   * Sets the read / starred / saved state of a single article.
   * `action` is one of: 'read' | 'starred' | 'saved'
   */
  ipcMain.handle('articles:mark', (_event, id: number, action: 'read' | 'saved', value: boolean) => {
    switch (action) {
      case 'read':    articleService.setRead(id, value);    break
      case 'saved':   articleService.setSaved(id, value);   break
      default: throw new Error(`Unknown action: ${action}`)
    }
  })

  /**
   * Marks all articles as read.
   * If feedId is provided, only marks that feed's articles.
   * After the bulk update, recounts unread_count on the feed(s).
   */
  ipcMain.handle('articles:mark-all-read', (_event, feedId?: number) => {
    const affected = articleService.markAllRead(feedId)
    // Resync the denormalised counter(s)
    if (feedId !== undefined) {
      feedService.recountUnread(feedId)
    } else {
      feedService.getAll().forEach(f => feedService.recountUnread(f.id))
    }
    return affected
  })

  /** Full-text search across all articles. */
  ipcMain.handle('search:query', (_event, query: string, limit?: number) => {
    return searchService.search(query, limit)
  })

  /** Extract all GitHub links across the DB. */
  ipcMain.handle('articles:get-github-links', () => {
    return articleService.getGithubLinks()
  })

  /** Fetch live Reddit comments via JSON backend proxy. */
  ipcMain.handle('articles:get-reddit-comments', async (_event, url: string) => {
    try {
      if (!url.includes('reddit.com')) return []
      const jsonUrl = url.replace(/\/$/, '') + '.json'
      const res = await fetch(jsonUrl, {
        headers: { 'User-Agent': 'Albatros/1.0.0 (Node.js)' }
      })
      if (!res.ok) return []
      
      const json = await res.json()
      const commentsData = json[1]?.data?.children || []
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parseComment = (child: any): any => {
        if (child.kind === 't1' && child.data && child.data.body) {
          let html = child.data.body_html || ''
          html = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const replies: any[] = []
          if (child.data.replies && child.data.replies.data && child.data.replies.data.children) {
            for (const replyNode of child.data.replies.data.children) {
              const reply = parseComment(replyNode)
              if (reply) replies.push(reply)
            }
          }

          return {
            id: child.data.id,
            author: child.data.author,
            content_html: html || child.data.body,
            published_at: child.data.created_utc,
            score: child.data.score || 0,
            is_submitter: child.data.is_submitter || false,
            replies,
          }
        }
        return null
      }

      const comments = commentsData.map(parseComment).filter(Boolean)
      
      // Extract the main post's self-text HTML if available (useful for crossposts without RSS text)
      let selftextHtml = null
      const postData = json[0]?.data?.children?.[0]?.data
      if (postData && postData.selftext_html) {
         selftextHtml = postData.selftext_html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      }

      return { comments, selftextHtml }
    } catch (err) {
      console.warn('[IPC] Failed to fetch reddit comments:', err)
      return { comments: [], selftextHtml: null }
    }
  })
}
