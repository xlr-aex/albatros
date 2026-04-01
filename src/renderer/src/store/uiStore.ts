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
  status: 'syncing' | 'success' | 'not_modified' | 'error'
  articlesNew?: number
  error?: string
}

interface UiStore {
  theme:            Theme
  searchQuery:      string
  isSearchOpen:     boolean
  isSidebarOpen:    boolean
  syncingFeedIds:   Set<number>
  lastSyncStatuses: SyncStatus[]

  setTheme:       (theme: Theme) => void
  setSearchQuery: (q: string) => void
  openSearch:     () => void
  closeSearch:    () => void
  toggleSidebar:  () => void
  applySyncUpdate: (status: SyncStatus) => void
}

export const useUiStore = create<UiStore>((set, _get) => ({
  theme:            'dark',
  searchQuery:      '',
  isSearchOpen:     false,
  isSidebarOpen:    true,
  syncingFeedIds:   new Set(),
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
    set(s => {
      const ids = new Set(s.syncingFeedIds)
      if (status.status === 'syncing') {
        ids.add(status.feedId)
      } else {
        ids.delete(status.feedId)
        
        // When a sync finishes, update the sidebar counters
        setTimeout(() => {
          void useFeedStore.getState().loadFeeds()

          // If the newly synced feed is currently selected, or we are viewing 'all',
          // gracefully reload the articles so they appear without a restart.
          // Note: we only auto-reload if the user is on the first page (no cursor),
          // to avoid stealing their scroll position deep down.
          const sel = useFeedStore.getState().selection
          const artStore = useArticleStore.getState()
          
          if (!artStore.hasMore || artStore.articles.length < 50) {
            if (sel.type === 'feed' && sel.feedId === status.feedId) {
              void artStore.loadArticles({ feed_id: status.feedId }, true)
            } else if (sel.type === 'all' || sel.type === 'unread') {
              void artStore.loadArticles({
                unread_only: sel.type === 'unread'
              }, true)
            } else if (sel.type === 'group' && sel.groupId !== undefined) {
              // Check if the synced feed belongs to the selected group
              const syncedFeed = useFeedStore.getState().feeds.find(f => f.id === status.feedId)
              if (syncedFeed?.group_id === sel.groupId) {
                void artStore.loadArticles({ group_id: sel.groupId }, true)
              }
            }
          }
        }, 0)
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
