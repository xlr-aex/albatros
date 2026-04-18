/**
 * @file App.tsx
 * @description Root application component.
 * Bootstraps initial state, subscribes to IPC sync events, and renders the
 * 3-panel layout (Sidebar, ArticleList, ArticleReader).
 */

import React, { useEffect } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { ArticleList } from './components/layout/ArticleList'
import { ArticleReader } from './components/layout/ArticleReader'
import { GithubLinksView } from './components/layout/GithubLinksView'
import { AiDigestView } from './components/layout/AiDigestView'
import { useFeedStore } from './store/feedStore'
import { useArticleStore } from './store/articleStore'
import { useUiStore, subscribeSyncEvents } from './store/uiStore'
import { applyAccentColor } from './utils/theme'
import styles from './App.module.css'

export default function App() {
  const { loadFeeds, refreshUnreadCount, selection } = useFeedStore()
  const { loadArticles } = useArticleStore()
  const { theme, setTheme } = useUiStore()

  // ── Initial load & subscriptions ──────────────────────────────────────────
  useEffect(() => {
    // 1. Load initial settings (Theme, Layout Widths, Font Size)
    window.api.settings.getAll().then((settings) => {
      if (settings.theme) setTheme(settings.theme as 'light' | 'dark')
      if (settings.font_size) {
        document.documentElement.style.setProperty('--article-font-size', `${settings.font_size}px`)
      }
      if (settings.ui_font_size) {
        document.documentElement.style.setProperty('--ui-font-size', `${settings.ui_font_size}px`)
      }
      if (settings.accent_color) {
        applyAccentColor(settings.accent_color)
      }
      if (settings.sidebar_width) {
        document.documentElement.style.setProperty('--sidebar-width', `${settings.sidebar_width}px`)
      }
      if (settings.article_list_width) {
        document.documentElement.style.setProperty('--article-list-width', `${settings.article_list_width}px`)
      }
    })

    // 2. Load feeds and selection
    void loadFeeds().then(() => {
      // Load all articles by default
      void loadArticles({})
    })

    // 3. Subscribe to real-time sync events from the main process
    const unsub = subscribeSyncEvents()

    // 4. Periodically refresh total unread (fallback for drift)
    const interval = setInterval(() => {
      void refreshUnreadCount()
    }, 60_000)

    return () => {
      unsub()
      clearInterval(interval)
    }
  }, [loadFeeds, loadArticles, refreshUnreadCount, setTheme])

  // ── Drag Resizer Handlers ───────────────────────────────────────────────
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.body.style.pointerEvents = 'none'

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(moveEvent.clientX, 600))
      document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`)
    }

    const onMouseUp = (upEvent: MouseEvent) => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.body.style.pointerEvents = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      const finalWidth = Math.max(200, Math.min(upEvent.clientX, 600))
      window.api.settings.set('sidebar_width', finalWidth.toString())
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const startArticleListResize = (e: React.MouseEvent) => {
    e.preventDefault()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.body.style.pointerEvents = 'none'

    // The mouse clientX represents SidebarWidth + ArticleListWidth.
    // Calculate the ArticleList width by subtracting the Sidebar width
    const sidebarWidthStr = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')
    const sidebarWidth = parseInt(sidebarWidthStr) || 260

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(250, Math.min(moveEvent.clientX - sidebarWidth, 800))
      document.documentElement.style.setProperty('--article-list-width', `${newWidth}px`)
    }

    const onMouseUp = (upEvent: MouseEvent) => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.body.style.pointerEvents = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      const finalWidth = Math.max(250, Math.min(upEvent.clientX - sidebarWidth, 800))
      window.api.settings.set('article_list_width', finalWidth.toString())
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div className={styles.appContainer} data-theme={theme}>
      <Sidebar />
      <div className={styles.resizer} onMouseDown={startSidebarResize}>
        <div className={styles.resizerHandle} />
      </div>
      
      {selection.type === 'github' ? (
        <GithubLinksView />
      ) : selection.type === 'digest' ? (
        <AiDigestView />
      ) : (
        <>
          <ArticleList />
          <div className={styles.resizer} onMouseDown={startArticleListResize}>
            <div className={styles.resizerHandle} />
          </div>
          <ArticleReader />
        </>
      )}
    </div>
  )
}
