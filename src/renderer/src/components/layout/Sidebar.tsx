/**
 * @file components/layout/Sidebar.tsx
 * @description Left navigation panel: system views, feed groups, feed items.
 *
 * Layout:
 *  ┌─────────────────────────┐
 *  │ [Logo] Albatros          │  ← Header (drag region)
 *  ├─────────────────────────┤
 *  │ ● All Items        (42) │  ← System views
 *  │ ★ Starred               │
 *  │ 🔖 Read Later            │
 *  │ 📅 Today                │
 *  ├─────────────────────────┤
 *  │ ▼ Tech (8 unread)       │  ← Feed group (collapsible)
 *  │   • Hacker News     (5) │  ← Feed items
 *  │   • The Verge       (3) │
 *  │ ▶ Science               │  ← Collapsed group
 *  ├─────────────────────────┤
 *  │ [+ Add Feed]            │  ← Footer
 *  └─────────────────────────┘
 */

import React, { useEffect, useState, useRef } from 'react'
import { useFeedStore, type Feed, type FeedGroup, type SystemView } from '../../store/feedStore'
import { useArticleStore } from '../../store/articleStore'
import { useUiStore } from '../../store/uiStore'
import { AddFeedModal } from '../feed/AddFeedModal'
import { CreateGroupModal } from '../feed/CreateGroupModal'
import { FeedPropertiesModal } from '../feed/FeedPropertiesModal'
import { ManageFeedsModal } from '../feed/ManageFeedsModal'
import { SettingsPanel } from '../settings/SettingsPanel'
import { HighlightText } from './HighlightText'
import styles from './Sidebar.module.css'
import logo from '../../assets/logo.png'

function getBaseDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const twoPartTld = /^(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(parts.slice(-2).join('.'))
  return parts.slice(twoPartTld ? -3 : -2).join('.')
}

function getFaviconFallbackUrl(feed: Feed): string {
  try {
    // Query the favicon service with the registrable domain — feed site URLs
    // sometimes live on subdomains with no favicon of their own.
    const url = feed.site_url || feed.url
    const hostname = getBaseDomain(new URL(url).hostname)
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
  } catch {
    return ''
  }
}

// ─── Emojis ───────────────────────────────────────────────────────────────────
const EMOJIS = [
  '📁',
  '📰',
  '🚀',
  '⭐',
  '💡',
  '🔥',
  '📌',
  '📚',
  '🎧',
  '🎮',
  '💻',
  '🤖',
  '🌐',
  '🌍',
  '🏠',
  '💼',
  '💰',
  '🎯',
  '🎨',
  '✨',
]

// ─── System view items ────────────────────────────────────────────────────────

const SYSTEM_VIEWS = [
  {
    type: 'all' as const,
    label: 'All Items',
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
      </svg>
    ),
  },
  {
    type: 'unread' as const,
    label: 'Unread',
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
  },
  {
    type: 'saved' as const,
    label: 'Saved Posts',
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    type: 'today' as const,
    label: 'Today',
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    type: 'github' as const,
    label: 'GitHub Links',
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
      </svg>
    ),
  },
  {
    type: 'digest' as const,
    label: 'Chatbot',
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
]

const ChevronRight = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
)
const GripIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={styles.dragGrip}>
    <circle cx="8" cy="5" r="2.5" />
    <circle cx="16" cy="5" r="2.5" />
    <circle cx="8" cy="12" r="2.5" />
    <circle cx="16" cy="12" r="2.5" />
    <circle cx="8" cy="19" r="2.5" />
    <circle cx="16" cy="19" r="2.5" />
  </svg>
)

// ─── Component ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const {
    feeds,
    groups,
    selection,
    setSelection,
    totalUnread,
    toggleGroup,
    deleteFeed,
    updateFeed,
    loadFeeds,
    deleteGroup,
  } = useFeedStore()
  const { loadArticles, articles } = useArticleStore()
  const { syncingFeedIds, isSyncing, syncCompletionSequence } = useUiStore()
  const [showSyncComplete, setShowSyncComplete] = useState(false)
  const [addFeedOpen, setAddFeedOpen] = useState(false)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [menuVisible, setMenuVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manageFeedsOpen, setManageFeedsOpen] = useState(false)
  const [isDragOverRoot, setIsDragOverRoot] = useState(false)
  const rootDragCounter = useRef(0)

  const [feedPropertiesOpen, setFeedPropertiesOpen] = useState<number | null>(null)

  useEffect(() => {
    if (syncCompletionSequence === 0) return
    setShowSyncComplete(true)
    const timer = window.setTimeout(() => setShowSyncComplete(false), 1_800)
    return () => window.clearTimeout(timer)
  }, [syncCompletionSequence])
  const [ctxMenu, setCtxMenu] = useState<{ feedId: number; x: number; y: number } | null>(null)
  const [groupCtxMenu, setGroupCtxMenu] = useState<{
    groupId: number
    x: number
    y: number
  } | null>(null)
  const [emojiPicker, setEmojiPicker] = useState<{ groupId: number; x: number; y: number } | null>(
    null,
  )

  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)

  // Real-time debounced article search
  const lastSearchRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const q = searchQuery.trim()
    const timer = setTimeout(() => {
      if (q) {
        // Skip when the same query already ran — the selection change below
        // would otherwise re-trigger this effect and run the search twice.
        if (lastSearchRef.current === q && selection.type === 'search') return
        lastSearchRef.current = q
        setSelection({ type: 'search' })
        void loadArticles({ searchQuery: q })
      } else {
        lastSearchRef.current = null
        if (selection.type === 'search') {
          setSelection({ type: 'all' })
          void loadArticles({})
        }
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, loadArticles, selection.type, setSelection])

  // Computed matching items for auto-complete dropdown
  const qLower = searchQuery.toLowerCase().trim()
  const matchedGroups = qLower ? groups.filter(g => g.name.toLowerCase().includes(qLower)) : []
  const matchedFeeds = qLower
    ? feeds.filter(f => (f.title || f.url).toLowerCase().includes(qLower))
    : []
  const lastSaveTimestamp = useArticleStore(s => s.lastSaveTimestamp)
  const savedBtnRef = useRef<HTMLButtonElement>(null)

  // Imperatively animate the "Saved Posts" button when an article is saved.
  // Uses Web Animations API — completely decoupled from React renders.
  React.useEffect(() => {
    if (!lastSaveTimestamp || !savedBtnRef.current) return
    savedBtnRef.current.animate(
      [
        {
          background: 'color-mix(in srgb, var(--color-saved), transparent 55%)',
          color: 'var(--color-saved)',
          transform: 'scale(1.04)',
          offset: 0,
        },
        { transform: 'scale(1)', offset: 0.08 },
        {
          background: 'color-mix(in srgb, var(--color-saved), transparent 60%)',
          color: 'var(--color-saved)',
          offset: 0.55,
        },
        { background: 'transparent', color: 'var(--text-secondary)', offset: 1 },
      ],
      { duration: 3000, easing: 'ease-out', fill: 'none' },
    )
  }, [lastSaveTimestamp])

  const showSearchDropdown =
    isSearchFocused && qLower.length > 0 && (matchedGroups.length > 0 || matchedFeeds.length > 0)

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
  }

  const handleOpmlImport = async () => {
    const count = await window.api.opml.import()
    if (count > 0) void loadFeeds()
  }

  const handleOpmlExport = async () => {
    await window.api.opml.export()
  }

  // Groups feeds by group_id for easy rendering
  const feedsByGroup = React.useMemo(() => {
    const map = new Map<number | null, Feed[]>()
    map.set(null, [])
    for (const g of groups) map.set(g.id, [])
    for (const f of feeds) {
      const bucket = map.get(f.group_id) ?? map.get(null)!
      bucket.push(f)
    }
    return map
  }, [feeds, groups])

  function selectSystemView(type: SystemView | 'digest') {
    setSearchQuery('')
    setSelection({ type: type as SystemView }) // Treat digest as a SystemView effectively
    if (type !== 'digest' && type !== 'github') {
      void loadArticles({
        unread_only: type === 'unread',
        saved_only: type === 'saved',
        today_only: type === 'today',
      })
    }
  }

  function selectFeed(feedId: number) {
    setSearchQuery('')
    setSelection({ type: 'feed', feedId })
    void loadArticles({ feed_id: feedId })
  }

  function selectGroup(groupId: number) {
    setSearchQuery('')
    setSelection({ type: 'group', groupId })
    void loadArticles({ group_id: groupId })
  }

  function handleFeedContextMenu(e: React.MouseEvent, feedId: number) {
    e.preventDefault()
    setCtxMenu({ feedId, x: e.clientX, y: e.clientY })
  }

  return (
    <aside className={styles.sidebar}>
      {/* Drag region for frameless window */}
      <div className={`${styles.header} drag-region`}>
        <div className={styles.logo}>
          <img src={logo} className={styles.logoImg} alt="Albatros" />
          <span className={styles.logoText}>ALBATROS</span>
        </div>
        <div className={styles.actions}>
          <button
            title={menuVisible ? 'Hide Menu Bar' : 'Show Menu Bar'}
            aria-label={menuVisible ? 'Hide Menu Bar' : 'Show Menu Bar'}
            onClick={() => void window.api.menu.toggle().then(setMenuVisible)}
            className={`${styles.actionBtn} ${menuVisible ? styles.actionBtnActive : ''} no-drag`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <button
            title={isSyncing ? 'Sync in progress…' : 'Sync All Feeds'}
            aria-label={isSyncing ? 'Sync in progress' : 'Sync All Feeds'}
            aria-busy={isSyncing}
            onClick={() => void window.api.sync.refreshAll()}
            className={`${styles.actionBtn} no-drag`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isSyncing ? styles.syncSpin : showSyncComplete ? styles.syncComplete : ''}>
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
          <button
            title="Create Folder"
            aria-label="Create Folder"
            onClick={() => setCreateGroupOpen(true)}
            className={`${styles.actionBtn} no-drag`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </button>
          <button
            title="Settings"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
            className={`${styles.actionBtn} no-drag`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            title="Import OPML"
            aria-label="Import OPML"
            onClick={() => void handleOpmlImport()}
            className={`${styles.actionBtn} no-drag`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button
            title="Export OPML"
            aria-label="Export OPML"
            onClick={() => void handleOpmlExport()}
            className={`${styles.actionBtn} no-drag`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
        </div>
      </div>

      <div style={{ padding: '0 12px 12px 12px' }}>
        <form
          onSubmit={handleSearchSubmit}
          style={{ position: 'relative', display: 'flex' }}
          role="search"
        >
          <div
            style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
              display: 'flex',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <input
            type="search"
            placeholder="Search feeds and articles…"
            aria-label="Search feeds and articles"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="no-drag"
            style={{
              flex: 1,
              width: '100%',
              padding: '8px 28px 8px 32px',
              borderRadius: '9999px',
              border: '1px solid transparent',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none',
              transition: 'border-color 0.2s, background 0.2s',
            }}
            onFocus={e => {
              e.target.style.borderColor = 'var(--border-light)'
              e.target.style.background = 'var(--bg-elevated)'
              setIsSearchFocused(true)
            }}
            onBlur={e => {
              e.target.style.borderColor = 'transparent'
              e.target.style.background = 'var(--bg-surface)'
              setTimeout(() => setIsSearchFocused(false), 200)
            }}
          />
          {/* Clear button — visible when query is non-empty */}
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchQuery('')}
              className="no-drag"
              style={{
                position: 'absolute',
                right: '6px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                fontSize: '14px',
                lineHeight: 1,
                padding: '2px 4px',
                borderRadius: '4px',
              }}
            >
              ×
            </button>
          )}

          {/* ── Auto-complete Dropdown ──────────────────────────── */}
          {showSearchDropdown && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: '6px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                zIndex: 100,
                maxHeight: '350px',
                overflowY: 'auto',
                boxShadow: '0 8px 16px rgba(0,0,0,0.3)',
              }}
            >
              {matchedGroups.length > 0 && (
                <div style={{ padding: '8px' }}>
                  <div
                    style={{
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      marginBottom: '4px',
                      paddingLeft: '8px',
                      fontWeight: 'bold',
                      letterSpacing: '0.5px',
                    }}
                  >
                    Folders
                  </div>
                  {matchedGroups.map(g => (
                    <div
                      key={g.id}
                      onClick={() => {
                        setSearchQuery('')
                        setIsSearchFocused(false)
                        if (!g.is_expanded) toggleGroup(g.id)
                      }}
                      style={{
                        padding: '8px',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        fontSize: '13px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span>{g.icon || '📂'}</span>
                      <HighlightText text={g.name} highlight={qLower} />
                    </div>
                  ))}
                </div>
              )}

              {matchedFeeds.length > 0 && (
                <div
                  style={{
                    padding: '8px',
                    borderTop: matchedGroups.length > 0 ? '1px solid var(--border-subtle)' : 'none',
                  }}
                >
                  <div
                    style={{
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      marginBottom: '4px',
                      paddingLeft: '8px',
                      fontWeight: 'bold',
                      letterSpacing: '0.5px',
                    }}
                  >
                    Feeds
                  </div>
                  {matchedFeeds.map(f => (
                    <div
                      key={f.id}
                      onClick={() => {
                        setSearchQuery('')
                        setIsSearchFocused(false)
                        selectFeed(f.id)
                        if (f.group_id) {
                          const parent = groups.find(g => g.id === f.group_id)
                          if (parent && !parent.is_expanded) toggleGroup(parent.id)
                        }
                      }}
                      style={{
                        padding: '8px',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        overflow: 'hidden',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {f.favicon_url ? (
                        <img
                          src={f.favicon_url}
                          style={{
                            width: '1rem',
                            height: '1rem',
                            borderRadius: '2px',
                            objectFit: 'cover',
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: '0.875rem' }}>📰</span>
                      )}
                      <span
                        style={{
                          fontSize: '0.8125rem',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          color: 'var(--text-normal)',
                        }}
                      >
                        <HighlightText text={f.title || f.url} highlight={qLower} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </form>
      </div>

      <nav
        className={styles.nav}
        onDragOver={e => {
          e.preventDefault()
        }}
        onDrop={e => {
          e.preventDefault()
          const feedId = Number(e.dataTransfer.getData('albatros/feed-id'))
          if (feedId && feeds.find(f => f.id === feedId)?.group_id !== null) {
            void updateFeed(feedId, { group_id: null })
          }
        }}
      >
        {/* ── System views ──────────────────────────────────── */}
        <section className={styles.section}>
          {SYSTEM_VIEWS.map(view => (
            <button
              key={view.type}
              ref={view.type === 'saved' ? savedBtnRef : undefined}
              className={`${styles.navItem} ${selection.type === view.type ? styles.active : ''}`}
              onClick={() => selectSystemView(view.type)}
              aria-current={selection.type === view.type ? 'page' : undefined}
            >
              <span className={styles.navIcon}>{view.icon}</span>
              <span className={styles.navLabel}>{view.label}</span>
              {view.type === 'all' && totalUnread > 0 && (
                <span className={styles.badge} aria-label={`${totalUnread} unread`}>
                  {totalUnread > 999 ? '999+' : totalUnread}
                </span>
              )}
            </button>
          ))}
        </section>

        <div className={styles.divider} />

        {/* ── Feed groups & feeds ──────────────────────────── */}
        <section className={`${styles.section} ${styles.feedSection}`}>
          {/* Ungrouped feeds */}
          <div
            className={`${isDragOverRoot ? styles.rootDragOver : ''}`}
            style={{
              minHeight: '24px',
              paddingBottom: '4px',
              borderRadius: '4px',
              transition: 'background 0.2s',
              margin: '0 8px',
            }}
            onDragEnter={e => {
              if (!e.dataTransfer.types.includes('albatros/feed-id')) return
              e.preventDefault()
              e.stopPropagation()
              rootDragCounter.current++
              setIsDragOverRoot(true)
            }}
            onDragLeave={e => {
              e.stopPropagation()
              rootDragCounter.current--
              if (rootDragCounter.current === 0) setIsDragOverRoot(false)
            }}
            onDragOver={e => {
              if (e.dataTransfer.types.includes('albatros/feed-id')) {
                e.preventDefault()
                e.stopPropagation()
              }
            }}
            onDrop={e => {
              e.preventDefault()
              e.stopPropagation()
              rootDragCounter.current = 0
              setIsDragOverRoot(false)
              const feedId = Number(e.dataTransfer.getData('albatros/feed-id'))
              if (feedId && feeds.find(f => f.id === feedId)?.group_id !== null) {
                void updateFeed(feedId, { group_id: null })
              }
            }}
          >
            {(feedsByGroup.get(null) ?? []).map(feed => (
              <FeedItem
                key={feed.id}
                feed={feed}
                isSelected={selection.type === 'feed' && selection.feedId === feed.id}
                isSyncing={syncingFeedIds.has(feed.id)}
                articleCountOverride={selection.type === 'feed' && selection.feedId === feed.id ? articles.length : undefined}
                onClick={() => selectFeed(feed.id)}
                onContextMenu={e => handleFeedContextMenu(e, feed.id)}
              />
            ))}
          </div>

          {/* Grouped feeds */}
          {groups.map(group => (
            <FeedGroupComponent
              key={group.id}
              group={group}
              feeds={feedsByGroup.get(group.id) ?? []}
              selectedFeedId={selection.type === 'feed' ? selection.feedId : undefined}
              isGroupSelected={selection.type === 'group' && selection.groupId === group.id}
              syncingFeedIds={syncingFeedIds}
              selectedFeedArticleCount={articles.length}
              onSelectFeed={selectFeed}
              onSelectGroup={selectGroup}
              onToggleGroup={() => void toggleGroup(group.id)}
              onDropFeed={feedId => {
                void updateFeed(feedId, { group_id: group.id })
              }}
              onContextMenuFeed={handleFeedContextMenu}
              onContextMenuGroup={e => {
                e.preventDefault()
                setGroupCtxMenu({ groupId: group.id, x: e.clientX, y: e.clientY })
              }}
              onEmojiClick={(e, groupId) => {
                e.preventDefault()
                e.stopPropagation()
                setEmojiPicker({ groupId, x: e.clientX, y: e.clientY })
              }}
            />
          ))}
        </section>
      </nav>

      {/* ── Footer ────────────────────────────────────────── */}
      <div className={styles.footer} style={{ display: 'flex', gap: '8px' }}>
        <button
          className={styles.addFeedBtn}
          onClick={() => setAddFeedOpen(true)}
          title="Add RSS Feed (Ctrl+N)"
          style={{ flex: 1 }}
        >
          + Add Feed
        </button>
        <button
          className={styles.manageBtn}
          onClick={() => setManageFeedsOpen(true)}
          title="Manage Feeds"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>

      {/* ── Modals & context menus ─────────────────────────── */}
      {addFeedOpen && <AddFeedModal onClose={() => setAddFeedOpen(false)} />}

      {manageFeedsOpen && <ManageFeedsModal onClose={() => setManageFeedsOpen(false)} />}

      {createGroupOpen && <CreateGroupModal onClose={() => setCreateGroupOpen(false)} />}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {feedPropertiesOpen !== null && (
        <FeedPropertiesModal
          feedId={feedPropertiesOpen}
          onClose={() => setFeedPropertiesOpen(null)}
        />
      )}

      {emojiPicker && (
        <>
          <div className={styles.emojiOverlay} onClick={() => setEmojiPicker(null)} />
          <div
            className={styles.emojiPicker}
            style={{
              top: Math.min(emojiPicker.y, window.innerHeight - 150),
              left: emojiPicker.x + 10,
            }}
          >
            {EMOJIS.map(emoji => (
              <button
                key={emoji}
                className={styles.emojiBtn}
                onClick={async () => {
                  const { useFeedStore } = await import('../../store/feedStore')
                  await useFeedStore.getState().updateGroup(emojiPicker.groupId, { icon: emoji })
                  setEmojiPicker(null)
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      )}

      {ctxMenu && (
        <FeedContextMenu
          feedId={ctxMenu.feedId}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onDelete={async () => {
            await deleteFeed(ctxMenu.feedId)
            setCtxMenu(null)
          }}
          onShowProperties={() => {
            setFeedPropertiesOpen(ctxMenu.feedId)
            setCtxMenu(null)
          }}
        />
      )}

      {groupCtxMenu && (
        <GroupContextMenu
          x={groupCtxMenu.x}
          y={groupCtxMenu.y}
          onClose={() => setGroupCtxMenu(null)}
          onDelete={async () => {
            await deleteGroup(groupCtxMenu.groupId)
            setGroupCtxMenu(null)
          }}
        />
      )}
    </aside>
  )
}

// ─── FeedGroupComponent ───────────────────────────────────────────────────────

function FeedGroupComponent({
  group,
  feeds,
  selectedFeedId,
  isGroupSelected,
  syncingFeedIds,
  selectedFeedArticleCount,
  onSelectFeed,
  onSelectGroup,
  onToggleGroup,
  onDropFeed,
  onContextMenuFeed,
  onContextMenuGroup,
  onEmojiClick,
}: {
  group: FeedGroup
  feeds: Feed[]
  selectedFeedId?: number
  isGroupSelected?: boolean
  syncingFeedIds: Set<number>
  selectedFeedArticleCount: number
  onSelectFeed: (id: number) => void
  onSelectGroup: (id: number) => void
  onToggleGroup: () => void
  onDropFeed: (feedId: number) => void
  onContextMenuFeed: (e: React.MouseEvent, feedId: number) => void
  onContextMenuGroup: (e: React.MouseEvent) => void
  onEmojiClick: (e: React.MouseEvent, groupId: number) => void
}) {
  const groupUnread = feeds.reduce((s, f) => s + f.unread_count, 0)
  const groupArticles = feeds.reduce((s, f) => s + (f.article_count ?? 0), 0)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(group.name)
  const dragCounter = useRef(0)

  return (
    <div
      className={`${styles.group} ${isDragOver ? styles.groupDragOver : ''}`}
      onDragEnter={e => {
        if (!e.dataTransfer.types.includes('albatros/feed-id')) return
        e.preventDefault()
        dragCounter.current++
        setIsDragOver(true)
      }}
      onDragOver={e => {
        if (e.dataTransfer.types.includes('albatros/feed-id')) e.preventDefault()
      }}
      onDragLeave={() => {
        dragCounter.current--
        if (dragCounter.current === 0) setIsDragOver(false)
      }}
      onDrop={e => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current = 0
        setIsDragOver(false)
        const feedId = Number(e.dataTransfer.getData('albatros/feed-id'))
        if (feedId) onDropFeed(feedId)
      }}
    >
      <button
        className={`${styles.groupHeader} ${isGroupSelected ? styles.active : ''}`}
        onClick={e => {
          // INPUT (rename) — ignore
          if ((e.target as HTMLElement).tagName === 'INPUT') return
          // Caret click — only toggle expand/collapse
          if ((e.target as HTMLElement).closest('[data-caret]')) {
            onToggleGroup()
            return
          }
          // Anything else — select group (load articles)
          onSelectGroup(group.id)
          if (!group.is_expanded) onToggleGroup()
        }}
        onContextMenu={onContextMenuGroup}
        aria-expanded={group.is_expanded}
        aria-controls={`group-feeds-${group.id}`}
        aria-current={isGroupSelected ? 'true' : undefined}
      >
        <span
          data-caret
          className={styles.caret}
          onClick={e => {
            e.stopPropagation()
            onToggleGroup()
          }}
        >
          <ChevronRight />
        </span>
        <span
          className={styles.groupIconBtn}
          onClick={e => {
            e.stopPropagation()
            onEmojiClick(e, group.id)
          }}
          title="Change icon"
        >
          {group.icon || '📁'}
        </span>
        {isRenaming ? (
          <input
            autoFocus
            className={styles.renameInput}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={async e => {
              if (e.key === 'Enter') {
                const newName = renameValue.trim()
                if (newName && newName !== group.name) {
                  const { useFeedStore } = await import('../../store/feedStore')
                  await useFeedStore.getState().updateGroup(group.id, { name: newName })
                }
                setIsRenaming(false)
              } else if (e.key === 'Escape') {
                setRenameValue(group.name)
                setIsRenaming(false)
              }
            }}
            onBlur={() => {
              setRenameValue(group.name)
              setIsRenaming(false)
            }}
          />
        ) : (
          <span
            className={styles.groupName}
            onClick={e => {
              e.stopPropagation()
              setRenameValue(group.name)
              setIsRenaming(true)
            }}
          >
            {group.name}
          </span>
        )}
        {!isRenaming && groupUnread > 0 && <span className={styles.badge}>{groupUnread}</span>}
        {!isRenaming && groupUnread === 0 && groupArticles > 0 && (
          <span className={`${styles.badge} ${styles.readBadge}`} title={`${groupArticles} saved posts`}>
            {groupArticles}
          </span>
        )}
      </button>

      {group.is_expanded && (
        <div className={styles.groupFeeds} id={`group-feeds-${group.id}`}>
          {feeds.map(feed => (
            <FeedItem
              key={feed.id}
              feed={feed}
              isSelected={selectedFeedId === feed.id}
              isSyncing={syncingFeedIds.has(feed.id)}
              articleCountOverride={selectedFeedId === feed.id ? selectedFeedArticleCount : undefined}
              onClick={() => onSelectFeed(feed.id)}
              onContextMenu={e => onContextMenuFeed(e, feed.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── FeedItem ─────────────────────────────────────────────────────────────────

function FeedItem({
  feed,
  isSelected,
  isSyncing,
  articleCountOverride,
  onClick,
  onContextMenu,
}: {
  feed: Feed
  isSelected: boolean
  isSyncing: boolean
  articleCountOverride?: number
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const articleCount = Math.max(feed.article_count ?? 0, articleCountOverride ?? 0)
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${styles.navItem} ${styles.feedItem} ${isSelected ? styles.active : ''}`}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onClick()
      }}
      onContextMenu={onContextMenu}
      title={feed.title ?? feed.url}
      aria-label={`${feed.title ?? feed.url}${feed.unread_count > 0 ? `, ${feed.unread_count} unread` : articleCount > 0 ? `, ${articleCount} posts` : ', no posts'}${isSyncing ? ', syncing' : ''}`}
      aria-current={isSelected ? 'true' : undefined}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('albatros/feed-id', String(feed.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <GripIcon />
      <img
        src={feed.favicon_url || getFaviconFallbackUrl(feed)}
        alt=""
        className={styles.favicon}
        onError={e => {
          e.currentTarget.style.display = 'none'
          const fallback = e.currentTarget.parentElement?.querySelector(
            '.fallback-icon',
          ) as HTMLElement
          if (fallback) fallback.style.display = ''
        }}
      />
      <span className={`${styles.faviconFallback} fallback-icon`} style={{ display: 'none' }}>
        ◎
      </span>
      <span className={`${styles.navLabel} truncate`}>{feed.title ?? feed.url}</span>
      {isSyncing && (
        <span className={styles.syncDot} title="Syncing…">
          ⟳
        </span>
      )}
      {!isSyncing && feed.error_count > 0 && (
        <span className={styles.errorIcon} title={`Last Sync Failed (${feed.error_count} errors)`}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>
      )}
      {!isSyncing && feed.unread_count > 0 && (
        <span className={styles.badge}>{feed.unread_count}</span>
      )}
      {!isSyncing && feed.unread_count === 0 && articleCount > 0 && (
        <span className={`${styles.badge} ${styles.readBadge}`} title={`${articleCount} existing posts`}>
          {articleCount}
        </span>
      )}
    </div>
  )
}

// ─── FeedContextMenu ──────────────────────────────────────────────────────────

function FeedContextMenu({
  feedId,
  x,
  y,
  onClose,
  onDelete,
  onShowProperties,
}: {
  feedId: number
  x: number
  y: number
  onClose: () => void
  onDelete: () => void
  onShowProperties: () => void
}) {
  return (
    <>
      <div className={styles.ctxOverlay} onClick={onClose} />
      <menu
        className={styles.ctxMenu}
        role="menu"
        aria-label="Feed options"
        style={{ top: y, left: x }}
      >
        <li role="none">
          <button
            role="menuitem"
            onClick={() => {
              void window.api.sync.refreshFeed(feedId)
              onClose()
            }}
          >
            ⟳ Refresh Feed
          </button>
        </li>
        <li role="none">
          <button role="menuitem" onClick={onShowProperties}>
            ℹ️ Feed Info
          </button>
        </li>
        <li className={styles.ctxSeparator} role="separator" />
        <li role="none">
          <button role="menuitem" className={styles.ctxDanger} onClick={onDelete}>
            ✕ Unsubscribe
          </button>
        </li>
      </menu>
    </>
  )
}

// ─── GroupContextMenu ─────────────────────────────────────────────────────────

function GroupContextMenu({
  x,
  y,
  onClose,
  onDelete,
}: {
  x: number
  y: number
  onClose: () => void
  onDelete: () => void
}) {
  return (
    <>
      <div className={styles.ctxOverlay} onClick={onClose} />
      <menu
        className={styles.ctxMenu}
        role="menu"
        aria-label="Folder options"
        style={{ top: y, left: x }}
      >
        <li role="none">
          <button role="menuitem" className={styles.ctxDanger} onClick={onDelete}>
            ✕ Delete Folder
          </button>
        </li>
      </menu>
    </>
  )
}
