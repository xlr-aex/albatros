/**
 * @file main/index.ts
 * @description Electron main process entry point.
 *
 * Boot sequence:
 *  1. Wait for app.whenReady()
 *  2. Initialise sql.js database + run migrations
 *  3. Instantiate all services (FeedService, ArticleService, etc.)
 *  4. Register all IPC handlers
 *  5. Create the BrowserWindow
 *  6. Start the Scheduler (which triggers an immediate sync)
 *  7. On before-quit: stop scheduler, close DB
 */

import { app, BrowserWindow, shell, session, ipcMain } from 'electron'

// Suppress harmless Chromium DevTools Autofill errors that spam the terminal
const originalStderrWrite = process.stderr.write.bind(process.stderr);
/* eslint-disable @typescript-eslint/no-explicit-any */
process.stderr.write = ((chunk: Uint8Array | string, encoding?: any, callback?: any) => {
  const str = chunk.toString();
  if (str.includes('Request Autofill.enable failed') || str.includes('Request Autofill.setAddresses failed')) {
    if (typeof callback === 'function') callback();
    return true;
  }
  return originalStderrWrite(chunk, encoding, callback);
}) as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

import path from 'path'
import { promises as fs } from 'fs'
import { ElectronBlocker } from '@cliqz/adblocker-electron'
import { adsAndTrackingLists } from '@cliqz/adblocker'
import fetch from 'cross-fetch'

// ── DB ────────────────────────────────────────────────────────────────────────
import { getDatabase, closeDatabase } from './db/connection'
import { runMigrations } from './db/migrations/runner'

// ── Services ─────────────────────────────────────────────────────────────────
import { FeedService }     from './services/FeedService'
import { ArticleService }  from './services/ArticleService'
import { SearchService }   from './services/SearchService'
import { SettingsService } from './services/SettingsService'
import { OpmlService }     from './services/OpmlService'
import { SummaryService }  from './services/SummaryService'
import { LlmService }      from './services/LlmService'

// ── Sync ─────────────────────────────────────────────────────────────────────
import { SyncEngine, repairStaleFaviconUrls } from './sync/SyncEngine'
import { Scheduler }  from './sync/Scheduler'

// ── IPC ───────────────────────────────────────────────────────────────────────
import { registerFeedHandlers }     from './ipc/feeds'
import { registerArticleHandlers }  from './ipc/articles'
import { registerLlmHandlers, registerSettingsHandlers, registerSyncHandlers } from './ipc/settings'

// ─── Window helper ────────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width:           1440,
    height:          900,
    minWidth:        900,
    minHeight:       600,
    backgroundColor: '#0f1117', // Dark background to avoid white flash
    titleBarStyle:   'hiddenInset',
    autoHideMenuBar: true,
    icon:            path.join(__dirname, '../../resources/icon.png'),
    webPreferences:  {
      preload:          path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,    // Required for security
      nodeIntegration:  false,   // Never allow node in renderer
      sandbox:          false,   // Needed for sql.js WASM in preload
      webviewTag:       true,    // Enable <webview> for embedded browser
      webSecurity:      false,   // Bypass CORS/CSP for direct local AI api calls
    },
  })

  // Open external links in the OS browser, not Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load the renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    // Development: Vite dev server
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    // Production: static build
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ─── Application lifecycle ────────────────────────────────────────────────────

let scheduler: Scheduler | null = null
let summaryService: SummaryService | null = null

async function bootstrap(): Promise<void> {
  // ── 0. Adblock engine ──────────────────────────────────────────────────
  //    Loads prebuilt EasyList + EasyPrivacy filter lists with disk caching.
  //    First run downloads lists (~2s), subsequent starts load from cache (<50ms).
  //    The engine auto-refreshes stale lists from the network when possible.
  //
  //    Cosmetic filters MUST stay disabled: their preload injects scriptlets
  //    into every page, which violates Reddit's nonce-based CSP and leaves the
  //    embedded webview permanently blank (ghostery/adblocker#4234). Network
  //    filtering (onBeforeRequest) keeps blocking ads/trackers normally.
  try {
    // NOTE - v2 cache name: the previous engine file was serialized with
    // cosmetic filters enabled and would override the config below on load.
    const enginePath = path.join(app.getPath('userData'), 'adblocker-engine-v2.bin')
    void fs.unlink(path.join(app.getPath('userData'), 'adblocker-engine.bin')).catch(() => {})
    const blocker = await ElectronBlocker.fromLists(fetch, adsAndTrackingLists, {
      loadCosmeticFilters: false,
      enableMutationObserver: false,
    }, {
      path: enginePath,
      read: fs.readFile,
      write: fs.writeFile,
    })
    // Apply to a dedicated partition so the main app session is unaffected
    blocker.enableBlockingInSession(session.fromPartition('persist:adblock'))
    console.log('[Adblock] Engine loaded on partition persist:adblock')
  } catch (err) {
    console.error('[Adblock] Failed to initialise:', err)
    // Non-fatal: app works without adblocking
  }

  // ── 0b. Reddit embed fix ────────────────────────────────────────────────
  //    Reddit sends X-Frame-Options: SAMEORIGIN (and matching CSP frame-ancestors)
  //    which Chromium enforces even inside <webview> elements, causing a blank page.
  //    We strip those headers on both the default and adblock sessions for Reddit only.
  //    We also modify request headers for mainFrame navigations to bypass anti-embed detection.
  try {
    const sessions = [
      session.defaultSession,
      session.fromPartition('persist:adblock')
    ]

    for (const ses of sessions) {
      // Clean User-Agent helper (removes Electron/Albatros identifiers to avoid bot detection)
      const cleanUA = ses.getUserAgent()
        .replace(/\s+Albatros\/\S+/i, '')
        .replace(/\s+Electron\/\S+/i, '')

      // 1. Intercept outgoing request headers
      ses.webRequest.onBeforeSendHeaders(
        { urls: ['*://*.reddit.com/*', '*://reddit.com/*', '*://*.redd.it/*'] },
        (details, callback) => {
          const headers = { ...details.requestHeaders }
          
          const setHeader = (name: string, value: string) => {
            const lower = name.toLowerCase()
            for (const key of Object.keys(headers)) {
              if (key.toLowerCase() === lower) {
                delete headers[key]
              }
            }
            headers[name] = value
          }

          setHeader('User-Agent', cleanUA)

          if (details.resourceType === 'mainFrame') {
            setHeader('Sec-Fetch-Dest', 'document')
            setHeader('Sec-Fetch-Mode', 'navigate')
            setHeader('Sec-Fetch-Site', 'none')
            setHeader('Sec-Fetch-User', '?1')
            
            // If the referer is local, rewrite it to reddit.com to bypass iframe detection
            let hasLocalReferer = false
            for (const key of Object.keys(headers)) {
              if (key.toLowerCase() === 'referer') {
                const val = headers[key]
                if (val && (val.includes('localhost') || val.includes('127.0.0.1') || val.includes('file://'))) {
                  hasLocalReferer = true
                }
              }
            }
            if (hasLocalReferer) {
              setHeader('Referer', 'https://www.reddit.com/')
            }
          }

          callback({ requestHeaders: headers })
        }
      )

      // 2. Intercept incoming response headers
      ses.webRequest.onHeadersReceived(
        { urls: ['*://*.reddit.com/*', '*://reddit.com/*', '*://*.redd.it/*'] },
        (details, callback) => {
          const headers: Record<string, string[]> = {}
          for (const [key, val] of Object.entries(details.responseHeaders ?? {})) {
            const lower = key.toLowerCase()
            if (lower === 'x-frame-options') continue // drop entirely
            if (lower === 'content-security-policy') {
              // Strip only the frame-ancestors directive; leave the rest intact
              const filtered = (val as string[])
                .map(v => v.replace(/frame-ancestors[^;]*(;|$)/gi, '').trim().replace(/;$/, '').trim())
                .filter(Boolean)
              if (filtered.length) headers[key] = filtered
              continue
            }
            headers[key] = val as string[]
          }
          callback({ responseHeaders: headers })
        }
      )
    }
    console.log('[Embed] Reddit request/response header bypass active on all sessions')
  } catch (err) {
    console.error('[Embed] Failed to set up Reddit header intercept:', err)
  }

  // ── 0c. Local AI CORS bypass ────────────────────────────────────────────
  //    Bypass CORS restrictions when fetching local AI endpoints from renderer.
  try {
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ['http://localhost:*/*', 'http://127.0.0.1:*/*'] },
      (details, callback) => {
        const headers: Record<string, string[]> = {}
        for (const [key, val] of Object.entries(details.responseHeaders ?? {})) {
          headers[key] = val as string[]
        }
        headers['access-control-allow-origin'] = ['*']
        headers['access-control-allow-headers'] = ['*']
        callback({ responseHeaders: headers })
      }
    )
    console.log('[AI] Local CORS bypass active')
  } catch (err) {
    console.error('[AI] Failed to set up CORS bypass:', err)
  }

  // ── 1. Database ──────────────────────────────────────────────────────────
  const db = await getDatabase()
  runMigrations(db)

  // ── 2. Services ──────────────────────────────────────────────────────────
  const feedService     = new FeedService(db)
  feedService.clearTransientRateLimitErrors()
  repairStaleFaviconUrls(feedService)

  const articleService  = new ArticleService(db)
  const searchService   = new SearchService(db)
  const settingsService = new SettingsService(db)
  const llmService      = new LlmService(settingsService)
  const opmlService     = new OpmlService(feedService)

  // ── 3. Engine ────────────────────────────────────────────────────────────
  const syncEngine = new SyncEngine(feedService, articleService, db)
  scheduler = new Scheduler(db, syncEngine, feedService, articleService, settingsService)
  summaryService = new SummaryService(db, articleService, llmService)

  syncEngine.onSyncComplete = () => {
    summaryService?.trigger()
  }

  // ── 4. IPC ───────────────────────────────────────────────────────────────
  registerFeedHandlers(feedService, opmlService, scheduler)
  registerArticleHandlers(articleService, searchService, feedService)
  registerSettingsHandlers(settingsService)
  registerLlmHandlers(llmService)
  registerSyncHandlers(scheduler)

  ipcMain.handle('summary:status-get', () => {
    return {
      pending: summaryService?.getPendingCount() ?? 0,
      total: summaryService?.getTotalCount() ?? 0,
      isProcessing: false
    }
  })
  ipcMain.handle('summary:trigger', () => {
    summaryService?.trigger()
  })

  ipcMain.handle('menu:toggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const visible = !win.isMenuBarVisible()
    win.setMenuBarVisibility(visible)
    return visible
  })

  ipcMain.on('debug:log', (_event, msg) => {
    console.log('[Renderer Debug]', msg)
  })

  // Start background summarization
  summaryService.start()

  // ── 5. Window ────────────────────────────────────────────────────────────
  createWindow()

  app.on('activate', () => {
    // macOS: re-create window when clicking the dock icon with no open windows
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // ── 6. Start scheduler ───────────────────────────────────────────────────
  scheduler.start()
}

// ── Main entry ───────────────────────────────────────────────────────────────

void app.whenReady().then(bootstrap)

app.on('window-all-closed', () => {
  // On Windows and Linux, quit when all windows are closed
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  scheduler?.stop()
  summaryService?.stop()
  closeDatabase()
})
