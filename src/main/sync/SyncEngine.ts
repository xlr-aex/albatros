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
import type { Database } from 'better-sqlite3'
import pLimit from 'p-limit'
import { FeedHttpError, fetchFeed, type FetchFeedResult } from './HttpClient'
import { parseFeed } from './FeedParser'
import type { FeedService, Feed } from '../services/FeedService'
import type { ArticleService } from '../services/ArticleService'
import { persistDatabase } from '../db/connection'

function getBaseDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  // Rough public-suffix handling for common two-part TLDs (co.uk, com.au…)
  const twoPartTld = /^(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(parts.slice(-2).join('.'))
  return parts.slice(twoPartTld ? -3 : -2).join('.')
}

function getFaviconUrl(siteUrl: string | null, feedUrl: string, feedIconUrl: string | null): string | null {
  // Prefer the icon the feed advertises itself (channel image, atom logo…):
  // it is guaranteed to exist, unlike third-party favicon services.
  if (feedIconUrl && /^https?:\/\//i.test(feedIconUrl)) return feedIconUrl
  try {
    const siteHost = siteUrl ? new URL(siteUrl).hostname : null
    const feedHost = feedUrl ? new URL(feedUrl).hostname : null
    // Feeds are sometimes hosted on a different host than the site (e.g.
    // cms.singularityhub.com). When both belong to the same site, trust the
    // site URL; otherwise fall back to the feed host so the favicon service
    // resolves a domain that actually has an icon.
    const hostname =
      siteHost && feedHost && getBaseDomain(siteHost) === getBaseDomain(feedHost)
        ? siteHost
        : feedHost ?? siteHost
    if (!hostname) return null
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
  } catch {
    return null
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * One-time startup repair for stale favicon URLs.
 * Feeds synced before the hostname guard existed may store a favicon lookup
 * for a mismatched host (e.g. cms.singularityhub.com — a feed-host subdomain
 * with no favicon). Recompute the fallback for those; the feed's own
 * advertised icon replaces it at the next sync.
 */
export function repairStaleFaviconUrls(feedService: FeedService): void {
  let repaired = 0
  for (const feed of feedService.getAll()) {
    if (!feed.favicon_url?.includes('google.com/s2/favicons')) continue
    const corrected = getFaviconUrl(feed.site_url, feed.url, null)
    if (corrected && corrected !== feed.favicon_url) {
      feedService.update(feed.id, { favicon_url: corrected })
      repaired++
    }
  }
  if (repaired > 0) console.log(`[Favicon] Repaired ${repaired} stale favicon URL(s)`)
}

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
  status: 'success' | 'not_modified' | 'deferred' | 'error'
  error?: string
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class SyncEngine {
  private readonly limiter = pLimit(MAX_CONCURRENT)
  private readonly hostLimiters = new Map<string, ReturnType<typeof pLimit>>()
  private nextRedditRequestAt = 0
  private redditBlockedUntil = 0
  private activeSyncOperations = 0
  private readonly db: Database
  public onSyncComplete?: () => void

  constructor(
    private readonly feedService: FeedService,
    private readonly articleService: ArticleService,
    db: Database,
  ) {
    this.db = db
  }

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

    this.beginSyncOperation()
    try {
      const redditFeeds = toSync
        .filter(feed => this.isRedditUrl(feed.url))
        .sort((a, b) => {
          const emptyFirst = Number(a.article_count > 0) - Number(b.article_count > 0)
          return emptyFirst || (a.last_fetched_at ?? 0) - (b.last_fetched_at ?? 0)
        })
      const nonReddit = toSync.filter(feed => !this.isRedditUrl(feed.url))
      const regularTasks = nonReddit.map(feed =>
        this.hostLimiter(feed.url)(() => this.limiter(() => this.syncOne(feed, true))),
      )
      // Keep Reddit strictly serial, including manual per-feed refreshes. The
      // Chromium session can sustain this queue without the 429 storm caused by
      // dozens of anonymous Node requests. Empty feeds are filled first.
      const redditTask = (async (): Promise<SyncResult[]> => {
        const results: SyncResult[] = []
        for (const feed of redditFeeds) {
          results.push(await this.hostLimiter(feed.url)(
            () => this.limiter(() => this.syncOne(feed, true)),
          ))
        }
        return results
      })()

      const [regularResults, redditResults] = await Promise.all([
        Promise.all(regularTasks),
        redditTask,
      ])
      const results = [...regularResults, ...redditResults]
      persistDatabase() // Persist once after the entire batch
      this.onSyncComplete?.()
      return results
    } finally {
      this.endSyncOperation()
    }
  }

  private hostLimiter(feedUrl: string): ReturnType<typeof pLimit> {
    let host = 'unknown'
    try { host = new URL(feedUrl).hostname.toLowerCase() } catch { /* validated later by fetchFeed */ }
    if (host.endsWith('reddit.com')) host = 'reddit.com'
    const existing = this.hostLimiters.get(host)
    if (existing) return existing
    // Providers such as Reddit rate-limit aggressively; serialize that host.
    const limiter = pLimit(host.endsWith('reddit.com') ? 1 : 2)
    this.hostLimiters.set(host, limiter)
    return limiter
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
    this.beginSyncOperation()
    try {
      const res = await this.hostLimiter(feed.url)(() => this.limiter(() => this.syncOne(feed)))
      this.onSyncComplete?.()
      return res
    } finally {
      this.endSyncOperation()
    }
  }

  // ── Core sync logic ───────────────────────────────────────────────────────

  private async syncOne(feed: Feed, skipPersist = false): Promise<SyncResult> {
    const logId = this.insertSyncLog(feed.id, skipPersist)
    this.emitStatus({ feedId: feed.id, status: 'syncing' })

    const MAX_ATTEMPTS = 3
    const RETRY_DELAY_MS = 2000
    let lastError: Error | null = null

    if (this.isRedditUrl(feed.url) && Date.now() < this.redditBlockedUntil) {
      return this.deferRateLimitedFeed(feed, logId, skipPersist)
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          console.info(`[SyncEngine] Retrying feed ${feed.id} (attempt ${attempt}/${MAX_ATTEMPTS})...`)
        }

        // ── Fetch ──────────────────────────────────────────────────────────
        // On the final attempt, we force a full reload by ignoring ETag and Last-Modified.
        // This resolves cases where buggy servers return empty 200/304 incorrectly.
        const useCache = attempt < MAX_ATTEMPTS
        await this.waitForProvider(feed.url)
        let effectiveUrl = feed.url
        let response: FetchFeedResult
        try {
          response = await fetchFeed(
            effectiveUrl,
            useCache ? feed.last_etag : null,
            useCache ? feed.last_modified : null,
          )
        } catch (err) {
          if (!(err instanceof FeedHttpError) || err.status !== 404) throw err

          const recovered = await this.tryFeedAlternatives(feed.url)
          if (!recovered) throw err
          effectiveUrl = recovered.url
          response = recovered.response

          const existing = this.feedService.getByUrl(effectiveUrl)
          if (!existing || existing.id === feed.id) {
            this.feedService.update(feed.id, { url: effectiveUrl }, skipPersist)
          }
        }

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
                if (fbParsed.articles.length > 0) {
                  parsed = fbParsed
                }
              }
            } catch { /* ignore */ }
          }
        }

        // If even after fallback it is still empty, and we have retries left, then retry
        if (parsed.articles.length === 0) {
          if (attempt < MAX_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
            continue
          } else {
            // After 3 attempts (including a forced fresh one), it is truly empty
            throw new Error('Feed has 0 articles (even after forced reload)')
          }
        }

        // Update feed metadata from parsed feed info
        const faviconUrl = getFaviconUrl(parsed.meta.site_url, effectiveUrl, parsed.meta.icon_url)
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
        const inputs = parsed.articles
          .filter(article => Boolean(article.guid))
          .map(article => ({
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
          }))
        const { articlesNew, articlesUpdated } = this.articleService.upsertMany(inputs)

        if (!skipPersist) persistDatabase()

        // ── Update feed metadata ───────────────────────────────────────────
        const nextFetch = this.adaptiveInterval(feed, articlesNew, true)
        this.feedService.updateAfterSync(
          {
            id: feed.id,
            last_etag: response.etag,
            last_modified: response.lastModified,
            next_fetch_at: nextFetch,
            error_count: 0, 
          },
          skipPersist,
        )

        this.finishSyncLog(logId, articlesNew, articlesUpdated, 'success', undefined, skipPersist)
        this.emitStatus({ feedId: feed.id, status: 'success', articlesNew })
        return { feedId: feed.id, articlesNew, articlesUpdated, status: 'success' }

      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (err instanceof FeedHttpError && err.status === 429) {
          const retryAfterMs = Math.min(
            Math.max(err.retryAfterMs ?? 60_000, 60_000),
            15 * 60_000,
          )
          if (this.isRedditUrl(feed.url)) {
            this.redditBlockedUntil = Math.max(this.redditBlockedUntil, Date.now() + retryAfterMs)
          }
          return this.deferRateLimitedFeed(feed, logId, skipPersist, retryAfterMs)
        }
        // Network/HTTP error: retry up to MAX_ATTEMPTS
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
          continue
        }
      }
    }

    // If we reach here, all attempts failed
    const message = lastError?.message || 'Sync failed'
    console.error(`[SyncEngine] Persistent error for feed ${feed.id}:`, message)
    
    // Atomic increment — a manual refresh racing a scheduler tick must not
    // compute the same base twice or the counter never reaches the threshold.
    const newErrorCount = this.feedService.incrementErrorCount(feed.id)
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

    if (newErrorCount >= 10) {
      this.feedService.update(feed.id, { is_active: false }, skipPersist)
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

  private isRedditUrl(url: string): boolean {
    try { return new URL(url).hostname.toLowerCase().endsWith('reddit.com') } catch { return false }
  }

  private async waitForProvider(url: string): Promise<void> {
    if (!this.isRedditUrl(url)) return
    const waitMs = Math.max(0, this.nextRedditRequestAt - Date.now())
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))
    // The persistent Chromium session is accepted by Reddit, but spacing starts
    // avoids turning a full-library refresh into a burst.
    this.nextRedditRequestAt = Date.now() + 750
  }

  private deferRateLimitedFeed(
    feed: Feed,
    logId: number,
    skipPersist: boolean,
    retryAfterMs = Math.max(60_000, this.redditBlockedUntil - Date.now()),
  ): SyncResult {
    const nextFetchAt = Math.floor((Date.now() + retryAfterMs) / 1000)
    this.feedService.deferAfterRateLimit(feed.id, nextFetchAt)
    this.finishSyncLog(logId, 0, 0, 'deferred', 'Provider rate limit; retry scheduled', skipPersist)
    this.emitStatus({ feedId: feed.id, status: 'deferred' })
    return { feedId: feed.id, articlesNew: 0, articlesUpdated: 0, status: 'deferred' }
  }

  private async tryFeedAlternatives(feedUrl: string): Promise<{ url: string; response: FetchFeedResult } | null> {
    let parsed: URL
    try { parsed = new URL(feedUrl) } catch { return null }

    const paths = new Set<string>()
    const cleanPath = parsed.pathname.replace(/\/+$/, '')
    if (/\/(?:rss|feed)$/i.test(cleanPath)) {
      paths.add(`${cleanPath.replace(/\/(?:rss|feed)$/i, '')}/feed/`)
    }
    const wordpressTag = cleanPath.match(/^\/tag\/([^/]+)\/(?:rss|feed)$/i)
    if (wordpressTag) paths.add(`/category/${wordpressTag[1]}/feed/`)
    paths.add('/feed/')

    for (const pathname of paths) {
      const candidate = new URL(parsed.toString())
      candidate.pathname = pathname
      candidate.search = ''
      candidate.hash = ''
      if (candidate.toString() === feedUrl) continue
      try {
        const response = await fetchFeed(candidate.toString())
        if (response.status === 200) return { url: candidate.toString(), response }
      } catch { /* try the next conventional endpoint */ }
    }
    return null
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
      const info = this.db.prepare(`INSERT INTO sync_log (feed_id, status) VALUES (?, 'running')`).run(_feedId)
      if (!skipPersist) persistDatabase()
      return Number(info.lastInsertRowid)
    } catch (err) {
      console.error('[SyncEngine] insertSyncLog error:', err)
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
      this.db.prepare(
        `UPDATE sync_log SET finished_at = strftime('%s','now'), articles_new = ?, articles_updated = ?, status = ?, error_message = ? WHERE id = ?`
      ).run(_articlesNew, _articlesUpdated, _status, _error ?? null, _logId)
      if (!skipPersist) persistDatabase()
    } catch (err) {
      console.error('[SyncEngine] finishSyncLog error:', err)
    }
  }

  // ── IPC emission ──────────────────────────────────────────────────────────

  private beginSyncOperation(): void {
    this.activeSyncOperations++
    if (this.activeSyncOperations === 1) {
      this.emitStatus({ feedId: 0, status: 'syncing', scope: 'batch' })
    }
  }

  private endSyncOperation(): void {
    this.activeSyncOperations = Math.max(0, this.activeSyncOperations - 1)
    if (this.activeSyncOperations === 0) {
      this.emitStatus({ feedId: 0, status: 'success', scope: 'batch' })
    }
  }

  /**
   * Broadcasts a sync status update to all renderer windows via IPC.
   * The renderer subscribes to 'sync:update' to update its loading indicators.
   */
  private emitStatus(payload: {
    feedId: number
    status: 'syncing' | 'success' | 'not_modified' | 'deferred' | 'error'
    scope?: 'feed' | 'batch'
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
