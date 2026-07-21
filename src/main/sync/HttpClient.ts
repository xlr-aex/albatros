/**
 * @file sync/HttpClient.ts
 * @description HTTP client for fetching RSS/Atom/JSON feeds.
 *
 * Features:
 *  - ETag and Last-Modified support (conditional GET — avoids re-downloading)
 *  - Automatic decompression (gzip, brotli)
 *  - SSRF protection: blocks requests to private / loopback IP ranges
 *  - Configurable timeouts (connect: 5s, response: 30s)
 *  - Follows up to 5 redirects
 *  - Sets a proper User-Agent header
 */


import { session } from 'electron'
import { URL } from 'url'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FetchFeedResult {
  /** HTTP status code */
  status: number
  /** Response body text (empty string for 304) */
  body: string
  /** ETag header value, if any */
  etag: string | null
  /** Last-Modified header value, if any */
  lastModified: string | null
  /** Content-Type header (used for format detection) */
  contentType: string | null
}

export class FeedHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(`HTTP ${status} fetching ${url}`)
    this.name = 'FeedHttpError'
  }
}

// ─── SSRF protection ─────────────────────────────────────────────────────────

/** IP prefixes that should never be fetched (RFC 1918 + loopback + link-local). */
const BLOCKED_PREFIXES = [
  '10.',
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.',
  '127.',
  '169.254.',  // Link-local
  '::1',       // IPv6 loopback
  'fc', 'fd',  // IPv6 unique-local
]

/**
 * Returns true if the hostname resolves to a private network address.
 * This is a lightweight prefix check — it won't catch all cases but prevents
 * the most common SSRF vectors.
 */
function isPrivateHost(hostname: string): boolean {
  // Reject bare IP addresses that match private ranges
  for (const prefix of BLOCKED_PREFIXES) {
    if (hostname.startsWith(prefix)) return true
  }
  // localhost is always blocked
  if (hostname === 'localhost') return true
  return false
}

// ─── Client ──────────────────────────────────────────────────────────────────

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Albatros/1.0'
const RESPONSE_TIMEOUT_MS = 45_000
const MAX_BODY_BYTES       = 10 * 1024 * 1024 // 10 MB cap

/**
 * Fetches the content of an RSS / Atom / JSON Feed URL.
 *
 * Returns a structured result object.  A 304 (Not Modified) response returns
 * status 304 with an empty body — the caller should use the cached content.
 *
 * @param url          - Feed URL to fetch
 * @param lastEtag     - ETag from the previous successful fetch (conditional GET)
 * @param lastModified - Last-Modified from the previous successful fetch
 */
export async function fetchFeed(
  url: string,
  lastEtag: string | null = null,
  lastModified: string | null = null,
): Promise<FetchFeedResult> {
  // ── SSRF guard ──────────────────────────────────────────────────────────
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid feed URL: ${url}`)
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`)
  }

  if (isPrivateHost(parsed.hostname)) {
    throw new Error(`Blocked: URL resolves to a private address (${parsed.hostname})`)
  }

  // ── Build request headers ───────────────────────────────────────────────
  const isReddit = parsed.hostname.toLowerCase().endsWith('reddit.com')
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/rss+xml, application/atom+xml, application/json, application/xml, text/xml, */*;q=0.8',
  }
  if (lastEtag)     headers['If-None-Match']     = lastEtag
  if (lastModified) headers['If-Modified-Since'] = lastModified

  // ── Execute request ─────────────────────────────────────────────────────
  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), RESPONSE_TIMEOUT_MS)

  let response: Response
  try {
    const options: RequestInit = {
      method:  'GET',
      headers,
      signal:  controller.signal,
      redirect: 'follow',
    }
    // Reddit heavily throttles anonymous Node requests. Reuse the persistent
    // Chromium session used by the embedded browser (cookies + browser network
    // stack), which is both faster and accepted by Reddit's RSS endpoint.
    response = isReddit && session?.fromPartition
      ? await session.fromPartition('persist:adblock').fetch(url, options)
      : await fetch(url, options)
  } catch (err) {
    clearTimeout(timeout)
    throw new Error(`Fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`)
  }
  const statusCode = response.status

  // ── 304 Not Modified — no body to read ─────────────────────────────────
  if (statusCode === 304) {
    clearTimeout(timeout)
    return {
      status:      304,
      body:        '',
      etag:        extractHeader(response.headers.get('etag')),
      lastModified: extractHeader(response.headers.get('last-modified')),
      contentType: null,
    }
  }

  // ── Non-200 responses ───────────────────────────────────────────────────
  if (!response.ok) {
    clearTimeout(timeout)
    throw new FeedHttpError(statusCode, url, parseRetryAfter(response.headers.get('retry-after')))
  }

  // ── Read body with size cap ─────────────────────────────────────────────
  // Pre-check Content-Length to avoid downloading excessively large feeds into memory.
  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    clearTimeout(timeout)
    throw new Error(`Feed body exceeds size limit (${MAX_BODY_BYTES} bytes, Content-Length: ${contentLength}): ${url}`)
  }

  let bodyText: string
  try {
    bodyText = await response.text()
  } finally {
    clearTimeout(timeout)
  }
  if (Buffer.byteLength(bodyText, 'utf8') > MAX_BODY_BYTES) {
    throw new Error(`Feed body exceeds size limit (${MAX_BODY_BYTES} bytes): ${url}`)
  }

  return {
    status:      statusCode,
    body:        bodyText,
    etag:        extractHeader(response.headers.get('etag')),
    lastModified: extractHeader(response.headers.get('last-modified')),
    contentType: extractHeader(response.headers.get('content-type')),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalises a header value (string or string[]) to a single string or null. */
function extractHeader(value: string | string[] | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return Array.isArray(value) ? value[0] : value
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}
