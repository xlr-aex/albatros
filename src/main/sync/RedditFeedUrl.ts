/** Convert a subreddit page URL to its Atom feed URL. Leave other URLs intact. */
export function normalizeRedditFeedUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!['reddit.com', 'www.reddit.com', 'old.reddit.com'].includes(url.hostname.toLowerCase())) return value
    const match = url.pathname.match(/^\/r\/([a-z0-9_]+)\/?$/i)
    if (!match) return value
    return `${url.origin}/r/${match[1]}/.rss`
  } catch {
    return value
  }
}
