import { describe, expect, it } from 'vitest'
import { isBlockedNetworkAddress, parseExternalHttpUrl } from './ExternalUrlPolicy'

describe('ExternalUrlPolicy', () => {
  it.each([
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1',
  ])('blocks reserved address %s', address => {
    expect(isBlockedNetworkAddress(address)).toBe(true)
  })

  it.each(['https://example.com/feed.xml', 'http://feeds.example.org/rss'])('accepts public HTTP URLs', value => {
    expect(parseExternalHttpUrl(value).href).toBe(value)
  })

  it.each([
    'file:///etc/passwd', 'ftp://example.com/feed.xml', 'http://localhost:8080/feed',
    'http://169.254.169.254/latest/meta-data', 'https://user:password@example.com/feed',
  ])('rejects unsafe feed URL %s', value => {
    expect(() => parseExternalHttpUrl(value)).toThrow()
  })
})
