/**
 * @file preload/index.ts
 * @description Secure bridge between the Electron main process and the renderer.
 *
 * `contextBridge.exposeInMainWorld` creates a `window.api` object in the
 * renderer with a whitelist of IPC channels. This is the ONLY way the renderer
 * should communicate with the main process — never via nodeIntegration.
 *
 * Each function here wraps `ipcRenderer.invoke()` (request/response) or
 * `ipcRenderer.on()` (push events from main).
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { ArticleListParams } from '../main/services/ArticleService'
import type { SettingKey } from '../main/services/SettingsService'

// ─── Type-safe API surface ────────────────────────────────────────────────────

export type Api = typeof api

const api = {
  // ── Feeds ────────────────────────────────────────────────────────────────
  feeds: {
    list:   ()                                              => ipcRenderer.invoke('feeds:list'),
    add:    (url: string, groupId?: number)                 => ipcRenderer.invoke('feeds:add', url, groupId),
    update: (id: number, patch: object)                     => ipcRenderer.invoke('feeds:update', id, patch),
    delete: (id: number)                                    => ipcRenderer.invoke('feeds:delete', id),
  },

  // ── Groups ───────────────────────────────────────────────────────────────
  groups: {
    list:   ()                                              => ipcRenderer.invoke('groups:list'),
    create: (name: string)                                  => ipcRenderer.invoke('groups:create', name),
    update: (id: number, patch: object)                     => ipcRenderer.invoke('groups:update', id, patch),
    delete: (id: number)                                    => ipcRenderer.invoke('groups:delete', id),
  },

  // ── Articles ─────────────────────────────────────────────────────────────
  articles: {
    list:          (params: ArticleListParams)                => ipcRenderer.invoke('articles:list', params),
    get:           (id: number)                               => ipcRenderer.invoke('articles:get', id),
    totalUnread: ()                                         => ipcRenderer.invoke('articles:total-unread'),
    mark:        (id: number, action: 'read' | 'starred' | 'saved', value: boolean) => ipcRenderer.invoke('articles:mark', id, action, value),
    markAllRead: (feedId?: number)                          => ipcRenderer.invoke('articles:mark-all-read', feedId),
    getGithubLinks: ()                                      => ipcRenderer.invoke('articles:get-github-links'),
    getRedditComments: (url: string)                        => ipcRenderer.invoke('articles:get-reddit-comments', url),
  },

  // ── Search ───────────────────────────────────────────────────────────────
  search: {
    query: (q: string, limit?: number)                      => ipcRenderer.invoke('search:query', q, limit),
  },

  // ── Sync ─────────────────────────────────────────────────────────────────
  sync: {
    refreshAll:  ()                                         => ipcRenderer.invoke('sync:refresh-all'),
    refreshFeed: (feedId: number)                           => ipcRenderer.invoke('sync:refresh-feed', feedId),

    /**
     * Subscribes to real-time sync status updates pushed from the main process.
     * Returns an unsubscribe function — call it in useEffect cleanup.
     */
    onUpdate: (cb: (payload: {
      feedId: number
      status: 'syncing' | 'success' | 'not_modified' | 'deferred' | 'error'
      scope?: 'feed' | 'batch'
      articlesNew?: number
      error?: string
    }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload as Parameters<typeof cb>[0])
      ipcRenderer.on('sync:update', handler)
      return () => ipcRenderer.off('sync:update', handler)
    },
  },

  // ── Settings ─────────────────────────────────────────────────────────────
  settings: {
    getAll: ()                                              => ipcRenderer.invoke('settings:get-all'),
    get:    (key: SettingKey)                               => ipcRenderer.invoke('settings:get', key),
    set:    (key: SettingKey, value: string)                => ipcRenderer.invoke('settings:set', key, value),
    setMany: (values: Partial<Record<SettingKey, string>>)  => ipcRenderer.invoke('settings:set-many', values),
  },

  // ── OPML ─────────────────────────────────────────────────────────────────
  opml: {
    import: ()                                              => ipcRenderer.invoke('opml:import'),
    export: ()                                              => ipcRenderer.invoke('opml:export'),
  },

  // ── Laya Folder Sorting ──────────────────────────────────────────────────
  laya: {
    listFolders:   ()                                                        => ipcRenderer.invoke('laya:folders-list'),
    listGroupScopes: (folderId: number)                                     => ipcRenderer.invoke('laya:group-scopes-list', folderId),
    setGroupScopes: (folderId: number, groupIds: number[])                  => ipcRenderer.invoke('laya:group-scopes-set', folderId, groupIds),
    listFeedScopes: (folderId: number)                                      => ipcRenderer.invoke('laya:feed-scopes-list', folderId),
    setFeedScopes: (folderId: number, feedIds: number[])                    => ipcRenderer.invoke('laya:feed-scopes-set', folderId, feedIds),
    createFolder:  (name: string, description: string)                       => ipcRenderer.invoke('laya:folder-create', name, description),
    updateFolder:  (id: number, patch: { name?: string; description?: string; is_enabled?: boolean }) => ipcRenderer.invoke('laya:folder-update', id, patch),
    deleteFolder:  (id: number)                                              => ipcRenderer.invoke('laya:folder-delete', id),
    getStatus:     ()                                                        => ipcRenderer.invoke('laya:status-get'),
    trigger:       ()                                                        => ipcRenderer.invoke('laya:trigger'),
    pause:         ()                                                        => ipcRenderer.invoke('laya:pause'),
    resume:        ()                                                        => ipcRenderer.invoke('laya:resume'),
    resetAll:      ()                                                        => ipcRenderer.invoke('laya:reset-all'),
    resetFolderScope: (folderId: number)                                    => ipcRenderer.invoke('laya:reset-folder-scope', folderId),

    onStatus: (cb: (payload: { pending: number; total: number; processed: number; scopeTotal: number; folderProgress: Record<number, { processed: number; total: number }>; isProcessing: boolean; isPaused: boolean; workerReady: boolean; folderCount: number; workerError: string | null }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload as Parameters<typeof cb>[0])
      ipcRenderer.on('laya:status', handler)
      return () => { ipcRenderer.off('laya:status', handler) }
    },
    onFolders: (cb: (folders: unknown[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, folders: unknown) => cb(folders as unknown[])
      ipcRenderer.on('laya:folders', handler)
      return () => { ipcRenderer.off('laya:folders', handler) }
    },
  },

  debug: {
    log: (msg: string) => ipcRenderer.send('debug:log', msg)
  },

  menu: {
    toggle: () => ipcRenderer.invoke('menu:toggle') as Promise<boolean>
  },

  browser: {
    open: (url: string) => ipcRenderer.invoke('browser:open', url) as Promise<boolean>
  },

  mcp: {
    connectionInfo: () => ipcRenderer.invoke('mcp:connection-info') as Promise<{
      running: boolean
      url: string
      token: string
    } | null>
  }
}

// Expose the API to the renderer under window.api
contextBridge.exposeInMainWorld('api', api)
