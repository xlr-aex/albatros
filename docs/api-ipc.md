# IPC API reference

The React renderer uses `window.api` to call privileged code. `src/preload/index.ts` exposes this interface through Electron `contextBridge`. Do not import Electron or Node modules into renderer code.

Request methods return promises. Event subscriptions return a function that stops the subscription. Call that function when the React effect ends.

## `window.api.feeds`

| Method | Arguments | Result | Notes |
|---|---|---|---|
| `list()` | — | `Promise<Feed[]>` | Active feeds with normalised booleans, unread count and computed article count. |
| `add(url, groupId?)` | `string`, optional `number` | `Promise<number>` | Creates a subscription and immediately refreshes that feed. |
| `update(id, patch)` | `number`, object | `Promise<void>` | Supports URL, title, site URL, group, interval, favicon and active state. |
| `delete(id)` | `number` | `Promise<void>` | Deletes the feed; article rows cascade. |

## `window.api.groups`

| Method | Arguments | Result | Notes |
|---|---|---|---|
| `list()` | — | `Promise<FeedGroup[]>` | Groups ordered by `sort_order`, then name. |
| `create(name)` | `string` | `Promise<number>` | Creates a folder. |
| `update(id, patch)` | `number`, object | `Promise<void>` | Updates name, order, icon or expansion state. |
| `delete(id)` | `number` | `Promise<void>` | Child feeds become ungrouped. |

## `window.api.articles`

| Method | Arguments | Result | Notes |
|---|---|---|---|
| `list(params)` | `ArticleListParams` | `Promise<ArticleSummary[]>` | Indexed/cursor-based list query for feed, folder or system views. |
| `get(id)` | `number` | `Promise<Article \| null>` | Returns the complete article body and state. |
| `totalUnread()` | — | `Promise<number>` | Global unread aggregate. |
| `mark(id, action, value)` | action is `read`, `starred` or `saved` | `Promise<void>` | Updates one user-state flag. `saved` also maintains the `read_later` table. |
| `markAllRead(feedId?)` | optional `number` | `Promise<number>` | Marks all or one feed read and returns the affected count. |
| `getGithubLinks()` | — | `Promise<GitHubLink[]>` | Extracts GitHub URLs from stored articles. |
| `getRedditComments(url)` | Reddit post URL | `Promise<RedditCommentsResult>` | Fetches/caches post metadata and comments; invalid URLs return an empty result. |

`ArticleListParams` selects a feed, group, or system view. It also sets cursor paging and read, saved, or starred filters. Check the exported service type before you add a field.

## `window.api.search`

| Method | Arguments | Result |
|---|---|---|
| `query(q, limit?)` | text, optional maximum | `Promise<SearchResult[]>` |

Search results include article IDs and short matched text from SQLite FTS4. A plain word becomes a prefix term (`word*`). Spaces between words mean AND. Before a `LIKE` fallback, the code escapes `%`, `_`, and `\`. Treat matched text as untrusted. Use the renderer's safe display path.

## `window.api.sync`

| Method | Arguments | Result | Notes |
|---|---|---|---|
| `refreshAll()` | — | `Promise<void>` | Forces all active feeds through one non-overlapping scheduler operation. |
| `refreshFeed(feedId)` | `number` | `Promise<void>` | Forces one feed, still respecting host/Reddit limiters. |
| `onUpdate(callback)` | function | unsubscribe function | Receives per-feed and batch status pushes. |

Status payload:

```ts
{
  feedId: number
  status: 'syncing' | 'success' | 'not_modified' | 'deferred' | 'error'
  scope?: 'feed' | 'batch'
  articlesNew?: number
  error?: string
}
```

`feedId: 0` with `scope: 'batch'` identifies a full sync. It does not identify a stored feed.

## `window.api.settings`

| Method | Arguments | Result |
|---|---|---|
| `getAll()` | — | `Promise<Record<string, string>>` |
| `get(key)` | typed `SettingKey` | `Promise<string \| null>` |
| `set(key, value)` | typed key, string value | `Promise<void>` |
| `setMany(values)` | partial key/value record | `Promise<void>` |

Values are stored as text. The current settings cover theme/accent, font and panel dimensions, reading behaviour, retention and the default feed interval.

## `window.api.opml`

| Method | Result | Notes |
|---|---|---|
| `import()` | `Promise<number>` | Opens a native file picker, imports subscriptions and starts refresh. |
| `export()` | `Promise<boolean>` | Opens a save dialog and writes the current folders/subscriptions. |

## `window.api.laya`

| Method | Arguments | Result | Notes |
|---|---|---|---|
| `listFolders()` | — | `Promise<LayaFolder[]>` | Folders with their included-post count and enabled state. |
| `createFolder(name, description)` | strings | `Promise<LayaFolder>` | Creates a local classification rule. |
| `updateFolder(id, patch)` / `deleteFolder(id)` | id and patch / id | `Promise<void>` | Edits state or deletes the rule. |
| `listGroupScopes(id)` / `setGroupScopes(id, ids)` | folder id, optional group ids | `Promise<LayaGroupScope[]>` / `Promise<void>` | A selected group includes all of its feeds. |
| `listFeedScopes(id)` / `setFeedScopes(id, ids)` | folder id, optional feed ids | `Promise<LayaFeedScope[]>` / `Promise<void>` | Individual feeds supplement selected groups. |
| `getStatus()` / `onStatus(callback)` | — / callback | status / unsubscribe | Overall and per-folder progress, worker state and errors. |
| `trigger()` / `pause()` / `resume()` | — | `Promise<void>` | Controls background classification. |
| `resetFolderScope(id)` | folder id | `Promise<void>` | Clears and requeues only that folder’s decisions for its selected sources. |

The status payload contains `processed`, `scopeTotal` and a `folderProgress` map keyed by folder id. The global values count article-folder evaluations; a decision can be `include`, `exclude` or `uncertain`.

## `window.api.debug`

`debug.log(message)` sends a message from the renderer to the main-process console. Do not send credentials or complete article bodies through this channel.

## Adding a new IPC method

1. Implement and validate the privileged operation in a main-process service.
2. Register a narrowly scoped `ipcMain.handle` channel.
3. Add the wrapper and types to `src/preload/index.ts`.
4. Update the renderer's global API declaration if needed.
5. Document argument validation, return type and failure semantics here.
6. Add a focused test where the logic can be separated from Electron.

Do not add a general channel that can execute SQL, read any file, or fetch any URL. Such a channel would bypass the preload allow-list.
