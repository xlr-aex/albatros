import React, { useState } from 'react'
import { useFeedStore, type Feed } from '../../store/feedStore'
import styles from '../settings/SettingsPanel.module.css'

interface Props {
  onClose: () => void
}

export function ManageFeedsModal({ onClose }: Props) {
  const { feeds, deleteFeed } = useFeedStore()
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggle = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const toggleAll = () => {
    if (selected.size === feeds.length) setSelected(new Set())
    else setSelected(new Set(feeds.map(f => f.id)))
  }

  const handleDelete = async () => {
    if (!selected.size) return
    const confirm = window.confirm(`Are you sure you want to permanently delete ${selected.size} feed(s) AND all of their saved articles?`)
    if (!confirm) return
    for (const id of selected) {
      await deleteFeed(id)
    }
    onClose()
  }

  const getFavicon = (feed: Feed) => {
    if (feed.favicon_url) return feed.favicon_url
    try {
      const url = feed.site_url || feed.url
      const hostname = new URL(url).hostname
      return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`
    } catch {
      return ''
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div 
        className={styles.panel} 
        style={{ maxWidth: '600px', display: 'flex', flexDirection: 'column', height: '80vh' }} 
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.header}>
           <h2 className={styles.headerTitle}>Manage Feeds</h2>
           <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body} style={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
               <input 
                 type="checkbox" 
                 checked={selected.size === feeds.length && feeds.length > 0}
                 ref={input => {
                   if (input) input.indeterminate = selected.size > 0 && selected.size < feeds.length
                 }}
                 onChange={toggleAll}
               />
               Select All
             </label>
             <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
               {selected.size} of {feeds.length} selected
             </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
             {feeds.map(feed => (
               <label 
                 key={feed.id} 
                 style={{ 
                   display: 'grid',
                   gridTemplateColumns: 'auto auto 1fr',
                   alignItems: 'center', 
                   gap: '12px',
                   padding: '8px 12px',
                   borderRadius: '6px',
                   cursor: 'pointer',
                   background: selected.has(feed.id) ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                   transition: 'background 150ms',
                   border: selected.has(feed.id) ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent'
                 }}
                 onMouseEnter={e => e.currentTarget.style.background = selected.has(feed.id) ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-elevated)'}
                 onMouseLeave={e => e.currentTarget.style.background = selected.has(feed.id) ? 'rgba(59, 130, 246, 0.1)' : 'transparent'}
               >
                 <input type="checkbox" checked={selected.has(feed.id)} onChange={() => toggle(feed.id)} />
                 <img 
                    src={getFavicon(feed)} 
                    width={16} 
                    height={16} 
                    alt="" 
                    onError={e => { e.currentTarget.style.display = 'none' }}
                 />
                 <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                   <span style={{ fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                     {feed.title || feed.url}
                   </span>
                   {feed.title && (
                     <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                       {feed.url}
                     </span>
                   )}
                 </div>
               </label>
             ))}
             {feeds.length === 0 && (
               <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                 No feeds added yet.
               </div>
             )}
          </div>

        </div>

        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <button 
             style={{ padding: '8px 16px', fontWeight: 'bold', background: 'transparent', border: '1px solid var(--border-light)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer' }} 
             onClick={onClose}
             onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
             onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            Cancel
          </button>
          <button 
             style={{ 
               padding: '8px 16px', 
               fontWeight: 'bold', 
               background: selected.size > 0 ? '#ef4444' : 'var(--bg-elevated)',
               border: 'none', 
               borderRadius: '6px', 
               color: selected.size > 0 ? '#fff' : 'var(--text-muted)', 
               cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
               transition: 'all 150ms'
             }} 
             onClick={handleDelete}
             disabled={selected.size === 0}
             onMouseEnter={e => { if (selected.size) e.currentTarget.style.background = '#dc2626' }}
             onMouseLeave={e => { if (selected.size) e.currentTarget.style.background = '#ef4444' }}
          >
             Delete {selected.size} Feeds
          </button>
        </div>

      </div>
    </div>
  )
}
