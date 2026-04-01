/**
 * @file ipc/settings.ts & ipc/sync.ts
 * @description IPC handlers for settings management and manual sync triggers.
 */

import { ipcMain } from 'electron'
import type { SettingsService, SettingKey } from '../services/SettingsService'
import type { Scheduler } from '../sync/Scheduler'

// ─── Settings Handlers ────────────────────────────────────────────────────────

export function registerSettingsHandlers(settings: SettingsService): void {
  /** Returns all settings as a plain key-value object. */
  ipcMain.handle('settings:get-all', () => settings.getAll())

  /** Returns a single setting value by key. */
  ipcMain.handle('settings:get', (_event, key: SettingKey) => settings.get(key))

  /**
   * Sets a single setting.
   * The renderer must refresh relevant state after calling this
   * (e.g. re-apply theme CSS variables).
   */
  ipcMain.handle('settings:set', (_event, key: SettingKey, value: string) => {
    settings.set(key, value)
  })
}

// ─── Sync Handlers ────────────────────────────────────────────────────────────

export function registerSyncHandlers(scheduler: Scheduler): void {
  /**
   * Manually triggers a full refresh of all feeds.
   * Called by the "Refresh All" toolbar button.
   */
  ipcMain.handle('sync:refresh-all', async () => {
    await scheduler.refreshAll()
  })

  /**
   * Manually triggers a sync for a single feed.
   * Called by right-clicking a feed in the sidebar → "Refresh".
   */
  ipcMain.handle('sync:refresh-feed', async (_event, feedId: number) => {
    await scheduler.refreshFeed(feedId)
  })
}
