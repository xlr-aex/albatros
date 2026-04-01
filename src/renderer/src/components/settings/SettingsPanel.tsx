/**
 * @file components/settings/SettingsPanel.tsx
 * @description Full-featured settings modal with persistence via window.api.settings.
 */

import React, { useState, useEffect } from 'react'
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

export function SettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const all = await window.api.settings.getAll()
      setSettings({ ...DEFAULTS, ...all })
      setLoaded(true)
    }
    void load()
  }, [])

  function update(key: keyof Settings, value: string) {
    setSettings(s => ({ ...s, [key]: value }))
    
    // Apply visual settings instantly
    if (key === 'theme') {
      useUiStore.getState().setTheme(value as 'light' | 'dark')
    } else if (key === 'font_size') {
      document.documentElement.style.setProperty('--article-font-size', `${value}px`)
    } else if (key === 'ui_font_size') {
      document.documentElement.style.setProperty('--ui-font-size', `${value}px`)
    } else if (key === 'accent_color') {
      applyAccentColor(value)
    }
    
    // Fire-and-forget DB update to avoid blocking slider dragging
    window.api.settings.set(key, value).catch(console.error)
  }

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
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.version}>Albatros v1.0.0</span>
        </div>
      </div>
    </div>
  )
}
