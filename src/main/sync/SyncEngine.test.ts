import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetchFeed: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('./HttpClient', () => ({
  fetchFeed: mocks.fetchFeed,
  FeedHttpError: class FeedHttpError extends Error {},
}))
vi.mock('../db/connection', () => ({ persistDatabase: vi.fn() }))

import { SyncEngine } from './SyncEngine'

describe('feed URL fallback', () => {
  it('does not replace a Reddit URL with a generic /feed/ page', async () => {
    const engine = new SyncEngine({} as never, {} as never, {} as never)
    const result = await engine['tryFeedAlternatives']('https://www.reddit.com/r/homeautomation/.rss')
    expect(result).toBeNull()
    expect(mocks.fetchFeed).not.toHaveBeenCalled()
  })
})
