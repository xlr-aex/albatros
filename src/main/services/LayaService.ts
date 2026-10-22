/**
 * @file services/LayaService.ts
 * @description Background service that classifies articles into user-defined
 * Laya folders using a local Laya /v1/systemone worker.
 *
 * Strategy:
 *  - Every eligible article/folder pair is classified independently, so an
 *    article can appear in several folders.
 *  - Classification runs in parallel batches (p-limit concurrency 5) to
 *    maximise throughput without hammering the API.
 *  - Results are persisted immediately to SQLite so they survive restarts.
 *  - Only new/changed posts need re-classification; already-classified
 *    articles are skipped unless folders change.
 *  - Results are stored as auditable memberships. Reclassification clears
 *    only the target folder's decisions.
 */

import type { Database } from 'better-sqlite3'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fetch from 'cross-fetch'
import { app, BrowserWindow } from 'electron'
import { LayaRuntimeService } from './LayaRuntimeService'

// Laya runs on the user's machine.  The Python worker exposes the same
// SystemOne route as the reference Space, but no post content ever leaves
// localhost.
const LAYA_BATCH_ENDPOINT = 'http://127.0.0.1:7860/v1/systemone/batch'
const VECTOR_ENDPOINT = 'http://127.0.0.1:7861/candidates'
const CONCURRENCY   = 1          // keep the renderer responsive during local inference
const BATCH_SIZE    = 32         // articles fetched per loop iteration
const LAYA_BATCH_SIZE = 8        // articles sharing one Laya forward pass
// The multilingual Laya model runs on CPU. On a 4-core machine, two native
// requests take longer together than one after the other. Fair job ordering
// below still ensures no folder is starved.
const LAYA_REQUEST_CONCURRENCY = 1
// The embedding prefilter loads a second multilingual transformer (~hundreds
// of MB) in addition to Laya. Keep the reader stable on typical machines;
// advanced users can explicitly re-enable it with ALBATROS_ENABLE_VECTOR_FILTER=1.
const USE_VECTOR_FILTER = process.env.ALBATROS_ENABLE_VECTOR_FILTER === '1'
const LOOP_IDLE_MS  = 30_000     // sleep between sweeps when nothing to do
const FAILURE_BACKOFF_MS = 60_000// backoff after a network failure
const MAX_ATTEMPTS  = 3          // skip article after this many failures
// The multilingual model's raw `noul` output is a relevance score.  Keep the
// threshold deliberately conservative: wrongly filing an article is worse
// than leaving it in the general inbox.
const MIN_RELEVANCE_SCORE = 0.70
const KEYWORD_ASSISTED_SCORE = 0.52
const VECTOR_MIN_SIMILARITY = 0.35
const FOLDER_STOP_WORDS = new Set([
  'avec', 'aussi', 'dans', 'dont', 'des', 'dossier', 'elle', 'elles', 'leur', 'leurs', 'mais',
  'pour', 'post', 'posts', 'plus', 'que', 'qui', 'sera', 'sont', 'sur', 'tous', 'toute', 'toutes',
  'une', 'the', 'and', 'are', 'article', 'articles', 'information', 'informations', 'latest',
])

// ─── DB types ─────────────────────────────────────────────────────────────────

export interface LayaFolder {
  id:          number
  name:        string
  description: string
  sort_order:  number
  created_at:  number
  is_enabled:  number
}

export interface LayaGroupScope {
  group_id: number
  name: string
  icon: string | null
  feed_count: number
  enabled: number
}

export interface LayaFeedScope {
  feed_id: number
  title: string | null
  url: string
  group_name: string | null
  enabled: number
}

interface ArticleRow {
  id:           number
  feed_id:      number
  title:        string | null
  excerpt:      string | null
  content_text: string | null
}

// ─── Laya API ─────────────────────────────────────────────────────────────────

interface LayaAnswer {
  type?: string
  noul?: number
}

interface LayaResponse {
  answers: Record<string, LayaAnswer | undefined>
}

interface LayaBatchResponse {
  results: LayaResponse[]
}

type MembershipDecision = {
  folder: LayaFolder
  score: number
  decision: 'include' | 'exclude' | 'uncertain'
  evidence: string
}

/**
 * Feeds occasionally contain malformed UTF-16 (usually a truncated emoji).
 * JSON.stringify emits those as unpaired surrogate escapes, which Python's
 * UTF-8 request decoder rightly rejects. Replace only invalid code units while
 * preserving valid emoji pairs and all normal Unicode text.
 */
export function sanitizeUtf16(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xDC00 && next <= 0xDFFF) {
        result += value[index] + value[index + 1]
        index++
      } else {
        result += '�'
      }
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      result += '�'
    } else {
      result += value[index]
    }
  }
  return result
}

function normalizeWords(value: string): string[] {
  return sanitizeUtf16(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]{4,}/gu)
    ?.filter(word => !FOLDER_STOP_WORDS.has(word)) ?? []
}

function hasDirectFolderKeyword(article: ArticleRow, folder: LayaFolder): boolean {
  const articleWords = new Set(normalizeWords(`${article.title ?? ''} ${article.excerpt ?? ''} ${(article.content_text ?? '').slice(0, 600)}`))
  const folderWords = normalizeWords(`${folder.name} ${folder.description}`)
  return folderWords.some(word => {
    if (articleWords.has(word)) return true
    // Handles common French plural/gender forms (arabe/arabes, musulman/musulmane).
    const stem = word.replace(/(?:es|s)$/u, '')
    return stem.length >= 4 && [...articleWords].some(articleWord => articleWord.replace(/(?:es|s)$/u, '') === stem)
  })
}

/**
 * Laya's CPU cost grows sharply with the number of tokens in each state.  RSS
 * titles and descriptions already carry the editorial subject in the vast
 * majority of feeds, so make those authoritative and only use the beginning
 * of the body to fill the remaining context.  This keeps a useful evidence
 * window for terse posts without paying to classify a whole article preview.
 */
function articleText(article: ArticleRow): string {
  const title = (article.title ?? '').trim().slice(0, 260)
  const excerpt = (article.excerpt ?? '').trim().slice(0, 420)
  const header = [title, excerpt].filter(Boolean).join('\n')
  const remaining = Math.max(0, 620 - header.length)
  const body = remaining > 40
    ? (article.content_text ?? '').trim().slice(0, remaining)
    : ''

  return sanitizeUtf16([header, body].filter(Boolean).join('\n').slice(0, 620))
}

/** Convert the guided natural-language fields into concise contrastive criteria. */
function parseFolderPrompt(description: string): { topic: string; include: string; exclude: string } {
  description = sanitizeUtf16(description)
  const read = (labels: string[]) => new RegExp(`(?:${labels.join('|')})\\s*:\\s*([\\s\\S]*?)(?=\\n(?:Main topic|Include|Exclude|Sujet principal|Inclure notamment|Exclure explicitement)\\s*:|$)`, 'i').exec(description)?.[1]?.trim() ?? ''
  const topic = read(['Main topic', 'Sujet principal'])
  return topic
    ? { topic, include: read(['Include', 'Inclure notamment']), exclude: read(['Exclude', 'Exclure explicitement']) }
    : { topic: description.trim(), include: '', exclude: '' }
}

async function prefilterFoldersByVector(
  article: ArticleRow,
  folders: LayaFolder[],
  signal: AbortSignal,
): Promise<LayaFolder[]> {
  try {
    const response = await fetch(VECTOR_ENDPOINT, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: articleText(article),
        candidates: folders.map(folder => sanitizeUtf16(`${folder.name}. ${folder.description}`)),
      }),
    })
    if (!response.ok) return folders
    const data = await response.json() as { scores?: number[] }
    return folders.filter((_, index) => (data.scores?.[index] ?? 0) >= VECTOR_MIN_SIMILARITY)
  } catch {
    // A first-run model download must not block the RSS reader or discard an
    // article. Fall back to Laya until the local vector worker is ready.
    return folders
  }
}

function buildLayaQuestions(
  folders: LayaFolder[],
): { questions: Record<string, unknown>; folderQuestions: { key: string; folder: LayaFolder }[] } {
  const folderQuestions = folders.map((folder, index) => ({
    key: `folder_${index}`,
    folder,
  }))

  return {
    folderQuestions,
    questions: Object.fromEntries(folderQuestions.map(({ key, folder }) => {
      const rule = parseFolderPrompt(folder.description || folder.name)
      return [key, {
        type: 'noul',
        criteria: {
          false: `Out of scope: the main topic is not about ${rule.topic}.${rule.exclude ? ` Explicitly exclude: ${rule.exclude}.` : ''}`,
          true: `Main topic: ${rule.topic}.${rule.include ? ` Include: ${rule.include}.` : ''}`,
        },
        instructions: `Strict decision for “${folder.name}”: accept only when the central topic matches the positive criterion. Reject a passing mention and any explicit exclusion.`,
      }]
    })),
  }
}

export function resolveFolderDecisions(
  data: LayaResponse,
  article: ArticleRow,
  folderQuestions: { key: string; folder: LayaFolder }[],
): MembershipDecision[] {
  return folderQuestions.map(({ key, folder }) => {
    const rawScore = Number(data.answers?.[key]?.noul ?? 0)
    const score = Number.isFinite(rawScore) ? rawScore : 0
    const keywordMatch = score >= KEYWORD_ASSISTED_SCORE && hasDirectFolderKeyword(article, folder)
    const decision = score >= MIN_RELEVANCE_SCORE || keywordMatch
      ? 'include'
      : score >= KEYWORD_ASSISTED_SCORE
        ? 'uncertain'
        : 'exclude'
    return {
      folder,
      score,
      decision,
      evidence: JSON.stringify({ score, keywordMatch, threshold: MIN_RELEVANCE_SCORE }),
    }
  })
}

async function classifyArticlesBatch(
  articles: ArticleRow[],
  folders: LayaFolder[],
  signal: AbortSignal,
): Promise<MembershipDecision[][]> {
  const { questions, folderQuestions } = buildLayaQuestions(folders)
  const payload = {
    model: 'multilingual',
    states: articles.map(article => articleText(article) || 'No content'),
    questions,
    batch_size: LAYA_BATCH_SIZE,
    sort_by_length: true,
  }

  const res = await fetch(LAYA_BATCH_ENDPOINT, {
    method:  'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Laya ${res.status}: ${errText}`)
  }

  const data = await res.json() as LayaBatchResponse
  if (data.results.length !== articles.length) throw new Error('Laya batch response is incomplete')
  return data.results.map((result, index) => resolveFolderDecisions(result, articles[index], folderQuestions))
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class LayaService {
  private isRunning    = false
  private isProcessing = false
  private isPaused     = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private statusBroadcastTimer: ReturnType<typeof setTimeout> | null = null
  private lastFailureTime = 0
  private failedAttempts  = new Map<number, number>()
  private abortController: AbortController | null = null
  private worker: ChildProcessWithoutNullStreams | null = null
  private vectorWorker: ChildProcessWithoutNullStreams | null = null
  private workerError: string | null = null
  private workerReady = false
  private vectorReady = false
  private runtimeStart: Promise<void> | null = null
  private runtimePython: string | null = null
  private readonly runtime = new LayaRuntimeService()

  constructor(private readonly db: Database) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    console.log('[LayaService] Starting background classifier…')
    void this.loop()
  }

  stop(): void {
    this.isRunning = false
    this.abortController?.abort()
    this.worker?.kill()
    this.vectorWorker?.kill()
    this.worker = null
    this.vectorWorker = null
    this.workerReady = false
    this.vectorReady = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.statusBroadcastTimer) {
      clearTimeout(this.statusBroadcastTimer)
      this.statusBroadcastTimer = null
    }
    console.log('[LayaService] Stopped.')
  }

  /** Call this after a sync completes to immediately process new articles. */
  trigger(): void {
    if (this.isProcessing || !this.isRunning || this.isPaused) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    void this.loop()
  }

  /** Pauses classification without losing already persisted decisions. */
  pause(): void {
    if (this.isPaused) return
    this.isPaused = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.abortController?.abort()
    this.broadcastStatus()
  }

  resume(): void {
    if (!this.isPaused) return
    this.isPaused = false
    this.broadcastStatus()
    this.trigger()
  }

  /** Force-reclassify all articles (e.g. after folder list changes). */
  resetAll(): void {
    try {
      this.db.prepare('DELETE FROM article_laya_memberships').run()
      this.failedAttempts.clear()
      console.log('[LayaService] Reset all article classifications.')
    } catch (err) {
      console.error('[LayaService] resetAll error:', err)
    }
    this.trigger()
  }

  /** Reclassify only the posts currently in one folder and its selected groups. */
  resetFolderScope(folderId: number): void {
    try {
      const feedIds = this.getEnabledFeedIds(folderId)
      if (!feedIds.length) return
      this.db.prepare(`
        DELETE FROM article_laya_memberships
        WHERE folder_id = ? AND article_id IN (
          SELECT id FROM articles WHERE feed_id IN (${feedIds.map(() => '?').join(',')})
        )
      `).run(folderId, ...feedIds)
      this.failedAttempts.clear()
      console.log(`[LayaService] Reset classifications in folder ${folderId} scope.`)
    } catch (err) {
      console.error('[LayaService] resetFolderScope error:', err)
    }
    this.broadcastFolders()
    this.trigger()
  }

  // ── CRUD helpers (called from IPC) ─────────────────────────────────────────

  listFolders(): LayaFolder[] {
    return this.db
      .prepare(`
        SELECT f.id, f.name, f.description, f.sort_order, f.created_at, f.is_enabled,
               COUNT(memberships.article_id) AS article_count
        FROM laya_folders f
        LEFT JOIN article_laya_memberships memberships
          ON memberships.folder_id = f.id AND memberships.decision = 'include'
        GROUP BY f.id
        ORDER BY f.sort_order ASC, f.id ASC
      `)
      .all() as LayaFolder[]
  }

  listGroupScopes(folderId: number): LayaGroupScope[] {
    return this.db.prepare(`
      SELECT g.id AS group_id, g.name, g.icon, COUNT(f.id) AS feed_count,
             COALESCE(s.enabled, 0) AS enabled
      FROM feed_groups g
      JOIN feeds f ON f.group_id = g.id
      LEFT JOIN laya_folder_group_scopes s ON s.group_id = g.id AND s.folder_id = ?
      GROUP BY g.id
      ORDER BY g.sort_order, g.name COLLATE NOCASE
    `).all(folderId) as LayaGroupScope[]
  }

  setGroupScopes(folderId: number, groupIds: number[]): void {
    const selected = new Set(groupIds)
    const groups = this.db.prepare(`SELECT DISTINCT g.id FROM feed_groups g JOIN feeds f ON f.group_id = g.id`).all() as { id: number }[]
    const save = this.db.transaction(() => {
      const upsert = this.db.prepare(`
        INSERT INTO laya_folder_group_scopes (folder_id, group_id, enabled) VALUES (?, ?, ?)
        ON CONFLICT(folder_id, group_id) DO UPDATE SET enabled = excluded.enabled
      `)
      for (const group of groups) upsert.run(folderId, group.id, selected.has(group.id) ? 1 : 0)
    })
    save()
    this.trigger()
  }

  /** Individual feeds supplement the selected source groups for this folder. */
  listFeedScopes(folderId: number): LayaFeedScope[] {
    return this.db.prepare(`
      SELECT f.id AS feed_id, f.title, f.url, g.name AS group_name,
             COALESCE(s.enabled, 0) AS enabled
      FROM feeds f
      LEFT JOIN feed_groups g ON g.id = f.group_id
      LEFT JOIN laya_folder_feed_scopes s ON s.feed_id = f.id AND s.folder_id = ?
      ORDER BY g.sort_order, g.name COLLATE NOCASE, f.title COLLATE NOCASE, f.id
    `).all(folderId) as LayaFeedScope[]
  }

  setFeedScopes(folderId: number, feedIds: number[]): void {
    const selected = new Set(feedIds)
    const feeds = this.db.prepare('SELECT id FROM feeds').all() as { id: number }[]
    const save = this.db.transaction(() => {
      const upsert = this.db.prepare(`
        INSERT INTO laya_folder_feed_scopes (folder_id, feed_id, enabled) VALUES (?, ?, ?)
        ON CONFLICT(folder_id, feed_id) DO UPDATE SET enabled = excluded.enabled
      `)
      for (const feed of feeds) upsert.run(folderId, feed.id, selected.has(feed.id) ? 1 : 0)
    })
    save()
    this.trigger()
  }

  createFolder(name: string, description: string): LayaFolder {
    const sortOrder = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM laya_folders').get() as { n: number }).n
    const result    = this.db.prepare(
      `INSERT INTO laya_folders (name, description, sort_order) VALUES (?, ?, ?) RETURNING id, name, description, sort_order, created_at`
    ).get(name, description, sortOrder) as LayaFolder
    this.broadcastFolders()
    // Only classify new articles — existing ones keep assignments
    this.trigger()
    return result
  }

  updateFolder(id: number, patch: { name?: string; description?: string; is_enabled?: boolean }): void {
    const sets: string[] = []
    const values: unknown[] = []
    if (patch.name        !== undefined) { sets.push('name = ?');        values.push(patch.name) }
    if (patch.description !== undefined) { sets.push('description = ?'); values.push(patch.description) }
    if (patch.is_enabled !== undefined) { sets.push('is_enabled = ?'); values.push(patch.is_enabled ? 1 : 0) }
    if (!sets.length) return
    values.push(id)
    this.db.prepare(`UPDATE laya_folders SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    // Editing metadata must never move this folder's posts into another
    // folder. Reclassification is always an explicit user action.
    this.broadcastFolders()
    this.trigger()
  }

  deleteFolder(id: number): void {
    this.db.prepare('DELETE FROM laya_folders WHERE id = ?').run(id)
    this.broadcastFolders()
    this.trigger()
  }

  getPendingCount(): number {
    if (!this.getEnabledFolders().length) return 0
    const blockedIds = this.getBlockedIds()
    const clause     = blockedIds.length ? `AND articles.id NOT IN (${blockedIds.map(() => '?').join(',')})` : ''
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM articles
      JOIN laya_folders folders ON folders.is_enabled = 1
      WHERE NOT EXISTS (
        SELECT 1 FROM article_laya_memberships memberships
        WHERE memberships.article_id = articles.id AND memberships.folder_id = folders.id
      ) AND (
        EXISTS (
          SELECT 1 FROM feeds scoped_feeds
          JOIN laya_folder_group_scopes scopes ON scopes.group_id = scoped_feeds.group_id
          WHERE scopes.folder_id = folders.id AND scoped_feeds.id = articles.feed_id AND scopes.enabled = 1
        ) OR EXISTS (
          SELECT 1 FROM laya_folder_feed_scopes scopes
          WHERE scopes.folder_id = folders.id AND scopes.feed_id = articles.feed_id AND scopes.enabled = 1
        )
      ) ${clause}
    `).get(...blockedIds) as { count: number }
    return row.count
  }

  getTotalCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM articles').get() as { count: number }
    return row.count
  }

  private getScopedProgress(): { total: number; processed: number } {
    const folders = this.getEnabledFolders()
    if (!folders.length) return { total: 0, processed: 0 }
    const total = this.db.prepare(`
      SELECT COUNT(*) AS count FROM articles
      JOIN laya_folders folders ON folders.is_enabled = 1
      WHERE (
        EXISTS (SELECT 1 FROM feeds scoped_feeds
          JOIN laya_folder_group_scopes scopes ON scopes.group_id = scoped_feeds.group_id
          WHERE scopes.folder_id = folders.id AND scoped_feeds.id = articles.feed_id AND scopes.enabled = 1)
        OR EXISTS (SELECT 1 FROM laya_folder_feed_scopes scopes
          WHERE scopes.folder_id = folders.id AND scopes.feed_id = articles.feed_id AND scopes.enabled = 1)
      )
    `).get() as { count: number }
    const processed = this.db.prepare(`
      SELECT COUNT(*) AS count FROM article_laya_memberships memberships
      JOIN articles ON articles.id = memberships.article_id
      JOIN laya_folders folders ON folders.id = memberships.folder_id AND folders.is_enabled = 1
      WHERE (
        EXISTS (SELECT 1 FROM feeds scoped_feeds
          JOIN laya_folder_group_scopes scopes ON scopes.group_id = scoped_feeds.group_id
          WHERE scopes.folder_id = folders.id AND scoped_feeds.id = articles.feed_id AND scopes.enabled = 1)
        OR EXISTS (SELECT 1 FROM laya_folder_feed_scopes scopes
          WHERE scopes.folder_id = folders.id AND scopes.feed_id = articles.feed_id AND scopes.enabled = 1)
      )
    `).get() as { count: number }
    return { total: total.count, processed: processed.count }
  }

  getStatus(): { pending: number; total: number; processed: number; scopeTotal: number; folderProgress: Record<number, { processed: number; total: number }>; isProcessing: boolean; isPaused: boolean; workerReady: boolean; folderCount: number; workerError: string | null } {
    const progress = this.getScopedProgress()
    const folders = this.listFolders()
    const folderProgress = Object.fromEntries(folders.map(folder => [folder.id, this.getFolderScopedProgress(folder.id)]))
    return {
      pending:      this.getPendingCount(),
      total:        this.getTotalCount(),
      processed:    progress.processed,
      scopeTotal:   progress.total,
      folderProgress,
      isProcessing: this.isProcessing,
      isPaused:     this.isPaused,
      workerReady:  this.workerReady,
      folderCount:  this.listFolders().length,
      workerError:  this.workerError,
    }
  }

  /** Progress for an individual folder's selected sources. */
  private getFolderScopedProgress(folderId: number): { total: number; processed: number } {
    const feedIds = this.getEnabledFeedIds(folderId)
    if (!feedIds.length) return { total: 0, processed: 0 }
    const placeholders = feedIds.map(() => '?').join(',')
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM articles WHERE feed_id IN (${placeholders})`).get(...feedIds) as { count: number }
    const processed = this.db.prepare(`
      SELECT COUNT(*) AS count FROM article_laya_memberships
      WHERE folder_id = ? AND article_id IN (
        SELECT id FROM articles WHERE feed_id IN (${placeholders})
      )
    `).get(folderId, ...feedIds) as { count: number }
    return { total: total.count, processed: processed.count }
  }

  /** Starts the local Laya HTTP worker when it is not already running. */
  private startLocalWorker(): void {
    if (this.worker || this.runtimeStart) return
    this.workerError = 'Preparing Laya for its first run…'
    this.broadcastStatus()
    this.runtimeStart = this.runtime.ensure().then(python => {
      if (!this.isRunning) return
      this.runtimePython = python
      const worker = spawn(python, ['-m', 'laya.serve'], {
        windowsHide: true,
        env: {
          ...process.env,
          LAYA_HOST: '127.0.0.1',
          LAYA_PORT: '7860',
          LAYA_DEVICE: 'cpu',
          LAYA_MODELS: 'multilingual',
          LAYA_PRELOAD: '1',
          // The vector worker has one thread too. Restrict Laya to one core
          // so a full reclassification cannot starve Electron's renderer.
          LAYA_THREADS: '1',
          OMP_NUM_THREADS: '1',
          MKL_NUM_THREADS: '1',
          TOKENIZERS_PARALLELISM: 'false',
          CUDA_VISIBLE_DEVICES: '',
        },
      })
      this.worker = worker
      this.workerReady = false
      worker.on('error', error => {
        this.workerError = `Could not start Laya locally: ${error.message}`
        this.worker = null
        this.workerReady = false
        console.error('[LayaService]', this.workerError)
      })
      worker.on('exit', (code, signal) => {
        if (!this.isRunning) return
        this.worker = null
        this.workerReady = false
      this.workerError = `The local Laya worker stopped (${signal ?? `code ${code ?? 'unknown'}`}).`
        console.error('[LayaService]', this.workerError)
      })
      worker.stderr.on('data', data => console.warn(`[Laya local] ${String(data).trim()}`))
      if (USE_VECTOR_FILTER) this.startVectorWorker(python)
    }).catch(error => {
      this.workerError = `Could not start Laya locally: ${(error as Error).message}`
      console.error('[LayaService]', this.workerError)
    }).finally(() => { this.runtimeStart = null })
  }

  /** Starts the on-device multilingual embedding model used before Laya. */
  private startVectorWorker(python: string): void {
    if (this.vectorWorker) return
    const script = app.isPackaged
      ? path.join(process.resourcesPath, 'vector_worker.py')
      : path.join(app.getAppPath(), 'resources', 'vector_worker.py')
    // `python.exe` is our already-selected embedded interpreter. `-3.10` is
    // for the Windows `py.exe` launcher and made the worker restart forever.
    const args = [script]
    try {
      const worker = spawn(python, args, {
        windowsHide: true,
        env: {
          ...process.env,
          ALBATROS_VECTOR_PORT: '7861',
          ALBATROS_VECTOR_THREADS: '1',
          TOKENIZERS_PARALLELISM: 'false',
          OMP_NUM_THREADS: '1',
          MKL_NUM_THREADS: '1',
        },
      })
      this.vectorWorker = worker
      this.vectorReady = false
      worker.on('error', error => console.warn(`[VectorFilter] Unable to start: ${error.message}`))
      worker.on('exit', code => {
        this.vectorWorker = null
        this.vectorReady = false
        if (this.isRunning) console.warn(`[VectorFilter] Worker stopped (code ${code ?? 'unknown'}).`)
      })
      worker.stderr.on('data', data => console.warn(`[VectorFilter] ${String(data).trim()}`))
    } catch (error) {
      console.warn('[VectorFilter] Unable to start:', (error as Error).message)
    }
  }

  // ── Private loop ────────────────────────────────────────────────────────────

  private async loop(): Promise<void> {
    if (!this.isRunning || this.isProcessing || this.isPaused) return

    // Backoff after failures
    if (Date.now() - this.lastFailureTime < FAILURE_BACKOFF_MS) {
      this.timer = setTimeout(() => this.loop(), 10_000)
      return
    }

    const folders = this.getEnabledFolders()
    if (!folders.length) {
      // Nothing to do without folders — sleep and retry later
      this.timer = setTimeout(() => this.loop(), LOOP_IDLE_MS)
      return
    }

    // Do not consume local model resources until the user has created at
    // least one destination folder.
    this.startLocalWorker()
    if (USE_VECTOR_FILTER && this.runtimePython) this.startVectorWorker(this.runtimePython)

    // CPU model loading can take a while. Do not mark posts as failed while
    // the local HTTP server is still booting.
    if (!this.workerReady) {
      if (!await this.isWorkerReady()) {
        this.timer = setTimeout(() => this.loop(), 2_000)
        return
      }
      this.workerReady = true
      this.workerError = null
      this.broadcastStatus()
    }

    // The vector model is loaded once and stays resident. Waiting here makes
    // every classification benefit from the high-recall cheap prefilter,
    // instead of producing a slow unfiltered first sweep.
    if (USE_VECTOR_FILTER && !this.vectorReady) {
      if (!await this.isVectorWorkerReady()) {
        this.timer = setTimeout(() => this.loop(), 2_000)
        return
      }
      this.vectorReady = true
      this.broadcastStatus()
    }

    const blockedIds = this.getBlockedIds()
    const clause     = blockedIds.length ? `AND id NOT IN (${blockedIds.map(() => '?').join(',')})` : ''

    const batch = this.db.prepare(`
      SELECT id, feed_id, title, excerpt, content_text
      FROM articles
      WHERE EXISTS (
        SELECT 1 FROM laya_folders folders
        WHERE folders.is_enabled = 1
          AND NOT EXISTS (
            SELECT 1 FROM article_laya_memberships memberships
            WHERE memberships.article_id = articles.id AND memberships.folder_id = folders.id
          )
          AND (
            EXISTS (
              SELECT 1 FROM feeds scoped_feeds
              JOIN laya_folder_group_scopes scopes ON scopes.group_id = scoped_feeds.group_id
              WHERE scopes.folder_id = folders.id AND scoped_feeds.id = articles.feed_id AND scopes.enabled = 1
            ) OR EXISTS (
              SELECT 1 FROM laya_folder_feed_scopes scopes
              WHERE scopes.folder_id = folders.id AND scopes.feed_id = articles.feed_id AND scopes.enabled = 1
            )
          )
      ) ${clause}
      ORDER BY published_at DESC, id DESC
      LIMIT ${BATCH_SIZE}
    `).all(...blockedIds) as ArticleRow[]

    if (!batch.length) {
      this.timer = setTimeout(() => this.loop(), LOOP_IDLE_MS)
      return
    }

    this.isProcessing = true
    this.broadcastStatus()
    this.abortController = new AbortController()
    const { signal } = this.abortController

    try {
      await this.processBatch(batch, folders, signal)
      this.lastFailureTime = 0
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        console.log('[LayaService] Batch aborted.')
      } else {
        console.error('[LayaService] Batch error:', err)
        this.lastFailureTime = Date.now()
      }
    } finally {
      this.isProcessing = false
      this.broadcastStatus()
      this.abortController = null
      if (this.isRunning && !this.isPaused) {
        const delay = this.lastFailureTime > 0 ? FAILURE_BACKOFF_MS : 500
        this.timer  = setTimeout(() => this.loop(), delay)
      }
    }
  }

  private async isWorkerReady(): Promise<boolean> {
    try {
      const response = await fetch('http://127.0.0.1:7860/docs', {
        signal: AbortSignal.timeout(1_500),
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async processBatch(
    batch:   ArticleRow[],
    folders: LayaFolder[],
    signal:  AbortSignal,
  ): Promise<void> {
    type PreparedArticle = { article: ArticleRow; folders: LayaFolder[] }

    // Vectorization is cheap but still CPU-bound. Limit those requests, then
    // group articles with an identical candidate set for one native Laya batch.
    const queue = [...batch]
    const prepared: PreparedArticle[] = []
    const vectorWorkers: Promise<void>[] = []

    const runVectorWorker = async () => {
      while (queue.length > 0) {
        if (signal.aborted) break
        const article = queue.shift()
        if (!article) break

        try {
          const eligibleFolders = this.getEligibleFoldersForFeed(article.feed_id, folders)
            .filter(folder => !this.hasMembership(article.id, folder.id))
          // A vector prefilter is allowed to improve local worker warm-up, but
          // it must never remove a folder: every scoped pair needs an explicit
          // include/exclude/uncertain decision.
          if (USE_VECTOR_FILTER && eligibleFolders.length) {
            await prefilterFoldersByVector(article, eligibleFolders, signal)
          }
          prepared.push({ article, folders: eligibleFolders })
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err
          console.warn(`[LayaService] Failed to prefilter article ${article.id}:`, (err as Error).message)
          this.failedAttempts.set(article.id, (this.failedAttempts.get(article.id) ?? 0) + 1)
          this.lastFailureTime = Date.now()
        }
      }
    }

    for (let i = 0; i < CONCURRENCY; i++) vectorWorkers.push(runVectorWorker())
    await Promise.all(vectorWorkers)

    const groups = new Map<string, PreparedArticle[]>()
    for (const item of prepared) {
      if (!item.folders.length) {
        continue
      }
      const key = item.folders.map(folder => folder.id).sort((a, b) => a - b).join(',')
      const group = groups.get(key) ?? []
      group.push(item)
      groups.set(key, group)
    }

    // Each candidate set represents one or more folder scopes. Previously
    // these groups were handled serially, so a large reanalysis could starve
    // another folder. Jobs are interleaved below so every folder gets a turn.
    const groupedItems = [...groups.values()]
    const jobs: { candidates: LayaFolder[]; chunk: PreparedArticle[] }[] = []
    for (let offset = 0; ; offset += LAYA_BATCH_SIZE) {
      let added = false
      for (const items of groupedItems) {
        const chunk = items.slice(offset, offset + LAYA_BATCH_SIZE)
        if (!chunk.length) continue
        jobs.push({ candidates: items[0].folders, chunk })
        added = true
      }
      if (!added) break
    }

    let nextJob = 0
    const runLayaWorker = async () => {
      while (!signal.aborted) {
        const job = jobs[nextJob++]
        if (!job) return
        try {
          const decisions = await classifyArticlesBatch(job.chunk.map(item => item.article), job.candidates, signal)
          const runId = randomUUID()
          for (let index = 0; index < job.chunk.length; index++) {
            this.persistClassifications(job.chunk[index].article.id, decisions[index], runId)
          }
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err
          console.warn('[LayaService] Failed to classify Laya batch:', (err as Error).message)
          for (const item of job.chunk) {
            this.failedAttempts.set(item.article.id, (this.failedAttempts.get(item.article.id) ?? 0) + 1)
          }
          this.lastFailureTime = Date.now()
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(LAYA_REQUEST_CONCURRENCY, jobs.length) }, () => runLayaWorker()))
  }

  private persistClassifications(articleId: number, decisions: MembershipDecision[], runId: string): void {
    const save = this.db.transaction(() => {
      const upsert = this.db.prepare(`
        INSERT INTO article_laya_memberships
          (article_id, folder_id, score, decision, model_version, classified_at, run_id, evidence)
        VALUES (?, ?, ?, ?, 'laya-multilingual', strftime('%s','now'), ?, ?)
        ON CONFLICT(article_id, folder_id) DO UPDATE SET
          score = excluded.score, decision = excluded.decision,
          model_version = excluded.model_version, classified_at = excluded.classified_at,
          run_id = excluded.run_id, evidence = excluded.evidence
      `)
      for (const result of decisions) {
        // A paused folder remains pending while unrelated folders still save.
        if (this.isFolderEnabled(result.folder.id)) {
          upsert.run(articleId, result.folder.id, result.score, result.decision, runId, result.evidence)
        }
      }
    })
    save()
    this.scheduleStatusBroadcast()
  }

  private hasMembership(articleId: number, folderId: number): boolean {
    return this.db.prepare(
      'SELECT 1 FROM article_laya_memberships WHERE article_id = ? AND folder_id = ?'
    ).get(articleId, folderId) !== undefined
  }

  private getBlockedIds(): number[] {
    return [...this.failedAttempts.entries()]
      .filter(([, n]) => n >= MAX_ATTEMPTS)
      .map(([id]) => id)
  }

  private async isVectorWorkerReady(): Promise<boolean> {
    try {
      const response = await fetch('http://127.0.0.1:7861/health', { signal: AbortSignal.timeout(1_500) })
      return response.ok
    } catch {
      return false
    }
  }

  private getEnabledFolders(): LayaFolder[] {
    return this.listFolders().filter(folder => folder.is_enabled === 1)
  }

  private isFolderEnabled(folderId: number): boolean {
    const row = this.db.prepare('SELECT is_enabled FROM laya_folders WHERE id = ?').get(folderId) as { is_enabled: number } | undefined
    return row?.is_enabled === 1
  }

  private getEnabledFeedIds(folderId: number): number[] {
    return (this.db.prepare(`
      SELECT DISTINCT feed_id FROM (
        SELECT f.id AS feed_id FROM feeds f
        JOIN laya_folder_group_scopes scopes ON scopes.group_id = f.group_id
        WHERE scopes.folder_id = ? AND scopes.enabled = 1
        UNION
        SELECT feed_id FROM laya_folder_feed_scopes
        WHERE folder_id = ? AND enabled = 1
      )
    `).all(folderId, folderId) as { feed_id: number }[]).map(row => row.feed_id)
  }

  private getScopedFeedIds(): number[] {
    return (this.db.prepare(`
      SELECT DISTINCT feed_id FROM (
        SELECT f.id AS feed_id FROM feeds f
        JOIN laya_folder_group_scopes scopes ON scopes.group_id = f.group_id
        JOIN laya_folders folders ON folders.id = scopes.folder_id
        WHERE scopes.enabled = 1 AND folders.is_enabled = 1
        UNION
        SELECT scopes.feed_id FROM laya_folder_feed_scopes scopes
        JOIN laya_folders folders ON folders.id = scopes.folder_id
        WHERE scopes.enabled = 1 AND folders.is_enabled = 1
      )
    `).all() as { feed_id: number }[]).map(row => row.feed_id)
  }

  private getEligibleFoldersForFeed(feedId: number, folders: LayaFolder[]): LayaFolder[] {
    const folderIds = new Set((this.db.prepare(`
      SELECT folder_id FROM (
        SELECT scopes.folder_id FROM feeds f
        JOIN laya_folder_group_scopes scopes ON scopes.group_id = f.group_id
        WHERE f.id = ? AND scopes.enabled = 1
        UNION
        SELECT folder_id FROM laya_folder_feed_scopes
        WHERE feed_id = ? AND enabled = 1
      )
    `).all(feedId, feedId) as { folder_id: number }[]).map(row => row.folder_id))
    return folders.filter(folder => folderIds.has(folder.id))
  }

  // ── IPC broadcasts ─────────────────────────────────────────────────────────

  private broadcast(channel: string, payload: unknown): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      // A renderer can be disposed between the checks and send(). Status
      // updates are best-effort, so never let that lifecycle race spam logs.
      try {
        win.webContents.send(channel, payload)
      } catch {
        // Renderer closed or crashed; its next window will request fresh state.
      }
    }
  }

  broadcastStatus(): void {
    this.broadcast('laya:status', this.getStatus())
  }

  private scheduleStatusBroadcast(): void {
    if (this.statusBroadcastTimer) return
    this.statusBroadcastTimer = setTimeout(() => {
      this.statusBroadcastTimer = null
      this.broadcastStatus()
    }, 150)
  }

  broadcastFolders(): void {
    this.broadcast('laya:folders', this.listFolders())
  }
}
