/**
 * @file sync/SyncEngine.ts
 * @description Orchestrates fetching, parsing and storing RSS/Atom feeds.
 *
 * Responsibilities:
 *  - Fetch a feed via HttpClient (conditional GET with ETag)
 *  - Parse the response via FeedParser (RSS / Atom / JSON Feed)
 *  - Upsert articles into SQLite via ArticleService
 *  - Update feed metadata (ETag, next_fetch_at, error_count)
 *  - Write a sync_log entry
 *  - Emit IPC events so the renderer can update its UI in real-time
 *  - Enforce max concurrency (p-limit, default 5)
 *
 * The SyncEngine does NOT manage the scheduling interval — that is handled
 * by the Scheduler class.
 */

import { BrowserWindow } from 'electron'
import pLimit from 'p-limit'
import { fetchFeed } from './HttpClient'
import { parseFeed } from './FeedParser'
import type { FeedService, Feed } from '../services/FeedService'
import type { ArticleService } from '../services/ArticleService'
import { persistDatabase } from '../db/connection'

function getFaviconUrl(siteUrl: string | null, feedUrl: string): string | null {
  try {
    const url = siteUrl || feedUrl
    if (!url) return null
    const hostname = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
  } catch {
    return null
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum simultaneous feed fetches. */
const MAX_CONCURRENT = 5

/**
 * Adaptive interval calculation parameters.
 * All values in seconds.
 */
const INTERVAL = {
  MIN: 300, // 5 minutes (most active feeds)
  MAX: 86400, // 24 hours (very quiet or errored feeds)
  DEFAULT: 900, // 15 minutes
  BACKOFF_MAX: 86400, // Max backoff on repeated errors
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  feedId: number
  articlesNew: number
  articlesUpdated: number
  status: 'success' | 'not_modified' | 'error'
  error?: string
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class SyncEngine {
  private readonly limiter = pLimit(MAX_CONCURRENT)

  constructor(
    private readonly feedService: FeedService,
    private readonly articleService: ArticleService,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Syncs a list of feeds concurrently (up to MAX_CONCURRENT at a time).
   * Emits `sync:update` IPC events to all renderer windows as feeds complete.
   *
   * @param feeds - Feeds to sync (defaults to all feeds due for sync)
   */
  async syncMany(feeds?: Feed[]): Promise<SyncResult[]> {
    const toSync = feeds ?? this.feedService.getDueForSync()
    if (toSync.length === 0) return []

    const tasks = toSync.map(feed => this.limiter(() => this.syncOne(feed, true)))
    const results = await Promise.all(tasks)
    persistDatabase() // Persist once after the entire batch
    return results
  }

  /**
   * Syncs a single feed by ID.  Useful for "refresh now" triggered from the UI.
   */
  async syncFeedById(feedId: number): Promise<SyncResult> {
    const feed = this.feedService.getById(feedId)
    if (!feed)
      return {
        feedId,
        articlesNew: 0,
        articlesUpdated: 0,
        status: 'error',
        error: 'Feed not found',
      }
    return this.syncOne(feed)
  }

  // ── Core sync logic ───────────────────────────────────────────────────────

  private async syncOne(feed: Feed, skipPersist = false): Promise<SyncResult> {
    // Write a "running" log entry
    const logId = this.insertSyncLog(feed.id, skipPersist)
    this.emitStatus({ feedId: feed.id, status: 'syncing' })

    try {
      // ── Fetch ──────────────────────────────────────────────────────────
      const response = await fetchFeed(feed.url, feed.last_etag, feed.last_modified)

      // ── 304 Not Modified ───────────────────────────────────────────────
      if (response.status === 304) {
        const nextFetch = this.adaptiveInterval(feed, 0, false)
        this.feedService.updateAfterSync(
          {
            id: feed.id,
            last_etag: response.etag ?? feed.last_etag,
            last_modified: response.lastModified ?? feed.last_modified,
            next_fetch_at: nextFetch,
            error_count: 0,
          },
          skipPersist,
        )
        this.finishSyncLog(logId, 0, 0, 'success', undefined, skipPersist)
        this.emitStatus({ feedId: feed.id, status: 'not_modified' })
        return { feedId: feed.id, articlesNew: 0, articlesUpdated: 0, status: 'not_modified' }
      }

      // ── Parse ──────────────────────────────────────────────────────────
      let parsed = parseFeed(response.body, response.contentType)

      // ── Fallback RSS <-> ATOM for incomplete scraping ──────────────────
      // If every article is missing extensive content (or the feed is inexplicably empty),
      // we guess the alternative feed format URL to scrape for richer data.
      const isContentMissing =
        parsed.articles.length === 0 ||
        parsed.articles.every(
          a => !a.content_html && !a.content_text && (!a.excerpt || a.excerpt.length < 50),
        )

      if (isContentMissing) {
        let fallbackUrl: string | null = null
        if (feed.url.endsWith('.rss')) fallbackUrl = feed.url.replace(/\.rss$/, '.atom')
        else if (feed.url.endsWith('.atom')) fallbackUrl = feed.url.replace(/\.atom$/, '.rss')
        else if (feed.url.endsWith('/rss')) fallbackUrl = feed.url.replace(/\/rss$/, '/atom')
        else if (feed.url.endsWith('/atom')) fallbackUrl = feed.url.replace(/\/atom$/, '/rss')

        if (fallbackUrl) {
          try {
            const fbRes = await fetchFeed(fallbackUrl)
            if (fbRes.status === 200) {
              const fbParsed = parseFeed(fbRes.body, fbRes.contentType)
              // If the fallback feed successfully parsed rich articles, ruthlessly overwrite the primary feed
              if (fbParsed.articles.length > 0) {
                parsed = fbParsed
              }
            }
          } catch (fallbackErr) {
            // Silently ignore fallback fetch failures and proceed with original parsed data
          }
        }
      }

      // Update feed metadata from parsed feed info (title, site_url, etc.)
      const faviconUrl = getFaviconUrl(parsed.meta.site_url, feed.url)

      if (parsed.meta.title || parsed.meta.site_url || faviconUrl !== feed.favicon_url) {
        this.feedService.update(
          feed.id,
          {
            title: parsed.meta.title ?? undefined,
            site_url: parsed.meta.site_url ?? undefined,
            favicon_url: faviconUrl ?? undefined,
          },
          skipPersist,
        )
      }

      // ── Upsert articles ────────────────────────────────────────────────
      let articlesNew = 0
      for (const article of parsed.articles) {
        if (!article.guid) continue

        const { isNew } = this.articleService.upsert({
          feed_id: feed.id,
          guid: article.guid,
          url: article.url ?? undefined,
          title: article.title ?? undefined,
          author: article.author ?? undefined,
          content_html: article.content_html ?? undefined,
          content_text: article.content_text ?? undefined,
          excerpt: article.excerpt ?? undefined,
          enclosure_url: article.enclosure_url ?? undefined,
          enclosure_type: article.enclosure_type ?? undefined,
          word_count: article.word_count ?? undefined,
          published_at: article.published_at ?? undefined,
          thumbnail_url: article.thumbnail_url ?? undefined,
        })
        if (isNew) articlesNew++
      }

      // Persist all article inserts in a single flush
      if (!skipPersist) persistDatabase()

      // ── Update feed metadata ───────────────────────────────────────────
      const nextFetch = this.adaptiveInterval(feed, articlesNew, true)
      this.feedService.updateAfterSync(
        {
          id: feed.id,
          last_etag: response.etag,
          last_modified: response.lastModified,
          next_fetch_at: nextFetch,
          error_count: 0, // Reset error counter on success
        },
        skipPersist,
      )

      this.finishSyncLog(logId, articlesNew, 0, 'success', undefined, skipPersist)
      this.emitStatus({ feedId: feed.id, status: 'success', articlesNew })

      return { feedId: feed.id, articlesNew, articlesUpdated: 0, status: 'success' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[SyncEngine] Error saving feed:', feed.id, message)
      const newErrorCount = (feed.error_count ?? 0) + 1

      // Exponential backoff: 2^errorCount * defaultInterval, capped at BACKOFF_MAX
      const backoff = Math.min(INTERVAL.DEFAULT * Math.pow(2, newErrorCount), INTERVAL.BACKOFF_MAX)
      const nextFetch = Math.floor(Date.now() / 1000) + backoff

      this.feedService.updateAfterSync(
        {
          id: feed.id,
          last_etag: feed.last_etag,
          last_modified: feed.last_modified,
          next_fetch_at: nextFetch,
          error_count: newErrorCount,
        },
        skipPersist,
      )

      // Auto-disable feed after 10 consecutive errors
      if (newErrorCount >= 10) {
        this.feedService.update(feed.id, { is_active: false }, skipPersist)
        console.error(
          `[SyncEngine] Feed ${feed.id} disabled after ${newErrorCount} consecutive errors`,
        )
      }

      this.finishSyncLog(logId, 0, 0, 'error', message, skipPersist)
      this.emitStatus({ feedId: feed.id, status: 'error', error: message })

      return {
        feedId: feed.id,
        articlesNew: 0,
        articlesUpdated: 0,
        status: 'error',
        error: message,
      }
    }
  }

  // ── Adaptive interval ─────────────────────────────────────────────────────

  /**
   * Computes the next poll time using adaptive backoff / speedup logic.
   *
   *  - If many articles were found → poll sooner (multiply by 0.8, floor at MIN)
   *  - If no articles found → poll later (multiply by 1.2, cap at MAX)
   *  - If 304 → poll later (multiply by 1.5, cap at MAX)
   *
   * @param feed          - Current feed record
   * @param articlesFound - Number of new articles discovered
   * @param didFetch      - false if server returned 304 (didn't re-download body)
   */
  private adaptiveInterval(feed: Feed, articlesFound: number, didFetch: boolean): number {
    let interval = feed.fetch_interval_sec ?? INTERVAL.DEFAULT

    if (!didFetch) {
      // 304: increase interval more aggressively (feed hasn't changed)
      interval = Math.min(interval * 1.5, INTERVAL.MAX)
    } else if (articlesFound >= 10) {
      // Very active feed — check sooner
      interval = Math.max(interval * 0.8, INTERVAL.MIN)
    } else if (articlesFound === 0) {
      // Quiet feed — check a bit later
      interval = Math.min(interval * 1.2, INTERVAL.MAX)
    }
    // else: moderate activity, keep current interval

    return Math.floor(Date.now() / 1000) + Math.round(interval)
  }

  // ── Sync log helpers ──────────────────────────────────────────────────────

  private insertSyncLog(_feedId: number, skipPersist = false): number {
    try {
      // Use feedService.db since we're in the same layer
      // @ts-expect-error accessing protected db
      const db = this.feedService.db
      db.run(`INSERT INTO sync_log (feed_id, status) VALUES (?, 'running')`, [_feedId])
      const res = db.exec('SELECT last_insert_rowid()')
      if (!skipPersist) persistDatabase()
      return Number(res[0].values[0][0])
    } catch {
      return 0
    }
  }

  private finishSyncLog(
    _logId: number,
    _articlesNew: number,
    _articlesUpdated: number,
    _status: string,
    _error?: string,
    skipPersist = false,
  ): void {
    if (_logId === 0) return
    try {
      // @ts-expect-error accessing protected db
      const db = this.feedService.db
      db.run(
        `UPDATE sync_log SET finished_at = strftime('%s','now'), articles_new = ?, articles_updated = ?, status = ?, error_message = ? WHERE id = ?`,
        [_articlesNew, _articlesUpdated, _status, _error ?? null, _logId],
      )
      if (!skipPersist) persistDatabase()
    } catch {
      /* ignore */
    }
  }

  // ── IPC emission ──────────────────────────────────────────────────────────

  /**
   * Broadcasts a sync status update to all renderer windows via IPC.
   * The renderer subscribes to 'sync:update' to update its loading indicators.
   */
  private emitStatus(payload: {
    feedId: number
    status: 'syncing' | 'success' | 'not_modified' | 'error'
    articlesNew?: number
    error?: string
  }): void {
    const windows = BrowserWindow?.getAllWindows?.() ?? []
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('sync:update', payload)
      }
    }
  }
}
