/**
 * @file store/articleStore.ts
 * @description Zustand store for the article list and the currently open article.
 *
 * Pagination uses cursor-based loading — each "load more" call appends to the
 * existing list by using the last article's (published_at, id) as the cursor.
 */

import { create } from 'zustand'
import { useFeedStore } from './feedStore'

export interface ArticleSummary {
  id: number
  feed_id: number
  feed_title: string | null
  feed_favicon: string | null
  title: string | null
  author: string | null
  excerpt: string | null
  published_at: number | null
  is_read: boolean
  is_saved: boolean
  thumbnail_url: string | null
  snippet?: string
}

export interface Article extends ArticleSummary {
  guid: string
  url: string | null
  content_html: string | null
  word_count: number | null
  comments?: Article[]
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface ArticleStore {
  articles:          ArticleSummary[]
  selectedArticle:   Article | null
  isLoadingList:     boolean
  isLoadingArticle:  boolean
  hasMore:           boolean
  currentSearchQuery: string | null
  lastSaveTimestamp:  number | null

  /** Replaces the list with a fresh load (on selection change). */
  loadArticles: (params: {
    feed_id?: number
    group_id?: number
    unread_only?: boolean
    saved_only?: boolean
    searchQuery?: string
  }, silent?: boolean) => Promise<void>

  /** Appends the next page to the existing list. */
  loadMore: () => Promise<void>

  /** Loads and displays a full article in the reader pane. */
  openArticle: (id: number) => Promise<void>

  /** Closes the reader pane. */
  closeArticle: () => void

  /** Optimistically updates an article's flags in the list. */
  updateArticleFlag: (
    id: number,
    flag: 'is_read' | 'is_saved',
    value: boolean,
  ) => void

  /** Called after mark-all-read to refresh the list. */
  markAllReadLocal: () => void
}

// ─── Internal pagination state (not exposed in store interface) ───────────────

let _lastParams: Parameters<ArticleStore['loadArticles']>[0] = {}

export const useArticleStore = create<ArticleStore>((set, get) => ({
  articles:         [],
  selectedArticle:  null,
  isLoadingList:    false,
  isLoadingArticle: false,
  hasMore:          true,
  currentSearchQuery: null,
  lastSaveTimestamp:  null,

  loadArticles: async (params, silent = false) => {
    _lastParams = params
    
    if (!silent) {
      set({ isLoadingList: true, articles: [], hasMore: true, selectedArticle: null, currentSearchQuery: params.searchQuery || null })
    } else {
      set({ isLoadingList: true })
    }

    if (params.searchQuery) {
      // Global TF-IDF TF/BM25 Semantic Ranking View
      const items = await window.api.search.query(params.searchQuery, 100)
      set({ articles: items, isLoadingList: false, hasMore: false })
    } else {
      // Standard chronological list view
      const items = await window.api.articles.list({ ...params, limit: 50 })
      set({ articles: items, isLoadingList: false, hasMore: items.length === 50 })
    }
  },

  loadMore: async () => {
    const { articles, isLoadingList, hasMore } = get()
    if (isLoadingList || !hasMore || _lastParams.searchQuery) return

    const last = articles[articles.length - 1]
    if (!last) return

    set({ isLoadingList: true })
    const more = await window.api.articles.list({
      ..._lastParams,
      cursor_published_at: last.published_at ?? undefined,
      cursor_id:           last.id,
      limit:               50,
    })
    set(s => ({
      articles:      [...s.articles, ...more],
      isLoadingList: false,
      hasMore:       more.length === 50,
    }))
  },

  openArticle: async (id) => {
    set({ isLoadingArticle: true })

    // Mark immediately as read (optimistic)
    get().updateArticleFlag(id, 'is_read', true)
    void window.api.articles.mark(id, 'read', true)

    const article = await window.api.articles.get(id)
    set({ selectedArticle: article, isLoadingArticle: false })
  },

  closeArticle: () => set({ selectedArticle: null }),

  updateArticleFlag: (id, flag, value) => {
    set(s => {
      // Find the existing article to compute the transition
      const existing = s.articles.find(a => a.id === id) || (s.selectedArticle?.id === id ? s.selectedArticle : null)

      // Sync unread count to FeedStore in real-time
      if (existing && flag === 'is_read' && existing.is_read !== value) {
        if (value === true) {
          useFeedStore.getState().decrementUnread(existing.feed_id, 1)
        } else {
          useFeedStore.getState().incrementUnread(existing.feed_id, 1)
        }
      }

      return {
        articles: s.articles.map(a => a.id === id ? { ...a, [flag]: value } : a),
        selectedArticle:
          s.selectedArticle?.id === id
            ? { ...s.selectedArticle, [flag]: value }
            : s.selectedArticle,
        lastSaveTimestamp: (flag === 'is_saved' && value === true) ? Date.now() : s.lastSaveTimestamp,
      }
    })
  },

  markAllReadLocal: () => {
    set(s => ({
      articles: s.articles.map(a => ({ ...a, is_read: true })),
    }))
    // Force a fresh sync for all totals since it's a mass update
    void useFeedStore.getState().refreshUnreadCount()
  },
}))
