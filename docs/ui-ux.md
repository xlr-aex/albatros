# Interface and accessibility

This guide describes the main interface rules. Use the current CSS and React components as the source for exact values.

## Design tokens

`src/renderer/src/styles/variables.css` defines colors, spacing, text sizes, border radii, transitions, and layer order. Use these tokens in component CSS. Do not add a fixed value when a suitable token exists.

| Token | Use |
|---|---|
| `--brand-500` | Main accent color. |
| `--bg-base`, `--bg-sidebar`, `--bg-panel` | Main background colors. |
| `--text-primary`, `--text-secondary`, `--text-muted` | Text colors. |
| `--transition`, `--transition-fast`, `--transition-slow` | Transition times. |
| `--z-dropdown`, `--z-overlay`, `--z-modal` | Layer order. |

The app sets `data-theme="light"` for the light theme. Theme rules in `variables.css` set the colors. `utils/theme.ts` applies a selected accent color and sets a readable text color for accent buttons.

## Navigation

The sidebar has views for all posts, unread posts, saved posts, and today's posts. It also shows feed groups, feeds, and Laya folders.

For a feed group, select the arrow to expand or collapse it. Select the name or icon to show posts from its feeds. The selected group uses `aria-current="true"`.

The search field has an accessible label. A clear button appears when the query contains text. Keep search controls usable with a keyboard.

Context menus use `role="menu"`. Each action uses `role="menuitem"`. Keep the menu labels and keyboard focus visible.

## Article list and reader

Article cards show the title, source, time, and read state. The selected card uses `aria-current="true"`. The list must continue to work with many articles; do not remove virtualization.

The reader keeps images within the reading column. Images keep their natural shape. The list can use a smaller, cropped thumbnail. The reader can use a larger image from the article.

Use native video controls when possible. If a Reddit video cannot play, show the poster and a browser action. Do not show a still image as if it were a working player.

## Dialogs and menus

Dialogs use `role="dialog"` and `aria-modal="true"`. Give each dialog an accessible name. Link an error message with `aria-describedby` when the error is visible. The Escape key closes a dialog when no save operation is in progress.

Menus use `role="menu"` and `role="menuitem"`. Each menu action must be usable with the keyboard.

## Keyboard and screen readers

| Control | Keys |
|---|---|
| Sidebar item | Tab, then Enter or Space. |
| Group arrow | Enter or Space. |
| Article list | Up/Down or `j`/`k`. |
| Settings switch | Tab, then Enter or Space. |
| Dialog or link popup | Escape to close. |

Show a visible focus ring on interactive controls. Use `role="status"` for loading status. Use `aria-current` for the selected view or article.

Use the global `.spinner` class for a loading indicator:

```tsx
<span className="spinner" role="status" aria-label="Loading…" />
```

## Motion and sync status

Respect `prefers-reduced-motion`. Shorten or remove decorative motion when this preference is active.

The toolbar Sync icon rotates while a full sync runs. It flashes green three times when the full operation ends. Per-feed errors are separate from the full-sync animation. This matters when Reddit requests continue after other feeds finish.

Do not treat a sync error as an empty feed. Keep stored articles visible after a network error. Sidebar badges show stored article counts. An adjacent status indicator shows the current sync state.
