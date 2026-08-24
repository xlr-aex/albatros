import type { Database } from 'better-sqlite3'
import { BrowserWindow } from 'electron'
import type { ArticleService } from './ArticleService'
import fetch from 'cross-fetch'
import type { LlmService } from './LlmService'

export class SummaryService {
  private isProcessing = false
  private isRunning = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastFailureTime = 0
  /** Articles that repeatedly failed summarization, so one poison pill cannot stall the queue. */
  private failedAttempts = new Map<number, number>()
  private static readonly MAX_ATTEMPTS = 3

  constructor(
    private readonly db: Database,
    private readonly articleService: ArticleService,
    private readonly llm: LlmService
  ) {}

  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    console.log('[SummaryService] Starting background summarizer...')
    this.loop()
  }

  stop(): void {
    this.isRunning = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    console.log('[SummaryService] Stopped background summarizer.')
  }

  trigger(): void {
    if (this.isProcessing || !this.isRunning) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.loop()
  }

  getPendingCount(): number {
    const minPublishedAt = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60
    const blockedIds = [...this.failedAttempts.entries()]
      .filter(([, attempts]) => attempts >= SummaryService.MAX_ATTEMPTS)
      .map(([id]) => id)
    const blockClause = blockedIds.length
      ? `AND id NOT IN (${blockedIds.map(() => '?').join(',')})`
      : ''
    const row = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM articles 
      WHERE summary IS NULL 
        AND (published_at >= ? OR is_read = 0)
        ${blockClause}
    `).get(minPublishedAt, ...blockedIds) as { count: number } | undefined
    return row?.count ?? 0
  }

  getTotalCount(): number {
    const minPublishedAt = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60
    const row = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM articles 
      WHERE published_at >= ? OR is_read = 0
    `).get(minPublishedAt) as { count: number } | undefined
    return row?.count ?? 0
  }

  private async loop() {
    if (!this.isRunning) return
    if (this.isProcessing) return

    // Backoff if we recently had a failure (e.g. LLM offline)
    const now = Date.now()
    if (now - this.lastFailureTime < 60_000) {
      this.timer = setTimeout(() => this.loop(), 10_000)
      return
    }

    const minPublishedAt = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60
    const blockedIds = [...this.failedAttempts.entries()]
      .filter(([, attempts]) => attempts >= SummaryService.MAX_ATTEMPTS)
      .map(([id]) => id)
    const blockClause = blockedIds.length
      ? `AND id NOT IN (${blockedIds.map(() => '?').join(',')})`
      : ''
    const nextArticle = this.db.prepare(`
      SELECT id, title, content_text, excerpt 
      FROM articles 
      WHERE summary IS NULL 
        AND (published_at >= ? OR is_read = 0)
        ${blockClause}
      ORDER BY published_at DESC 
      LIMIT 1
    `).get(minPublishedAt, ...blockedIds) as { id: number; title: string | null; content_text: string | null; excerpt: string | null } | undefined

    if (!nextArticle) {
      // No articles to process; sleep 30s
      this.timer = setTimeout(() => this.loop(), 30_000)
      return
    }

    this.isProcessing = true
    this.broadcastStatus()

    try {
      const summary = await this.summarizeArticle(nextArticle)
      if (summary) {
        this.articleService.updateSummary(nextArticle.id, summary)
      } else {
        // Fallback to title if empty summary returned
        this.articleService.updateSummary(nextArticle.id, nextArticle.title || 'Article sans résumé')
      }
      this.lastFailureTime = 0 // Reset failure on success
    } catch (err) {
      console.warn(`[SummaryService] Failed to summarize article ${nextArticle.id}:`, err)
      this.failedAttempts.set(nextArticle.id, (this.failedAttempts.get(nextArticle.id) ?? 0) + 1)
      this.lastFailureTime = Date.now()
    } finally {
      this.isProcessing = false
      this.broadcastStatus()

      if (this.isRunning) {
        // Continue processing after a short gap to not freeze the thread
        const delay = this.lastFailureTime > 0 ? 30_000 : 1_000
        this.timer = setTimeout(() => this.loop(), delay)
      }
    }
  }

  private async summarizeArticle(article: { title: string | null; content_text: string | null; excerpt: string | null }): Promise<string> {
    const config = this.llm.getConfig()
    const targetModel = await this.llm.resolveModel(config)

    const systemPrompt = "Tu es un assistant de lecture RSS. Résume l'article fourni en français sous la forme d'une seule phrase très courte, directe et factuelle (maximum 15 mots), sans introduction ni conclusion."
    const titleText = article.title ? `Titre: ${article.title}\n\n` : ''
    const bodyText = (article.content_text || article.excerpt || '').substring(0, 1500)
    const promptText = `${titleText}Contenu:\n${bodyText}`

    console.log(`[SummaryService] Summarizing: provider=${config.provider} url=${config.chatUrl} model=${targetModel}`)

    if (config.provider === 'ollama') {
      const res = await fetch(config.chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: promptText }
          ],
          stream: false
        })
      })
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${res.statusText}`)
      const json = await res.json()
      return json.message?.content?.trim() || ''
    } else {
      const res = await fetch(config.chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: promptText }
          ],
          stream: false
        })
      })
      if (!res.ok) throw new Error(`LM Studio HTTP ${res.status}: ${res.statusText}`)
      const json = await res.json()
      return json.choices?.[0]?.message?.content?.trim() || ''
    }
  }

  private broadcastStatus(): void {
    const pending = this.getPendingCount()
    const total = this.getTotalCount()
    const payload = {
      pending,
      total,
      isProcessing: this.isProcessing
    }

    const windows = BrowserWindow?.getAllWindows?.() ?? []
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('summary:status', payload)
      }
    }
  }
}
