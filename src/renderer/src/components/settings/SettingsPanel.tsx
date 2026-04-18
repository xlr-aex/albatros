/**
 * @file components/settings/SettingsPanel.tsx
 * @description Full-featured settings modal with persistence via window.api.settings.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useUiStore } from '../../store/uiStore'
import { applyAccentColor, ACCENT_COLORS } from '../../utils/theme'
import styles from './SettingsPanel.module.css'

interface Props { onClose: () => void }

interface Settings {
  theme: string
  accent_color: string
  font_size: string
  ui_font_size: string
  mark_read_on_open: string
  default_interval_sec: string
  retention_days: string
  max_articles_per_feed: string
  // ── AI ──
  ai_provider: string
  ai_base_url: string
  ai_model: string
  ai_system_prompt: string
  ai_chatbot_summary_prompt: string
  ai_chatbot_news_prompt: string
}

const DEFAULTS: Settings = {
  theme: 'dark',
  accent_color: 'blue',
  font_size: '16',
  ui_font_size: '16',
  mark_read_on_open: '1',
  default_interval_sec: '900',
  retention_days: '30',
  max_articles_per_feed: '500',
  // ── AI ──
  ai_provider: 'lmstudio',
  ai_base_url: 'http://127.0.0.1:1234',
  ai_model: '',
  ai_system_prompt: "Tu es un assistant analytique expert. Ta tâche est de résumer l'article suivant de manière ultra-concise.\n\nRÈGLES STRICTES :\n1. Pas d'introduction ni de conclusion.\n2. Liste à puces uniquement (3 à 5 points).\n3. Style informatif et neutre.\n4. Si l'article est vide ou illisible, dis-le simplement.",
  ai_chatbot_summary_prompt: "Tu es un assistant analytique expert. Ta tâche est de faire un résumé exhaustif et structuré de l'ensemble des articles fournis.\n\nCONSIGNES :\n1. Regroupe les infos par thématiques.\n2. Chaque fait mentionné DOIT être sourcé avec l'ID correspondant entre crochets (ex: [12]).\n3. L'ID se trouve dans la balise <source id=\"...\"> ou dans 'ID DE RÉFÉRENCE'.\n4. N'invente jamais d'ID.",
  ai_chatbot_news_prompt: "Tu es un assistant analytique expert. Ta tâche est d'extraire uniquement les annonces majeures, les alertes critiques et les nouveaux produits des articles fournis.\n\nCONSIGNES :\n1. Sois très sélectif.\n2. Utilise une liste à puces.\n3. Chaque fait mentionné DOIT être sourcé avec l'ID correspondant entre crochets (ex: [12]).\n4. N'invente jamais d'ID.",
}

export function SettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const [aiTestStatus, setAiTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [aiTestMsg, setAiTestMsg] = useState('')

  useEffect(() => {
    async function load() {
      const all = await window.api.settings.getAll()
      setSettings({ ...DEFAULTS, ...all })
      setLoaded(true)
    }
    void load()
  }, [])

  const update = useCallback((key: keyof Settings, value: string) => {
    setSettings(s => {
      const next = { ...s, [key]: value }
      if (key === 'ai_provider') {
        const defaultUrl = value === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234'
        next.ai_base_url = defaultUrl
      }
      return next
    })

    if (key === 'ai_provider') {
      const defaultUrl = value === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234'
      window.api.settings.set('ai_base_url', defaultUrl).catch(console.error)
      setAiTestStatus('idle')
      setAiTestMsg('')
    }
    else if (key === 'ai_base_url') {
      setAiTestStatus('idle')
      setAiTestMsg('')
    }
    
    if (key === 'theme') {
      useUiStore.getState().setTheme(value as 'light' | 'dark')
    } else if (key === 'font_size') {
      document.documentElement.style.setProperty('--article-font-size', `${value}px`)
    } else if (key === 'ui_font_size') {
      document.documentElement.style.setProperty('--ui-font-size', `${value}px`)
    } else if (key === 'accent_color') {
      applyAccentColor(value)
    }
    
    window.api.settings.set(key, value).catch(console.error)
  }, [])

  const testConnection = useCallback(async () => {
    setAiTestStatus('testing')
    setAiTestMsg('')
    let baseUrl = settings.ai_base_url.replace(/\/$/, '')
    if (settings.ai_provider === 'lmstudio' && baseUrl.endsWith('/v1')) {
      baseUrl = baseUrl.slice(0, -3)
    }
    const provider = settings.ai_provider
    try {
      const endpoint = provider === 'ollama'
        ? `${baseUrl}/api/tags`
        : `${baseUrl}/v1/models`
        
      // Délai artificiel pour le rendu visuel
      await new Promise(r => setTimeout(r, 400))
        
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // Extract model list for a friendly message
      const models: string[] = provider === 'ollama'
        ? (data.models ?? []).map((m: {name: string}) => m.name)
        : (data.data ?? []).map((m: {id: string}) => m.id)
      const modelList = models.slice(0, 5)
      const modelHint = modelList.length > 0 ? `Modèles : ${modelList.join(', ')}` : 'Connecté !'
      setAiTestMsg(modelHint)
      setAiTestStatus('ok')
      
      // Auto-fetch: Si le modèle est vide, on prend le premier disponible
      if (!settings.ai_model && models.length > 0) {
        update('ai_model', models[0])
      }
    } catch (err: unknown) {
      setAiTestMsg((err as Error).message ?? String(err))
      setAiTestStatus('error')
    }
  }, [settings.ai_base_url, settings.ai_provider, settings.ai_model, update])

  if (!loaded) return null

  return (
    <div
      className={styles.overlay}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Settings">
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>⚙ Settings</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.body}>
          {/* ── Appearance ────────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Appearance</div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>Theme</div>
                <div className={styles.rowDesc}>Choose between dark and light mode</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', opacity: settings.theme === 'light' ? 1 : 0.5 }}>☀️</span>
                <div
                  className={`${styles.toggle} ${settings.theme === 'dark' ? styles.toggleOn : ''}`}
                  onClick={() => update('theme', settings.theme === 'dark' ? 'light' : 'dark')}
                  onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); update('theme', settings.theme === 'dark' ? 'light' : 'dark') } }}
                  role="switch"
                  tabIndex={0}
                  aria-checked={settings.theme === 'dark'}
                  aria-label="Dark mode"
                />
                <span style={{ fontSize: '14px', opacity: settings.theme === 'dark' ? 1 : 0.5 }}>🌙</span>
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>Accent Color</div>
                <div className={styles.rowDesc}>Choose any color or pick a preset</div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {Object.entries(ACCENT_COLORS).map(([colorName, hexes]) => (
                  <button
                    key={colorName}
                    title={colorName}
                    aria-label={`Accent color: ${colorName}`}
                    aria-pressed={settings.accent_color === colorName}
                    style={{
                      width: '22px', height: '22px', borderRadius: '50%',
                      background: hexes[500],
                      border: settings.accent_color === colorName ? '2px solid white' : '2px solid transparent',
                      boxShadow: settings.accent_color === colorName ? `0 0 0 2px ${hexes[500]}` : 'none',
                      flexShrink: 0,
                    }}
                    onClick={() => update('accent_color', colorName)}
                  />
                ))}
                {/* Separator */}
                <span style={{ width: 1, height: 20, background: 'var(--border-subtle)', flexShrink: 0 }} />
                {/* Native color picker — any color */}
                <label
                  title="Custom color"
                  aria-label="Custom accent color"
                  style={{
                    width: '22px', height: '22px', borderRadius: '50%',
                    background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
                    cursor: 'pointer',
                    boxShadow: settings.accent_color?.startsWith('#') ? '0 0 0 2px var(--brand-500), 0 0 0 4px white' : 'none',
                    flexShrink: 0,
                    overflow: 'hidden',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <input
                    type="color"
                    aria-label="Custom accent color picker"
                    value={settings.accent_color?.startsWith('#') ? settings.accent_color : '#3b82f6'}
                    onChange={e => update('accent_color', e.target.value)}
                    style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                  />
                </label>
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>
                  UI Scale <span className={styles.fontValue}>{settings.ui_font_size}px</span>
                </div>
                <div className={styles.rowDesc}>Base size for the interface elements</div>
              </div>
              <input
                type="range"
                className={styles.slider}
                min="12"
                max="24"
                step="1"
                value={settings.ui_font_size}
                aria-label={`UI Scale: ${settings.ui_font_size}px`}
                onChange={e => update('ui_font_size', e.target.value)}
              />
            </div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>
                  Font Size <span className={styles.fontValue}>{settings.font_size}px</span>
                </div>
                <div className={styles.rowDesc}>Base font size for article content</div>
              </div>
              <input
                type="range"
                className={styles.slider}
                min="12"
                max="36"
                step="1"
                value={settings.font_size}
                aria-label={`Article font size: ${settings.font_size}px`}
                onChange={e => update('font_size', e.target.value)}
              />
            </div>

            <div style={{
              marginTop: '16px',
              padding: '16px',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              background: 'var(--bg-base)',
            }}>
              <div style={{ fontSize: 'var(--ui-font-size, 16px)', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Text Preview
              </div>
              <div style={{ fontSize: 'var(--article-font-size, 16px)', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                Portez ce vieux whisky au juge blond qui fume.
              </div>
            </div>
          </div>

          <div className={styles.divider} />

          {/* ── Reading ───────────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Reading</div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>Mark as read on open</div>
                <div className={styles.rowDesc}>Automatically mark articles as read when opened</div>
              </div>
              <div
                className={`${styles.toggle} ${settings.mark_read_on_open === '1' ? styles.toggleOn : ''}`}
                onClick={() => update('mark_read_on_open', settings.mark_read_on_open === '1' ? '0' : '1')}
                onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); update('mark_read_on_open', settings.mark_read_on_open === '1' ? '0' : '1') } }}
                role="switch"
                tabIndex={0}
                aria-checked={settings.mark_read_on_open === '1'}
                aria-label="Mark as read on open"
              />
            </div>
          </div>

          <div className={styles.divider} />

          {/* ── Sync ─────────────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Sync & Storage</div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>Refresh interval</div>
                <div className={styles.rowDesc}>How often feeds are checked for new articles</div>
              </div>
              <select
                className={styles.select}
                value={settings.default_interval_sec}
                onChange={e => update('default_interval_sec', e.target.value)}
              >
                <option value="300">5 minutes</option>
                <option value="600">10 minutes</option>
                <option value="900">15 minutes</option>
                <option value="1800">30 minutes</option>
                <option value="3600">1 hour</option>
                <option value="7200">2 hours</option>
              </select>
            </div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>Article retention</div>
                <div className={styles.rowDesc}>Delete articles older than this many days</div>
              </div>
              <input
                type="number"
                className={styles.input}
                value={settings.retention_days}
                min={1}
                max={365}
                onChange={e => update('retention_days', e.target.value)}
              />
            </div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>Max articles per feed</div>
                <div className={styles.rowDesc}>Maximum number of articles stored per feed</div>
              </div>
              <input
                type="number"
                className={styles.input}
                value={settings.max_articles_per_feed}
                min={50}
                max={5000}
                step={50}
                onChange={e => update('max_articles_per_feed', e.target.value)}
              />
            </div>
          </div>
          <div className={styles.divider} />

          {/* ── Intelligence Artificielle ──────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span style={{
                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
              >✦ Intelligence Artificielle</span>
            </div>

            {/* Provider */}
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>Fournisseur LLM</div>
                <div className={styles.rowDesc}>Backend IA local à utiliser pour les résumés</div>
              </div>
              <select
                className={styles.select}
                value={settings.ai_provider}
                onChange={e => update('ai_provider', e.target.value)}
                id="settings-ai-provider"
              >
                <option value="lmstudio">🖥 LM Studio</option>
                <option value="ollama">🦙 Ollama</option>
              </select>
            </div>

            {/* Base URL */}
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>URL de l'API</div>
                <div className={styles.rowDesc}>
                  {settings.ai_provider === 'ollama'
                    ? 'Ex : http://127.0.0.1:11434'
                    : 'Ex : http://127.0.0.1:1234'}
                </div>
              </div>
              <input
                type="text"
                className={styles.input}
                value={settings.ai_base_url}
                placeholder={settings.ai_provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234'}
                onChange={e => update('ai_base_url', e.target.value)}
                id="settings-ai-base-url"
                style={{ width: 220, minWidth: 180 }}
              />
            </div>

            {/* Model name */}
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>Nom du modèle</div>
                <div className={styles.rowDesc}>
                  {settings.ai_provider === 'ollama' ? 'Ex : llama3, mistral, phi3' : 'Ex : local-model (laissez vide pour le modèle actif)'}
                </div>
              </div>
              <input
                type="text"
                className={styles.input}
                value={settings.ai_model}
                placeholder={settings.ai_provider === 'ollama' ? 'llama3' : 'local-model'}
                onChange={e => update('ai_model', e.target.value)}
                id="settings-ai-model"
                style={{ width: 200, minWidth: 160 }}
              />
            </div>

            {/* Test connection */}
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>Test de connexion</div>
                <div className={styles.rowDesc}>Vérifie que le backend répond</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <button
                  className={styles.select}
                  onClick={testConnection}
                  disabled={aiTestStatus === 'testing'}
                  id="settings-ai-test-btn"
                  style={{
                    cursor: aiTestStatus === 'testing' ? 'wait' : 'pointer',
                    background: aiTestStatus === 'ok'
                      ? 'color-mix(in srgb, #22c55e 15%, var(--bg-elevated))'
                      : aiTestStatus === 'error'
                        ? 'color-mix(in srgb, #ef4444 15%, var(--bg-elevated))'
                        : undefined,
                    borderColor: aiTestStatus === 'ok' ? '#22c55e'
                      : aiTestStatus === 'error' ? '#ef4444' : undefined,
                    color: aiTestStatus === 'ok' ? '#4ade80'
                      : aiTestStatus === 'error' ? '#f87171' : undefined,
                    transition: 'all 0.2s',
                    minWidth: 110,
                  }}
                >
                  {aiTestStatus === 'testing' ? '⏳ Test…'
                    : aiTestStatus === 'ok' ? '✓ Connecté'
                    : aiTestStatus === 'error' ? '✕ Erreur'
                    : '⚡ Tester'}
                </button>
                {aiTestMsg && (
                  <span style={{
                    fontSize: '0.72rem',
                    color: aiTestStatus === 'ok' ? 'var(--text-muted)' : '#f87171',
                    maxWidth: 280,
                    textAlign: 'right',
                    lineHeight: 1.4,
                  }}>
                    {aiTestMsg}
                  </span>
                )}
              </div>
            </div>

            {/* System Prompt */}
            <div style={{ marginTop: 8 }}>
              <div className={styles.rowName} style={{ marginBottom: 6 }}>System Prompt (Résumé d'Article)</div>
              <div className={styles.rowDesc} style={{ marginBottom: 8 }}>
                Instructions envoyées au modèle lors d'un clic sur le bouton "Résumé IA" (Indépendant du Chatbot global).
              </div>
              <textarea
                id="settings-ai-system-prompt"
                value={settings.ai_system_prompt}
                onChange={e => update('ai_system_prompt', e.target.value)}
                rows={5}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md, 6px)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  lineHeight: 1.6,
                  padding: '10px 12px',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  outline: 'none',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--brand-500, #6366f1)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
                placeholder="Décris à l'IA comment elle doit résumer l'article…"
              />
              <button
                onClick={() => update('ai_system_prompt', DEFAULTS.ai_system_prompt)}
                style={{
                  marginTop: 6,
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 0',
                  textDecoration: 'underline',
                }}
                id="settings-ai-reset-prompt-btn"
              >
                Remettre le prompt par défaut
              </button>
            </div>
            
            <div style={{ marginTop: 16 }}>
              <div className={styles.rowName} style={{ marginBottom: 6 }}>Prompt : Résumé exhaustif (Chatbot)</div>
              <textarea
                value={settings.ai_chatbot_summary_prompt}
                onChange={e => update('ai_chatbot_summary_prompt', e.target.value)}
                rows={4}
                style={{
                  width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)',
                  border: '1px solid var(--border-subtle)', borderRadius: 6,
                  color: 'var(--text-primary)', fontSize: '0.85rem', padding: '10px 12px',
                  resize: 'vertical', outline: 'none', lineHeight: 1.5,
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--brand-500, #6366f1)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
              />
              <button
                onClick={() => update('ai_chatbot_summary_prompt', DEFAULTS.ai_chatbot_summary_prompt)}
                style={{
                  marginTop: 6, fontSize: '0.75rem', color: 'var(--text-muted)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '2px 0', textDecoration: 'underline',
                }}
              >
                Remettre le prompt par défaut
              </button>
            </div>

            {/* Chatbot News Prompt */}
            <div style={{ marginTop: 12 }}>
              <div className={styles.rowName} style={{ marginBottom: 6 }}>Prompt : Annonces clés (Chatbot)</div>
              <textarea
                value={settings.ai_chatbot_news_prompt}
                onChange={e => update('ai_chatbot_news_prompt', e.target.value)}
                rows={4}
                style={{
                  width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)',
                  border: '1px solid var(--border-subtle)', borderRadius: 6,
                  color: 'var(--text-primary)', fontSize: '0.85rem', padding: '10px 12px',
                  resize: 'vertical', outline: 'none', lineHeight: 1.5,
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--brand-500, #6366f1)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
              />
              <button
                onClick={() => update('ai_chatbot_news_prompt', DEFAULTS.ai_chatbot_news_prompt)}
                style={{
                  marginTop: 6, fontSize: '0.75rem', color: 'var(--text-muted)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '2px 0', textDecoration: 'underline',
                }}
              >
                Remettre le prompt par défaut
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.version}>Albatros v1.0.0</span>
        </div>
      </div>
    </div>
  )
}
