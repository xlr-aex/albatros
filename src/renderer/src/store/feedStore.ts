/**
 * @file store/feedStore.ts
 * @description Zustand store for feeds and feed groups.
 *
 * This store is the single source of truth for all feed/group state in the
 * renderer.  It calls `window.api` (the preload bridge) to read from and
 * write to the main process, then updates local state optimistically or after
 * confirmation.
 */

import { create } from 'zustand'

// ─── Types (mirrored from backend without backend imports) ────────────────────

export interface FeedGroup {
  id: number
  name: string
  icon: string | null
  sort_order: number
  is_expanded: boolean
}

export interface Feed {
  id: number
  group_id: number | null
  url: string
  title: string | null
  site_url: string | null
  favicon_url: string | null
  unread_count: number
  error_count: number
  is_active: boolean
  fetch_interval_sec: number
}

// ─── View types (built-in navigation entries) ─────────────────────────────────

export type SystemView = 'all' | 'unread' | 'saved' | 'today' | 'github'
export type SelectionType = SystemView | 'feed' | 'group'

export interface FeedSelection {
  type: SelectionType
  feedId?: number
  groupId?: number
}

// ─── Store shape ──────────────────────────────────────────────────────────────

interface FeedStore {
  feeds:    Feed[]
  groups:   FeedGroup[]
  selection: FeedSelection
  isLoading: boolean

  /** Total unread across all feeds (from articles:total-unread). */
  totalUnread: number

  // ── Actions ──────────────────────────────────────────────────────────────
  loadFeeds:    () => Promise<void>
  addFeed:      (url: string, groupId?: number) => Promise<void>
  deleteFeed:   (id: number) => Promise<void>
  updateFeed:   (id: number, patch: Partial<Pick<Feed, 'title' | 'group_id' | 'fetch_interval_sec' | 'is_active'>>) => Promise<void>

  createGroup:  (name: string) => Promise<void>
  updateGroup:  (id: number, patch: { name?: string; icon?: string | null }) => Promise<void>
  deleteGroup:  (id: number) => Promise<void>
  toggleGroup:  (id: number) => Promise<void>

  setSelection: (sel: FeedSelection) => void

  /** Called by the SyncEngine push event to update a single feed's counter. */
  incrementUnread: (feedId: number, by: number) => void
  decrementUnread: (feedId: number, by: number) => void
  refreshUnreadCount: () => Promise<void>
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useFeedStore = create<FeedStore>((set, get) => ({
  feeds:       [],
  groups:      [],
  selection:   { type: 'all' },
  isLoading:   false,
  totalUnread: 0,

  loadFeeds: async () => {
    set({ isLoading: true })
    const [feeds, groups, totalUnread] = await Promise.all([
      window.api.feeds.list(),
      window.api.groups.list(),
      window.api.articles.totalUnread(),
    ])
    set({ feeds, groups, totalUnread, isLoading: false })
  },

  addFeed: async (url, groupId) => {
    await window.api.feeds.add(url, groupId)
    // Re-fetch instead of optimistic update — the backend populates title etc.
    await get().loadFeeds()
  },

  deleteFeed: async (id) => {
    await window.api.feeds.delete(id)
    set(s => ({ feeds: s.feeds.filter(f => f.id !== id) }))
    // If deleted feed was selected, fall back to All
    if (get().selection.feedId === id) set({ selection: { type: 'all' } })
  },

  updateFeed: async (id, patch) => {
    await window.api.feeds.update(id, patch)
    set(s => ({ feeds: s.feeds.map(f => f.id === id ? { ...f, ...patch } : f) }))
  },

  createGroup: async (name) => {
    await window.api.groups.create(name)
    await get().loadFeeds()
  },

  deleteGroup: async (id) => {
    await window.api.groups.delete(id)
    set(s => ({
      groups: s.groups.filter(g => g.id !== id),
      feeds:  s.feeds.map(f => f.group_id === id ? { ...f, group_id: null } : f),
    }))
  },

  updateGroup: async (id, patch) => {
    await window.api.groups.update(id, patch)
    set(s => ({
      groups: s.groups.map(g => g.id === id ? { ...g, ...patch } : g),
    }))
  },

  toggleGroup: async (id) => {
    const group = get().groups.find(g => g.id === id)
    if (!group) return
    const next = !group.is_expanded
    await window.api.groups.update(id, { is_expanded: next })
    set(s => ({
      groups: s.groups.map(g => g.id === id ? { ...g, is_expanded: next } : g),
    }))
  },

  setSelection: (sel) => set({ selection: sel }),

  incrementUnread: (feedId, by) => {
    set(s => ({
      feeds:       s.feeds.map(f => f.id === feedId ? { ...f, unread_count: f.unread_count + by } : f),
      totalUnread: s.totalUnread + by,
    }))
  },

  decrementUnread: (feedId, by) => {
    set(s => ({
      feeds:       s.feeds.map(f => f.id === feedId ? { ...f, unread_count: Math.max(0, f.unread_count - by) } : f),
      totalUnread: Math.max(0, s.totalUnread - by),
    }))
  },

  refreshUnreadCount: async () => {
    const totalUnread = await window.api.articles.totalUnread()
    set({ totalUnread })
  },
}))
