import { describe, it, expect } from 'vitest'
import { parseFeed } from './FeedParser'

describe('FeedParser', () => {
  it('parses RSS 2.0 correctly', () => {
    const rss = `<?xml version="1.0" encoding="UTF-8" ?>
    <rss version="2.0">
    <channel>
      <title>Test Feed</title>
      <link>https://example.com</link>
      <description>Description of the feed</description>
      <item>
        <title>Article 1</title>
        <link>https://example.com/article1</link>
        <description>Content of article 1</description>
        <pubDate>Mon, 06 Sep 2021 16:45:00 +0000</pubDate>
      </item>
    </channel>
    </rss>`

    const result = parseFeed(rss, 'application/rss+xml')
    expect(result.format).toBe('rss')
    expect(result.meta.title).toBe('Test Feed')
    expect(result.articles).toHaveLength(1)
    expect(result.articles[0].title).toBe('Article 1')
    expect(result.articles[0].url).toBe('https://example.com/article1')
    expect(result.articles[0].content_html).toBe('Content of article 1')
  })

  it('parses Atom 1.0 correctly', () => {
    const atom = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Test Atom Feed</title>
      <link href="https://example.com/"/>
      <entry>
        <title>Atom Article</title>
        <link href="https://example.com/atom1"/>
        <id>urn:uuid:12345</id>
        <updated>2021-09-06T16:45:00Z</updated>
        <summary>Summary of atom article</summary>
      </entry>
    </feed>`

    const result = parseFeed(atom, 'application/atom+xml')
    expect(result.format).toBe('atom')
    expect(result.meta.title).toBe('Test Atom Feed')
    expect(result.articles).toHaveLength(1)
    expect(result.articles[0].title).toBe('Atom Article')
    expect(result.articles[0].content_html).toBe('Summary of atom article')
  })

  it('parses JSON Feed 1.1 correctly', () => {
    const jsonfeed = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'JSON Feed Test',
      items: [
        {
          id: 'json1',
          title: 'JSON Article',
          url: 'https://example.com/json1',
          content_html: '<p>HTML content</p>',
        },
      ],
    })

    const result = parseFeed(jsonfeed, 'application/feed+json')
    expect(result.format).toBe('jsonfeed')
    expect(result.meta.title).toBe('JSON Feed Test')
    expect(result.articles).toHaveLength(1)
    expect(result.articles[0].title).toBe('JSON Article')
    expect(result.articles[0].content_text).toBe('HTML content')
  })

  describe('thumbnail extraction', () => {
    it('extracts thumbnail from media:thumbnail in RSS', () => {
      const rss = `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <link>https://example.com</link>
        <item>
          <title>Article with thumbnail</title>
          <link>https://example.com/article1</link>
          <media:thumbnail url="https://cdn.example.com/image.jpg"/>
        </item>
      </channel>
      </rss>`

      const result = parseFeed(rss, 'application/rss+xml')
      expect(result.articles[0].thumbnail_url).toBe('https://cdn.example.com/image.jpg')
    })

    it('extracts thumbnail from first img in HTML content for RSS', () => {
      const rss = `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <link>https://example.com</link>
        <item>
          <title>Article with inline image</title>
          <link>https://example.com/article1</link>
          <description><![CDATA[<p>Some text</p><img src="https://example.com/images/pic.jpg"/>]]></description>
        </item>
      </channel>
      </rss>`

      const result = parseFeed(rss, 'application/rss+xml')
      expect(result.articles[0].thumbnail_url).toBe('https://example.com/images/pic.jpg')
    })

    it('resolves relative thumbnail URLs in RSS', () => {
      const rss = `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <link>https://example.com</link>
        <item>
          <title>Article with relative thumbnail</title>
          <link>https://example.com/article1</link>
          <description><![CDATA[<img src="/images/relative-pic.jpg"/>]]></description>
        </item>
      </channel>
      </rss>`

      const result = parseFeed(rss, 'application/rss+xml')
      expect(result.articles[0].thumbnail_url).toBe('https://example.com/images/relative-pic.jpg')
    })

    it('extracts YouTube thumbnail from Atom feed', () => {
      const atom = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
        <title>YouTube Feed</title>
        <link href="https://www.youtube.com/"/>
        <entry>
          <title>YouTube Video</title>
          <link href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
          <id>yt:video:dQw4w9WgXcQ</id>
          <updated>2021-09-06T16:45:00Z</updated>
          <yt:videoId>dQw4w9WgXcQ</yt:videoId>
        </entry>
      </feed>`

      const result = parseFeed(atom, 'application/atom+xml')
      expect(result.articles[0].thumbnail_url).toBe(
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      )
    })

    it('resolves relative thumbnail URLs in Atom feed', () => {
      const atom = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Test Feed</title>
        <link href="https://blog.example.com/"/>
        <entry>
          <title>Atom Article</title>
          <link href="https://blog.example.com/post/123"/>
          <id>urn:uuid:test123</id>
          <updated>2021-09-06T16:45:00Z</updated>
          <content><![CDATA[<p>Text</p><img src="assets/thumb.png"/>]]></content>
        </entry>
      </feed>`

      const result = parseFeed(atom, 'application/atom+xml')
      expect(result.articles[0].thumbnail_url).toBe('https://blog.example.com/assets/thumb.png')
    })

    it('filters out data: URLs from thumbnail extraction', () => {
      const rss = `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <link>https://example.com</link>
        <item>
          <title>Article</title>
          <link>https://example.com/article1</link>
          <description><![CDATA[<img src="data:image/png;base64,abc123"/>]]></description>
        </item>
      </channel>
      </rss>`

      const result = parseFeed(rss, 'application/rss+xml')
      expect(result.articles[0].thumbnail_url).toBeNull()
    })

    it('filters out protocol-relative URLs from thumbnail extraction', () => {
      const rss = `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <link>https://example.com</link>
        <item>
          <title>Article</title>
          <link>https://example.com/article1</link>
          <description><![CDATA[<img src="//cdn.example.com/image.jpg"/>]]></description>
        </item>
      </channel>
      </rss>`

      const result = parseFeed(rss, 'application/rss+xml')
      expect(result.articles[0].thumbnail_url).toBeNull()
    })

    it('extracts thumbnail from JSON Feed explicit image field', () => {
      const jsonfeed = JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: 'JSON Feed Test',
        items: [
          {
            id: 'json1',
            title: 'JSON Article',
            url: 'https://example.com/json1',
            image: 'https://example.com/explicit-image.jpg',
          },
        ],
      })

      const result = parseFeed(jsonfeed, 'application/feed+json')
      expect(result.articles[0].thumbnail_url).toBe('https://example.com/explicit-image.jpg')
    })

    it('extracts thumbnail from media:thumbnail in Atom feed', () => {
      const atom = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Test Feed</title>
        <link href="https://example.com/"/>
        <entry>
          <title>Atom Article</title>
          <link href="https://example.com/atom1"/>
          <id>urn:uuid:test456</id>
          <updated>2021-09-06T16:45:00Z</updated>
          <media:thumbnail url="https://media.example.com/thumb.jpg"/>
        </entry>
      </feed>`

      const result = parseFeed(atom, 'application/atom+xml')
      expect(result.articles[0].thumbnail_url).toBe('https://media.example.com/thumb.jpg')
    })

    it('extracts thumbnail from content:encoded in RSS', () => {
      const rss = `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <link>https://example.com</link>
        <item>
          <title>Article with content:encoded</title>
          <link>https://example.com/article1</link>
          <content:encoded><![CDATA[<div class="article"><h2>Title</h2><p>Paragraph</p><img src="https://content.example.com/photo.png" alt="Photo"/></div>]]></content:encoded>
        </item>
      </channel>
      </rss>`

      const result = parseFeed(rss, 'application/rss+xml')
      expect(result.articles[0].thumbnail_url).toBe('https://content.example.com/photo.png')
    })

    it('extracts thumbnail from Atom feed content with img', () => {
      const atom = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Test Feed</title>
        <link href="https://example.com/"/>
        <entry>
          <title>Atom Article</title>
          <link href="https://example.com/article"/>
          <id>urn:uuid:test789</id>
          <updated>2021-09-06T16:45:00Z</updated>
          <content type="html"><![CDATA[<p>Hello world</p><img src="https://images.example.com/hero.jpg"/><p>More content</p>]]></content>
        </entry>
      </feed>`

      const result = parseFeed(atom, 'application/atom+xml')
      expect(result.articles[0].thumbnail_url).toBe('https://images.example.com/hero.jpg')
    })

    it('handles multiple images and picks the first one', () => {
      const rss = `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <link>https://example.com</link>
        <item>
          <title>Article with multiple images</title>
          <link>https://example.com/article1</link>
          <description><![CDATA[<img src="https://example.com/first.jpg"/><img src="https://example.com/second.jpg"/>]]></description>
        </item>
      </channel>
      </rss>`

      const result = parseFeed(rss, 'application/rss+xml')
      expect(result.articles[0].thumbnail_url).toBe('https://example.com/first.jpg')
    })

    it('formats HackerNews content with comments link', () => {
      const rss = `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
      <channel>
        <title>Hacker News</title>
        <link>https://news.ycombinator.com</link>
        <item>
          <title>Interesting Tech Post</title>
          <link>https://news.ycombinator.com/item?id=12345</link>
          <guid isPermaLink="false">https://news.ycombinator.com/item?id=12345</guid>
          <comments>https://news.ycombinator.com/item?id=12345</comments>
          <description><![CDATA[
<p>Article URL: <a href="https://example.com/article">https://example.com/article</a></p>
<p>Comments URL: <a href="https://news.ycombinator.com/item?id=12345">https://news.ycombinator.com/item?id=12345</a></p>
<p>Points: 42</p>
<p># Comments: 15</p>
]]></description>
        </item>
      </channel>
      </rss>`

      const result = parseFeed(rss, 'application/rss+xml')
      expect(result.articles[0].content_html).toContain('View Comments on Hacker News')
      expect(result.articles[0].content_html).toContain('42')
      expect(result.articles[0].content_html).toContain('15')
      expect(result.articles[0].content_html).toContain('https://example.com/article')
    })

    it('detects HackerNews feeds from external article links via content format', () => {
      // This simulates hnrss.org where the link is the external article URL
      // but the guid and description match HN format
      const rss = `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
      <channel>
        <title>Hacker News: Best</title>
        <link>https://hnrss.org/best</link>
        <item>
          <title>Some Interesting Article</title>
          <link>https://external-blog.com/post</link>
          <guid isPermaLink="false">https://news.ycombinator.com/item?id=99999</guid>
          <comments>https://news.ycombinator.com/item?id=99999</comments>
          <description><![CDATA[
<p>Article URL: <a href="https://external-blog.com/post">https://external-blog.com/post</a></p>
<p>Comments URL: <a href="https://news.ycombinator.com/item?id=99999">https://news.ycombinator.com/item?id=99999</a></p>
<p>Points: 100</p>
<p># Comments: 50</p>
]]></description>
        </item>
      </channel>
      </rss>`

      const result = parseFeed(rss, 'application/rss+xml')
      expect(result.articles[0].content_html).toContain('hackernews-content')
      expect(result.articles[0].content_html).toContain('View Comments on Hacker News')
      expect(result.articles[0].content_html).toContain('⬆ 100')
      expect(result.articles[0].content_html).toContain('💬 50')
    })
  })
})
