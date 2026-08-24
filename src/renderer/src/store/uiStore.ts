/**
 * @file store/uiStore.ts
 * @description Zustand store for UI state: theme, search, sync status.
 */

import { create } from 'zustand'
import type { Theme } from '../../../main/services/SettingsService'
import { useFeedStore } from './feedStore'
import { useArticleStore } from './articleStore'

interface SyncStatus {
  feedId: number
  status: 'syncing' | 'success' | 'not_modified' | 'deferred' | 'error'
  scope?: 'feed' | 'batch'
  articlesNew?: number
  error?: string
}

interface UiStore {
  theme:            Theme
  searchQuery:      string
  isSearchOpen:     boolean
  isSidebarOpen:    boolean
  syncingFeedIds:   Set<number>
  isSyncing:        boolean
  syncCompletionSequence: number
  lastSyncStatuses: SyncStatus[]

  setTheme:       (theme: Theme) => void
  setSearchQuery: (q: string) => void
  openSearch:     () => void
  closeSearch:    () => void
  toggleSidebar:  () => void
  applySyncUpdate: (status: SyncStatus) => void
}

// Debounce timer to coalesce rapid sync completions into a single reload
let _syncReloadTimer: ReturnType<typeof setTimeout> | null = null

export const useUiStore = create<UiStore>((set, _get) => ({
  theme:            'dark',
  searchQuery:      '',
  isSearchOpen:     false,
  isSidebarOpen:    true,
  syncingFeedIds:   new Set(),
  isSyncing:        false,
  syncCompletionSequence: 0,
  lastSyncStatuses: [],

  setTheme: (theme) => {
    document.documentElement.dataset['theme'] = theme
    set({ theme })
    void window.api.settings.set('theme', theme)
  },

  setSearchQuery: (q)   => set({ searchQuery: q }),
  openSearch:     ()    => set({ isSearchOpen: true }),
  closeSearch:    ()    => set({ isSearchOpen: false, searchQuery: '' }),
  toggleSidebar:  ()    => set(s => ({ isSidebarOpen: !s.isSidebarOpen })),

  applySyncUpdate: (status) => {
    if (status.scope === 'batch') {
      set(s => {
        const isSyncing = status.status === 'syncing'
        return {
          isSyncing,
          syncCompletionSequence: !isSyncing && s.isSyncing
            ? s.syncCompletionSequence + 1
            : s.syncCompletionSequence,
          lastSyncStatuses: [status, ...s.lastSyncStatuses].slice(0, 50),
        }
      })
      return
    }
    set(s => {
      const ids = new Set(s.syncingFeedIds)
      if (status.status === 'syncing') {
        ids.add(status.feedId)
      } else {
        ids.delete(status.feedId)
        if (status.status !== 'error') {
          useFeedStore.setState(s => ({
            feeds: s.feeds.map(feed =>
              feed.id === status.feedId ? { ...feed, error_count: 0 } : feed,
            ),
          }))
        }
        
        // Debounce: coalesce rapid sync completions into a single reload.
        // During a batch sync of 50 feeds, this prevents 50 individual reloads.
        if (_syncReloadTimer) clearTimeout(_syncReloadTimer)
        _syncReloadTimer = setTimeout(() => {
          _syncReloadTimer = null
          void useFeedStore.getState().loadFeeds()

          const sel = useFeedStore.getState().selection
          const artStore = useArticleStore.getState()
          
          if (!artStore.hasMore || artStore.articles.length < 50) {
            if (sel.type === 'feed' && sel.feedId !== undefined) {
              void artStore.loadArticles({ feed_id: sel.feedId }, true)
            } else if (sel.type === 'all' || sel.type === 'unread') {
              void artStore.loadArticles({
                unread_only: sel.type === 'unread'
              }, true)
            } else if (sel.type === 'group' && sel.groupId !== undefined) {
              void artStore.loadArticles({ group_id: sel.groupId }, true)
            } else if (sel.type === 'saved') {
              void artStore.loadArticles({ saved_only: true }, true)
            } else if (sel.type === 'today') {
              void artStore.loadArticles({ today_only: true }, true)
            }
          }
        }, 500)
      }
      // Keep last 50 status records
      const statuses = [status, ...s.lastSyncStatuses].slice(0, 50)
      return { syncingFeedIds: ids, lastSyncStatuses: statuses }
    })
  },
}))

/** Subscribe to sync push events from the main process. */
export function subscribeSyncEvents(): () => void {
  return window.api.sync.onUpdate(status => {
    useUiStore.getState().applySyncUpdate(status)
  })
}
