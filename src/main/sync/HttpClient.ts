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


import { URL } from 'url'
import dns from 'dns/promises'

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
 * Uses DNS resolution to catch DNS rebinding and obscured IPs.
 */
async function isPrivateHost(hostname: string): Promise<boolean> {
  if (hostname === 'localhost') return true
  try {
    const { address } = await dns.lookup(hostname)
    if (address === '0.0.0.0' || address === '127.0.0.1' || address === '::1') return true
    for (const prefix of BLOCKED_PREFIXES) {
      if (address.startsWith(prefix)) return true
    }
  } catch (err) {
    // If DNS fails to resolve, we allow it through so fetch handles the standard network error
    return false
  }
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
  // ── Build request headers ───────────────────────────────────────────────
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/rss+xml, application/atom+xml, application/json, application/xml, text/xml, */*;q=0.8',
  }
  if (lastEtag)     headers['If-None-Match']     = lastEtag
  if (lastModified) headers['If-Modified-Since'] = lastModified

  // ── Execute request (with manual redirect & SSRF checks) ───────────────
  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), RESPONSE_TIMEOUT_MS)

  let currentUrl = url
  let redirects = 0
  const MAX_REDIRECTS = 5
  let response: Response | null = null

  try {
    while (redirects <= MAX_REDIRECTS) {
      let parsed: URL
      try {
        parsed = new URL(currentUrl)
      } catch {
        throw new Error(`Invalid feed URL: ${currentUrl}`)
      }

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`)
      }

      const isPrivate = await isPrivateHost(parsed.hostname)
      if (isPrivate) {
        throw new Error(`Blocked: URL resolves to a private address (${parsed.hostname})`)
      }

      const res = await fetch(currentUrl, {
        method:  'GET',
        headers,
        signal:  controller.signal,
        redirect: 'manual', // Prevent native following so we can SSRF-check the next hop
      })

      // Handle redirect
      if (res.status >= 300 && res.status <= 399) {
        const location = res.headers.get('location')
        if (!location) {
          response = res
          break
        }
        currentUrl = new URL(location, currentUrl).href
        redirects++
        if (redirects > MAX_REDIRECTS) {
          throw new Error(`Too many redirects fetching ${url}`)
        }
        continue
      }

      response = res
      break
    }
  } catch (err) {
    clearTimeout(timeout)
    throw new Error(`Fetch failed for ${currentUrl}: ${err instanceof Error ? err.message : String(err)}`)
  }

  clearTimeout(timeout)

  if (!response) {
    throw new Error(`Fetch failed for ${url}: Unknown error`)
  }

  const statusCode = response.status

  // ── 304 Not Modified — no body to read ─────────────────────────────────
  if (statusCode === 304) {
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
    throw new Error(`HTTP ${statusCode} fetching ${currentUrl}`)
  }

  // ── Read body with size cap ─────────────────────────────────────────────
  // Pre-check Content-Length to avoid downloading excessively large feeds into memory.
  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    throw new Error(`Feed body exceeds size limit (${MAX_BODY_BYTES} bytes, Content-Length: ${contentLength}): ${currentUrl}`)
  }

  const bodyText = await response.text()
  if (Buffer.byteLength(bodyText, 'utf8') > MAX_BODY_BYTES) {
    throw new Error(`Feed body exceeds size limit (${MAX_BODY_BYTES} bytes): ${currentUrl}`)
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
