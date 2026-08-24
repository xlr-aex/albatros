/**
 * @file components/layout/ArticleReader.tsx
 * @description Right panel — full article reader with sanitised HTML rendering.
 * DOMPurify is used for XSS prevention before injecting any article HTML.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import DOMPurify from 'dompurify'
import type HlsType from 'hls.js'
import { useArticleStore } from '../../store/articleStore'
import styles from './ArticleReader.module.css'
import { formatDate, unescapeHtml } from '../../utils/format'
import { HighlightText } from './HighlightText'
import { normalizeArticleHtml } from '../../utils/articleHtml'

const cleanUserAgent = typeof window !== 'undefined'
  ? window.navigator.userAgent
      .replace(/\s+albatros\/\S+/i, '')
      .replace(/\s+electron\/\S+/i, '')
  : ''

interface RedditComment {
  id: number | string
  author: string
  is_submitter?: boolean
  score?: number
  published_at?: number
  content_html?: string
  replies?: RedditComment[]
}

interface RedditVideoInfo {
  fallbackUrl: string | null
  hlsUrl: string | null
  poster: string | null
  width?: number
  height?: number
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

const RedditVideoNode = React.memo(({
  video,
  fallbackPoster,
  postUrl,
  playerUrl,
  onReady,
}: {
  video: RedditVideoInfo | null
  fallbackPoster?: string | null
  postUrl?: string | null
  playerUrl: string | null
  onReady?: () => void
}) => {
  const [hasFailed, setHasFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const poster = video?.poster || fallbackPoster || undefined
  const playerAssetId = playerUrl?.match(/\/video\/([^/]+)\/player/i)?.[1]
  const hlsUrl = video?.hlsUrl
    || (playerAssetId ? `https://v.redd.it/${encodeURIComponent(playerAssetId)}/HLSPlaylist.m3u8` : null)
  const mp4Url = video?.fallbackUrl || null

  useEffect(() => {
    setHasFailed(false)
    const element = videoRef.current
    if (!element) return

    let hls: HlsType | null = null
    let cancelled = false
    let usingMp4Fallback = false
    const loadMp4Fallback = () => {
      if (!mp4Url || usingMp4Fallback) {
        setHasFailed(true)
        return
      }
      usingMp4Fallback = true
      hls?.destroy()
      hls = null
      element.src = mp4Url
      element.load()
    }

    const loadVideo = async () => {
      if (hlsUrl && element.canPlayType('application/vnd.apple.mpegurl')) {
        element.src = hlsUrl
        return
      }
      if (hlsUrl) {
        const { default: Hls } = await import('hls.js')
        if (cancelled) return
        if (Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
          })
          hls.loadSource(hlsUrl)
          hls.attachMedia(element)
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) loadMp4Fallback()
          })
          return
        }
      }
      if (mp4Url) element.src = mp4Url
      else setHasFailed(true)
    }
    void loadVideo()

    return () => {
      cancelled = true
      hls?.destroy()
      element.removeAttribute('src')
      element.load()
    }
  }, [hlsUrl, mp4Url, postUrl])

  if (!playerUrl && !video) return null

  if ((!hlsUrl && !mp4Url) || hasFailed) {
    return (
      <button
        type="button"
        className="reddit-video-fallback"
        onClick={() => postUrl && window.open(postUrl, '_blank')}
        style={poster ? { backgroundImage: `url(${JSON.stringify(poster).slice(1, -1)})` } : undefined}
        aria-label="Open Reddit video in browser"
      >
        <span className="reddit-video-play" aria-hidden="true">▶</span>
        <span>Open video on Reddit</span>
      </button>
    )
  }

  return (
    <div
      className="reddit-video-container"
      style={video?.width && video?.height ? { aspectRatio: `${video.width} / ${video.height}` } : undefined}
    >
      <video
        ref={videoRef}
        className="reddit-video-element"
        controls
        playsInline
        preload="metadata"
        poster={poster}
        onLoadedData={onReady}
        onError={() => { if (!hlsUrl) setHasFailed(true) }}
      />
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
  const [redditVideo, setRedditVideo] = useState<RedditVideoInfo | null>(null)
  const [redditVideoReady, setRedditVideoReady] = useState(false)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const frozenContentHtmlRef = useRef<string | null>(null)

  const [redditJsonUrl, setRedditJsonUrl] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hiddenWebviewRef = useRef<any>(null)
  /** Article the hidden webview was started for — stale results are discarded. */
  const hiddenWebviewArticleIdRef = useRef<number | null>(null)

  const handleHiddenWebviewDomReady = useCallback(async () => {
    const webview = hiddenWebviewRef.current
    const expectedId = hiddenWebviewArticleIdRef.current
    if (!webview) return
    try {
      const text = await webview.executeJavaScript('document.body.innerText')
      // The user may have switched articles while the page was loading
      if (expectedId === null || hiddenWebviewArticleIdRef.current !== expectedId) return
      const json = JSON.parse(text)
      
      const commentsData = json[1]?.data?.children || []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parseComment = (child: any): any => {
        if (child.kind === 't1' && child.data && child.data.body) {
          let html = child.data.body_html || ''
          html = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const replies: any[] = []
          if (child.data.replies && child.data.replies.data && child.data.replies.data.children) {
            for (const replyNode of child.data.replies.data.children) {
              const reply = parseComment(replyNode)
              if (reply) replies.push(reply)
            }
          }

          return {
            id: child.data.id,
            author: child.data.author,
            content_html: html || child.data.body,
            published_at: child.data.created_utc,
            score: child.data.score || 0,
            is_submitter: child.data.is_submitter || false,
            replies,
          }
        }
        return null
      }

      const comments = commentsData.map(parseComment).filter(Boolean)

      let selftextHtml = null
      const postData = json[0]?.data?.children?.[0]?.data
      if (postData && postData.selftext_html) {
        selftextHtml = postData.selftext_html
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      }

      const mediaPost = [postData, ...(postData?.crosspost_parent_list || [])]
        .find(post => post?.secure_media?.reddit_video || post?.media?.reddit_video)
      const videoData = mediaPost?.secure_media?.reddit_video || mediaPost?.media?.reddit_video
      const decodeUrl = (value: unknown): string | null =>
        typeof value === 'string' ? value.replace(/&amp;/g, '&') : null

      if (videoData) {
        setRedditVideo({
          fallbackUrl: decodeUrl(videoData.fallback_url),
          hlsUrl: decodeUrl(videoData.hls_url),
          poster: decodeUrl(
            mediaPost?.preview?.images?.[0]?.source?.url
            || postData?.preview?.images?.[0]?.source?.url,
          ),
          width: typeof videoData.width === 'number' ? videoData.width : undefined,
          height: typeof videoData.height === 'number' ? videoData.height : undefined,
        })
      }

      // Re-validate before committing state — the article may have changed during parse
      if (hiddenWebviewArticleIdRef.current !== expectedId) return

      setLiveComments(comments)
      if (selftextHtml) setRedditSelftext(selftextHtml)
    } catch (err) {
      console.warn('Failed to parse Reddit comments from hidden webview:', err)
    } finally {
      if (hiddenWebviewArticleIdRef.current === expectedId) {
        setIsLoadingComments(false)
        setRedditJsonUrl(null)
      }
    }
  }, [])

  useEffect(() => {
    const webview = hiddenWebviewRef.current
    if (!webview) return

    const onDomReady = () => {
      handleHiddenWebviewDomReady()
    }
    webview.addEventListener('dom-ready', onDomReady)
    return () => {
      webview.removeEventListener('dom-ready', onDomReady)
    }
  }, [redditJsonUrl, handleHiddenWebviewDomReady])

  // Scroll to top whenever a new article is opened
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
    setEmbeddedUrl(null)
    setLinkPopup(null)
    setLiveComments([])
    setActiveYtVideos([])
    setRedditSelftext(null)
    setRedditVideo(null)
    setRedditVideoReady(false)
    setLightbox(null)
    frozenContentHtmlRef.current = null

    if (selectedArticle?.url && selectedArticle.url.includes('reddit.com')) {
      setIsLoadingComments(true)
      hiddenWebviewArticleIdRef.current = selectedArticle.id
      const cleanUrl = selectedArticle.url.replace(/\/$/, '') + '/.json'
      setRedditJsonUrl(cleanUrl)
    } else {
      hiddenWebviewArticleIdRef.current = null
      setRedditJsonUrl(null)
      setIsLoadingComments(false)
    }
  }, [selectedArticle?.id, selectedArticle?.url])

  // Safety net: if the hidden webview never fires dom-ready (network error,
  // blocked request…), stop the comments spinner instead of spinning forever.
  useEffect(() => {
    if (!redditJsonUrl || !isLoadingComments) return
    const timeout = window.setTimeout(() => {
      if (hiddenWebviewArticleIdRef.current !== null) {
        hiddenWebviewArticleIdRef.current = null
        setIsLoadingComments(false)
        setRedditJsonUrl(null)
      }
    }, 20_000)
    return () => window.clearTimeout(timeout)
  }, [redditJsonUrl, isLoadingComments])

  // Track webview load state
  useEffect(() => {
    if (!embeddedUrl) return

    setIsWebviewLoading(true)
    setWebviewError(null)

    const wv = webviewRef.current
    if (!wv) return

    const onStart = () => {
      window.api.debug.log(`[Webview Status] Start Loading: ${embeddedUrl}`)
      setIsWebviewLoading(true)
      setWebviewError(null)
    }
    const onStop  = () => {
      window.api.debug.log('[Webview Status] Stop Loading')
      setIsWebviewLoading(false)
    }
    const onFail  = (e: WebviewLoadingEvent) => {
      if (e.errorCode === -3) return // ERR_ABORTED — normal for redirects
      window.api.debug.log(`[Webview Status] Failed to load: ${e.errorDescription} (code ${e.errorCode})`)
      setIsWebviewLoading(false)
      setWebviewError(`Could not load page (${e.errorDescription || 'unknown error'})`)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onConsole = (e: any) => {
      window.api.debug.log(`[Webview Content] [Level ${e.level}] ${e.message} (${e.sourceId}:${e.line})`)
    }

    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading',  onStop)
    wv.addEventListener('did-fail-load',     onFail)
    wv.addEventListener('console-message',   onConsole)

    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading',  onStop)
      wv.removeEventListener('did-fail-load',     onFail)
      wv.removeEventListener('console-message',   onConsole)
    }
  }, [embeddedUrl])

  // Intercept all link clicks in article body
  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a')
    if (!target) {
      // Direct click on a standalone image → open the lightbox viewer
      const direct = e.target as HTMLElement
      if (direct.tagName === 'IMG') {
        const src = (direct as HTMLImageElement).currentSrc || (direct as HTMLImageElement).src
        if (src) {
          e.preventDefault()
          e.stopPropagation()
          setLightbox({ src, alt: (direct as HTMLImageElement).alt || '' })
        }
      }
      return
    }
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

    // Image wrapped in a link → lightbox viewer instead of link options
    const linkedImage = target.querySelector('img')
    if (linkedImage) {
      const src = linkedImage.currentSrc || linkedImage.src
      if (src) {
        setLightbox({ src, alt: linkedImage.alt || '' })
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
      ? url.replace(/https?:\/\/(?:www\.|new\.|np\.)?reddit\.com/i, 'https://www.reddit.com')
      : url
    setEmbeddedUrl(targetUrl)
    setLinkPopup(null)
  }

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop
    setIsScrolled(top > 20)
  }, [])

  // Close the lightbox with Escape
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

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
         ALLOWED_ATTR: ['href','src','srcset','alt','title','class','id','target','rel','width','height','datetime','allowfullscreen','allow','frameborder','style', 'viewBox', 'fill', 'd', 'data-src', 'data-lazy-src', 'data-original'],
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
    // Non-global copy for .test() — a /g regex advances lastIndex on each
    // successful test, which would skip every other matching node.
    const testRegex = new RegExp(`^(?:${allMatches.join('|')})$`, 'i')
    
    const doc = new DOMParser().parseFromString(safeHtml, 'text/html')
    const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null)
    
    const nodesToReplace: Text[] = []
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (node.nodeValue && regex.test(node.nodeValue)) {
        nodesToReplace.push(node as Text)
      }
      regex.lastIndex = 0
    }
    
    for (const textNode of nodesToReplace) {
      if (!textNode.nodeValue) continue
      const frag = document.createDocumentFragment()
      const parts = textNode.nodeValue.split(regex)
      for (const part of parts) {
        if (part && testRegex.test(part)) {
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

  const redditVideoUrl = React.useMemo(() => {
    const html = selectedArticle?.content_html || ''
    const match = /href=["'](https:\/\/(?:www\.)?reddit\.com\/link\/[^/]+\/video\/[^/]+\/player(?:[?#][^"']*)?)["']/i.exec(html)
    return match?.[1]?.replace(/&amp;/g, '&') || null
  }, [selectedArticle?.content_html])

  const normalizedHtml = React.useMemo(
    () => normalizeArticleHtml(
      highlightedHtml || safeHtml || '',
      selectedArticle?.url,
      selectedArticle?.thumbnail_url,
      Boolean(redditVideo || redditVideoUrl),
    ),
    [
      highlightedHtml,
      safeHtml,
      selectedArticle?.url,
      selectedArticle?.thumbnail_url,
      redditVideo,
      redditVideoUrl,
    ],
  )

  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-fallback-src]'))
    const cleanups = images.map(image => {
      const onError = () => {
        const fallback = image.dataset.fallbackSrc
        image.removeAttribute('data-fallback-src')
        if (fallback) image.src = fallback
      }
      image.addEventListener('error', onError, { once: true })
      return () => image.removeEventListener('error', onError)
    })
    return () => cleanups.forEach(cleanup => cleanup())
  }, [normalizedHtml, selectedArticle?.id])

  // Hide the Reddit preview image only once the video player can actually play.
  // Until then the image stays visible (it doubles as the video poster), so a
  // failing HLS stream never blanks out the post.
  const handleVideoReady = useCallback(() => setRedditVideoReady(true), [])

  useEffect(() => {
    if (!redditVideoReady) return
    const root = contentRef.current
    if (!root) return
    root.querySelectorAll('[data-reddit-preview]').forEach(el => {
      ;(el as HTMLElement).style.display = 'none'
    })
  }, [redditVideoReady, normalizedHtml])

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
                ref={webviewRef}
                className={styles.embeddedFrame}
                src={embeddedUrl}
                partition="persist:adblock"
                useragent={cleanUserAgent}
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

               let baseHtml = normalizedHtml || selectedArticle.content_html || ''
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
                    // Only replace the main content if the Reddit API text is significantly longer
                    // (meaning the RSS feed truncated the post).
                    if (normReddit.length > normBase.length * 1.5) {
                      useSelftextAsMain = true
                    }
                  } else {
                    showRedditSelftext = true
                  }
                }
              }

              if (useSelftextAsMain) {
                // If we are replacing the main content, try to rescue the images from the RSS feed
                // because the Reddit API selftext usually lacks thumbnail/preview images.
                let mediaHtml = ''
                if (baseHtml) {
                  const doc = new DOMParser().parseFromString(baseHtml, 'text/html')
                  const images = doc.querySelectorAll('img')
                  const addedSrcs = new Set<string>()
                  
                  images.forEach(img => {
                    if (addedSrcs.has(img.src)) return
                    addedSrcs.add(img.src)
                    // Don't include tiny tracking pixels
                    if (img.width === 1 && img.height === 1) return
                    
                    const a = img.closest('a')
                    if (a) {
                      mediaHtml += `<a href="${a.href}"><img src="${img.src}" style="max-width: 100%; border-radius: 8px; margin-bottom: 16px;" /></a><br/>`
                    } else {
                      mediaHtml += `<img src="${img.src}" style="max-width: 100%; border-radius: 8px; margin-bottom: 16px;" /><br/>`
                    }
                  })
                }
                htmlToRender = DOMPurify.sanitize(mediaHtml + redditSelftext!, { FORCE_BODY: true })
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

                <RedditVideoNode
                  video={redditVideo}
                  fallbackPoster={selectedArticle.thumbnail_url}
                  postUrl={selectedArticle.url}
                  playerUrl={redditVideoUrl}
                  onReady={handleVideoReady}
                />
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

      {/* ── Image lightbox (near-fullscreen viewer) ─────────── */}
      {lightbox && (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-label="Image viewer"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox.src}
            alt={lightbox.alt}
            className={styles.lightboxImg}
            onClick={e => e.stopPropagation()}
          />
          <button
            className={styles.lightboxClose}
            onClick={() => setLightbox(null)}
            aria-label="Close image viewer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
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

      {redditJsonUrl && (
        <webview
          ref={hiddenWebviewRef}
          src={redditJsonUrl}
          partition="persist:adblock"
          useragent={cleanUserAgent}
          style={{ width: 1, height: 1, position: 'absolute', left: '-9999px', visibility: 'hidden' }}
        />
      )}
    </div>
  )
}
