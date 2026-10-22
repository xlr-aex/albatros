import { describe, expect, it } from 'vitest'
import { extractSearchHighlightTerms } from './searchHighlight'

describe('extractSearchHighlightTerms', () => {
  it('keeps positive phrase terms and removes search syntax', () => {
    expect(extractSearchHighlightTerms('"manifestation lycéenne" after:2026-01-01')).toEqual([
      'manifestation lycéenne', 'manifestation', 'lycéenne',
    ])
  })

  it('does not highlight exclusions or boolean operators', () => {
    expect(extractSearchHighlightTerms('ransomware -bitcoin OR LockBit')).toEqual(['ransomware', 'LockBit'])
  })
})
