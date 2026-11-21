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

// Laya runs CPU-bound local models alongside Chromium. On affected Windows GPU
// drivers, the GPU process repeatedly dies while memory is under pressure and
// takes the renderer down with it. Software compositing is much more reliable
// for this desktop reader and leaves memory headroom for the classifier.
app.disableHardwareAcceleration()

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
import { promises as fs, existsSync } from 'fs'
import { spawn } from 'node:child_process'
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
import { LayaService }     from './services/LayaService'
import { AlbatrosMcpService } from './mcp/AlbatrosMcpService'

// ── Sync ─────────────────────────────────────────────────────────────────────
import { SyncEngine, repairStaleFaviconUrls } from './sync/SyncEngine'
import { Scheduler }  from './sync/Scheduler'

// ── IPC ───────────────────────────────────────────────────────────────────────
import { registerFeedHandlers }     from './ipc/feeds'
import { registerArticleHandlers }  from './ipc/articles'
import { registerSettingsHandlers, registerSyncHandlers } from './ipc/settings'
import { registerLayaHandlers }     from './ipc/laya'

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
    icon:            path.join(__dirname, '../../resources/icon.ico'),
    webPreferences:  {
      preload:          path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,    // Required for security
      nodeIntegration:  false,   // Never allow node in renderer
      sandbox:          false,   // Needed for sql.js WASM in preload
      webviewTag:       true,    // Enable <webview> for embedded browser
      webSecurity:      true,
    },
  })

  // Keep renderer failures visible in the development terminal instead of
  // leaving the user with an unexplained blank window.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Renderer] Process stopped:', details.reason, details.exitCode)
  })

  // Open external links in the OS browser, not Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    openUrlInBrowser(url)
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

/**
 * Windows can have a broken http(s) association (in this case it pointed to
 * python.exe). Prefer an installed browser for article links, with Electron's
 * normal OS hand-off as a fallback on other systems.
 */
function openUrlInBrowser(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const localAppData = process.env.LOCALAPPDATA ?? ''
    const browsers = [
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]
    const browser = browsers.find(existsSync)
    if (browser) {
      const child = spawn(browser, [url.href], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      return true
    }
  }

  void shell.openExternal(url.href)
  return true
}

// ─── Application lifecycle ────────────────────────────────────────────────────

let scheduler: Scheduler | null = null
let layaService:    LayaService    | null = null
let mcpService:     AlbatrosMcpService | null = null

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
  // NOTE - v2 cache name: the previous engine file was serialized with
  // cosmetic filters enabled and would override the config below on load.
  // Never make first paint wait for filter-list disk I/O or a first-run
  // download. The dedicated webview partition simply starts unfiltered until
  // this promise completes.
  const enginePath = path.join(app.getPath('userData'), 'adblocker-engine-v2.bin')
  void fs.unlink(path.join(app.getPath('userData'), 'adblocker-engine.bin')).catch(() => {})
  void ElectronBlocker.fromLists(fetch, adsAndTrackingLists, {
      loadCosmeticFilters: false,
      enableMutationObserver: false,
    }, {
      path: enginePath,
      read: fs.readFile,
      write: fs.writeFile,
    })
    .then(blocker => {
      // Apply to a dedicated partition so the main app session is unaffected
      blocker.enableBlockingInSession(session.fromPartition('persist:adblock'))
      console.log('[Adblock] Engine loaded on partition persist:adblock')
    })
    .catch(err => console.error('[Adblock] Failed to initialise:', err))

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
        { urls: ['*://*.reddit.com/*', '*://reddit.com/*', '*://*.redd.it/*', '*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'] },
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

          // YouTube error 153 fix (late-2025 policy): embedded players require a
          // valid HTTP Referer. file:// / opaque origins send none, so we inject
          // one matching the `origin` param passed by the renderer iframes.
          if (/\.youtube(?:-nocookie)?\.com$/.test(new URL(details.url).hostname)) {
            setHeader('Referer', 'https://albatros.app/')
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
  const opmlService     = new OpmlService(feedService)
  layaService           = new LayaService(db)

  // ── 3. Engine ────────────────────────────────────────────────────────────
  const syncEngine = new SyncEngine(feedService, articleService, db)
  scheduler = new Scheduler(db, syncEngine, feedService, articleService, settingsService)
  mcpService = new AlbatrosMcpService(db, {
    articles: articleService,
    feeds: feedService,
    search: searchService,
    laya: layaService,
    scheduler,
  })

  syncEngine.onSyncComplete = () => {
    layaService?.trigger()
  }

  // ── 4. IPC ───────────────────────────────────────────────────────────────
  registerFeedHandlers(feedService, opmlService, scheduler)
  registerArticleHandlers(articleService, searchService, feedService)
  registerSettingsHandlers(settingsService)
  registerSyncHandlers(scheduler)
  registerLayaHandlers(layaService)

  ipcMain.handle('mcp:connection-info', () => mcpService?.getConnectionInfo() ?? null)

  ipcMain.handle('menu:toggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const visible = !win.isMenuBarVisible()
    win.setMenuBarVisibility(visible)
    return visible
  })

  ipcMain.handle('browser:open', (_event, url: string) => openUrlInBrowser(url))

  ipcMain.on('debug:log', (_event, msg) => {
    console.log('[Renderer Debug]', msg)
  })

  // ── 5. Window ────────────────────────────────────────────────────────────
  // Show the reader before loading the two local ML models. Their first load
  // uses several gigabytes of RAM and must never leave a blank Electron window.
  const mainWindow = createWindow()

  // Give Chromium a usable first paint before local Laya competes for RAM/CPU.
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => layaService?.start(), 8_000)
  })

  // The MCP endpoint remains loopback-only. ChatGPT reaches it through an
  // authenticated Secure MCP Tunnel, while local clients can use the same URL.
  try {
    await mcpService.start()
  } catch (error) {
    console.error('[MCP] Local MCP server did not start:', error)
  }

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
  layaService?.stop()
  void mcpService?.stop().catch(error => console.error('[MCP] Failed to stop:', error))
  closeDatabase()
})
