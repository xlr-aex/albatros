import { describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
  },
}))

import { isRedditPostUrl, registerArticleHandlers } from './articles'

describe('isRedditPostUrl', () => {
  it.each([
    'https://www.reddit.com/r/typescript/comments/abc123/example/',
    'https://old.reddit.com/r/typescript/comments/abc123/example/',
    'https://reddit.com/r/typescript/comments/abc123/example/',
  ])('accepts an HTTPS Reddit post URL: %s', url => {
    expect(isRedditPostUrl(url)).toBe(true)
  })

  it.each([
    'http://www.reddit.com/r/typescript/comments/abc123/example/',
    'https://reddit.com.evil.example/r/typescript/comments/abc123/example/',
    'http://127.0.0.1/?reddit.com',
    'not a URL containing reddit.com',
  ])('rejects an untrusted comment URL: %s', url => {
    expect(isRedditPostUrl(url)).toBe(false)
  })
})

describe('mark-all-read IPC handler', () => {
  it('uses the single-statement recount for a whole-library operation', () => {
    const articleService = { markAllRead: vi.fn(() => 12) }
    const feedService = {
      recountUnread: vi.fn(),
      recountAllUnread: vi.fn(),
      getAll: vi.fn(),
    }

    registerArticleHandlers(articleService as never, {} as never, feedService as never)
    const handler = handlers.get('articles:mark-all-read')

    expect(handler?.({}, undefined)).toBe(12)
    expect(feedService.recountAllUnread).toHaveBeenCalledOnce()
    expect(feedService.recountUnread).not.toHaveBeenCalled()
    expect(feedService.getAll).not.toHaveBeenCalled()
  })
})
