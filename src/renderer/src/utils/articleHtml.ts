/** Normalise les images HTML de feeds avant injection dans le lecteur. */
export function getPreferredImageUrl(url: string): string {
  try {
    const parsed = new URL(url)
    // TechXplore/Phys.org thumbnails map to the full asset on the scx2 CDN.
    if (parsed.hostname.endsWith('b-cdn.net') && parsed.pathname.includes('/csz/news/tmb/')) {
      parsed.hostname = 'scx2.b-cdn.net'
      parsed.pathname = parsed.pathname.replace('/csz/news/tmb/', '/gfx/news/')
    }
    // Common WordPress thumbnail naming convention: image-300x200.jpg.
    parsed.pathname = parsed.pathname.replace(/(.*?)([_-])\d{2,4}x\d{2,4}(\.[a-z0-9]+)$/i, '$1$3')
    parsed.searchParams.delete('width')
    parsed.searchParams.delete('height')
    parsed.searchParams.delete('w')
    parsed.searchParams.delete('h')
    return parsed.href
  } catch {
    return url
  }
}

export function normalizeArticleHtml(
  html: string,
  baseUrl: string | null | undefined,
  fallbackThumbnail: string | null | undefined,
): string {
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') return html

  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  const redditVideoLinks = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .filter(link => /^https:\/\/(?:www\.)?reddit\.com\/link\/[^/]+\/video\/[^/]+\/player(?:[?#].*)?$/i.test(link.href))

  for (const link of redditVideoLinks) {
    const paragraph = link.closest('p')
    if (paragraph && paragraph.textContent?.trim() === link.textContent?.trim()) paragraph.remove()
    else link.remove()
  }

  if (redditVideoLinks.length > 0) {
    for (const image of Array.from(doc.querySelectorAll<HTMLImageElement>('img'))) {
      const src = image.getAttribute('src') || ''
      if (!/(?:external-preview|preview)\.redd\.it/i.test(src)) continue
      const parent = image.closest('div')
      if (parent && parent.querySelectorAll('img').length === 1 && !parent.textContent?.trim()) parent.remove()
      else image.remove()
    }
  }

  const images = Array.from(doc.querySelectorAll('img'))
  let usableImage = redditVideoLinks.length > 0

  for (const image of images) {
    const candidate =
      image.getAttribute('src') ||
      image.getAttribute('data-src') ||
      image.getAttribute('data-lazy-src') ||
      image.getAttribute('data-original')

    if (!candidate || candidate.startsWith('data:') || candidate === 'about:blank') continue

    let src = candidate.trim()
    try {
      src = src.startsWith('//')
        ? `https:${src}`
        : baseUrl
          ? new URL(src, baseUrl).href
          : src
    } catch {
      // Keep the original URL when a malformed feed URL cannot be resolved.
    }

    if (!/^https?:\/\//i.test(src)) continue
    image.setAttribute('src', src)
    image.setAttribute('referrerpolicy', 'no-referrer')
    image.setAttribute('loading', 'lazy')
    image.setAttribute('decoding', 'async')
    image.removeAttribute('data-src')
    image.removeAttribute('data-lazy-src')
    image.removeAttribute('data-original')
    usableImage = true
  }

  if (!usableImage && fallbackThumbnail && /^https?:\/\//i.test(fallbackThumbnail)) {
    const image = doc.createElement('img')
    const preferredUrl = getPreferredImageUrl(fallbackThumbnail)
    image.src = preferredUrl
    if (preferredUrl !== fallbackThumbnail) image.dataset.fallbackSrc = fallbackThumbnail
    image.alt = ''
    image.loading = 'lazy'
    image.decoding = 'async'
    image.referrerPolicy = 'no-referrer'
    image.style.cssText = 'max-width:100%;height:auto;display:block;margin:1em auto;border-radius:8px;'
    doc.body.insertBefore(image, doc.body.firstChild)
  }

  return doc.body.innerHTML
}
