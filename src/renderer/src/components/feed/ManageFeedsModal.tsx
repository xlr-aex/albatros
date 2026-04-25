/**
 * ManageFeedsModal.tsx
 * Axe 4 : Bouton "Supprimer les flux sélectionnés" avec badge séparé (plus de "Delete 0 Feeds").
 * Suppression de window.confirm() → remplacé par un toast d'annulation (5 secondes).
 */
import React, { useState, useRef } from 'react'
import { useFeedStore, type Feed } from '../../store/feedStore'
import styles from '../settings/SettingsPanel.module.css'
import toastStyles from './ManageFeedsModal.module.css'

interface Props {
  onClose: () => void
}

export function ManageFeedsModal({ onClose }: Props) {
  const { feeds, deleteFeed, loadFeeds } = useFeedStore()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [undoVisible, setUndoVisible] = useState(false)
  const [deletedFeeds, setDeletedFeeds] = useState<Feed[]>([])
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    // Store deleted feeds for possible undo
    const toDelete = feeds.filter(f => selected.has(f.id))
    setDeletedFeeds(toDelete)

    for (const id of selected) {
      await deleteFeed(id)
    }
    setSelected(new Set())

    // Show undo toast for 5 seconds
    setUndoVisible(true)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => {
      setUndoVisible(false)
      setDeletedFeeds([])
    }, 5000)
  }

  // Undo: re-add feeds via OPML-style re-add (best effort — re-add each URL)
  const handleUndo = async () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    setUndoVisible(false)
    // Re-add each deleted feed by URL
    for (const feed of deletedFeeds) {
      try {
        await window.api.feeds.add(feed.url)
      } catch {
        // ignore individual failures
      }
    }
    setDeletedFeeds([])
    void loadFeeds()
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
          <h2 className={styles.headerTitle}>Gérer les flux</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className={styles.body} style={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
              <input
                type="checkbox"
                checked={selected.size === feeds.length && feeds.length > 0}
                ref={input => { if (input) input.indeterminate = selected.size > 0 && selected.size < feeds.length }}
                onChange={toggleAll}
              />
              Tout sélectionner
            </label>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {selected.size} / {feeds.length} sélectionné{selected.size > 1 ? 's' : ''}
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
                  border: selected.has(feed.id) ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                }}
                onMouseEnter={e => e.currentTarget.style.background = selected.has(feed.id) ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-elevated)'}
                onMouseLeave={e => e.currentTarget.style.background = selected.has(feed.id) ? 'rgba(59, 130, 246, 0.1)' : 'transparent'}
              >
                <input type="checkbox" checked={selected.has(feed.id)} onChange={() => toggle(feed.id)} />
                <img
                  src={getFavicon(feed)}
                  width={16} height={16} alt=""
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
                Aucun flux ajouté.
              </div>
            )}
          </div>
        </div>

        {/* Footer — fixed label button (no "Delete 0 Feeds" paradox) */}
        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <button
            style={{ padding: '8px 16px', fontWeight: 'bold', background: 'transparent', border: '1px solid var(--border-light)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer' }}
            onClick={onClose}
          >
            Fermer
          </button>

          {/* Fixed label + dynamic badge counter (no "Delete 0" paradox) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {selected.size > 0 && (
              <span style={{
                padding: '2px 8px',
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.35)',
                borderRadius: '9999px',
                fontSize: '12px',
                color: '#f87171',
                fontWeight: 'bold',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {selected.size}
              </span>
            )}
            <button
              style={{
                padding: '8px 16px',
                fontWeight: 'bold',
                background: selected.size > 0 ? 'rgba(239,68,68,0.85)' : 'var(--bg-elevated)',
                border: 'none',
                borderRadius: '6px',
                color: selected.size > 0 ? '#fff' : 'var(--text-muted)',
                cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
                transition: 'all 150ms',
                opacity: selected.size > 0 ? 1 : 0.5,
              }}
              onClick={handleDelete}
              disabled={selected.size === 0}
              onMouseEnter={e => { if (selected.size) e.currentTarget.style.background = '#dc2626' }}
              onMouseLeave={e => { if (selected.size) e.currentTarget.style.background = 'rgba(239,68,68,0.85)' }}
            >
              🗑 Supprimer les flux sélectionnés
            </button>
          </div>
        </div>
      </div>

      {/* Undo Toast */}
      {undoVisible && (
        <div className={toastStyles.undoToast} role="status" aria-live="polite">
          <span>
            {deletedFeeds.length} flux supprimé{deletedFeeds.length > 1 ? 's' : ''}
          </span>
          <button className={toastStyles.undoBtn} onClick={handleUndo}>
            ↩ Annuler
          </button>
          <button className={toastStyles.toastClose} onClick={() => { setUndoVisible(false); setDeletedFeeds([]) }} aria-label="Fermer">✕</button>
        </div>
      )}
    </div>
  )
}
