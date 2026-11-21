import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
])

function isBlockedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
}

/** Returns whether an address belongs to a loopback, private, link-local or reserved range. */
export function isBlockedNetworkAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase()
  const family = isIP(normalized)
  if (family === 4) return isBlockedIpv4(normalized)
  if (family !== 6) return true

  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('2001:db8:')) return true

  const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]
  return mappedIpv4 ? isBlockedIpv4(mappedIpv4) : false
}

/** Validates URL shape and literal hosts before a feed is persisted. */
export function parseExternalHttpUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Feed URL must be a valid HTTP or HTTPS URL.')
  }

  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Feed URL must use HTTP or HTTPS.')
  if (url.username || url.password) throw new Error('Feed URL must not contain credentials.')

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || (isIP(hostname) !== 0 && isBlockedNetworkAddress(hostname))) {
    throw new Error('Feed URL must not target a local, private, or metadata address.')
  }

  return url
}

/** Resolves DNS immediately before a request, preventing hostname-based SSRF and unsafe redirects. */
export async function assertSafeExternalHttpUrl(value: string): Promise<URL> {
  const url = parseExternalHttpUrl(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) return url

  let addresses: { address: string }[]
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error(`Could not resolve feed host: ${hostname}`)
  }
  if (!addresses.length || addresses.some(({ address }) => isBlockedNetworkAddress(address))) {
    throw new Error('Feed URL resolves to a local, private, or metadata address.')
  }
  return url
}
