/**
 * @file sync/Scheduler.ts
 * @description Periodic sync scheduler and maintenance task runner.
 *
 * The Scheduler uses a simple `setInterval` loop (every 60 seconds) to check
 * which feeds are due for synchronisation and triggers the SyncEngine.
 *
 * It also runs a daily maintenance task that:
 *  - Deletes articles older than the configured retention period
 *  - Rebuilds the FTS5 index after mass deletions
 */

import type { Database } from 'better-sqlite3'
import type { SyncEngine } from './SyncEngine'
import type { ArticleService } from '../services/ArticleService'
import type { FeedService } from '../services/FeedService'
import type { SettingsService } from '../services/SettingsService'

// ─── Constants ────────────────────────────────────────────────────────────────

/** How often the scheduler checks for feeds due for sync (milliseconds). */
const TICK_INTERVAL_MS = 60_000

/** How often the daily maintenance task runs (milliseconds). */
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000

// ─── Scheduler ───────────────────────────────────────────────────────────────

export class Scheduler {
  private tickTimer:        ReturnType<typeof setInterval> | null = null
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null
  private isRunning = false

  constructor(
    private readonly db:             Database,
    private readonly syncEngine:     SyncEngine,
    private readonly feedService:    FeedService,
    private readonly articleService: ArticleService,
    private readonly settings:       SettingsService,
  ) {}

  /**
   * Starts the scheduler.  Triggers an initial sync immediately on startup
   * so the user sees fresh content right away.
   */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true

    console.warn('[Scheduler] Starting...')

    // Staggered startup to avoid main-thread congestion
    // 1. Initial sync after 5 seconds (allows UI to settle)
    setTimeout(() => {
      if (this.isRunning) void this.tick()
    }, 5_000)

    // 2. Daily maintenance after 30 seconds (heavy DB task)
    setTimeout(() => {
      if (this.isRunning) void this.runMaintenance()
    }, 30_000)

    // Periodic sync tick
    this.tickTimer = setInterval(() => {
      void this.tick()
    }, TICK_INTERVAL_MS)

    // Daily maintenance repeat
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance()
    }, MAINTENANCE_INTERVAL_MS)
  }

  /**
   * Stops all timers.  Should be called on `app.on('before-quit')`.
   */
  stop(): void {
    if (this.tickTimer)        clearInterval(this.tickTimer)
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer)
    this.tickTimer        = null
    this.maintenanceTimer = null
    this.isRunning = false
    console.warn('[Scheduler] Stopped.')
  }

  /**
   * Manually triggers a sync for all feeds (called by the "Refresh All" button
   * in the toolbar via IPC).
   */
  async refreshAll(): Promise<void> {
    await this.tick(true)
  }

  /**
   * Forces an immediate sync for a single feed (called by right-click →
   * "Refresh Feed" in the sidebar).
   */
  async refreshFeed(feedId: number): Promise<void> {
    await this.syncEngine.syncFeedById(feedId)
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * One scheduler tick: queries feeds due for sync and dispatches them to the
   * SyncEngine.
   *
   * @param forceAll - If true, syncs ALL active feeds regardless of schedule
   */
  private async tick(forceAll = false): Promise<void> {
    try {
      const feeds = forceAll
        ? this.feedService.getAll()
        : this.feedService.getDueForSync()

      if (feeds.length === 0) return

      console.warn(`[Scheduler] tick: syncing ${feeds.length} feed(s)`)
      await this.syncEngine.syncMany(feeds)
    } catch (err) {
      console.error('[Scheduler] tick error:', err)
    }
  }

  /**
   * Daily maintenance:
   *  1. Delete expired articles (retention policy)
   *  2. Rebuild FTS5 index after mass deletions
   *  3. Recount unread_count for all feeds (drift correction)
   */
  private async runMaintenance(): Promise<void> {
    try {
      const retention = this.settings.retentionDays
      const deleted   = this.articleService.applyRetention(retention)

      if (deleted > 0) {
        console.warn(`[Scheduler] Maintenance: deleted ${deleted} expired articles`)
        // Native triggers maintain indexing health automatically. No rebuild needed.
      }

      // Recount unread for all feeds to fix any counter drift efficiently
      this.feedService.recountAllUnread()
      console.warn('[Scheduler] Maintenance: unread counts resynced')
    } catch (err) {
      console.error('[Scheduler] Maintenance error:', err)
    }
  }
}
