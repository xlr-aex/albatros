/**
 * @file components/article/ArticleCard.tsx
 * @description A single card in the article list panel.
 * Shows feed name, title, excerpt, relative time, and read/star state.
 */

import React, { useState, memo } from 'react'
import type { ArticleSummary } from '../../store/articleStore'
import { useArticleStore } from '../../store/articleStore'
import { formatRelativeTime, unescapeHtml } from '../../utils/format'
import { HighlightText } from '../layout/HighlightText'
import styles from './ArticleCard.module.css'

interface Props {
  article: ArticleSummary
  isSelected: boolean
  onClick: () => void
}

export const ArticleCard = memo(function ArticleCard({ article, isSelected, onClick }: Props) {
  const { title, excerpt, feed_title, published_at, is_read } = article
  const currentSearchQuery = useArticleStore(state => state.currentSearchQuery)
  const [thumbError, setThumbError] = useState(false)

  const ariaLabel = [
    title ? unescapeHtml(title) : 'Untitled',
    feed_title ?? 'Unknown Feed',
    is_read ? 'read' : 'unread',
    published_at ? formatRelativeTime(published_at) : undefined,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <button
      className={`${styles.card} ${isSelected ? styles.selected : ''} ${is_read ? styles.read : ''}`}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-current={isSelected ? 'true' : undefined}
    >
      {/* Unread indicator dot */}
      {!is_read && <span className={styles.unreadDot} aria-label="Unread" />}

      <div className={styles.body}>
        {/* Title */}
        <h3 className={styles.title}>
          {title ? (
            currentSearchQuery ? (
              <HighlightText text={unescapeHtml(title)} highlight={currentSearchQuery} />
            ) : (
              unescapeHtml(title)
            )
          ) : (
            'Untitled'
          )}
        </h3>

        {/* Feed name + timestamp (Discreet line below title) */}
        <div className={styles.meta}>
          <span className={styles.feedName}>{feed_title ?? 'Unknown Feed'}</span>
          {published_at && <span className={styles.time}>{formatRelativeTime(published_at)}</span>}
        </div>

        {/* Excerpt */}
        {(article.snippet || excerpt) &&
          (() => {
            let cleanExcerpt = unescapeHtml(article.snippet || excerpt || '')
            // Retroactive fix: remove the old "▶" triangle artifact cached from the previous parser logic
            cleanExcerpt = cleanExcerpt.replace(/^▶\s*/, '').trim()
            if (!cleanExcerpt) return null

            return (
              <p className={styles.excerpt}>
                {currentSearchQuery ? (
                  <HighlightText text={cleanExcerpt} highlight={currentSearchQuery} />
                ) : (
                  cleanExcerpt
                )}
              </p>
            )
          })()}
      </div>

      {/* Thumbnail (Small format on the right) */}
      {article.thumbnail_url && !thumbError && (
        <div className={styles.thumbnailWrapper}>
          <img
            src={article.thumbnail_url}
            alt=""
            className={styles.thumbnail}
            loading="lazy"
            onError={() => setThumbError(true)}
          />
        </div>
      )}
    </button>
  )
})
