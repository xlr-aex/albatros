/**
 * @file components/settings/SettingsPanel.tsx
 * @description Settings — full-page layout with vertical tabs.
 * Axes 3 (tabs), 3 (no free color picker), 3 (auto-resize prompts), 3 (reset confirmation).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
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
  ai_provider: 'lmstudio',
  ai_base_url: 'http://127.0.0.1:1234',
  ai_model: '',
  ai_system_prompt: "Tu es un assistant analytique expert. Ta tâche est de résumer l'article suivant de manière ultra-concise.\n\nRÈGLES STRICTES :\n1. Pas d'introduction ni de conclusion.\n2. Liste à puces uniquement (3 à 5 points).\n3. Style informatif et neutre.\n4. Si l'article est vide ou illisible, dis-le simplement.",
  ai_chatbot_summary_prompt: "Tu es un assistant analytique expert. Ta tâche est de faire un résumé exhaustif et structuré de l'ensemble des articles fournis.\n\nCONSIGNES :\n1. Regroupe les infos par thématiques.\n2. Chaque fait mentionné DOIT être sourcé avec l'ID correspondant entre crochets (ex: [12]).\n3. L'ID se trouve dans la balise <source id=\"...\"> ou dans 'ID DE RÉFÉRENCE'.\n4. N'invente jamais d'ID.",
  ai_chatbot_news_prompt: "Tu es un assistant analytique expert. Ta tâche est d'extraire uniquement les annonces majeures, les alertes critiques et les nouveaux produits des articles fournis.\n\nCONSIGNES :\n1. Sois très sélectif.\n2. Utilise une liste à puces.\n3. Chaque fait mentionné DOIT être sourcé avec l'ID correspondant entre crochets (ex: [12]).\n4. N'invente jamais d'ID.",
}

type TabId = 'appearance' | 'reading' | 'ai'

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'appearance', icon: '🎨', label: 'Apparence' },
  { id: 'reading',    icon: '📖', label: 'Lecture & Sync' },
  { id: 'ai',        icon: '✦',  label: 'IA & Modèles' },
]

/** Parse an error to produce a diagnostic message + hint */
function parseConnectionError(msg: string): { title: string; hint: string } {
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')) {
    return { title: 'Connexion refusée', hint: 'Vérifiez que LM Studio / Ollama est bien lancé et accessible sur l\'URL configurée.' }
  }
  if (msg.includes('timeout') || msg.includes('AbortError') || msg.includes('ETIMEDOUT')) {
    return { title: 'Délai d\'attente dépassé', hint: 'Le serveur ne répond pas. Vérifiez le port et que le modèle est chargé.' }
  }
  if (msg.includes('HTTP 4') || msg.includes('HTTP 5')) {
    return { title: `Erreur serveur (${msg})`, hint: 'Le serveur a répondu avec une erreur. Vérifiez l\'URL de l\'API et la version du provider.' }
  }
  return { title: msg, hint: 'Vérifiez la configuration et réessayez.' }
}

export function SettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('appearance')
  const [aiTestStatus, setAiTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [aiTestMsg, setAiTestMsg] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [resetConfirm, setResetConfirm] = useState<string | null>(null)
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    async function load() {
      const all = await window.api.settings.getAll()
      setSettings({ ...DEFAULTS, ...all })
      setLoaded(true)
    }
    void load()
  }, [])

  const persist = useCallback((values: Partial<Settings>) => {
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => window.api.settings.setMany(values))
    return saveQueueRef.current
  }, [])

  const update = useCallback((key: keyof Settings, value: string) => {
    const providerDefaultUrl = key === 'ai_provider'
      ? (value === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234')
      : null
    setSettings(s => {
      const next = { ...s, [key]: value }
      if (providerDefaultUrl) next.ai_base_url = providerDefaultUrl
      return next
    })
    if (key === 'ai_provider') {
      const defaultUrl = value === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234'
      void persist({ ai_provider: value, ai_base_url: defaultUrl }).catch(console.error)
      setAvailableModels([])
      setAiTestStatus('idle'); setAiTestMsg('')
    } else if (key === 'ai_base_url') {
      setAvailableModels([])
      setAiTestStatus('idle'); setAiTestMsg('')
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
    if (key !== 'ai_provider') void persist({ [key]: value }).catch(console.error)
  }, [persist])

  const testConnection = useCallback(async () => {
    setAiTestStatus('testing'); setAiTestMsg('')
    try {
      // Persist one coherent snapshot first; the main process then tests exactly
      // the same configuration that SummaryService reads from SQLite.
      await persist({
        ai_provider: settings.ai_provider,
        ai_base_url: settings.ai_base_url,
        ai_model: settings.ai_model,
      })
      const result = await window.api.llm.testConnection()
      const models: string[] = result.models
      setAvailableModels(models)
      const modelHint = models.length > 0 ? `Modèles disponibles : ${models.slice(0, 5).join(', ')}` : 'Connecté !'
      setAiTestMsg(modelHint)
      setAiTestStatus('ok')
      if ((!settings.ai_model || settings.ai_model === 'local-model') && models.length > 0) {
        setSettings(current => ({ ...current, ai_model: models[0], ai_base_url: result.config.baseUrl }))
        await persist({ ai_model: models[0], ai_base_url: result.config.baseUrl })
      }
    } catch (err: unknown) {
      setAiTestMsg((err as Error).message ?? String(err))
      setAiTestStatus('error')
    }
  }, [settings.ai_base_url, settings.ai_provider, settings.ai_model, persist])

  const handleReset = (key: keyof Settings) => {
    if (resetConfirm === key) {
      update(key, DEFAULTS[key])
      setResetConfirm(null)
    } else {
      setResetConfirm(key)
      setTimeout(() => setResetConfirm(null), 3000)
    }
  }

  if (!loaded) return null

  const diagError = aiTestStatus === 'error' ? parseConnectionError(aiTestMsg) : null

  return (
    <div
      className={styles.overlay}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Paramètres">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>⚙ Paramètres</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        {/* ── Body: sidebar tabs + content ───────────────────────── */}
        <div className={styles.body}>
          {/* Vertical tab sidebar */}
          <nav className={styles.tabSidebar} aria-label="Catégories de paramètres">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab(tab.id)}
                aria-selected={activeTab === tab.id}
                aria-controls={`tab-panel-${tab.id}`}
              >
                <span className={styles.tabIcon}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Tab content */}
          <div className={styles.tabContent} id={`tab-panel-${activeTab}`} role="tabpanel">

            {/* ══════════════ APPARENCE ══════════════ */}
            {activeTab === 'appearance' && (
              <>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Thème</div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>Mode d'affichage</div>
                      <div className={styles.rowDesc}>Choisissez entre le mode clair et sombre</div>
                    </div>
                    <div className={styles.segmentedControl}>
                      <button
                        className={`${styles.segmentBtn} ${settings.theme === 'light' ? styles.segmentBtnActive : ''}`}
                        onClick={() => update('theme', 'light')}
                        aria-pressed={settings.theme === 'light'}
                      >
                        <span className={styles.segmentIcon}>☀️</span> Clair
                      </button>
                      <button
                        className={`${styles.segmentBtn} ${settings.theme === 'dark' ? styles.segmentBtnActive : ''}`}
                        onClick={() => update('theme', 'dark')}
                        aria-pressed={settings.theme === 'dark'}
                      >
                        <span className={styles.segmentIcon}>🌙</span> Sombre
                      </button>
                    </div>
                  </div>

                  {/* Color palette — only pre-validated accessible swatches */}
                  <div className={styles.row} style={{ alignItems: 'flex-start' }}>
                    <div className={styles.rowLabel} style={{ marginTop: '4px' }}>
                      <div className={styles.rowName}>Couleur d'accentuation</div>
                      <div className={styles.rowDesc}>Palette validée WCAG — contraste ≥ 4.5:1 garanti</div>
                    </div>
                    <div className={styles.colorPalette}>
                      {Object.entries(ACCENT_COLORS).map(([colorName, hexes]) => (
                        <button
                          key={colorName}
                          title={colorName}
                          aria-label={`Couleur: ${colorName}`}
                          aria-pressed={settings.accent_color === colorName}
                          className={`${styles.colorSwatch} ${settings.accent_color === colorName ? styles.colorSwatchActive : ''}`}
                          style={{ '--swatch-color': hexes[500] } as React.CSSProperties}
                          onClick={() => update('accent_color', colorName)}
                        >
                          {settings.accent_color === colorName && <span className={styles.checkIcon}>✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Typographie</div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>
                        Taille de l'interface <span className={styles.fontValue}>{settings.ui_font_size}px</span>
                      </div>
                      <div className={styles.rowDesc}>Éléments de navigation et de contrôle</div>
                    </div>
                    <input
                      type="range" className={styles.slider}
                      min="12" max="24" step="1"
                      value={settings.ui_font_size}
                      aria-label={`Taille interface: ${settings.ui_font_size}px`}
                      onChange={e => update('ui_font_size', e.target.value)}
                    />
                  </div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>
                        Taille du texte <span className={styles.fontValue}>{settings.font_size}px</span>
                      </div>
                      <div className={styles.rowDesc}>Contenu des articles en lecture</div>
                    </div>
                    <input
                      type="range" className={styles.slider}
                      min="12" max="36" step="1"
                      value={settings.font_size}
                      aria-label={`Taille texte: ${settings.font_size}px`}
                      onChange={e => update('font_size', e.target.value)}
                    />
                  </div>

                  {/* Live preview */}
                  <div style={{ marginTop: '8px', padding: '16px', border: '1px solid var(--border-subtle)', borderRadius: '8px', background: 'var(--bg-base)' }}>
                    <div style={{ fontSize: 'var(--ui-font-size, 16px)', color: 'var(--text-secondary)', marginBottom: '8px' }}>Aperçu du texte</div>
                    <div style={{ fontSize: 'var(--article-font-size, 16px)', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                      Portez ce vieux whisky au juge blond qui fume.
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ══════════════ LECTURE & SYNC ══════════════ */}
            {activeTab === 'reading' && (
              <>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Lecture</div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>Marquer comme lu à l'ouverture</div>
                      <div className={styles.rowDesc}>Marquer automatiquement les articles comme lus lors de leur ouverture</div>
                    </div>
                    <div
                      className={`${styles.toggle} ${settings.mark_read_on_open === '1' ? styles.toggleOn : ''}`}
                      onClick={() => update('mark_read_on_open', settings.mark_read_on_open === '1' ? '0' : '1')}
                      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); update('mark_read_on_open', settings.mark_read_on_open === '1' ? '0' : '1') } }}
                      role="switch" tabIndex={0}
                      aria-checked={settings.mark_read_on_open === '1'}
                      aria-label="Marquer comme lu à l'ouverture"
                    />
                  </div>
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Synchronisation & Stockage</div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>Intervalle de rafraîchissement</div>
                      <div className={styles.rowDesc}>Fréquence de vérification des nouveaux articles</div>
                    </div>
                    <select className={styles.select} value={settings.default_interval_sec} onChange={e => update('default_interval_sec', e.target.value)}>
                      <option value="300">5 minutes</option>
                      <option value="600">10 minutes</option>
                      <option value="900">15 minutes</option>
                      <option value="1800">30 minutes</option>
                      <option value="3600">1 heure</option>
                      <option value="7200">2 heures</option>
                    </select>
                  </div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>Conservation des articles</div>
                      <div className={styles.rowDesc}>Supprimer les articles plus anciens que ce nombre de jours</div>
                    </div>
                    <input type="number" className={styles.input} value={settings.retention_days} min={1} max={365} onChange={e => update('retention_days', e.target.value)} />
                  </div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>Articles max par flux</div>
                      <div className={styles.rowDesc}>Nombre maximum d'articles stockés par flux</div>
                    </div>
                    <input type="number" className={styles.input} value={settings.max_articles_per_feed} min={50} max={5000} step={50} onChange={e => update('max_articles_per_feed', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {/* ══════════════ IA ══════════════ */}
            {activeTab === 'ai' && (
              <>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    <span className={styles.aiGradientTitle}>✦ Configuration du Backend IA</span>
                  </div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>Fournisseur LLM</div>
                      <div className={styles.rowDesc}>Backend IA local à utiliser</div>
                    </div>
                    <select className={styles.select} value={settings.ai_provider} onChange={e => update('ai_provider', e.target.value)} id="settings-ai-provider">
                      <option value="lmstudio">🖥 LM Studio</option>
                      <option value="ollama">🦙 Ollama</option>
                    </select>
                  </div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>URL de l'API</div>
                      <div className={styles.rowDesc}>{settings.ai_provider === 'ollama' ? 'Ex : http://127.0.0.1:11434' : 'Ex : http://127.0.0.1:1234'}</div>
                    </div>
                    <input
                      type="text" className={styles.input}
                      value={settings.ai_base_url}
                      placeholder={settings.ai_provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234'}
                      onChange={e => update('ai_base_url', e.target.value)}
                      id="settings-ai-base-url"
                      style={{ width: 220, minWidth: 180, textAlign: 'left' }}
                    />
                  </div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>Nom du modèle</div>
                      <div className={styles.rowDesc}>{settings.ai_provider === 'ollama' ? 'Ex : llama3, mistral, phi3' : 'Laissez vide pour le modèle actif'}</div>
                    </div>
                    <input
                      type="text" className={styles.input}
                      value={settings.ai_model}
                      list="settings-ai-models"
                      placeholder={settings.ai_provider === 'ollama' ? 'llama3' : 'Détecté automatiquement'}
                      onChange={e => update('ai_model', e.target.value)}
                      id="settings-ai-model"
                      style={{ width: 200, minWidth: 160, textAlign: 'left' }}
                    />
                    <datalist id="settings-ai-models">
                      {availableModels.map(model => <option value={model} key={model} />)}
                    </datalist>
                  </div>

                  {/* Test connection with diagnostic error */}
                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>Test de connexion</div>
                      <div className={styles.rowDesc}>Vérifie que le backend répond et liste les modèles disponibles</div>
                    </div>
                    <button
                      className={`${styles.testBtn} ${aiTestStatus === 'ok' ? styles.testBtnOk : aiTestStatus === 'error' ? styles.testBtnError : ''}`}
                      onClick={testConnection}
                      disabled={aiTestStatus === 'testing'}
                      id="settings-ai-test-btn"
                      style={{ cursor: aiTestStatus === 'testing' ? 'wait' : 'pointer' }}
                    >
                      {aiTestStatus === 'testing' ? '⏳ Test…' : aiTestStatus === 'ok' ? '✓ Connecté' : aiTestStatus === 'error' ? '✕ Erreur' : '⚡ Tester'}
                    </button>
                  </div>

                  {/* Diagnostic error message */}
                  {aiTestStatus === 'ok' && aiTestMsg && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-success)', lineHeight: 1.5, padding: '8px 12px', background: 'rgba(74, 222, 128, 0.07)', borderRadius: '6px', border: '1px solid rgba(74,222,128,0.15)' }}>
                      {aiTestMsg}
                    </div>
                  )}
                  {diagError && (
                    <div className={styles.errorDiag}>
                      <div className={styles.errorDiagTitle}>⚠ {diagError.title}</div>
                      <div className={styles.errorDiagHint}>💡 {diagError.hint}</div>
                    </div>
                  )}
                </div>

                {/* Advanced section (collapsible) */}
                <div className={styles.section}>
                  <button
                    className={`${styles.advancedToggle} ${showAdvanced ? styles.advancedToggleOpen : ''}`}
                    onClick={() => setShowAdvanced(v => !v)}
                    aria-expanded={showAdvanced}
                  >
                    <span>🔧</span>
                    <span>Paramètres Avancés — Prompts Système</span>
                    <span className={styles.advancedToggleCaret}>▶</span>
                  </button>

                  {showAdvanced && (
                    <>
                      {/* Article summary prompt */}
                      <div>
                        <div className={styles.rowName} style={{ marginBottom: 4 }}>System Prompt — Résumé d'Article</div>
                        <div className={styles.rowDesc} style={{ marginBottom: 8 }}>
                          Instructions envoyées lors d'un clic sur le bouton "Résumé IA" dans un article.
                        </div>
                        <textarea
                          id="settings-ai-system-prompt"
                          value={settings.ai_system_prompt}
                          onChange={e => update('ai_system_prompt', e.target.value)}
                          className={styles.promptTextarea}
                          rows={6}
                          placeholder="Décris à l'IA comment résumer l'article…"
                        />
                        <button
                          className={styles.resetBtn}
                          onClick={() => handleReset('ai_system_prompt')}
                          id="settings-ai-reset-prompt-btn"
                        >
                          <span>↺</span>
                          {resetConfirm === 'ai_system_prompt' ? '⚠ Confirmer la réinitialisation ?' : 'Réinitialiser le prompt'}
                        </button>
                      </div>

                      <div style={{ marginTop: 16 }}>
                        <div className={styles.rowName} style={{ marginBottom: 4 }}>Prompt Chatbot — Résumé exhaustif</div>
                        <textarea
                          value={settings.ai_chatbot_summary_prompt}
                          onChange={e => update('ai_chatbot_summary_prompt', e.target.value)}
                          className={styles.promptTextarea}
                          rows={5}
                        />
                        <button className={styles.resetBtn} onClick={() => handleReset('ai_chatbot_summary_prompt')}>
                          <span>↺</span>
                          {resetConfirm === 'ai_chatbot_summary_prompt' ? '⚠ Confirmer ?' : 'Réinitialiser'}
                        </button>
                      </div>

                      <div style={{ marginTop: 16 }}>
                        <div className={styles.rowName} style={{ marginBottom: 4 }}>Prompt Chatbot — Annonces clés</div>
                        <textarea
                          value={settings.ai_chatbot_news_prompt}
                          onChange={e => update('ai_chatbot_news_prompt', e.target.value)}
                          className={styles.promptTextarea}
                          rows={5}
                        />
                        <button className={styles.resetBtn} onClick={() => handleReset('ai_chatbot_news_prompt')}>
                          <span>↺</span>
                          {resetConfirm === 'ai_chatbot_news_prompt' ? '⚠ Confirmer ?' : 'Réinitialiser'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className={styles.footer}>
          <span className={styles.version}>Albatros v1.0.0</span>
        </div>
      </div>
    </div>
  )
}
