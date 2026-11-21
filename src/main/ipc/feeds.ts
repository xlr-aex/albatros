/**
 * @file ipc/feeds.ts
 * @description IPC handlers for feed and feed group operations.
 *
 * All handlers are registered on the `ipcMain` object and communicate with
 * the renderer via the preload bridge (`window.api`).
 *
 * Channel naming convention: `<domain>:<action>`
 * e.g. `feeds:list`, `feeds:add`, `groups:create`
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { FeedService } from '../services/FeedService'
import type { OpmlService } from '../services/OpmlService'
import type { Scheduler } from '../sync/Scheduler'
import { assertSafeExternalHttpUrl } from '../security/ExternalUrlPolicy'
import fs from 'fs'

export function registerFeedHandlers(
  feedService: FeedService,
  opmlService: OpmlService,
  scheduler: Scheduler,
): void {
  // ── Feed Groups ────────────────────────────────────────────────────────────

  /** Returns all feed groups. */
  ipcMain.handle('groups:list', () => feedService.getGroups())

  /** Creates a new group. Returns the new group id. */
  ipcMain.handle('groups:create', (_event, name: string) => {
    if (!name?.trim()) throw new Error('Group name cannot be empty')
    return feedService.createGroup(name.trim())
  })

  /** Updates a group's name or sort order. */
  ipcMain.handle('groups:update', (_event, id: number, patch: { name?: string; sort_order?: number; is_expanded?: boolean }) => {
    feedService.updateGroup(id, patch)
  })

  /** Deletes a group (feeds in it become ungrouped). */
  ipcMain.handle('groups:delete', (_event, id: number) => {
    feedService.deleteGroup(id)
  })

  // ── Feeds ─────────────────────────────────────────────────────────────────

  /** Returns all feeds with their unread_count. */
  ipcMain.handle('feeds:list', () => feedService.getAll())

  /**
   * Adds a new feed by URL.
   * Triggers an immediate sync so the user sees articles right away.
   */
  ipcMain.handle('feeds:add', async (_event, url: string, groupId?: number) => {
    const trimmedUrl = url?.trim()
    if (!trimmedUrl) throw new Error('Feed URL cannot be empty')

    await assertSafeExternalHttpUrl(trimmedUrl)

    const id = feedService.create({ url: trimmedUrl, group_id: groupId })

    // Trigger an immediate sync so the user gets articles right away
    void scheduler.refreshFeed(id)

    return id
  })

  /** Updates feed properties, validating a changed URL before saving it. */
  ipcMain.handle('feeds:update', async (_event, id: number, patch: {
    url?: string
    title?: string
    group_id?: number | null
    fetch_interval_sec?: number
    is_active?: boolean
  }) => {
    const current = feedService.getById(id)
    if (!current) throw new Error('Feed not found')
    const update = { ...patch, url: patch.url?.trim(), title: patch.title?.trim(), title_is_custom: patch.title !== undefined ? true : undefined }
    if (update.title !== undefined && !update.title) throw new Error('Feed name cannot be empty')
    if (update.url !== undefined) {
      if (!update.url) throw new Error('Feed URL cannot be empty')
      await assertSafeExternalHttpUrl(update.url)
      const existing = feedService.getByUrl(update.url)
      if (existing && existing.id !== id) throw new Error('This feed URL is already subscribed')
    }
    feedService.update(id, update)
    if (update.url && update.url !== current.url) void scheduler.refreshFeed(id).catch(error => console.error('[Feeds] Refresh after URL change failed:', error))
  })

  /** Permanently deletes a feed and all its articles. */
  ipcMain.handle('feeds:delete', (_event, id: number) => {
    feedService.delete(id)
  })

  // ── OPML ──────────────────────────────────────────────────────────────────

  /** Opens a file picker and imports the chosen OPML file. */
  ipcMain.handle('opml:import', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? null
    const result = await dialog.showOpenDialog(win as Electron.BrowserWindow, {
      title:       'Import OPML Subscriptions',
      filters:     [{ name: 'OPML Files', extensions: ['opml', 'xml'] }],
      properties:  ['openFile'],
    })
    if (result.canceled || !result.filePaths.length) return 0

    const xml = fs.readFileSync(result.filePaths[0], 'utf-8')
    const count = opmlService.import(xml)

    // Kick off a sync for all newly added feeds
    void scheduler.refreshAll()
    return count
  })

  /** Saves an OPML export to a user-chosen file path. */
  ipcMain.handle('opml:export', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? null
    const result = await dialog.showSaveDialog(win as Electron.BrowserWindow, {
      title:       'Export OPML Subscriptions',
      defaultPath: `albatros-export-${new Date().toISOString().slice(0, 10)}.opml`,
      filters:     [{ name: 'OPML Files', extensions: ['opml'] }],
    })
    if (result.canceled || !result.filePath) return false

    const xml = opmlService.export()
    fs.writeFileSync(result.filePath, xml, 'utf-8')
    return true
  })
}
