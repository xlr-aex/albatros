/**
 * @file components/feed/AddFeedModal.tsx
 * @description Modal dialog for adding a new RSS feed subscription.
 */

import React, { useState, useRef, useEffect } from 'react'
import { useFeedStore } from '../../store/feedStore'
import styles from './AddFeedModal.module.css'

interface Props { onClose: () => void }

export function AddFeedModal({ onClose }: Props) {
  const { addFeed, groups } = useFeedStore()
  const [url, setUrl]         = useState('')
  const [groupId, setGroupId] = useState<number | undefined>(undefined)
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    try {
      await addFeed(trimmed, groupId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add feed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className={styles.overlay}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Add Feed" aria-describedby={error ? 'feed-error' : undefined}>
        <div className={styles.header}>
          <h2 className={styles.title}>Add RSS Feed</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label} htmlFor="feed-url">Feed URL or website address</label>
          <input
            id="feed-url"
            ref={inputRef}
            className={styles.input}
            type="url"
            placeholder="https://example.com/rss"
            value={url}
            onChange={e => setUrl(e.target.value)}
            required
          />

          {groups.length > 0 && (
            <>
              <label className={styles.label} htmlFor="feed-group">Add to group (optional)</label>
              <select
                id="feed-group"
                className={styles.select}
                value={groupId ?? ''}
                onChange={e => setGroupId(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">No group</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </>
          )}

          {error && <p id="feed-error" className={styles.error}>{error}</p>}

          <div className={styles.footer}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.submitBtn} disabled={loading || !url.trim()}>
              {loading ? '⟳ Adding…' : '+ Subscribe'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
