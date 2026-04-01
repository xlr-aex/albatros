/**
 * @file components/layout/ArticleReader.tsx
 * @description Right panel — full article reader with sanitised HTML rendering.
 * DOMPurify is used for XSS prevention before injecting any article HTML.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { useArticleStore } from '../../store/articleStore'
import styles from './ArticleReader.module.css'
import { formatDate, readingTime, unescapeHtml } from '../../utils/format'
import { HighlightText } from './HighlightText'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CommentNode = ({ comment, depth = 0 }: { comment: any, depth?: number }) => {
  return (
    <div style={{ 
      marginTop: depth === 0 ? '1rem' : '0.25rem',
      paddingLeft: depth === 0 ? 0 : '1rem',
      borderLeft: depth === 0 ? 'none' : '2px solid var(--border-subtle)'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85em', color: 'var(--text-muted)' }}>
          <strong style={{ color: comment.is_submitter ? 'var(--accent-color)' : 'var(--text-normal)' }}>
            {comment.author || '[deleted]'}
          </strong>
          {comment.is_submitter && (
            <span style={{ fontSize: '0.7em', fontWeight: 'bold', background: 'var(--accent-color)', color: '#fff', padding: '0 4px', borderRadius: '4px' }}>OP</span>
          )}
          <span>{comment.score} pts</span>
          <span>·</span>
          <time>{comment.published_at ? formatDate(comment.published_at) : ''}</time>
        </div>
        <div 
          className="article-body" 
          style={{ fontSize: '0.95em', margin: 0, paddingBottom: '0.5rem' }}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(comment.content_html || '', { FORCE_BODY: true }) }} 
        />
      </div>
      
      {comment.replies && comment.replies.length > 0 && (
        <div className="comment-replies" style={{ display: 'flex', flexDirection: 'column', marginTop: '0.25rem' }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {comment.replies.map((r: any) => <CommentNode key={r.id} comment={r} depth={depth + 1} />)}
        </div>
      )}
    </div>
  )
}

/** Physically isolates the HTML DOM string from React Virtual DOM engine reconciliations. */
const ArticleContentNode = React.memo(({ htmlToRender }: { htmlToRender: string }) => {
  if (!htmlToRender) return null
  return <div key="main-reader-content" className="article-body article-reader--content" dangerouslySetInnerHTML={{ __html: htmlToRender }} />
})

/** Physically isolates the legacy youtube iframe string from React Virtual DOM engine reconciliations. */
const RetroPlayerNode = React.memo(({ 
  ytVideoId, 
  hasNewPlayer, 
  isActive 
}: { 
  ytVideoId: string | null; 
  hasNewPlayer: boolean; 
  isActive: boolean; 
}) => {
  if (!ytVideoId || hasNewPlayer) return null
  const html = isActive
    ? `<iframe width="100%" height="100%" src="https://www.youtube-nocookie.com/embed/${ytVideoId}?autoplay=1&dnt=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="aspect-ratio: 16/9; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); background: #000;"></iframe>`
    : `<a href="https://www.youtube.com/watch?v=${ytVideoId}" target="_blank" rel="noopener noreferrer" class="youtube-player-preview"><img src="https://i.ytimg.com/vi/${ytVideoId}/maxresdefault.jpg" onerror="this.src='https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg'" alt="YouTube Video" /><div class="youtube-player-overlay"><div class="youtube-play-button"><svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div><div class="youtube-pill">YouTube</div></div></a>`
  
  return <div key="retro-player" className="youtube-player-container" dangerouslySetInnerHTML={{ __html: html }} />
})

export function ArticleReader() {
  const { selectedArticle, isLoadingArticle, updateArticleFlag, currentSearchQuery } = useArticleStore()
  const contentRef = useRef<HTMLDivElement>(null)
  const [linkPopup, setLinkPopup] = useState<{ url: string; x: number; y: number } | null>(null)
  const [embeddedUrl, setEmbeddedUrl] = useState<string | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [liveComments, setLiveComments] = useState<any[]>([])
  const [isLoadingComments, setIsLoadingComments] = useState(false)
  const [activeYtVideos, setActiveYtVideos] = useState<string[]>([])
  const [redditSelftext, setRedditSelftext] = useState<string | null>(null)
  const frozenContentHtmlRef = useRef<string | null>(null)

  // Scroll to top whenever a new article is opened
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
    setEmbeddedUrl(null)
    setLinkPopup(null)
    setLiveComments([])
    setActiveYtVideos([])
    setRedditSelftext(null)
    frozenContentHtmlRef.current = null

    if (selectedArticle?.url && selectedArticle.url.includes('reddit.com')) {
      setIsLoadingComments(true)
      window.api.articles.getRedditComments(selectedArticle.url)
        .then((res: any) => {
          setLiveComments(res.comments || res)
          if (res.selftextHtml) setRedditSelftext(res.selftextHtml)
        })
        .catch(console.error)
        .finally(() => setIsLoadingComments(false))
    }
  }, [selectedArticle?.id, selectedArticle?.url])

  // Intercept all link clicks in article body
  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a')
    if (!target) return
    const href = target.getAttribute('href')
    if (!href || href.startsWith('#')) return

    e.preventDefault()
    e.stopPropagation()

    // Facade pattern: swap YouTube preview with a radical ad-free iframe embed
    if (target.classList.contains('youtube-player-preview')) {
      const ytVideoIdMatch = href.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$)/)
      const ytVideoId = ytVideoIdMatch ? ytVideoIdMatch[1] : null
      
      if (ytVideoId) {
        // Defer to React state so the iframe survives sync re-renders perfectly
        setActiveYtVideos(prev => Array.from(new Set([...prev, ytVideoId])))
        return
      }
    }

    // Position popup near the click for standard links
    setLinkPopup({ url: href, x: e.clientX, y: e.clientY })
  }, [])

  function openInBrowser(url: string) {
    window.open(url, '_blank')
    setLinkPopup(null)
  }

  function openInApp(url: string) {
    setEmbeddedUrl(url)
    setLinkPopup(null)
  }

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop
    setIsScrolled(top > 20)
  }, [])

  // Sanitise HTML content
  const safeHtml = selectedArticle?.content_html
    ? DOMPurify.sanitize(selectedArticle.content_html, {
        ALLOWED_TAGS: [
          'p','br','strong','em','b','i','u','s','del','ins',
          'h1','h2','h3','h4','h5','h6',
          'ul','ol','li','dl','dt','dd',
          'a','img','figure','figcaption',
          'blockquote','cite','pre','code','samp','kbd',
          'table','thead','tbody','tr','th','td',
          'div','span','section','article','aside',
          'mark','abbr','time','sup','sub',
          'iframe', 'svg', 'path'
        ],
        ALLOWED_ATTR: ['href','src','alt','title','class','id','target','rel','width','height','datetime','allowfullscreen','allow','frameborder','style', 'viewBox', 'fill', 'd'],
        FORCE_BODY: true,
      })
    : null

  const highlightedHtml = React.useMemo(() => {
    if (!safeHtml || !currentSearchQuery) return safeHtml
    
    const q = currentSearchQuery.trim()
    if (!q) return safeHtml
    
    const exact = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const words = q.split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    
    // Sort words by length descending so longer words match first, preventing subset splitting
    const allMatches = [exact, ...words].sort((a, b) => b.length - a.length)
    const pattern = `(${allMatches.join('|')})`
    
    // Safe lookup ensuring we do not highlight text strictly inside HTML tag properties
    const regex = new RegExp(`(?![^<]*>)${pattern}`, 'gi')
    
    return safeHtml.replace(regex, '<mark style="background: color-mix(in srgb, var(--brand-500), transparent 70%); color: var(--brand-400); font-weight: bold; border-radius: 2px; padding: 0 2px;">$1</mark>')
  }, [safeHtml, currentSearchQuery])

  if (isLoadingArticle && !selectedArticle) {
    return <div className={styles.empty}><span className="spinner" role="status" aria-label="Loading article" style={{ width: '1.25rem', height: '1.25rem' }} /></div>
  }

  if (!selectedArticle) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>📖</span>
        <p>Select an article to read</p>
      </div>
    )
  }

  const { id, title, author, published_at, url, feed_title, word_count, is_saved } = selectedArticle
  const readMin = word_count ? readingTime(word_count) : null


  async function toggleSave() {
    const next = !is_saved
    updateArticleFlag(id, 'is_saved', next)
    await window.api.articles.mark(id, 'saved', next)
  }

  return (
    <div className={styles.reader} style={{ position: 'relative' }}>
      {/* ── Embedded browser overlay ──────────────────────── */}
      {embeddedUrl && (
        <div className={styles.embeddedBrowser}>
          <div className={styles.embeddedHeader}>
            <button
              className={styles.embeddedClose}
              onClick={() => setEmbeddedUrl(null)}
              title="Close embedded view"
              aria-label="Close embedded view"
            >
              ← Back
            </button>
            <span className={styles.embeddedUrl}>{embeddedUrl}</span>
            <button
              className={styles.embeddedClose}
              onClick={() => openInBrowser(embeddedUrl)}
              title="Open in system browser"
            >
              ↗ Browser
            </button>
          </div>
          <webview
            className={styles.embeddedFrame}
            src={embeddedUrl}
            style={{ flex: 1, width: '100%', border: 'none' }}
          />
        </div>
      )}

      {!embeddedUrl && (
        <div 
          ref={contentRef} 
          className={styles.content} 
          onClick={handleContentClick}
          onScroll={handleScroll}
        >
          <div className={styles.contentWrapper}>
            {/* ── Header Information (Scrolls Away) ─────────── */}
            <header className={styles.header}>
              <div className={styles.meta}>
                <span className={styles.feedName}>{feed_title}</span>
                <span className={styles.dot}>·</span>
                <time className={styles.date} dateTime={published_at ? new Date(published_at * 1000).toISOString() : undefined}>
                  {published_at ? formatDate(published_at) : 'Unknown date'}
                </time>
                {readMin && (
                  <>
                    <span className={styles.dot}>·</span>
                    <span className={styles.readTime}>{readMin} min read</span>
                  </>
                )}
              </div>

              <h1 className={styles.title}>
                {title ? (
                  currentSearchQuery 
                    ? <HighlightText text={unescapeHtml(title)} highlight={currentSearchQuery} /> 
                    : unescapeHtml(title)
                ) : 'Untitled'}
              </h1>

              {author && <p className={styles.author}>by {author}</p>}
            </header>

            {/* ── Sticky Action Bar (Fixed at Top) ───────────── */}
            <div className={`${styles.stickyActions} ${isScrolled ? styles.stickyActionsScrolled : ''}`}>
              <div className={styles.actions}>
                <button
                  className={`${styles.actionBtn} ${is_saved ? styles.saved : ''}`}
                  onClick={toggleSave}
                  title={is_saved ? 'Remove from Saved' : 'Save Post'}
                >
                  <svg 
                    width="14" 
                    height="14" 
                    viewBox="0 0 24 24" 
                    fill={is_saved ? 'currentColor' : 'none'} 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    style={{ marginRight: '6px' }}
                  >
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                  </svg>
                  {is_saved ? 'Saved' : 'Save'}
                </button>
                {url && (
                  <>
                    <button className={styles.actionBtn} onClick={() => openInBrowser(url)} title="Open in browser">
                      ↗ Browser
                    </button>
                    <button className={styles.actionBtn} onClick={() => openInApp(url)} title="Open in app">
                      ⧉ Embed
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className={styles.divider} style={{ marginBottom: 'var(--space-6)' }} />
            
            {/* ── Article Content ──────────────────────────── */}
            {(() => {
              if (!selectedArticle) return null

              let baseHtml = highlightedHtml || selectedArticle.content_html || ''
              
              // Retroactive fix for cached YouTube articles 
              // Strips out the old red '▶' widget to remove the "useless triangle"
              baseHtml = baseHtml.replace(/<div class="youtube-thumbnail-wrapper"[\s\S]*?<\/div>\s*<\/a>\s*<\/div>/g, '')

              // Lock the HTML string in place if the user is currently watching a video.
              if (activeYtVideos.length > 0) {
                if (frozenContentHtmlRef.current === null) {
                  frozenContentHtmlRef.current = baseHtml
                }
                baseHtml = frozenContentHtmlRef.current
              } else {
                frozenContentHtmlRef.current = null
              }

              let htmlToRender = baseHtml

              // Dynamically replace active youtube previews with iframes in the locked HTML string.
              activeYtVideos.forEach(vid => {
                const regex = new RegExp(`<a href="[^"]*${vid}"[^>]*class="youtube-player-preview"[^>]*>[\\s\\S]*?</a>`, 'gi')
                htmlToRender = htmlToRender.replace(
                  regex,
                  `<iframe width="100%" height="100%" src="https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&dnt=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="aspect-ratio: 16/9; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); background: #000;"></iframe>`
                )
              })

              const ytVideoIdMatch = selectedArticle.url?.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$)/)
              const ytVideoId = ytVideoIdMatch ? ytVideoIdMatch[1] : null
              const hasNewPlayer = htmlToRender.includes('youtube-player-container')

              // Prevent duplicate Reddit self-text rendering
              let showRedditSelftext = !!redditSelftext
              if (redditSelftext && selectedArticle?.content_html) {
                const strippedBase = (selectedArticle.content_html || '').replace(/<[^>]+>/g, '').trim()
                const strippedReddit = redditSelftext.replace(/<[^>]+>/g, '').trim()
                if (strippedReddit.length > 50 && strippedBase.includes(strippedReddit.substring(0, 50))) {
                  showRedditSelftext = false
                } else if (strippedBase.length > strippedReddit.length * 0.8 && strippedBase.includes(strippedReddit.substring(0, 20))) {
                  showRedditSelftext = false
                }
              }

              if (isLoadingArticle && !htmlToRender) {
                return (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
                    <span className="spinner" role="status" aria-label="Loading content" style={{ width: '1.5rem', height: '1.5rem', opacity: 0.5 }} />
                  </div>
                )
              }

              return (
                <>
                  {showRedditSelftext && (
                  <div 
                    key="reddit-selftext"
                    className="reddit-selftext" 
                    style={{ marginBottom: 24, padding: 16, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', fontSize: 15, lineHeight: 1.6, border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', wordBreak: 'break-word' }}
                    dangerouslySetInnerHTML={{ __html: redditSelftext! }} 
                  />
                )}

                <ArticleContentNode htmlToRender={htmlToRender} />

                <RetroPlayerNode 
                  ytVideoId={ytVideoId} 
                  hasNewPlayer={hasNewPlayer} 
                  isActive={ytVideoId ? activeYtVideos.includes(ytVideoId) : false} 
                />

                {!htmlToRender && (
                  <p key="no-content-message" className={styles.noContent}>
                    No content available.{' '}
                    {selectedArticle.url && <a href={selectedArticle.url} onClick={e => { e.preventDefault(); openInBrowser(selectedArticle.url!) }}>Read on the web ↗</a>}
                  </p>
                )}
              </>
            )
          })()}

          {/* ── Nested Comments ──────────────────────────── */}
          {selectedArticle?.url?.includes('reddit.com') && (
            <div className="comments-section" style={{ marginTop: '3rem' }}>
              <div className={styles.divider} style={{ marginBottom: '1.5rem' }} />
              <h3 style={{ marginBottom: '1.5rem', color: 'var(--text-normal)', fontSize: '1.1em', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                💬 Discussion
                {isLoadingComments && <span className={styles.loader} style={{ fontSize: '0.8em', width: 14, height: 14 }}>⟳</span>}
                {!isLoadingComments && <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>({liveComments.length})</span>}
              </h3>

              {!isLoadingComments && liveComments.length > 0 && (
                <div style={{ background: 'var(--bg-elevated)', borderRadius: '8px', padding: '0.5rem 1.5rem 1.5rem', border: '1px solid var(--border-subtle)' }}>
                  {liveComments.map(comment => (
                    <CommentNode key={comment.id} comment={comment} />
                  ))}
                </div>
              )}

              {!isLoadingComments && liveComments.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.9em' }}>No comments found.</p>
              )}
            </div>
          )}
          </div> {/* end contentWrapper */}
        </div>
      )}

      {/* ── Link popup ──────────────────────────────────────── */}
      {linkPopup && (
        <>
          <div className={styles.linkPopupOverlay} onClick={() => setLinkPopup(null)} />
          <div
            className={styles.linkPopup}
            role="dialog"
            aria-label="Link options"
            style={{ top: linkPopup.y, left: linkPopup.x }}
            onKeyDown={e => { if (e.key === 'Escape') setLinkPopup(null) }}
          >
            <button
              className={`${styles.linkPopupBtn} ${styles.linkPopupBrowser}`}
              onClick={() => openInBrowser(linkPopup.url)}
              aria-label="Open in system browser"
            >
              ↗ Browser
            </button>
            <button
              className={`${styles.linkPopupBtn} ${styles.linkPopupEmbed}`}
              onClick={() => openInApp(linkPopup.url)}
              aria-label="Open link in embedded view"
            >
              ⧉ In App
            </button>
          </div>
        </>
      )}
    </div>
  )
}
