/**
 * @file sync/FeedParser.ts
 * @description Parses RSS 2.0, Atom 1.0, and JSON Feed 1.1 into a normalised
 * article format that the SyncEngine can directly store in SQLite.
 *
 * Priority rules for content:
 *   RSS:  content:encoded > description
 *   Atom: content > summary
 *   JSON: content_html > content_text > summary
 *
 * GUIDs:  guid element (RSS) / id element (Atom) / id (JSON Feed).
 *         Falls back to the article link if absent.
 *
 * The parser intentionally does NOT sanitise HTML — sanitisation is performed
 * on the renderer side (ArticleReader.tsx) via DOMPurify before injection
 * into the DOM.  Raw content_html in the database is untrusted.
 */

import { XMLParser } from 'fast-xml-parser'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedFeedMeta {
  title: string | null
  site_url: string | null
  description: string | null
  language: string | null
}

export interface ParsedArticle {
  guid: string
  url: string | null
  title: string | null
  author: string | null
  /** Raw HTML — not yet sanitised */
  content_html: string | null
  /** Plain text (stripped HTML) */
  content_text: string | null
  /** 160-char excerpt from content_text */
  excerpt: string | null
  enclosure_url: string | null
  enclosure_type: string | null
  word_count: number | null
  published_at: number | null
  thumbnail_url: string | null
}

export interface ParseResult {
  format: 'rss' | 'atom' | 'jsonfeed' | 'unknown'
  meta: ParsedFeedMeta
  articles: ParsedArticle[]
}

// ─── Parser ───────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  allowBooleanAttributes: true,
  // Treat CDATA sections as text
  cdataPropName: '__cdata',
  // Always return arrays for these elements to avoid single-item vs array
  // inconsistencies
  isArray: (name: string) => ['item', 'entry', 'link', 'category', 'author'].includes(name),
})

/**
 * Parses a feed body string.  Automatically detects the format.
 *
 * @param body        - Raw text body of the feed response
 * @param contentType - Content-Type header value (used as a format hint)
 */
export function parseFeed(body: string, contentType: string | null): ParseResult {
  // ── JSON Feed detection ─────────────────────────────────────────────────
  const isJson = contentType?.includes('json') || body.trimStart().startsWith('{')
  if (isJson) return parseJsonFeed(body)

  // ── XML-based formats ───────────────────────────────────────────────────
  let parsed: Record<string, unknown>
  try {
    parsed = xmlParser.parse(body) as Record<string, unknown>
  } catch {
    return { format: 'unknown', meta: emptyMeta(), articles: [] }
  }

  if (parsed['rss']) return parseRss(parsed['rss'] as Record<string, unknown>)
  if (parsed['feed']) return parseAtom(parsed['feed'] as Record<string, unknown>)

  return { format: 'unknown', meta: emptyMeta(), articles: [] }
}

// ─── RSS 2.0 ─────────────────────────────────────────────────────────────────

function parseRss(rss: Record<string, unknown>): ParseResult {
  const channel = (rss['channel'] as Record<string, unknown>) ?? {}

  const meta: ParsedFeedMeta = {
    title: coerceText(channel['title']),
    site_url: coerceText(channel['link']),
    description: coerceText(channel['description']),
    language: coerceText(channel['language']),
  }

  const rawItems = asArray(channel['item']) as Record<string, unknown>[]
  const siteUrl = meta.site_url
  const articles = rawItems.map(item => parseRssItem(item, siteUrl))

  return { format: 'rss', meta, articles }
}

function parseRssItem(item: Record<string, unknown>, siteUrl: string | null): ParsedArticle {
  const guid = coerceText(item['guid']) ?? coerceText(item['link']) ?? ''
  const link = coerceText(item['link'])
  const title = coerceText(item['title'])

  // content:encoded takes priority over description
  const contentEncoded = coerceText(item['content:encoded'])
  const description = coerceText(item['description'])
  let rawHtml = contentEncoded ?? description

  if (link && link.includes('reddit.com') && rawHtml) {
    rawHtml = fixRedditContent(rawHtml)
  }

  // Special handling for HackerNews feeds
  // Detect HN by: guid containing news.ycombinator.com, or content matching HN format
  const isHackerNews =
    guid?.includes('news.ycombinator.com') ||
    link?.includes('news.ycombinator.com') ||
    (rawHtml && /Comments URL:.*news\.ycombinator\.com/i.test(rawHtml)) ||
    (rawHtml && /Points?:\s*\d+/i.test(rawHtml) && /#?\s*Comments?:\s*\d+/i.test(rawHtml))

  if (rawHtml && isHackerNews) {
    rawHtml = fixHackerNewsContent(rawHtml, item)
  }

  const author = extractRssAuthor(item)

  // Enclosure (podcast audio etc.)
  const enclosure = item['enclosure'] as Record<string, string> | undefined
  const enclosureUrl = enclosure?.['@_url'] ?? null
  let enclosureType = enclosure?.['@_type'] ?? null

  // Implicitly flag Reddit comments natively without risking schema adjustments
  if (link && link.includes('reddit.com') && /\/comments\/[^/]+\/[^/]+\/[^/]+/.test(link)) {
    enclosureType = 'reddit-comment'
  }

  const publishedAt = parseDateToUnix(coerceText(item['pubDate']))

  const contentText = rawHtml ? stripHtml(rawHtml) : null
  const excerpt = contentText ? truncate(contentText, 160) : null
  const wordCount = contentText ? countWords(contentText) : null

  return {
    guid,
    url: link,
    title,
    author,
    content_html: rawHtml,
    content_text: contentText,
    excerpt,
    enclosure_url: enclosureUrl,
    enclosure_type: enclosureType,
    word_count: wordCount,
    published_at: publishedAt,
    thumbnail_url: extractRssThumbnail(item, rawHtml, siteUrl),
  }
}

function extractRssThumbnail(
  item: Record<string, unknown>,
  html: string | null,
  siteUrl: string | null,
): string | null {
  const mediaThumb = item['media:thumbnail'] as Record<string, string> | undefined
  if (mediaThumb?.['@_url']) return resolveUrl(mediaThumb['@_url'], siteUrl)

  const mediaContent = asArray(item['media:content']) as Record<string, string>[]
  for (const mc of mediaContent) {
    if (mc?.['@_url'] && (mc?.['@_medium'] === 'image' || mc?.['@_type']?.startsWith('image/'))) {
      return resolveUrl(mc['@_url'], siteUrl)
    }
  }

  if (html) return getFirstImageFromHtml(html, siteUrl)

  return null
}

function extractRssAuthor(item: Record<string, unknown>): string | null {
  const creator = coerceText(item['dc:creator'])
  if (creator) return creator
  const author = coerceText(item['author'])
  if (author) return author
  return null
}

// ─── Atom 1.0 ────────────────────────────────────────────────────────────────

function parseAtom(feed: Record<string, unknown>): ParseResult {
  const meta: ParsedFeedMeta = {
    title: coerceText(feed['title']),
    site_url: extractAtomLink(feed),
    description: coerceText(feed['subtitle']),
    language: (feed['@_xml:lang'] as string | undefined) ?? null,
  }

  const rawEntries = asArray(feed['entry']) as Record<string, unknown>[]
  const siteUrl = meta.site_url
  const articles = rawEntries.map(entry => parseAtomEntry(entry, siteUrl))

  return { format: 'atom', meta, articles }
}

function parseAtomEntry(entry: Record<string, unknown>, siteUrl: string | null): ParsedArticle {
  const guid = coerceText(entry['id']) ?? extractAtomLink(entry) ?? ''
  const link = extractAtomLink(entry)
  const title = coerceText(entry['title'])

  // content > summary
  let contentRaw = coerceText(entry['content']) ?? coerceText(entry['summary'])

  if (link && link.includes('reddit.com') && contentRaw) {
    contentRaw = fixRedditContent(contentRaw)
  }

  // YouTube specific: if yt:videoId is present, inject premium player and rich metadata
  const ytVideoIdObj = entry['yt:videoId']
  const ytVideoId = typeof ytVideoIdObj === 'string' ? ytVideoIdObj : coerceText(ytVideoIdObj)

  if (ytVideoId) {
    const mediaGroup = entry['media:group'] as Record<string, unknown> | undefined
    const mediaDesc = coerceText(mediaGroup?.['media:description']) || ''

    const mediaCommunity = mediaGroup?.['media:community'] as Record<string, unknown> | undefined
    const mediaStats = mediaCommunity?.['media:statistics'] as Record<string, unknown> | undefined
    const views = mediaStats?.['@_views'] ? Number(mediaStats['@_views']).toLocaleString() : null

    const starRating = mediaCommunity?.['media:starRating'] as Record<string, unknown> | undefined
    const likes = starRating?.['@_count'] ? Number(starRating['@_count']).toLocaleString() : null

    let extraHtml = ''
    if (views || likes) {
      extraHtml += `<div style="display: flex; gap: 16px; margin: -12px 0 24px; font-size: 0.85em; color: var(--text-muted); font-weight: var(--weight-medium);">`
      if (views)
        extraHtml += `<span style="display: flex; align-items: center; gap: 4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${views}</span>`
      if (likes)
        extraHtml += `<span style="display: flex; align-items: center; gap: 4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> ${likes}</span>`
      extraHtml += `</div>`
    }

    if (mediaDesc) {
      // Escape HTML and format URLs as clickable links, then convert newlines to <br>
      const formattedDesc = mediaDesc
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(
          /(https?:\/\/[^\s]+)/g,
          '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
        )
        .replace(/\n/g, '<br/>')

      extraHtml += `<div style="padding: 1rem 1.25rem; background: var(--bg-elevated); border-radius: var(--radius-md); font-size: 0.9em; line-height: 1.6; color: var(--text-secondary); word-break: break-word; white-space: pre-wrap;">${formattedDesc}</div>`
    }

    // Completely replace contentRaw to eliminate original feed HTML artifacts (e.g. the duplicate triangle/thumbnail)
    contentRaw = fixYoutubeContent(ytVideoId) + extraHtml
  }

  // Author can be a nested object
  const authorObj = asArray(entry['author'])[0] as Record<string, unknown> | undefined
  const author = coerceText(authorObj?.['name']) ?? coerceText(entry['author'])

  const updatedRaw = coerceText(entry['updated'])
  const publishedRaw = coerceText(entry['published']) ?? updatedRaw
  const publishedAt = parseDateToUnix(publishedRaw)

  const contentText = contentRaw ? stripHtml(contentRaw) : null
  const excerpt = contentText ? truncate(contentText, 160) : null
  const wordCount = ytVideoId ? null : contentText ? countWords(contentText) : null

  let enclosureType: string | null = null

  // Implicitly flag Reddit comments natively
  if (link && link.includes('reddit.com') && /\/comments\/[^/]+\/[^/]+\/[^/]+/.test(link)) {
    enclosureType = 'reddit-comment'
  }

  return {
    guid,
    url: link,
    title,
    author,
    content_html: contentRaw,
    content_text: contentText,
    excerpt,
    enclosure_url: null,
    enclosure_type: enclosureType,
    word_count: wordCount,
    published_at: publishedAt,
    thumbnail_url: extractAtomThumbnail(entry, contentRaw, siteUrl),
  }
}

function extractAtomThumbnail(
  entry: Record<string, unknown>,
  html: string | null,
  siteUrl: string | null,
): string | null {
  const mediaGroup = entry['media:group'] as Record<string, unknown> | undefined
  const mediaThumb = (entry['media:thumbnail'] ?? mediaGroup?.['media:thumbnail']) as
    | Record<string, string>
    | undefined
  if (mediaThumb?.['@_url']) return resolveUrl(mediaThumb['@_url'], siteUrl)

  const ytVideoId = findYoutubeVideoId(entry)
  if (ytVideoId) return `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`

  if (html) return getFirstImageFromHtml(html, siteUrl)

  return null
}

function extractAtomLink(obj: Record<string, unknown>): string | null {
  const links = asArray(obj['link']) as (Record<string, string> | string)[]
  if (!links.length) return null

  // Prefer rel="alternate" first
  for (const l of links) {
    if (typeof l === 'object' && l?.['@_rel'] === 'alternate') {
      return l?.['@_href'] ?? null
    }
  }
  // Fallback: first link element
  const first = links[0]
  if (typeof first === 'string') return first
  if (typeof first === 'object') return (first as Record<string, string>)?.['@_href'] ?? null
  return null
}

// ─── JSON Feed 1.1 ───────────────────────────────────────────────────────────

function parseJsonFeed(body: string): ParseResult {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(body) as Record<string, unknown>
  } catch {
    return { format: 'unknown', meta: emptyMeta(), articles: [] }
  }

  if (!obj['version']?.toString().startsWith('https://jsonfeed.org/version/')) {
    return { format: 'unknown', meta: emptyMeta(), articles: [] }
  }

  const meta: ParsedFeedMeta = {
    title: (obj['title'] as string | undefined) ?? null,
    site_url: (obj['home_page_url'] as string | undefined) ?? null,
    description: (obj['description'] as string | undefined) ?? null,
    language: (obj['language'] as string | undefined) ?? null,
  }

  const items = asArray(obj['items']) as Record<string, unknown>[]
  const articles = items.map(parseJsonItem)

  return { format: 'jsonfeed', meta, articles }
}

function parseJsonItem(item: Record<string, unknown>): ParsedArticle {
  const guid = (item['id'] as string | undefined) ?? ''
  const link = (item['url'] as string | undefined) ?? null
  const title = (item['title'] as string | undefined) ?? null

  const contentHtml = (item['content_html'] as string | undefined) ?? null
  const contentText = (item['content_text'] as string | undefined) ?? null
  const summary = (item['summary'] as string | undefined) ?? null

  // Prefer explicit content_text, fall back to stripping HTML
  const textBody = contentText ?? (contentHtml ? stripHtml(contentHtml) : summary)
  const datePublished = (item['date_published'] as string | undefined) ?? null

  // Author object optional
  const authorObj = item['author'] as Record<string, string> | undefined
  const author = authorObj?.['name'] ?? null

  return {
    guid,
    url: link,
    title,
    author,
    content_html: contentHtml,
    content_text: textBody,
    excerpt: textBody ? truncate(textBody, 160) : null,
    enclosure_url: null,
    enclosure_type: null,
    word_count: textBody ? countWords(textBody) : null,
    published_at: parseDateToUnix(datePublished),
    thumbnail_url:
      (item['image'] as string) || (contentHtml ? getFirstImageFromHtml(contentHtml) : null),
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Returns the text from a value that may be a string, CDATA object, or nested. */
function coerceText(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'string') return val || null
  if (typeof val === 'number') return String(val)
  if (Array.isArray(val)) return coerceText(val[0])
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>
    const t = o['__cdata'] ?? o['#text'] ?? o['_'] ?? null
    return t ? coerceText(t) : null
  }
  return null
}

/** Ensures a value is always returned as an array. */
function asArray(val: unknown): unknown[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

/** Parses a date string to a Unix timestamp (seconds). Returns null on failure. */
function parseDateToUnix(dateStr: string | null): number | null {
  if (!dateStr) return null
  const ms = Date.parse(dateStr)
  return isNaN(ms) ? null : Math.floor(ms / 1000)
}

/** Strips HTML tags, returning plain text. */
function stripHtml(html: string): string {
  // Replace block elements with spaces, then strip remaining tags
  return html
    .replace(/<(br|p|div|li|h[1-6])[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Truncates a string to `maxLen` chars at a word boundary. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > maxLen * 0.8 ? cut.slice(0, lastSpace) : cut) + '…'
}

/** Rough word count — splits on whitespace. */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** Extracts the src of the first <img> tag from an HTML string. */
function getFirstImageFromHtml(html: string, siteUrl: string | null = null): string | null {
  const match = /<img[^>]+src=["']([^"'>]+)["']/i.exec(html)
  if (!match) return null

  let src = match[1]
  if (!src || src.startsWith('data:') || src.startsWith('//')) return null

  return resolveUrl(src, siteUrl)
}

/** Converts a relative URL to an absolute URL using a base URL. */
function resolveUrl(relative: string, base: string | null): string {
  if (!base) return relative
  if (relative.startsWith('http://') || relative.startsWith('https://')) return relative

  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}

/** Finds YouTube video ID from various possible key names (namespace handling). */
function findYoutubeVideoId(obj: Record<string, unknown>): string | null {
  const ytKey = Object.keys(obj).find(k => {
    const lower = k.toLowerCase()
    return lower.includes('yt:videoid') || lower.includes('ytvideoid') || lower === 'yt:videoid'
  })
  if (ytKey) {
    const val = obj[ytKey]
    return typeof val === 'string' ? val : coerceText(val)
  }
  return null
}

/**
 * Generates a premium YouTube video preview with a glassmorphism play button.
 */
function fixYoutubeContent(videoId: string): string {
  return `
    <div class="youtube-player-container">
      <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer" class="youtube-player-preview">
        <img src="https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg" 
             onerror="this.src='https://i.ytimg.com/vi/${videoId}/hqdefault.jpg'" 
             alt="YouTube Video" />
        <div class="youtube-player-overlay">
          <div class="youtube-play-button">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
          <div class="youtube-pill">YouTube</div>
        </div>
      </a>
    </div>
  `
}

/**
 * Special handling for Reddit content to fix layout and broken images.
 *
 * Image strategy:
 * - preview.redd.it/ID.ext     → i.redd.it/ID.ext  (permanent, no signature)
 * - external-preview.redd.it   → extract the url= param (original source, permanent)
 * - preview.redd.it/external/  → same as above (old CDN path)
 */
function fixRedditContent(html: string): string {
  if (!html) return html

  return (
    html
      // 1. Remove layout-breaking tables and tr tags
      .replace(/<\/?table[^>]*>/g, '')
      .replace(/<\/?tr[^>]*>/g, '')
      // 2. Normalize td to div for better stacking
      .replace(/<td[^>]*>/g, '<div style="margin-bottom: 1em;">')
      .replace(/<\/td>/g, '</div>')
      // 3. external-preview.redd.it — extract the original image from url= param.
      //    These carry a time-limited s= signature; the url= value is permanent.
      .replace(
        /src=["'](https?:\/\/external-preview\.redd\.it\/[^"'><?]+)\?([^"'>]*)["']/gi,
        (_match, _baseUrl, queryStr) => {
          const rawQuery = queryStr.replace(/&amp;/g, '&')
          try {
            const originalUrl = new URLSearchParams(rawQuery).get('url')
            if (originalUrl && originalUrl.startsWith('http')) {
              return `src="${originalUrl}"`
            }
          } catch { /* ignore malformed query */ }
          return _match // fallback: leave unchanged
        },
      )
      // 4. preview.redd.it — swap hosted images to permanent i.redd.it (no signature),
      //    and extract url= for old-style /external/ proxy paths.
      .replace(
        /src=["'](https?:\/\/preview\.redd\.it\/[^"'><?]+)\?([^"'>]*)["']/gi,
        (_match, previewUrl, queryStr) => {
          if (previewUrl.includes('/external/')) {
            const rawQuery = queryStr.replace(/&amp;/g, '&')
            try {
              const originalUrl = new URLSearchParams(rawQuery).get('url')
              if (originalUrl && originalUrl.startsWith('http')) {
                return `src="${originalUrl}"`
              }
            } catch { /* ignore */ }
            return _match
          }
          // Hosted Reddit image — swap domain, discard expiring signature
          return `src="${previewUrl.replace('preview.redd.it', 'i.redd.it')}"`
        },
      )
  )
}


/**
 * Special handling for HackerNews feeds to display metadata nicely
 * and include a link to comments.
 */
function fixHackerNewsContent(html: string, item: Record<string, unknown>): string {
  if (!html) return html

  // Extract comments URL from the item
  const commentsUrl = coerceText(item['comments'])

  // Parse the description to extract article URL, points, and comments count
  const articleUrlMatch =
    html.match(/Article URL:.*?href="([^"]+)"/i) || html.match(/href="(https?:\/\/[^"]+)"/i)
  const pointsMatch = html.match(/Points?:\s*(\d+)/i)
  const commentsCountMatch = html.match(/#\s*Comments?:\s*(\d+)/i)

  const articleUrl = articleUrlMatch?.[1] ?? null
  const points = pointsMatch?.[1] ?? '0'
  const commentsCount = commentsCountMatch?.[1] ?? '0'

  // Build a nice formatted content
  let content = '<div class="hackernews-content">'

  // Add article link if available
  if (articleUrl) {
    content += `<p><strong>Article:</strong> <a href="${articleUrl}" target="_blank" rel="noopener noreferrer">${articleUrl}</a></p>`
  }

  // Add stats bar
  content += `<div style="display: flex; gap: 16px; margin: 12px 0; font-size: 0.9em; color: var(--text-muted);">`
  content += `<span><strong>⬆ ${points}</strong> points</span>`
  content += `<span><strong>💬 ${commentsCount}</strong> comments</span>`
  content += `</div>`

  // Add comments link
  if (commentsUrl) {
    content += `<p><a href="${commentsUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; background: var(--brand-500); color: white; border-radius: var(--radius-md); text-decoration: none; font-weight: var(--weight-medium);">`
    content += `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`
    content += `View Comments on Hacker News</a></p>`
  }

  content += '</div>'

  return content
}

function emptyMeta(): ParsedFeedMeta {
  return { title: null, site_url: null, description: null, language: null }
}
