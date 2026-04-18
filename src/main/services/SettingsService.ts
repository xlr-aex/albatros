/**
 * @file services/SettingsService.ts
 * @description Key-value settings store backed by the `settings` SQLite table.
 *
 * All values are stored as text and converted to the appropriate type by the
 * caller.  Helper getters for common settings are provided for convenience.
 */

import type { Database } from 'sql.js'
import { persistDatabase } from '../db/connection'

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
    const result = this.db.exec('SELECT value FROM settings WHERE key = ?', [key])
    if (!result.length || !result[0].values.length) return null
    const raw = result[0].values[0][0]
    return raw !== null ? String(raw) : null
  }

  /** Returns all settings as a plain object. */
  getAll(): Record<string, string> {
    const result = this.db.exec('SELECT key, value FROM settings')
    if (!result.length) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of result[0].values) {
      if (key !== null) out[String(key)] = value !== null ? String(value) : ''
    }
    return out
  }

  /** Sets a single key.  Upserts if the key already exists. */
  set(key: SettingKey, value: string): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, strftime('%s','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                       updated_at = excluded.updated_at`,
      [key, value],
    )
    persistDatabase()
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
