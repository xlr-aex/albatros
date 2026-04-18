/**
 * @file components/layout/ArticleReader.tsx
 * @description Right panel — full article reader with sanitised HTML rendering.
 * DOMPurify is used for XSS prevention before injecting any article HTML.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { useArticleStore } from '../../store/articleStore'
import styles from './ArticleReader.module.css'
import { formatDate, unescapeHtml } from '../../utils/format'
import { HighlightText } from './HighlightText'

interface RedditComment {
  id: number | string
  author: string
  is_submitter?: boolean
  score?: number
  published_at?: number
  content_html?: string
  replies?: RedditComment[]
}

const CommentNode = ({ comment, depth = 0 }: { comment: RedditComment; depth?: number }) => {
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
          <span>{comment.score ?? 0} pts</span>
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
          {comment.replies.map((r: RedditComment) => <CommentNode key={r.id} comment={r} depth={depth + 1} />)}
        </div>
      )}
    </div>
  )
}

const ArticleContentNode = React.memo(({ htmlToRender }: { htmlToRender: string }) => {
  if (!htmlToRender) return null
  return <div key="main-reader-content" className="article-body article-reader--content" dangerouslySetInnerHTML={{ __html: htmlToRender }} />
})

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
  
  if (isActive) {
    return (
      <div className="youtube-player-container">
        <iframe 
          width="100%" 
          height="100%" 
          src={`https://www.youtube.com/embed/${ytVideoId}?autoplay=1&dnt=1&origin=http://localhost:5173`} 
          frameBorder="0" 
          referrerPolicy="strict-origin-when-cross-origin" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
          allowFullScreen 
          style={{ aspectRatio: '16/9', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', background: '#000' }}
        />
      </div>
    )
  }

  return (
    <div className="youtube-player-container">
      <a 
        href={`https://www.youtube.com/watch?v=${ytVideoId}`} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="youtube-player-preview"
      >
        <img 
          src={`https://i.ytimg.com/vi/${ytVideoId}/maxresdefault.jpg`} 
          onError={e => { (e.currentTarget as HTMLImageElement).src = `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg` }} 
          alt="YouTube Video" 
        />
        <div className="youtube-player-overlay">
          <div className="youtube-play-button">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
          <div className="youtube-pill">YouTube</div>
        </div>
      </a>
    </div>
  )
})

type WebviewLoadingEvent = Event & {
  errorCode?: number
  errorDescription?: string
}

type HTMLWebViewElement = HTMLElement & {
  addEventListener(event: string, listener: (e: WebviewLoadingEvent) => void): void
  removeEventListener(event: string, listener: (e: WebviewLoadingEvent) => void): void
}

export function ArticleReader() {
  const { selectedArticle, isLoadingArticle, updateArticleFlag, currentSearchQuery } = useArticleStore()
  const contentRef = useRef<HTMLDivElement>(null)
  const [linkPopup, setLinkPopup] = useState<{ url: string; x: number; y: number } | null>(null)
  const [embeddedUrl, setEmbeddedUrl] = useState<string | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const webviewRef = useRef<HTMLWebViewElement>(null)
  const [isWebviewLoading, setIsWebviewLoading] = useState(false)
  const [webviewError, setWebviewError] = useState<string | null>(null)
  
  const [liveComments, setLiveComments] = useState<RedditComment[]>([])
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
        .then((res: { comments: RedditComment[], selftextHtml?: string }) => {
          setLiveComments(res.comments || (res as Record<string, unknown>))
          if (res.selftextHtml) setRedditSelftext(res.selftextHtml)
        })
        .catch(console.error)
        .finally(() => setIsLoadingComments(false))
    }
  }, [selectedArticle?.id, selectedArticle?.url])

  // Track webview load state
  useEffect(() => {
    if (!embeddedUrl) return

    setIsWebviewLoading(true)
    setWebviewError(null)

    const wv = webviewRef.current
    if (!wv) return

    const onStart = () => { setIsWebviewLoading(true); setWebviewError(null) }
    const onStop  = () => setIsWebviewLoading(false)
    const onFail  = (e: WebviewLoadingEvent) => {
      if (e.errorCode === -3) return // ERR_ABORTED — normal for redirects
      setIsWebviewLoading(false)
      setWebviewError(`Could not load page (${e.errorDescription || 'unknown error'})`)
    }

    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading',  onStop)
    wv.addEventListener('did-fail-load',     onFail)

    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading',  onStop)
      wv.removeEventListener('did-fail-load',     onFail)
    }
  }, [embeddedUrl])

  // Intercept all link clicks in article body
  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a')
    if (!target) return
    const href = target.getAttribute('href')
    if (!href || href.startsWith('#')) return

    e.preventDefault()
    e.stopPropagation()

    // YouTube preview click: swap to inline iframe player within the article
    if (target.classList.contains('youtube-player-preview')) {
      const ytVideoIdMatch = href.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$)/)
      const ytVideoId = ytVideoIdMatch ? ytVideoIdMatch[1] : null
      
      if (ytVideoId) {
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
    const targetUrl = /reddit\.com/i.test(url)
      ? url.replace(/https?:\/\/(?:www\.|new\.|np\.)?reddit\.com/i, 'https://old.reddit.com')
      : url
    setEmbeddedUrl(targetUrl)
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

  // Safely inject highlight tags only into text nodes
  const highlightedHtml = React.useMemo(() => {
    if (!safeHtml || !currentSearchQuery) return safeHtml
    
    const q = currentSearchQuery.trim()
    if (!q) return safeHtml
    
    const words = q.split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const allMatches = [q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ...words].sort((a, b) => b.length - a.length)
    const regex = new RegExp(`(${allMatches.join('|')})`, 'gi')
    
    const doc = new DOMParser().parseFromString(safeHtml, 'text/html')
    const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null)
    
    const nodesToReplace: Text[] = []
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (node.nodeValue && regex.test(node.nodeValue)) {
        nodesToReplace.push(node as Text)
      }
    }
    
    for (const textNode of nodesToReplace) {
      if (!textNode.nodeValue) continue
      const frag = document.createDocumentFragment()
      const parts = textNode.nodeValue.split(regex)
      for (const part of parts) {
        if (regex.test(part)) {
          const mark = document.createElement('mark')
          mark.style.cssText = 'background: yellow; color: #000; font-weight: 600; border-radius: 2px; padding: 0 2px;'
          mark.textContent = part 
          frag.appendChild(mark)
        } else if (part) {
          frag.appendChild(document.createTextNode(part))
        }
      }
      textNode.parentNode?.replaceChild(frag, textNode)
    }
    
    return doc.body.innerHTML
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

  const { id, title, author, published_at, url, feed_title, feed_favicon, is_saved } = selectedArticle

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

          <div className={styles.embeddedBody}>
            {isWebviewLoading && (
              <div className={styles.embeddedLoading}>
                <div className={styles.embeddedProgressBar}>
                  <div className={styles.embeddedProgressBarFill} />
                </div>
                <span className={styles.embeddedLoadingUrlHint}>{embeddedUrl}</span>
              </div>
            )}

            {webviewError ? (
              <div className={styles.embeddedErrorState}>
                <span style={{ fontSize: '2rem' }}>🚫</span>
                <p style={{ margin: 0, maxWidth: 280, textAlign: 'center' }}>{webviewError}</p>
                <button
                  className={styles.embeddedClose}
                  style={{ cursor: 'pointer' }}
                  onClick={() => openInBrowser(embeddedUrl)}
                >
                  ↗ Open in browser instead
                </button>
              </div>
            ) : (
              <webview
                // @ts-expect-error - Webview tag is valid in Electron react but dom bindings may lack it
                ref={webviewRef}
                className={styles.embeddedFrame}
                src={embeddedUrl}
                partition="persist:adblock"
                useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                style={{
                  flex: 1,
                  width: '100%',
                  border: 'none',
                  opacity: isWebviewLoading ? 0 : 1,
                  transition: 'opacity 0.3s ease',
                }}
              />
            )}
          </div>
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
            {/* ── Header Information ─────────── */}
            <header className={styles.header}>
              <div className={styles.meta}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  {feed_favicon && (
                    <img 
                      src={feed_favicon} 
                      className={styles.feedFavicon} 
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <span className={styles.feedName}>{feed_title}</span>
                </div>
                <span className={styles.dot}>·</span>
                <time className={styles.date} dateTime={published_at ? new Date(published_at * 1000).toISOString() : undefined}>
                  {published_at ? formatDate(published_at) : 'Unknown date'}
                </time>
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

            {/* ── Sticky Action Bar ───────────── */}
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

            <div className={styles.divider} style={{ marginBottom: 'var(--space-4)' }} />

            {/* ── Article Content ──────────────────────────── */}
            {(() => {
              if (!selectedArticle) return null

              let baseHtml = highlightedHtml || selectedArticle.content_html || ''
              baseHtml = baseHtml.replace(/<div class="youtube-thumbnail-wrapper"[\s\S]*?<\/div>\s*<\/a>\s*<\/div>/g, '')

              if (activeYtVideos.length > 0) {
                if (frozenContentHtmlRef.current === null) {
                  frozenContentHtmlRef.current = baseHtml
                }
                baseHtml = frozenContentHtmlRef.current
              } else {
                frozenContentHtmlRef.current = null
              }

              let htmlToRender = baseHtml

              // Safely swap active yt videos using DOMParser
              if (activeYtVideos.length > 0 && htmlToRender) {
                 const doc = new DOMParser().parseFromString(htmlToRender, 'text/html')
                 activeYtVideos.forEach(vid => {
                    const links = doc.querySelectorAll('a.youtube-player-preview')
                    links.forEach(link => {
                       const href = link.getAttribute('href')
                       if (href && href.includes(vid)) {
                          const iframe = document.createElement('iframe')
                          iframe.width = '100%'
                          iframe.height = '100%'
                          iframe.src = `https://www.youtube.com/embed/${vid}?autoplay=1&dnt=1&origin=http://localhost:5173`
                          iframe.setAttribute('frameborder', '0')
                          iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
                          iframe.allowFullscreen = true
                          iframe.style.cssText = 'aspect-ratio: 16/9; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); background: #000;'
                          link.replaceWith(iframe)
                       }
                    })
                 })
                 htmlToRender = doc.body.innerHTML
              }

              const ytVideoIdMatch = selectedArticle.url?.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$)/)
              const ytVideoId = ytVideoIdMatch ? ytVideoIdMatch[1] : null
              const hasNewPlayer = htmlToRender.includes('youtube-player-container')

              // ── Robust Reddit content deduplication ────────────────────────
              const normalize = (s: string) =>
                s.replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

              let showRedditSelftext = false
              let useSelftextAsMain = false

              if (redditSelftext) {
                const normReddit = normalize(redditSelftext)
                const normBase = normalize(selectedArticle?.content_html || '')

                if (normReddit.length < 10) {
                  showRedditSelftext = false
                } else if (normBase.length < 30) {
                  useSelftextAsMain = true
                } else {
                  const shorter = normReddit.length < normBase.length ? normReddit : normBase
                  const longer = normReddit.length < normBase.length ? normBase : normReddit
                  const probe = shorter.substring(0, Math.min(40, shorter.length))

                  if (longer.includes(probe)) {
                    if (normReddit.length > normBase.length * 0.8) {
                      useSelftextAsMain = true
                    }
                  } else {
                    showRedditSelftext = true
                  }
                }
              }

              if (useSelftextAsMain) {
                htmlToRender = DOMPurify.sanitize(redditSelftext!, { FORCE_BODY: true })
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
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(redditSelftext!, { FORCE_BODY: true }) }} 
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
            style={{
               top: Math.max(0, Math.min(linkPopup.y, window.innerHeight - 100)),
               left: Math.max(0, Math.min(linkPopup.x, window.innerWidth - 160)),
            }}
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
