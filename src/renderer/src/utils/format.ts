/**
 * @file utils/format.ts
 * @description Date formatting and text utility helpers for the renderer.
 */

/**
 * Formats a Unix timestamp as a human-friendly relative time string.
 * Returns strings like "2h ago", "Yesterday", "Mar 21", etc.
 */
export function formatRelativeTime(unixSec: number): string {
  const now  = Date.now()
  const ms   = unixSec * 1000
  const diff = now - ms                   // milliseconds elapsed

  const MINUTE = 60_000
  const HOUR   = 60 * MINUTE
  const DAY    = 24 * HOUR

  if (diff < MINUTE)         return 'Just now'
  if (diff < HOUR)           return `${Math.floor(diff / MINUTE)}m ago`
  if (diff < 2 * HOUR)       return '1h ago'
  if (diff < DAY)            return `${Math.floor(diff / HOUR)}h ago`
  if (diff < 2 * DAY)        return 'Yesterday'

  // Older than 2 days: show "Month Day"
  const d = new Date(ms)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Formats a Unix timestamp as a full date string for the article reader header.
 * Returns strings like "March 21, 2026 at 01:38".
 */
export function formatDate(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  return d.toLocaleDateString('en-US', {
    year:    'numeric',
    month:   'long',
    day:     'numeric',
    hour:    '2-digit',
    minute:  '2-digit',
  })
}

/**
 * Estimates reading time in minutes given a word count.
 * Average adult reading speed is ~238 words per minute.
 */
export function readingTime(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 238))
}

/**
 * Decodes HTML entities (e.g., &amp;, &#039;) back into normal characters.
 * Useful for displaying titles and excerpts that were not fully decoded.
 */
export function unescapeHtml(text: string | null | undefined): string {
  if (!text) return ''
  
  let decoded = text
  // Try DOMParser first (works in browser/Electron)
  try {
    const doc = new DOMParser().parseFromString(text, 'text/html')
    if (doc.documentElement.textContent) {
      decoded = doc.documentElement.textContent
    }
  } catch {
    // Ignore error in Node/vitest
  }
  
  // Fallback for Node/vitest or if DOMParser failed to decode
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#039;': "'",
    '&apos;': "'"
  }
  
  return decoded.replace(/&(?:amp|lt|gt|quot|#0?39|apos);/g, match => entities[match] || match)
}
