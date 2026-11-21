import { fetchFeed } from './HttpClient'
import type { ParseResult, ParsedArticle } from './FeedParser'

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])

/** True for YouTube channel pages and legacy channel RSS URLs. */
export function isYouTubeChannelUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return false
    return url.pathname === '/feeds/videos.xml' ||
      /^\/@[\w.-]+(?:\/videos)?\/?$/i.test(url.pathname) ||
      /^\/(?:channel|c|user)\/[\w.-]+(?:\/videos)?\/?$/i.test(url.pathname)
  } catch {
    return false
  }
}

/** Fetches the public channel page and extracts its recent video entries. */
export async function fetchYouTubeChannel(value: string): Promise<ParseResult> {
  const channelUrl = getChannelPageUrl(value)
  const response = await fetchFeed(channelUrl)
  if (response.status !== 200) throw new Error(`YouTube channel returned HTTP ${response.status}`)

  const initialData = extractInitialData(response.body)
  if (!initialData) {
    throw new Error('YouTube returned a consent or anti-bot page instead of channel data. Open the channel in the embedded browser, then retry.')
  }

  const renderers: Record<string, unknown>[] = []
  const stack: unknown[] = [initialData]
  while (stack.length && renderers.length < 100) {
    const current = stack.pop()
    if (!current || typeof current !== 'object') continue
    if (Array.isArray(current)) {
      for (const value of current) stack.push(value)
      continue
    }
    const record = current as Record<string, unknown>
    const renderer = record.videoRenderer ?? record.gridVideoRenderer ?? record.lockupViewModel ?? record.richItemRenderer
    if (renderer && typeof renderer === 'object') {
      const nested = (renderer as Record<string, unknown>).content
      const candidate = nested && typeof nested === 'object'
        ? (nested as Record<string, unknown>).videoRenderer ?? renderer
        : renderer
      if (candidate && typeof candidate === 'object') renderers.push(candidate as Record<string, unknown>)
    }
    for (const child of Object.values(record)) stack.push(child)
  }

  const metaRenderer = findObjectWithKey(initialData, 'channelMetadataRenderer')
  const headerRenderer = findObjectWithKey(initialData, 'c4TabbedHeaderRenderer')
  const channelMeta = (metaRenderer?.channelMetadataRenderer ?? {}) as Record<string, unknown>
  const headerMeta = (headerRenderer?.c4TabbedHeaderRenderer ?? {}) as Record<string, unknown>
  const channelId = stringValue(channelMeta.externalId) ?? getChannelId(channelUrl)
  const channelTitle = stringValue(channelMeta.title) ?? textValue(headerMeta.title) ?? 'YouTube channel'
  const avatar = thumbnailUrl(channelMeta.avatar) ?? thumbnailUrl(headerMeta.avatar)

  const seen = new Set<string>()
  const articles: ParsedArticle[] = []
  for (const renderer of renderers) {
    const metadata = renderer.metadata && typeof renderer.metadata === 'object'
      ? (renderer.metadata as Record<string, unknown>).lockupMetadataViewModel as Record<string, unknown> | undefined
      : undefined
    const videoId = stringValue(renderer.videoId) ?? stringValue(renderer.contentId) ?? findVideoId(renderer)
    if (!videoId || !/^[\w-]{11}$/.test(videoId) || seen.has(videoId)) continue
    seen.add(videoId)

    const title = textValue(renderer.title) ?? textValue(metadata?.title) ?? 'Untitled video'
    const description = textValue(renderer.descriptionSnippet) ?? ''
    const thumbnail = thumbnailUrl(renderer.thumbnail)
      ?? thumbnailUrl((renderer.contentImage as Record<string, unknown> | undefined)?.thumbnailViewModel)
      ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
    const contentHtml = [
      '<div class="youtube-player-container">',
      `<a href="${videoUrl}" target="_blank" rel="noopener noreferrer" class="youtube-player-preview">`,
      `<img src="${escapeAttribute(thumbnail)}" alt="${escapeAttribute(title)}" />`,
      '<div class="youtube-player-overlay"><div class="youtube-play-button">▶</div><div class="youtube-pill">YouTube</div></div>',
      '</a>',
      description ? `<p>${escapeHtml(description).replace(/\n/g, '<br/>')}</p>` : '',
      '</div>',
    ].join('')

    articles.push({
      guid: videoId,
      url: videoUrl,
      title,
      author: channelTitle,
      content_html: contentHtml,
      content_text: description || title,
      excerpt: description.slice(0, 160) || title.slice(0, 160),
      enclosure_url: null,
      enclosure_type: null,
      word_count: null,
      published_at: relativeDateToUnix(textValue(renderer.publishedTimeText) ?? getLockupPublishedText(metadata)),
      thumbnail_url: thumbnail,
    })
  }

  if (!articles.length) {
    throw new Error('YouTube returned channel data but no public videos. The channel may be empty, restricted, or require sign-in.')
  }

  return {
    format: 'atom',
    meta: {
      title: channelTitle,
      site_url: `https://www.youtube.com/channel/${channelId}`,
      description: stringValue(channelMeta.description) ?? null,
      language: null,
      icon_url: avatar,
    },
    articles,
  }
}

function getChannelPageUrl(value: string): string {
  const input = new URL(value)
  if (!YOUTUBE_HOSTS.has(input.hostname.toLowerCase())) throw new Error('Enter a YouTube channel URL.')

  if (input.pathname === '/feeds/videos.xml') {
    const id = input.searchParams.get('channel_id')
    if (!id || !/^[\w-]{10,64}$/.test(id)) throw new Error('The YouTube RSS URL is missing a valid channel_id.')
    return `https://www.youtube.com/channel/${id}/videos`
  }

  const path = input.pathname.replace(/\/+$/, '')
  if (/^\/@[\w.-]+$/i.test(path)) return `https://www.youtube.com${path}/videos`
  if (/^\/(?:channel|c|user)\/[\w.-]+$/i.test(path)) return `https://www.youtube.com${path}/videos`
  if (/^\/@[\w.-]+\/videos$/i.test(path) || /^\/(?:channel|c|user)\/[\w.-]+\/videos$/i.test(path)) {
    return `https://www.youtube.com${path}`
  }
  throw new Error('Use a YouTube channel URL such as youtube.com/@handle or youtube.com/channel/CHANNEL_ID.')
}

function extractInitialData(html: string): Record<string, unknown> | null {
  const assignments = /ytInitialData\s*=\s*/g
  while (assignments.exec(html)) {
    const start = assignments.lastIndex
    if (html[start] !== '{') continue
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < html.length; index++) {
      const char = html[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') depth++
      else if (char === '}' && --depth === 0) {
        try {
          const parsed: unknown = JSON.parse(html.slice(start, index + 1))
          if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
        } catch {
          break
        }
      }
    }
  }
  return null
}

function findObjectWithKey(root: unknown, key: string): Record<string, unknown> | null {
  const stack = [root]
  while (stack.length) {
    const value = stack.pop()
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      stack.push(...value)
      continue
    }
    const record = value as Record<string, unknown>
    if (key in record) return record
    stack.push(...Object.values(record))
  }
  return null
}

function getChannelId(url: string): string {
  const match = new URL(url).pathname.match(/^\/channel\/([\w-]+)/)
  return match?.[1] ?? ''
}

function textValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') return stringValue(value)
  const record = value as Record<string, unknown>
  if (typeof record.simpleText === 'string') return record.simpleText
  if (typeof record.content === 'string') return record.content
  if (Array.isArray(record.runs)) {
    const text = record.runs.map(run => run && typeof run === 'object' ? stringValue((run as Record<string, unknown>).text) ?? '' : '').join('')
    return text || null
  }
  return null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function thumbnailUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const image = record.image && typeof record.image === 'object' ? record.image as Record<string, unknown> : null
  const thumbnails = record.thumbnails ?? image?.sources
  if (!Array.isArray(thumbnails)) return null
  const urls = thumbnails.flatMap(item => item && typeof item === 'object' ? [stringValue((item as Record<string, unknown>).url)].filter((url): url is string => Boolean(url)) : [])
  return urls.find(url => /^https:\/\/i\.ytimg\.com\//.test(url)) ?? null
}

function getLockupPublishedText(metadata: Record<string, unknown> | undefined): string | null {
  const details = metadata?.metadata as Record<string, unknown> | undefined
  const content = details?.contentMetadataViewModel as Record<string, unknown> | undefined
  const rows = content?.metadataRows
  if (!Array.isArray(rows)) return null
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const parts = (row as Record<string, unknown>).metadataParts
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue
      const record = part as Record<string, unknown>
      const label = stringValue(record.accessibilityLabel) ?? textValue(record.text)
      if (label && /ago|il y a/i.test(label)) return label
    }
  }
  return null
}

function findVideoId(root: unknown): string | null {
  const stack = [root]
  while (stack.length) {
    const value = stack.pop()
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      stack.push(...value)
      continue
    }
    const record = value as Record<string, unknown>
    for (const key of ['videoId', 'contentId', 'animationActivationTargetId']) {
      const candidate = stringValue(record[key])
      if (candidate && /^[\w-]{11}$/.test(candidate)) return candidate
    }
    stack.push(...Object.values(record))
  }
  return null
}

function relativeDateToUnix(value: string | null): number | null {
  if (!value) return null
  const match = value.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i)
    ?? value.match(/il\s+y\s+a\s+(\d+)\s+(seconde|minute|heure|jour|semaine|mois|an|année)s?/i)
  if (!match) return null
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  const seconds = unit.startsWith('second') || unit.startsWith('seconde') ? 1
    : unit.startsWith('minute') ? 60
      : unit.startsWith('hour') || unit.startsWith('heure') ? 3600
        : unit.startsWith('day') || unit.startsWith('jour') ? 86400
          : unit.startsWith('week') || unit.startsWith('semaine') ? 604800
            : unit.startsWith('month') || unit.startsWith('mois') ? 2592000 : 31536000
  return Math.floor(Date.now() / 1000) - amount * seconds
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
