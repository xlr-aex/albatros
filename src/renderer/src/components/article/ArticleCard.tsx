/**
 * @file components/article/ArticleCard.tsx
 * @description A single post card in the article list panel.
 * Instagram-style layout: avatar header, large media, title + excerpt below.
 */

import React, { useState, useEffect, memo } from 'react'
import type { ArticleSummary } from '../../store/articleStore'
import { useArticleStore } from '../../store/articleStore'
import { useFeedStore } from '../../store/feedStore'
import { formatRelativeTime, unescapeHtml } from '../../utils/format'
import { HighlightText } from '../layout/HighlightText'
import styles from './ArticleCard.module.css'

interface Props {
  article: ArticleSummary
  isSelected: boolean
  onClick: () => void
  isCompact?: boolean
}

export const ArticleCard = memo(function ArticleCard({ article, isSelected, onClick, isCompact }: Props) {
  const { title, excerpt, feed_title, published_at, is_read, thumbnail_url } = article
  const currentSearchQuery = useArticleStore(state => state.currentSearchQuery)
  const selection = useFeedStore(state => state.selection)
  const [thumbError, setThumbError] = useState(false)
  const [avatarError, setAvatarError] = useState(false)

  // Reset error state if thumbnail_url changes
  useEffect(() => {
    setThumbError(false)
    setAvatarError(false)
  }, [thumbnail_url, article.feed_favicon])

  const showFeedFavicon = article.feed_favicon && ['all', 'unread', 'saved', 'today', 'group', 'search', 'feed'].includes(selection.type as string)

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
      className={`${styles.card} ${isSelected ? styles.selected : ''} ${is_read ? styles.read : ''} ${isCompact ? styles.compact : ''}`}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-current={isSelected ? 'true' : undefined}
    >
      {/* ── Post header : avatar ring + feed name + time ─────────────────── */}
      <div className={styles.postHeader}>
        <span className={styles.avatarRing}>
          {showFeedFavicon && !avatarError ? (
            <img
              src={article.feed_favicon!}
              className={styles.avatar}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setAvatarError(true)}
            />
          ) : (
            <span className={styles.avatarFallback}>{(feed_title ?? '?').charAt(0).toUpperCase()}</span>
          )}
        </span>
        <div className={styles.headerMeta}>
          <span className={styles.feedName}>{feed_title ?? 'Unknown Feed'}</span>
          {published_at && (
            <span className={styles.time}>{formatRelativeTime(published_at)}</span>
          )}
        </div>
        {/* Unread indicator dot */}
        {!is_read && <span className={styles.unreadDot} aria-label="Unread" />}
      </div>

      {/* ── Media : large Instagram-style image ──────────────────────────── */}
      {thumbnail_url && !thumbError && !isCompact && (
        <div className={styles.mediaWrapper}>
          <img
            src={thumbnail_url}
            alt=""
            className={styles.media}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setThumbError(true)}
          />
        </div>
      )}

      {/* ── Text body ────────────────────────────────────────────────────── */}
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
    </button>
  )
})
