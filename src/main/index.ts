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

import { app, BrowserWindow, shell, session } from 'electron'

// Suppress harmless Chromium DevTools Autofill errors that spam the terminal
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: Uint8Array | string, encoding?: any, callback?: any) => {
  const str = chunk.toString();
  if (str.includes('Request Autofill.enable failed') || str.includes('Request Autofill.setAddresses failed')) {
    if (typeof callback === 'function') callback();
    return true;
  }
  return originalStderrWrite(chunk, encoding, callback);
}) as any;

import path from 'path'
import { promises as fs } from 'fs'
import { ElectronBlocker } from '@cliqz/adblocker-electron'
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

// ── Sync ─────────────────────────────────────────────────────────────────────
import { SyncEngine } from './sync/SyncEngine'
import { Scheduler }  from './sync/Scheduler'

// ── IPC ───────────────────────────────────────────────────────────────────────
import { registerFeedHandlers }     from './ipc/feeds'
import { registerArticleHandlers }  from './ipc/articles'
import { registerSettingsHandlers, registerSyncHandlers } from './ipc/settings'

// ─── Window helper ────────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width:           1440,
    height:          900,
    minWidth:        900,
    minHeight:       600,
    backgroundColor: '#0f1117', // Dark background to avoid white flash
    titleBarStyle:   'hiddenInset',
    icon:            path.join(__dirname, '../../resources/icon.png'),
    webPreferences:  {
      preload:          path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,    // Required for security
      nodeIntegration:  false,   // Never allow node in renderer
      sandbox:          false,   // Needed for sql.js WASM in preload
      webviewTag:       true,    // Enable <webview> for embedded browser
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
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Production: static build
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ─── Application lifecycle ────────────────────────────────────────────────────

let scheduler: Scheduler | null = null

async function bootstrap(): Promise<void> {
  // ── 0. Adblock engine ──────────────────────────────────────────────────
  //    Loads prebuilt EasyList + EasyPrivacy filter lists with disk caching.
  //    First run downloads lists (~2s), subsequent starts load from cache (<50ms).
  //    The engine auto-refreshes stale lists from the network when possible.
  try {
    const enginePath = path.join(app.getPath('userData'), 'adblocker-engine.bin')
    const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
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

  // ── 1. Database ──────────────────────────────────────────────────────────
  const db = await getDatabase()
  runMigrations(db)

  // ── 2. Services ──────────────────────────────────────────────────────────
  const feedService     = new FeedService(db)
  feedService.resetErrorCounts() // Clean state on start

  const articleService  = new ArticleService(db)
  const searchService   = new SearchService(db)
  const settingsService = new SettingsService(db)
  const opmlService     = new OpmlService(feedService)

  // ── 3. Sync engine ───────────────────────────────────────────────────────
  const syncEngine = new SyncEngine(feedService, articleService, db)
  scheduler = new Scheduler(db, syncEngine, feedService, articleService, settingsService)

  // ── 4. IPC ───────────────────────────────────────────────────────────────
  registerFeedHandlers(feedService, opmlService, scheduler)
  registerArticleHandlers(articleService, searchService, feedService)
  registerSettingsHandlers(settingsService)
  registerSyncHandlers(scheduler)

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
  closeDatabase()
})
