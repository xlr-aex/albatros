/**
 * @file components/layout/ArticleList.tsx
 * @description Center panel — virtualised list of article cards.
 * Uses @tanstack/react-virtual for windowing (only renders visible cards),
 * enabling smooth scrolling over thousands of articles.
 */

import React, { useRef, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useArticleStore } from '../../store/articleStore'
import { useFeedStore } from '../../store/feedStore'
import { ArticleCard } from '../article/ArticleCard'
import styles from './ArticleList.module.css'

export function ArticleList() {
  const { articles, selectedArticle, isLoadingList, hasMore, loadMore, openArticle } = useArticleStore()
  const { selection } = useFeedStore()
  const parentRef = useRef<HTMLDivElement>(null)

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

  // ── Keyboard navigation ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return

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
  const panelTitle = getPanelTitle(selection)

  return (
    <div className={styles.panel}>
      {/* Header bar */}
      <header className={styles.header}>
        <h2 className={styles.title}>{panelTitle}</h2>
        {articles.length > 0 && (
          <span className={styles.count}>{articles.length}{hasMore ? '+' : ''}</span>
        )}
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon}>📭</span>
      <p>{message}</p>
    </div>
  )
}

function getPanelTitle(selection: ReturnType<typeof useFeedStore.getState>['selection']): string {
  switch (selection.type) {
    case 'all':     return 'All Items'
    case 'unread':  return 'Unread'
    case 'saved':   return 'Saved Posts'
    case 'today':   return 'Today'
    case 'feed':    return useFeedStore.getState().feeds.find(f => f.id === selection.feedId)?.title ?? 'Feed'
    case 'group':   return useFeedStore.getState().groups.find(g => g.id === selection.groupId)?.name ?? 'Folder'
    default: return 'Items'
  }
}
