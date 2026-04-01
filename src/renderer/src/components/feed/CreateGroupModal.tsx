/**
 * @file components/feed/CreateGroupModal.tsx
 * @description Modal dialog for creating a new Feed Group (Folder).
 */

import React, { useState, useRef, useEffect } from 'react'
import { useFeedStore } from '../../store/feedStore'
import styles from './CreateGroupModal.module.css'

interface Props { onClose: () => void }

export function CreateGroupModal({ onClose }: Props) {
  const { createGroup } = useFeedStore()
  const [name, setName]         = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    try {
      await createGroup(trimmed)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal} role="dialog" aria-label="Create Folder">
        <div className={styles.header}>
          <h2 className={styles.title}>Create Folder</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label} htmlFor="folder-name">Folder Name</label>
          <input
            id="folder-name"
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="e.g. OSINT, News, Science..."
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.submitBtn} disabled={loading || !name.trim()}>
              {loading ? 'Creating…' : 'Create Folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
