import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: {},
}))

import { sanitizeUtf16 } from './LayaService'

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
