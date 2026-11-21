/**
 * @file utils/theme.ts
 * @description Theme and color utilities for the renderer.
 */

export const ACCENT_COLORS = {
  blue:    { 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb' },
  emerald: { 400: '#34d399', 500: '#10b981', 600: '#059669' },
  violet:  { 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed' },
  rose:    { 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48' },
  amber:   { 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
}

export type AccentColor = keyof typeof ACCENT_COLORS

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(hex: string, otherLuminance: number): number {
  const luminance = relativeLuminance(hex)
  return (Math.max(luminance, otherLuminance) + 0.05) /
    (Math.min(luminance, otherLuminance) + 0.05)
}

function darken(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16)
  const channel = (shift: number) => Math.round(((value >> shift) & 0xff) * (1 - amount))
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`
}

function readableForeground(hex: string): '#ffffff' | '#061714' {
  return contrastRatio(hex, 1) >= contrastRatio(hex, 0)
    ? '#ffffff'
    : '#061714'
}

export function applyAccentColor(colorName: string) {
  const preset = ACCENT_COLORS[colorName as AccentColor]
  const candidate = preset?.[500] ?? colorName
  const hex = candidate.length === 4 && candidate.startsWith('#')
    ? '#' + [...candidate.slice(1)].map((channel) => channel + channel).join('')
    : candidate

  if (!/^#[0-9a-f]{6}$/i.test(hex)) return

  // CSS derives each shade from this one source of truth.  The values switch
  // automatically with [data-theme], so toggling light/dark never leaves a
  // light-mode accent washed out or a dark-mode accent too dim.
  document.documentElement.style.setProperty('--accent-base', hex)
  document.documentElement.style.setProperty('--brand-on-primary-dark', readableForeground(hex))
  document.documentElement.style.setProperty('--brand-on-primary-light', readableForeground(darken(hex, 0.18)))
}
