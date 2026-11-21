// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeedPropertiesModal } from './FeedPropertiesModal'
import { useFeedStore } from '../../store/feedStore'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('FeedPropertiesModal', () => {
  it('edits and saves the feed name and URL', async () => {
    const updateFeed = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    useFeedStore.setState({
      feeds: [{ id: 1, title: 'Old name', url: 'https://example.com/rss', group_id: null, site_url: null, favicon_url: null, unread_count: 0, article_count: 0, error_count: 0, is_active: true, fetch_interval_sec: 900 }],
      updateFeed,
    })
    render(React.createElement(FeedPropertiesModal, { feedId: 1, onClose }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New name' } })
    fireEvent.change(screen.getByLabelText('Feed URL'), { target: { value: 'https://example.org/feed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateFeed).toHaveBeenCalledWith(1, { title: 'New name', url: 'https://example.org/feed' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('keeps edits visible when saving fails', async () => {
    useFeedStore.setState({ updateFeed: vi.fn().mockRejectedValue(new Error('This feed URL is already subscribed')) })
    const onClose = vi.fn()
    render(React.createElement(FeedPropertiesModal, { feedId: 1, onClose }))
    fireEvent.change(screen.getByLabelText('Feed URL'), { target: { value: 'https://example.org/feed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This feed URL is already subscribed')
    expect(onClose).not.toHaveBeenCalled()
  })
})
