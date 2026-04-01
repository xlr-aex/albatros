import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatRelativeTime, formatDate, readingTime, unescapeHtml } from './format'

describe('format.ts utilities', () => {
  beforeEach(() => {
    // Mock system time to a fixed timestamp so relative tests are deterministic
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-21T12:00:00Z')) // roughly 1711022400 seconds maybe, let's just mock exact millies
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('formatRelativeTime()', () => {
    it('returns "Just now" for times under a minute ago', () => {
      const ms = Date.now() - 30 * 1000 // 30 seconds ago
      expect(formatRelativeTime(ms / 1000)).toBe('Just now')
    })

    it('returns "xm ago" for times under an hour ago', () => {
      const ms = Date.now() - 45 * 60 * 1000 // 45 minutes ago
      expect(formatRelativeTime(ms / 1000)).toBe('45m ago')
    })

    it('returns "1h ago" for times between 1 and 2 hours', () => {
      const ms = Date.now() - 90 * 60 * 1000 // 1.5 hours ago
      expect(formatRelativeTime(ms / 1000)).toBe('1h ago')
    })

    it('returns "xh ago" for times under a day', () => {
      const ms = Date.now() - 5 * 60 * 60 * 1000 // 5 hours ago
      expect(formatRelativeTime(ms / 1000)).toBe('5h ago')
    })

    it('returns "Yesterday" for times between 1 and 2 days', () => {
      const ms = Date.now() - 36 * 60 * 60 * 1000 // 36 hours ago
      expect(formatRelativeTime(ms / 1000)).toBe('Yesterday')
    })

    it('returns a formatted date string for older times', () => {
      const ms = Date.now() - 5 * 24 * 60 * 60 * 1000 // 5 days ago (Mar 16)
      expect(formatRelativeTime(ms / 1000)).toBe('Mar 16')
    })
  })

  describe('formatDate()', () => {
    it('returns full formatted date string', () => {
      const ms = new Date('2026-03-21T14:30:00Z').getTime()
      // The exact string depends on the runtime timezone, but it should contain the parts
      const str = formatDate(ms / 1000)
      expect(str).toMatch(/March 21, 2026( at)? \d{2}:\d{2}/)
    })
  })

  describe('readingTime()', () => {
    it('calculates 1 min for empty or short text', () => {
      expect(readingTime(0)).toBe(1)
      expect(readingTime(10)).toBe(1)
      expect(readingTime(238)).toBe(1)
    })

    it('calculates correct minutes for long text', () => {
      expect(readingTime(239)).toBe(2)
      expect(readingTime(500)).toBe(3)
    })
  })

  describe('unescapeHtml()', () => {
    it('decodes basic entities', () => {
      expect(unescapeHtml('OpenAI&#039;s safety pledges')).toBe("OpenAI's safety pledges")
      expect(unescapeHtml('&lt;Hello&gt; &amp; &quot;World&quot;')).toBe('<Hello> & "World"')
    })

    it('handles null/undefined gracefully', () => {
      expect(unescapeHtml(null)).toBe('')
      expect(unescapeHtml(undefined)).toBe('')
      expect(unescapeHtml('')).toBe('')
    })
  })
})
