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
}

type TabId = 'appearance' | 'reading'

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'appearance', icon: '🎨', label: 'Appearance' },
  { id: 'reading',    icon: '📖', label: 'Reading & Sync' },
]

export function SettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('appearance')
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
    setSettings(s => {
      return { ...s, [key]: value }
    })
    if (key === 'theme') {
      useUiStore.getState().setTheme(value as 'light' | 'dark')
    } else if (key === 'font_size') {
      document.documentElement.style.setProperty('--article-font-size', `${value}px`)
    } else if (key === 'ui_font_size') {
      document.documentElement.style.setProperty('--ui-font-size', `${value}px`)
    } else if (key === 'accent_color') {
      applyAccentColor(value)
    }
    void persist({ [key]: value }).catch(console.error)
  }, [persist])

  if (!loaded) return null

  return (
    <div
      className={styles.overlay}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Settings">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>⚙ Settings</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── Body: sidebar tabs + content ───────────────────────── */}
        <div className={styles.body}>
          {/* Vertical tab sidebar */}
          <nav className={styles.tabSidebar} aria-label="Settings categories">
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
                  <div className={styles.sectionTitle}>Theme</div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>Display mode</div>
                      <div className={styles.rowDesc}>Choose between light and dark mode</div>
                    </div>
                    <div className={styles.segmentedControl}>
                      <button
                        className={`${styles.segmentBtn} ${settings.theme === 'light' ? styles.segmentBtnActive : ''}`}
                        onClick={() => update('theme', 'light')}
                        aria-pressed={settings.theme === 'light'}
                      >
                        <span className={styles.segmentIcon}>☀️</span> Light
                      </button>
                      <button
                        className={`${styles.segmentBtn} ${settings.theme === 'dark' ? styles.segmentBtnActive : ''}`}
                        onClick={() => update('theme', 'dark')}
                        aria-pressed={settings.theme === 'dark'}
                      >
                        <span className={styles.segmentIcon}>🌙</span> Dark
                      </button>
                    </div>
                  </div>

                  {/* Color palette — only pre-validated accessible swatches */}
                  <div className={styles.row} style={{ alignItems: 'flex-start' }}>
                    <div className={styles.rowLabel} style={{ marginTop: '4px' }}>
                      <div className={styles.rowName}>Accent color</div>
                      <div className={styles.rowDesc}>WCAG-validated palette — 4.5:1 contrast guaranteed</div>
                    </div>
                    <div className={styles.colorPalette}>
                      {Object.entries(ACCENT_COLORS).map(([colorName, hexes]) => (
                        <button
                          key={colorName}
                          title={colorName}
                          aria-label={`Color: ${colorName}`}
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
                  <div className={styles.sectionTitle}>Typography</div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>
                        Interface size <span className={styles.fontValue}>{settings.ui_font_size}px</span>
                      </div>
                      <div className={styles.rowDesc}>Navigation and control elements</div>
                    </div>
                    <input
                      type="range" className={styles.slider}
                      min="12" max="24" step="1"
                      value={settings.ui_font_size}
                      aria-label={`Interface size: ${settings.ui_font_size}px`}
                      onChange={e => update('ui_font_size', e.target.value)}
                    />
                  </div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>
                        Text size <span className={styles.fontValue}>{settings.font_size}px</span>
                      </div>
                      <div className={styles.rowDesc}>Article content while reading</div>
                    </div>
                    <input
                      type="range" className={styles.slider}
                      min="12" max="36" step="1"
                      value={settings.font_size}
                      aria-label={`Text size: ${settings.font_size}px`}
                      onChange={e => update('font_size', e.target.value)}
                    />
                  </div>

                  {/* Live preview */}
                  <div style={{ marginTop: '8px', padding: '16px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-base)' }}>
                    <div style={{ fontSize: 'var(--ui-font-size, 16px)', color: 'var(--text-secondary)', marginBottom: '8px' }}>Text preview</div>
                    <div style={{ fontSize: 'var(--article-font-size, 16px)', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                      The quick brown fox jumps over the lazy dog.
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ══════════════ LECTURE & SYNC ══════════════ */}
            {activeTab === 'reading' && (
              <>
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
                      role="switch" tabIndex={0}
                      aria-checked={settings.mark_read_on_open === '1'}
                      aria-label="Mark as read on open"
                    />
                  </div>
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Sync & Storage</div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>Refresh interval</div>
                      <div className={styles.rowDesc}>How often to check for new articles</div>
                    </div>
                    <select className={styles.select} value={settings.default_interval_sec} onChange={e => update('default_interval_sec', e.target.value)}>
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
                      <div className={styles.rowDesc}>Delete articles older than this number of days</div>
                    </div>
                    <input type="number" className={styles.input} value={settings.retention_days} min={1} max={365} onChange={e => update('retention_days', e.target.value)} />
                  </div>

                  <div className={styles.row}>
                    <div className={styles.rowLabel}>
                      <div className={styles.rowName}>Maximum articles per feed</div>
                      <div className={styles.rowDesc}>Maximum number of stored articles per feed</div>
                    </div>
                    <input type="number" className={styles.input} value={settings.max_articles_per_feed} min={50} max={5000} step={50} onChange={e => update('max_articles_per_feed', e.target.value)} />
                  </div>
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
