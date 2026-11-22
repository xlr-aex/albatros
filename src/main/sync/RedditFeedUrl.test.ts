import { describe, expect, it } from 'vitest'
import { normalizeRedditFeedUrl } from './RedditFeedUrl'

describe('normalizeRedditFeedUrl', () => {
  it('uses the Atom endpoint for a subreddit page', () => {
    expect(normalizeRedditFeedUrl('https://www.reddit.com/r/homeautomation/'))
      .toBe('https://www.reddit.com/r/homeautomation/.rss')
    expect(normalizeRedditFeedUrl('https://reddit.com/r/homeautomation?sort=new'))
      .toBe('https://reddit.com/r/homeautomation/.rss')
  })

  it('keeps feed endpoints and unrelated URLs unchanged', () => {
    expect(normalizeRedditFeedUrl('https://www.reddit.com/r/homeautomation/.rss'))
      .toBe('https://www.reddit.com/r/homeautomation/.rss')
    expect(normalizeRedditFeedUrl('https://example.com/r/homeautomation/'))
      .toBe('https://example.com/r/homeautomation/')
    expect(normalizeRedditFeedUrl('https://reddit.com.evil.example/r/homeautomation/'))
      .toBe('https://reddit.com.evil.example/r/homeautomation/')
  })
})
