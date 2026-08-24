/**
 * @file services/SettingsService.ts
 * @description Key-value settings store backed by the `settings` SQLite table.
 *
 * All values are stored as text and converted to the appropriate type by the
 * caller.  Helper getters for common settings are provided for convenience.
 */

import type { Database } from 'better-sqlite3'

// ─── Known setting keys (typed for autocompletion + safety) ──────────────────

export type SettingKey =
  | 'theme'
  | 'accent_color'
  | 'font_size'
  | 'ui_font_size'
  | 'reading_pane'
  | 'mark_read_on_open'
  | 'default_interval_sec'
  | 'retention_days'
  | 'max_articles_per_feed'
  | 'sidebar_width'
  | 'article_list_width'
  // ── AI Summary ───────────────────────────────────────────────────────────
  | 'ai_provider'
  | 'ai_model'
  | 'ai_system_prompt'
  | 'ai_base_url'
  | 'ai_chatbot_summary_prompt'
  | 'ai_chatbot_news_prompt'

export type Theme       = 'dark' | 'light'
export type ReadingPane = 'right' | 'bottom' | 'off'

// ─── Service ─────────────────────────────────────────────────────────────────

export class SettingsService {
  constructor(private readonly db: Database) {}

  /** Returns the raw string value of a setting, or null if not found. */
  get(key: SettingKey): string | null {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?')
    const row = stmt.get(key) as { value: unknown } | undefined
    return row?.value !== undefined && row.value !== null ? String(row.value) : null
  }

  /** Returns all settings as a plain object. */
  getAll(): Record<string, string> {
    const stmt = this.db.prepare('SELECT key, value FROM settings')
    const rows = stmt.all() as { key: unknown, value: unknown }[]
    const out: Record<string, string> = {}
    for (const row of rows) {
      if (row.key !== null) out[String(row.key)] = row.value !== null ? String(row.value) : ''
    }
    return out
  }

  /** Sets a single key.  Upserts if the key already exists. */
  set(key: SettingKey, value: string): void {
    const stmt = this.db.prepare(`
       INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, strftime('%s','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                      updated_at = excluded.updated_at
    `)
    stmt.run(key, value)
    if (key === 'ai_base_url' || key === 'ai_provider' || key === 'ai_model') {
      console.log(`[SettingsService] Saved ${key}=${value}`)
    }
  }

  /** Atomically saves a settings snapshot, preserving renderer edit order. */
  setMany(values: Partial<Record<SettingKey, string>>): void {
    const save = this.db.transaction((entries: [SettingKey, string][]) => {
      for (const [key, value] of entries) this.set(key, value)
    })
    save(Object.entries(values) as [SettingKey, string][])
  }

  // ── Typed convenience getters ─────────────────────────────────────────────

  get theme(): Theme {
    return (this.get('theme') as Theme) ?? 'dark'
  }

  get readingPane(): ReadingPane {
    return (this.get('reading_pane') as ReadingPane) ?? 'right'
  }

  get markReadOnOpen(): boolean {
    return this.get('mark_read_on_open') === '1'
  }

  get retentionDays(): number {
    return parseInt(this.get('retention_days') ?? '30', 10)
  }

  get defaultIntervalSec(): number {
    return parseInt(this.get('default_interval_sec') ?? '900', 10)
  }

  get aiProvider(): string {
    return this.get('ai_provider') || 'lmstudio'
  }

  get aiModel(): string {
    return this.get('ai_model') || ''
  }

  get aiBaseUrl(): string {
    return this.get('ai_base_url') || 'http://127.0.0.1:1234'
  }

  get aiSystemPrompt(): string {
    return (
      this.get('ai_system_prompt') ||
      "Tu es un assistant de lecture. Résume l'article suivant en français en 3-5 points clés, de manière concise et claire. Commence directement par les points clés sans introduction."
    )
  }
}
