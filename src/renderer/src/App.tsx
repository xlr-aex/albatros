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
import { LayaFolderView } from './components/layout/LayaFolderView'
import { useFeedStore } from './store/feedStore'
import { useArticleStore } from './store/articleStore'
import { useUiStore, subscribeSyncEvents } from './store/uiStore'
import { applyAccentColor } from './utils/theme'
import styles from './App.module.css'

export default function App() {
  const { loadFeeds, refreshUnreadCount, selection, loadLayaFolders, setLayaFolders } = useFeedStore()
  const { loadArticles } = useArticleStore()
  const { theme, setTheme } = useUiStore()

  // ── Initial load & subscriptions ──────────────────────────────────────────
  useEffect(() => {
    // Recover from a resize gesture interrupted by a window blur. Older builds
    // left this on `none`, which made every control feel frozen.
    document.body.style.pointerEvents = ''
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

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

    // 2. Load feeds, selection and Laya folders
    void loadFeeds().then(() => {
      // Load all articles by default
      void loadArticles({})
    })
    void loadLayaFolders()

    // 3. Subscribe to real-time sync events from the main process
    const unsub = subscribeSyncEvents()

    // 4. Subscribe to Laya folder push events
    const unsubLayaFolders = window.api.laya.onFolders((folders) => {
      setLayaFolders(folders as import('./store/feedStore').LayaFolder[])
    })

    // 5. Periodically refresh total unread (fallback for drift)
    const interval = setInterval(() => {
      void refreshUnreadCount()
    }, 60_000)

    return () => {
      unsub()
      unsubLayaFolders()
      clearInterval(interval)
    }
  }, [loadFeeds, loadArticles, refreshUnreadCount, setTheme, loadLayaFolders, setLayaFolders])

  // ── Drag Resizer Handlers ───────────────────────────────────────────────
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(moveEvent.clientX, 600))
      document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`)
    }

    const finishResize = (upEvent?: MouseEvent) => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onWindowBlur)
      if (upEvent) {
        const finalWidth = Math.max(200, Math.min(upEvent.clientX, 600))
        window.api.settings.set('sidebar_width', finalWidth.toString())
      }
    }
    const onMouseUp = (upEvent: MouseEvent) => finishResize(upEvent)
    const onWindowBlur = () => finishResize()

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onWindowBlur, { once: true })
  }

  const startArticleListResize = (e: React.MouseEvent) => {
    e.preventDefault()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    // The mouse clientX represents SidebarWidth + ArticleListWidth.
    // Calculate the ArticleList width by subtracting the Sidebar width
    const sidebarWidthStr = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')
    const sidebarWidth = parseInt(sidebarWidthStr) || 260

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(250, Math.min(moveEvent.clientX - sidebarWidth, 800))
      document.documentElement.style.setProperty('--article-list-width', `${newWidth}px`)
    }

    const finishResize = (upEvent?: MouseEvent) => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onWindowBlur)
      if (upEvent) {
        const finalWidth = Math.max(250, Math.min(upEvent.clientX - sidebarWidth, 800))
        window.api.settings.set('article_list_width', finalWidth.toString())
      }
    }
    const onMouseUp = (upEvent: MouseEvent) => finishResize(upEvent)
    const onWindowBlur = () => finishResize()

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onWindowBlur, { once: true })
  }

  return (
    <div className={styles.appContainer} data-theme={theme}>
      <Sidebar />
      <div className={styles.resizer} onMouseDown={startSidebarResize}>
        <div className={styles.resizerHandle} />
      </div>
      
      {selection.type === 'github' ? (
        <GithubLinksView />
      ) : selection.type === 'laya' ? (
        <LayaFolderView />
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
