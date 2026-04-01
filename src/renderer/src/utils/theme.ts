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

/** Lighten a hex color by mixing it with white at `amount` (0–1). */
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const lr = Math.round(r + (255 - r) * amount)
  const lg = Math.round(g + (255 - g) * amount)
  const lb = Math.round(b + (255 - b) * amount)
  return `#${((lr << 16) | (lg << 8) | lb).toString(16).padStart(6, '0')}`
}

/** Darken a hex color by mixing it with black at `amount` (0–1). */
function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 0xff) * (1 - amount))
  const g = Math.round(((n >> 8) & 0xff) * (1 - amount))
  const b = Math.round((n & 0xff) * (1 - amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

export function applyAccentColor(colorName: string) {
  // Named preset
  if (ACCENT_COLORS[colorName as AccentColor]) {
    const c = ACCENT_COLORS[colorName as AccentColor]
    document.documentElement.style.setProperty('--brand-400', c[400])
    document.documentElement.style.setProperty('--brand-500', c[500])
    document.documentElement.style.setProperty('--brand-600', c[600])
    return
  }
  // Arbitrary hex color (#rrggbb or #rgb)
  if (colorName.startsWith('#')) {
    const hex = colorName.length === 4
      ? '#' + [...colorName.slice(1)].map(c => c + c).join('')
      : colorName
    document.documentElement.style.setProperty('--brand-400', lighten(hex, 0.25))
    document.documentElement.style.setProperty('--brand-500', hex)
    document.documentElement.style.setProperty('--brand-600', darken(hex, 0.15))
  }
}
