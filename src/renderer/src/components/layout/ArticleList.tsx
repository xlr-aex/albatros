/**
 * @file components/layout/ArticleList.tsx
 * @description Center panel — virtualised list of article cards.
 * Uses @tanstack/react-virtual for windowing (only renders visible cards),
 * enabling smooth scrolling over thousands of articles.
 */

import React, { useRef, useEffect, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useArticleStore } from '../../store/articleStore'
import { useFeedStore } from '../../store/feedStore'
import { ArticleCard } from '../article/ArticleCard'
import styles from './ArticleList.module.css'

export function ArticleList() {
  const { articles, selectedArticle, isLoadingList, hasMore, loadMore, openArticle, prefetchArticles } = useArticleStore()
  const { selection } = useFeedStore()
  const parentRef = useRef<HTMLDivElement>(null)
  const [isCompact, setIsCompact] = useState(false)

  // ── Virtualizer ────────────────────────────────────────────────────────────
  const rowVirtualizer = useVirtualizer({
    count:          hasMore ? articles.length + 1 : articles.length,
    getScrollElement: () => parentRef.current,
    estimateSize:   () => 88,   // Estimated card height in px
    overscan:       5,
  })

  // ── Infinite scroll ─────────────────────────────────────────────────────────
  const virtualItems = rowVirtualizer.getVirtualItems()

  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1]
    if (!lastItem) return
    // When the sentinel row (index === articles.length) becomes visible, load more
    if (lastItem.index >= articles.length - 1 && hasMore && !isLoadingList) {
      void loadMore()
    }
  }, [virtualItems, articles.length, hasMore, isLoadingList, loadMore])

  // ── Background Pre-fetching ────────────────────────────────────────────────
  useEffect(() => {
    if (virtualItems.length === 0 || isLoadingList) return

    const timer = setTimeout(() => {
      const visibleIndices = virtualItems.map((vi) => vi.index)
      const firstVisible = visibleIndices[0]
      // We look ahead for unread articles in the current view + the next 10 items
      const lookaheadRange = 10
      const nextUnreadBatch = articles
        .slice(firstVisible, firstVisible + virtualItems.length + lookaheadRange)
        .filter((a) => !a.is_read)
        .slice(0, 12)
        .map((a) => a.id)

      if (nextUnreadBatch.length > 0) {
        void prefetchArticles(nextUnreadBatch)
      }
    }, 600) // Trigger 600ms after scroll settling

    return () => clearTimeout(timer)
  }, [virtualItems, articles, isLoadingList, prefetchArticles])

  // ── Keyboard navigation ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      // Arrows always work to change post selection ("d'office") — but never
      // steal the keys from a focused input/select/textarea.
      if (isInputFocused) return
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        if (articles.length === 0) return
        if (!selectedArticle) {
          void openArticle(articles[0].id)
          rowVirtualizer.scrollToIndex(0, { align: 'auto' })
          return
        }
        const idx = articles.findIndex(a => a.id === selectedArticle.id)
        if (idx >= 0 && idx < articles.length - 1) {
          void openArticle(articles[idx + 1].id)
          rowVirtualizer.scrollToIndex(idx + 1, { align: 'auto' })
        }
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        if (!selectedArticle || articles.length === 0) return
        const idx = articles.findIndex(a => a.id === selectedArticle.id)
        if (idx > 0) {
          void openArticle(articles[idx - 1].id)
          rowVirtualizer.scrollToIndex(idx - 1, { align: 'auto' })
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [articles, selectedArticle, openArticle, rowVirtualizer])

  // ── Panel title ─────────────────────────────────────────────────────────────
  const feeds = useFeedStore(s => s.feeds)
  const groups = useFeedStore(s => s.groups)
  const panelTitle = getPanelTitle(selection, feeds, groups)

  return (
    <div className={styles.panel}>
      {/* Header bar */}
      <header className={styles.header}>
        <h2 className={styles.title}>{panelTitle}</h2>
        {articles.length > 0 && (
          <span className={styles.count}>{articles.length}{hasMore ? '+' : ''}</span>
        )}
        {/* Compact mode toggle — shows only titles for rapid scanning */}
        <button
          className={`${styles.compactToggle} ${isCompact ? styles.compactToggleActive : ''}`}
          onClick={() => setIsCompact(v => !v)}
          title={isCompact ? 'Vue détaillée' : 'Vue compacte'}
          aria-label={isCompact ? 'Passer en vue détaillée' : 'Passer en vue compacte'}
          aria-pressed={isCompact}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isCompact ? (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            ) : (
              <>
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </>
            )}
          </svg>
        </button>
      </header>

      {/* Article list (virtualised) */}
      <div ref={parentRef} className={styles.scrollArea}>
        {isLoadingList && articles.length === 0 ? (
          <div className={styles.emptyState}>
            <span className="spinner" role="status" aria-label="Loading articles" />
          </div>
        ) : articles.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>📭</span>
            <p>No articles here.</p>
            <p className={styles.emptyHint}>Select a feed in the sidebar to get started.</p>
          </div>
        ) : (
          <div
            style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualItems.map(virtualRow => {
              const article = articles[virtualRow.index]
              // Sentinel row at the bottom — shows the loading spinner
              if (!article) {
                return (
                  <div
                    key="sentinel"
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                    className={styles.sentinel}
                  >
                    {isLoadingList && <span className={styles.loader}>⟳ Loading…</span>}
                  </div>
                )
              }

              return (
                <div
                  key={article.id}
                  style={{
                    position: 'absolute',
                    top:  0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                >
                <ArticleCard
                    article={article}
                    isSelected={selectedArticle?.id === article.id}
                    onClick={() => void openArticle(article.id)}
                    isCompact={isCompact}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
function getPanelTitle(
  selection: ReturnType<typeof useFeedStore.getState>['selection'],
  feeds: ReturnType<typeof useFeedStore.getState>['feeds'],
  groups: ReturnType<typeof useFeedStore.getState>['groups'],
): string {
  switch (selection.type) {
    case 'all':     return 'All Items'
    case 'unread':  return 'Unread'
    case 'saved':   return 'Saved Posts'
    case 'today':   return 'Today'
    case 'feed':    return feeds.find(f => f.id === selection.feedId)?.title ?? 'Feed'
    case 'group':   return groups.find(g => g.id === selection.groupId)?.name ?? 'Folder'
    default: return 'Items'
  }
}
