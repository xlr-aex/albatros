import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: {},
}))

import { resolveFolderDecisions, sanitizeUtf16 } from './LayaService'

describe('sanitizeUtf16', () => {
  it('keeps valid Unicode including emoji pairs', () => {
    expect(sanitizeUtf16('Actualité 😀 internationale')).toBe('Actualité 😀 internationale')
  })

  it('replaces unpaired surrogate code units before JSON is sent to Laya', () => {
    const input = `avant${String.fromCharCode(0xD800)}milieu${String.fromCharCode(0xDC00)}après`
    const sanitized = sanitizeUtf16(input)

    expect(sanitized).toBe('avant�milieu�après')
    expect(JSON.stringify({ text: sanitized })).not.toContain('\\ud800')
    expect(JSON.stringify({ text: sanitized })).not.toContain('\\udc00')
  })
})

describe('resolveFolderDecisions', () => {
  it('keeps independent positive decisions for overlapping folders', () => {
    const ai = { id: 1, name: 'AI', description: 'artificial intelligence', sort_order: 0, created_at: 0, is_enabled: 1 }
    const security = { id: 2, name: 'Security', description: 'cybersecurity', sort_order: 1, created_at: 0, is_enabled: 1 }
    const decisions = resolveFolderDecisions(
      { answers: { ai: { noul: 0.91 }, security: { noul: 0.88 } } },
      { id: 1, feed_id: 1, title: 'AI security', excerpt: null, content_text: null },
      [{ key: 'ai', folder: ai }, { key: 'security', folder: security }],
    )

    expect(decisions.map(item => item.decision)).toEqual(['include', 'include'])
    expect(decisions.map(item => item.folder.id)).toEqual([1, 2])
  })
})
