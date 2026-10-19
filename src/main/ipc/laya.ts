/**
 * @file ipc/laya.ts
 * @description IPC handlers for Laya folder CRUD and classification status.
 */

import { ipcMain } from 'electron'
import type { LayaService } from '../services/LayaService'

export function registerLayaHandlers(laya: LayaService): void {
  // ── Folders ────────────────────────────────────────────────────────────────
  ipcMain.handle('laya:folders-list', () => laya.listFolders())
  ipcMain.handle('laya:group-scopes-list', (_event, folderId: number) => laya.listGroupScopes(folderId))
  ipcMain.handle('laya:group-scopes-set', (_event, folderId: number, groupIds: number[]) => laya.setGroupScopes(folderId, groupIds))
  ipcMain.handle('laya:feed-scopes-list', (_event, folderId: number) => laya.listFeedScopes(folderId))
  ipcMain.handle('laya:feed-scopes-set', (_event, folderId: number, feedIds: number[]) => laya.setFeedScopes(folderId, feedIds))

  ipcMain.handle('laya:folder-create', (_event, name: string, description: string) =>
    laya.createFolder(name, description)
  )

  ipcMain.handle('laya:folder-update', (_event, id: number, patch: { name?: string; description?: string; is_enabled?: boolean }) =>
    laya.updateFolder(id, patch)
  )

  ipcMain.handle('laya:folder-delete', (_event, id: number) =>
    laya.deleteFolder(id)
  )

  // ── Status & control ───────────────────────────────────────────────────────
  ipcMain.handle('laya:status-get', () => laya.getStatus())

  ipcMain.handle('laya:trigger', () => {
    laya.trigger()
  })
  ipcMain.handle('laya:pause', () => laya.pause())
  ipcMain.handle('laya:resume', () => laya.resume())

  ipcMain.handle('laya:reset-all', () => {
    laya.resetAll()
  })
  ipcMain.handle('laya:reset-folder-scope', (_event, folderId: number) => {
    laya.resetFolderScope(folderId)
  })

  // ── Article list filtered by folder ───────────────────────────────────────
  // Re-uses the existing articles:list IPC — folder_id is added to ArticleListParams
  // Nothing extra needed here; handled by ArticleService.
}
