import React, { useState } from 'react'
import { useFeedStore } from '../../store/feedStore'
import styles from './AddFeedModal.module.css'

interface Props {
  feedId: number
  onClose: () => void
}

export function FeedPropertiesModal({ feedId, onClose }: Props) {
  const feed = useFeedStore(s => s.feeds.find(f => f.id === feedId))
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedSite, setCopiedSite] = useState(false)

  if (!feed) return null

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(feed.url)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } catch (err) {
      console.error('Failed to copy', err)
    }
  }

  const handleCopySite = async () => {
    if (!feed.site_url) return
    try {
      await navigator.clipboard.writeText(feed.site_url)
      setCopiedSite(true)
      setTimeout(() => setCopiedSite(false), 2000)
    } catch (err) {
      console.error('Failed to copy', err)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        
        <div className={styles.header}>
          <h2 className={styles.title}>Feed Properties</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.form}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label className={styles.label}>Name</label>
            <input 
              type="text" 
              className={styles.input} 
              value={feed.title || feed.url} 
              readOnly 
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label className={styles.label}>RSS URL</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                className={styles.input} 
                value={feed.url} 
                readOnly 
              />
              <button 
                className={styles.cancelBtn}
                style={{ minWidth: '80px' }}
                onClick={handleCopyUrl}
                title="Copy URL"
              >
                {copiedUrl ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          </div>

          {feed.site_url && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label className={styles.label}>Website URL</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  className={styles.input} 
                  value={feed.site_url} 
                  readOnly 
                />
                <button 
                  className={styles.cancelBtn}
                  style={{ minWidth: '80px' }}
                  onClick={handleCopySite}
                  title="Copy Website"
                >
                  {copiedSite ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer} style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <button className={styles.submitBtn} onClick={onClose}>
            Close
          </button>
        </div>
        
      </div>
    </div>
  )
}
