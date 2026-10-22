import { describe, expect, it } from 'vitest'
import { parseSearchQuery } from './SearchQuery'

describe('parseSearchQuery', () => {
  it('supports phrases, exclusions and boolean groups', () => {
    expect(parseSearchQuery('ransomware -bitcoin').match).toBe('(ransomware* NOT bitcoin*)')
    expect(parseSearchQuery('(LockBit OR Akira) france').match).toBe('(((LockBit* OR Akira*)) AND france*)')
    expect(parseSearchQuery('"data breach"').match).toBe('"data breach"')
  })

  it('turns a phrase wildcard into a proximity search', () => {
    expect(parseSearchQuery('"ransomware * hospital"').match).toBe('ransomware* NEAR/10 hospital*')
  })

  it('extracts date and year-range filters without sending them to FTS', () => {
    const result = parseSearchQuery('ransomware after:2026-01-01 before:2026-02-01 2026..2026')
    expect(result.match).toBe('ransomware*')
    expect(result.publishedAfter).toBe(Date.UTC(2026, 0, 1) / 1000)
    expect(result.publishedBefore).toBe(Date.UTC(2026, 1, 1) / 1000)
  })
})
