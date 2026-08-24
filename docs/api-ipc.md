# IPC API reference

The React renderer communicates with privileged code exclusively through `window.api`, exposed by `src/preload/index.ts` using Electron `contextBridge`. Renderer code must not import Electron or Node modules directly.

All request/response methods return promises because they wrap `ipcRenderer.invoke()`. Event subscriptions return an unsubscribe function and should be cleaned up from React effects.

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
| `getForDigest(params)` | digest filter object | `Promise<Article[]>` | Retrieves bounded AI context by time/source. |
| `get(id)` | `number` | `Promise<Article \| null>` | Returns the complete article body and state. |
| `totalUnread()` | — | `Promise<number>` | Global unread aggregate. |
| `mark(id, action, value)` | action is `read`, `starred` or `saved` | `Promise<void>` | Updates one user-state flag. `saved` also maintains the `read_later` table. |
| `markAllRead(feedId?)` | optional `number` | `Promise<number>` | Marks all or one feed read and returns the affected count. |
| `getGithubLinks()` | — | `Promise<GitHubLink[]>` | Extracts GitHub URLs from stored articles. |
| `getRedditComments(url)` | Reddit post URL | `Promise<RedditCommentsResult>` | Fetches/caches post metadata and comments; invalid URLs return an empty result. |

`ArticleListParams` supports the selected feed/group/system view, cursor pagination, read/saved/starred constraints and search-dependent usage in the stores. Consult the exported service type before extending it.

## `window.api.search`

| Method | Arguments | Result |
|---|---|---|
| `query(q, limit?)` | text, optional maximum | `Promise<SearchResult[]>` |

Search results contain article identifiers and highlighted snippets produced from SQLite FTS4. Queries are compiled to bare prefix terms (`word*`, implicit AND), so partial words match. `%`, `_` and `\` are escaped before any `LIKE` fallback. Treat snippet markup as untrusted until it has passed the renderer's controlled rendering path.

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

`feedId: 0` plus `scope: 'batch'` represents the global operation rather than a database feed.

## `window.api.settings`

| Method | Arguments | Result |
|---|---|---|
| `getAll()` | — | `Promise<Record<string, string>>` |
| `get(key)` | typed `SettingKey` | `Promise<string \| null>` |
| `set(key, value)` | typed key, string value | `Promise<void>` |
| `setMany(values)` | partial key/value record | `Promise<void>` |

Values are stored as text. The known keys cover theme/accent, font and panel dimensions, read behaviour, retention/default interval and AI provider/model/base URL/prompts.

## `window.api.llm`

| Method | Result | Notes |
|---|---|---|
| `getConfig()` | `Promise<AiConfig>` | Normalised provider settings (provider, chat URL, model). |
| `listModels()` | `Promise<string[]>` | Queries the configured local provider for available models. |
| `testConnection()` | `Promise<TestResult>` | Probes the configured endpoint and reports success/error. |

The main process is the source of truth for AI configuration; the renderer never calls model endpoints directly.

## `window.api.opml`

| Method | Result | Notes |
|---|---|---|
| `import()` | `Promise<number>` | Opens a native file picker, imports subscriptions and starts refresh. |
| `export()` | `Promise<boolean>` | Opens a save dialog and writes the current folders/subscriptions. |

## `window.api.summary`

| Method | Result | Notes |
|---|---|---|
| `getStatus()` | `Promise<{pending,total,isProcessing}>` | Current background-summary queue state. |
| `trigger()` | `Promise<void>` | Wakes the summariser if it is idle and running. |
| `onStatus(callback)` | unsubscribe function | Receives queue progress broadcasts. |

The summary worker processes recent (14 days) or unread articles one at a time, backs off when the local model is offline, and permanently skips an article after three failed attempts so one malformed entry cannot stall the queue.

## `window.api.debug`

`debug.log(message)` sends renderer diagnostics to the main-process console. Do not send credentials, complete article bodies or personal model prompts through this convenience channel.

## Adding a new IPC method

1. Implement and validate the privileged operation in a main-process service.
2. Register a narrowly scoped `ipcMain.handle` channel.
3. Add the wrapper and types to `src/preload/index.ts`.
4. Update the renderer's global API declaration if needed.
5. Document argument validation, return type and failure semantics here.
6. Add a focused test where the logic can be separated from Electron.

Avoid generic channels such as “execute SQL”, “read file” or “fetch arbitrary URL”; they defeat the security boundary provided by the preload allow-list.
