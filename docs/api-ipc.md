# IPC API Reference

The entire interaction between the frontend (React) and backend (Node.js/SQLite) goes through a strictly typed Inter-Process Communication (IPC) bridge.

Node integration is completely disabled in the renderer for security. All API calls must go through the `window.api` object, which is injected via `src/preload/index.ts`.

## `window.api.feeds`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `list()` | - | `Promise<Feed[]>` | Returns all feeds, including denormalised unread counts. |
| `add()` | `url: string`, `groupId?: number` | `Promise<number>` | Adds a feed, triggering an immediate initial sync. |
| `update()` | `id: number`, `patch: object` | `Promise<void>` | Updates feed properties (e.g., title, interval). |
| `delete()` | `id: number` | `Promise<void>` | Permanently deletes a feed and all associated articles. |

## `window.api.groups`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `list()` | - | `Promise<FeedGroup[]>` | Returns all feed groups. |
| `create()` | `name: string` | `Promise<number>` | Creates a new feed group. |
| `update()` | `id: number`, `patch: object` | `Promise<void>` | Renames, sorts, or toggles expansion state. |
| `delete()` | `id: number` | `Promise<void>` | Deletes a group (feeds inside become ungrouped). |

## `window.api.articles`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `list()` | `ArticleListParams` | `Promise<ArticleSummary[]>` | Cursor-paginated query for the centre pane. |
| `get()` | `id: number` | `Promise<Article>` | Gets full HTML content for the reader pane. |
| `totalUnread()` | - | `Promise<number>` | Aggregate unread count across all feeds (for macOS dock badge). |
| `mark()` | `id: number`, `action`, `value: boolean` | `Promise<void>` | Toggles read/starred/saved status. |
| `markAllRead()`| `feedId?: number` | `Promise<number>` | Bulk mark-as-read, optionally scoped to one feed. |

## `window.api.sync`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `refreshAll()` | - | `Promise<void>` | Manually triggers a sync loop across all due feeds. |
| `refreshFeed()`| `feedId: number` | `Promise<void>` | Forces an immediate refresh of a single feed. |
| `onUpdate()` | `(status) => void` | `() => void` | Subscribes to real-time status push events (calls back on sync start/success/error). Returns an unsubscribe function. |

## `window.api.search`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `query()` | `q: string`, `limit?: number` | `Promise<SearchResult[]>` | Executes an FTS4 MATCH query returning snippets. |

## `window.api.settings`

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `get()` | `key: string` | `Promise<string>` | Retrieves a setting value (e.g. `theme`). |
| `set()` | `key: string`, `value: string`| `Promise<void>` | Saves a setting. |
| `getAll()` | - | `Promise<Record<string, string>>` | Returns all KV settings. |
