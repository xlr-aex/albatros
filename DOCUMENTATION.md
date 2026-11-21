# Albatros documentation

Use this page to find user and developer guides. These guides describe the current code. Each detailed topic has its own guide.

## Product overview

Albatros is a desktop feed reader. It uses Electron, React, and SQLite. The main design rules are:

1. **Local data:** Keep feeds, articles, and reading state in a local database.
2. **Fast reading:** Use indexed queries, virtual lists, and lazy media loading.
3. **Reliable sync:** Use HTTP cache headers, controlled retries, and adaptive schedules.
4. **Safe display:** Treat feed HTML as untrusted. Clean it before display.
5. **Local sorting:** Use Laya to sort posts into folders on this computer.

## Architecture

### Electron main process — `src/main/`

The main process does operations that need access to the system:

- opens and migrates `albatros.db` through `better-sqlite3`;
- provides feed, article, search and settings services;
- downloads and parses RSS, Atom and JSON feeds;
- schedules background refresh and retention maintenance;
- handles OPML file dialogs;
- configures the persistent embedded-browser session and ad blocker;
- exposes allow-listed IPC handlers.

### Preload bridge — `src/preload/`

`contextBridge` gives the renderer the typed `window.api` interface. The renderer cannot use raw `ipcRenderer`, Node APIs, or the file system. Add each new main-process function to this bridge. Document it in the [IPC reference](docs/api-ipc.md).

### Renderer — `src/renderer/`

The renderer uses React 19. Zustand stores hold feed, article, and interface state. Long article lists use `@tanstack/react-virtual`. Before the reader displays external HTML, it normalizes the HTML and cleans it with DOMPurify.

### Persistent browser partition

Embedded pages use the Electron partition `persist:adblock`. It blocks ads and trackers at the network level. Keep cosmetic filtering off: its injected scripts make Reddit pages blank. Reddit RSS requests also use this browser session because Reddit limits anonymous Node requests. See [Media and Reddit](docs/media-and-reddit.md).

## Principal data flow

```text
Scheduler/manual action
        │
        ▼
SyncEngine ──► HttpClient ──► publisher / Reddit
        │                         │
        │ response body           │ ETag / Last-Modified / Retry-After
        ▼                         │
FeedParser ◄──────────────────────┘
        │ normalised articles
        ▼
ArticleService transaction ──► SQLite + FTS/counter triggers
        │
        ├─► sync_log
        └─► sync:update IPC ──► sidebar/list refresh
```

When you select an article, React calls `window.api.articles.get`. The preload bridge sends the request to `ArticleService`. The service reads SQLite. The renderer cleans the content before it displays it.

## Guide index

| Guide | Audience | Contents |
|---|---|---|
| [README](README.md) | Users and new contributors | Features, installation, commands, first run and quick troubleshooting. |
| [Development](docs/development.md) | Contributors | Source tree, local workflow, native dependencies, tests and change guidelines. |
| [Sync engine](docs/sync-engine.md) | Backend contributors | Scheduling, concurrency, retries, Reddit throttling and sync events. |
| [Database](docs/database.md) | Backend contributors/operators | File location, pragmas, schema, FTS4, triggers, migrations and backup notes. |
| [IPC API](docs/api-ipc.md) | Full-stack contributors | Complete `window.api` contract and push-event payloads. |
| [Media and Reddit](docs/media-and-reddit.md) | Reader/media contributors | Images, lazy sources, Reddit JSON/comments, HLS video and fallbacks. |
| [UI/UX](docs/ui-ux.md) | Renderer contributors | Three-pane interaction, state, accessibility and motion. |
| [Laya folders](docs/laya-folders.md) | Users and contributors | Local classifier, source scopes, progress and runtime behaviour. |
| [Local MCP server](docs/mcp.md) | Users and contributors | Token setup, client configuration, and search tools. |
| [Troubleshooting](docs/troubleshooting.md) | Users/operators | Electron installation, SQLite bindings, HTTP 429 and media issues. |

## Security boundaries and limitations

- Feed URL validation rejects non-HTTP(S), credential-bearing, local, private, link-local and cloud-metadata destinations. DNS is checked before every initial request and redirect.
- The renderer has `contextIsolation` enabled and `nodeIntegration` disabled.
- Article HTML is stored raw and sanitised at render time. Code must never render `content_html` without DOMPurify.
- Embedded web content is less trusted than the application UI and is isolated in a dedicated partition; header rewriting for Reddit is deliberately scoped to Reddit/Reddit media domains.
- Electron registers a single listener per `webRequest` event: any new `onHeadersReceived`/`onBeforeRequest` registration on `persist:adblock` silently replaces the adblocker's (or the Reddit bypass's) handler. Check `src/main/index.ts` before adding one.
- `webSecurity` is enabled on the main application window. Privileged network and filesystem operations stay in the main process.

## Documentation maintenance

When behavior changes, update the related guide. Update the README if users can see the change. Check method and script names in the preload API and `package.json`. Describe only functions that exist in the code.
