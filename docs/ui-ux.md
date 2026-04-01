# UI/UX Design & Accessibility

Albatros adopts an opinionated, consistency-first approach to UI/UX. All visual and interaction decisions are centralized in design tokens, making future updates trivial.

## Design System

### Tokens (`styles/variables.css`)

All spacing, color, type scale, animation timing, and z-index layers are defined as CSS custom properties. **Never use hardcoded values in component CSS; always reference a token.**

| Token | Purpose |
|---|---|
| `--brand-500` | Primary blue accent |
| `--bg-base` / `--bg-sidebar` / `--bg-panel` | Panel hierarchy (darkest → lightest) |
| `--text-primary` / `--text-secondary` / `--text-muted` | Text hierarchy |
| `--transition` / `--transition-fast` / `--transition-slow` | 150ms / 100ms / 250ms ease-out |
| `--z-dropdown` / `--z-overlay` / `--z-modal` | Layer ordering: 150 / 100 / 200 |

### Light/Dark Theme

Applied via `data-theme="light"` on the root app container. Token overrides in `variables.css` handle everything automatically — no component-level conditionals needed.

---

## Component Patterns

### System Navigation
| View | Icon | Intuition |
|---|---|---|
| **All Items** | Layout Grid | Overall database view |
| **Unread** | Inbox | Incoming, pending items |
| **Saved Posts** | Bookmark | Long-term storage/reference |
| **Today** | Calendar | Time-bound context |

### Navigation Items (Sidebar)

Nav items are **pill-shaped**, not full-bleed rows:
- `width: calc(100% - var(--space-4))` with `margin: 1px var(--space-2)`
- `border-radius: var(--radius-md)`
- Active state has a **left accent bar**: `box-shadow: inset 3px 0 0 var(--brand-500)`

### Feed Groups

Groups support two distinct interactions:
- **Caret (`data-caret`)** — clicking the ▶/▼ arrow only toggles expand/collapse, no article load
- **Name / Icon** — clicking anywhere else selects the group, loading all articles from all feeds in that group

The group header gets `.active` styling when selected (`aria-current="true"`). Auto-expands the group when selected while collapsed.

When viewing a group, new articles from any feed in that group trigger an automatic reload if the list is short (<50 items).

### Search Input

- `role="search"` on the wrapping `<form>`
- `aria-label="Search feeds and articles"` on the `<input>`
- A **clear (×) button** appears when the query is non-empty — calls `setSearchQuery('')` directly, no functionality change

### Context Menus

- `<menu role="menu" aria-label="…">`
- Each `<li role="none">` wraps `<button role="menuitem">`
- Animated in via `fadeIn 120ms` CSS

---

## Article Cards

- Slightly rounded (`border-radius: var(--radius-md)`) with `margin: 2px var(--space-1)` so cards feel like discrete list items
- Hover: `translateX(1px)` subtle push-right for depth cue
- Unread dot: 8px with `box-shadow` glow
- Title: 3-line clamp (was 2) for more content at a glance
- `aria-label` = `"${title}, ${feedName}, read/unread, ${relativeTime}"`
- `aria-current="true"` on selected card

---

## Article Reader

### Actions toolbar

Action buttons now have explicit visual shape: `border: 1px solid var(--border-light)`, `background: var(--bg-surface)`, `border-radius: var(--radius-md)`. Saved states use tinted backgrounds.

### Link Popup

- `role="dialog" aria-label="Link options"`
- Closes on `Escape` key
- `backdrop-filter: blur(8px)` for visual clarity over content

### Reading content

- Max width 780px, `margin: 0 auto` for centered reading column
- Search highlight uses `color-mix(in srgb, var(--brand-500), transparent 70%)` — theme-aware, not hardcoded yellow

---

## Modals

### Common pattern

```tsx
<div
  className={styles.overlay}
  onClick={e => { if (e.target === e.currentTarget) onClose() }}
  onKeyDown={e => { if (e.key === 'Escape') onClose() }}
>
  <div role="dialog" aria-modal="true" aria-label="…">
```

All modal overlays have `backdrop-filter: blur(4px)`.

### AddFeedModal

- `aria-describedby="feed-error"` links dialog to error message when visible

### SettingsPanel

- Toggles have `tabIndex={0}` + `onKeyDown` for Space/Enter activation
- Sliders have `aria-label` with current value: `"UI Scale: 16px"`
- **Accent Color** — 5 named presets + a rainbow swatch that opens the native OS color picker (`<input type="color">`). Hex colors are auto-derived into `--brand-400` (lightened 25%) and `--brand-600` (darkened 15%) via `lighten()`/`darken()` helpers in `utils/theme.ts`.

---

## Accessibility

### Focus ring

`outline: 3px solid var(--border-focus); outline-offset: 3px` — visible on both dark and light themes.

### Keyboard navigation

| Component | Keys |
|---|---|
| Sidebar nav items | Tab, Enter/Space |
| Feed items (role=button) | Tab, Enter/Space |
| Group toggle | Enter/Space, propagates `aria-expanded` |
| Article list | ↑/↓ or j/k |
| Settings toggles | Tab, Space/Enter |
| Modals | Escape to close |
| Link popup | Escape to close |

### Screen readers

- `role="search"` on search form
- `aria-current="page"` on active system view
- `aria-current="true"` on selected article
- `role="menu"` / `role="menuitem"` on context menus
- `role="status" aria-label="Loading…"` on spinners

### Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Text selection

```css
::selection { background: color-mix(in srgb, var(--brand-500), transparent 70%); }
```

---

## CSS Spinner

Replaces the `⟳` spinning character everywhere. Apply the global `.spinner` class to an empty `<span>`:

```tsx
<span className="spinner" role="status" aria-label="Loading…" />
```

```css
.spinner {
  width: 14px; height: 14px;
  border: 2px solid var(--border-light);
  border-top-color: var(--brand-400);
  border-radius: 50%;
  animation: spin-border 0.7s linear infinite;
}
```
