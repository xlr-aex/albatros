import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), validate: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(name, handler) }, dialog: {}, BrowserWindow: {} }))
vi.mock('../security/ExternalUrlPolicy', () => ({ assertSafeExternalHttpUrl: mocks.validate }))

import { registerFeedHandlers } from './feeds'

describe('feeds:update', () => {
  const feeds = { getById: vi.fn(), getByUrl: vi.fn(), update: vi.fn() }
  const scheduler = { refreshFeed: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.validate.mockResolvedValue(new URL('https://example.org/feed'))
    feeds.getById.mockReturnValue({ id: 1, url: 'https://example.com/rss' })
    feeds.getByUrl.mockReturnValue(null)
    scheduler.refreshFeed.mockResolvedValue(undefined)
    registerFeedHandlers(feeds as never, {} as never, scheduler as never)
  })

  it('validates a new URL, persists the custom title and refreshes', async () => {
    await mocks.handlers.get('feeds:update')?.({}, 1, { title: ' Custom ', url: ' https://example.org/feed ' })
    expect(mocks.validate).toHaveBeenCalledWith('https://example.org/feed')
    expect(feeds.update).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Custom', title_is_custom: true, url: 'https://example.org/feed' }))
    expect(scheduler.refreshFeed).toHaveBeenCalledWith(1)
  })

  it('rejects an unsafe or duplicate URL without changing the feed', async () => {
    mocks.validate.mockRejectedValueOnce(new Error('Blocked'))
    await expect(mocks.handlers.get('feeds:update')?.({}, 1, { url: 'http://localhost/' })).rejects.toThrow('Blocked')
    feeds.getByUrl.mockReturnValue({ id: 2 })
    await expect(mocks.handlers.get('feeds:update')?.({}, 1, { url: 'https://example.org/feed' })).rejects.toThrow('already subscribed')
    expect(feeds.update).not.toHaveBeenCalled()
  })
})
