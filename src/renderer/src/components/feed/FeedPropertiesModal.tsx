import React, { useRef, useState } from 'react'
import { useFeedStore } from '../../store/feedStore'
import styles from './AddFeedModal.module.css'
import properties from './FeedPropertiesModal.module.css'

interface Props {
  feedId: number
  onClose: () => void
}

export function FeedPropertiesModal({ feedId, onClose }: Props) {
  const feed = useFeedStore(s => s.feeds.find(f => f.id === feedId))
  const updateFeed = useFeedStore(s => s.updateFeed)
  const [name, setName] = useState(() => feed?.title || feed?.url || '')
  const [url, setUrl] = useState(() => feed?.url || '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  if (!feed) return null

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (savingRef.current) return
    const title = name.trim()
    const nextUrl = url.trim()
    if (!title || !nextUrl) {
      setError('A feed name and URL are required.')
      return
    }
    const patch: { title?: string; url?: string } = {}
    if (title !== (feed.title || feed.url)) patch.title = title
    if (nextUrl !== feed.url) patch.url = nextUrl
    if (!Object.keys(patch).length) { onClose(); return }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await updateFeed(feedId, patch)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save feed properties. Please try again.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget && !saving) onClose() }}
      onKeyDown={e => { if (e.key === 'Escape' && !saving) onClose() }}>
      <div className={`${styles.modal} ${properties.modal}`} role="dialog" aria-modal="true" aria-labelledby="feed-properties-title" aria-describedby={error ? 'feed-properties-error' : undefined}>
        <div className={styles.header}>
          <h2 id="feed-properties-title" className={styles.title}>Feed Properties</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} disabled={saving} aria-label="Close">✕</button>
        </div>

        <form className={`${styles.form} ${properties.form}`} onSubmit={save}>
          <div className={properties.field}>
            <label className={styles.label} htmlFor="feed-properties-name">Name</label>
            <input id="feed-properties-name" className={`${styles.input} ${properties.input}`} type="text" value={name} onChange={e => setName(e.target.value)} required autoFocus />
          </div>
          <div className={properties.field}>
            <label className={styles.label} htmlFor="feed-properties-url">Feed URL</label>
            <input id="feed-properties-url" className={`${styles.input} ${properties.input}`} type="url" value={url} onChange={e => setUrl(e.target.value)} required />
            <p className={properties.hint}>Changing the URL keeps your existing articles and refreshes the feed.</p>
          </div>
          {feed.site_url && <div className={properties.field}>
            <span className={styles.label}>Website</span>
            <span className={properties.website}>{feed.site_url}</span>
          </div>}
          {error && <p id="feed-properties-error" className={styles.error} role="alert">{error}</p>}
          <div className={styles.footer}>
            <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className={styles.submitBtn} disabled={saving || !name.trim() || !url.trim()}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
