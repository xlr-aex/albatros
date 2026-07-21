// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { getPreferredImageUrl, normalizeArticleHtml } from './articleHtml'

describe('normalizeArticleHtml', () => {
  it('resolves relative/lazy images and applies hotlink-safe loading attributes', () => {
    const html = normalizeArticleHtml(
      '<p>Text</p><img data-src="/hero.jpg" alt="hero">',
      'https://example.com/posts/one',
      null,
    )
    expect(html).toContain('src="https://example.com/hero.jpg"')
    expect(html).toContain('referrerpolicy="no-referrer"')
    expect(html).toContain('loading="lazy"')
  })

  it('uses the feed thumbnail when the post has no usable body image', () => {
    const html = normalizeArticleHtml('<p>Text only</p>', 'https://example.com/post', 'https://cdn.example.com/cover.jpg')
    expect(html).toContain('src="https://cdn.example.com/cover.jpg"')
  })

  it('upgrades TechXplore thumbnail URLs to the original asset', () => {
    expect(getPreferredImageUrl('https://scx1.b-cdn.net/csz/news/tmb/2026/example.jpg'))
      .toBe('https://scx2.b-cdn.net/gfx/news/2026/example.jpg')
  })

  it('keeps the RSS thumbnail as a fallback for upgraded images', () => {
    const html = normalizeArticleHtml('', null, 'https://scx1.b-cdn.net/csz/news/tmb/2024/chatbot.jpg')
    expect(html).toContain('src="https://scx2.b-cdn.net/gfx/news/2024/chatbot.jpg"')
    expect(html).toContain('data-fallback-src="https://scx1.b-cdn.net/csz/news/tmb/2024/chatbot.jpg"')
  })

  it('renders Reddit video player links as responsive players instead of preview images', () => {
    const html = normalizeArticleHtml(
      '<div><a href="https://reddit.com/r/test/comments/abc"><img src="https://external-preview.redd.it/post.png"></a></div>' +
      '<p><a href="https://reddit.com/link/abc/video/media123/player">Demo</a></p>',
      'https://reddit.com/r/test/comments/abc',
      'https://external-preview.redd.it/post.png',
    )
    expect(html).not.toContain('/video/media123/player')
    expect(html).not.toContain('<img')
  })
})
