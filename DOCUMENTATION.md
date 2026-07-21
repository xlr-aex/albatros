# Albatros documentation

This is the entry point for user, operator and contributor documentation. It describes the code currently present in the repository; implementation details that change frequently are kept in the focused guides below.

## Product overview

Albatros is an Electron desktop feed reader with a React renderer and a native SQLite database. Its core design goals are:

1. **Local ownership** — subscriptions, article content and reading state live in a local database.
2. **Responsive reading** — list queries are indexed, large lists are virtualised and media loads lazily.
3. **Resilient ingestion** — feeds are fetched conditionally, retried conservatively and scheduled adaptively.
4. **Untrusted-content isolation** — feed HTML is treated as hostile and sanitised at the rendering boundary.
5. **Optional local intelligence** — Ollama and LM Studio can provide digest and summary features without an Albatros cloud service.

## Architecture

### Electron main process — `src/main/`

The main process owns privileged operations:

- opens and migrates `albatros.db` through `better-sqlite3`;
- provides feed, article, search, settings and summary services;
- downloads and parses RSS, Atom and JSON feeds;
- schedules background refresh and retention maintenance;
- handles OPML file dialogs;
- configures the persistent embedded-browser session and ad blocker;
- exposes allow-listed IPC handlers.

### Preload bridge — `src/preload/`

`contextBridge` publishes the typed `window.api` surface. The renderer does not receive raw `ipcRenderer`, filesystem access or Node APIs. Every new main-process capability should be explicitly added to this bridge and documented in [the IPC reference](docs/api-ipc.md).

### Renderer — `src/renderer/`

The renderer is a React 19 application. Zustand stores coordinate feeds, articles and UI state. Long article lists use `@tanstack/react-virtual`. External HTML is normalised, sanitised with DOMPurify and only then injected into the reader.

### Persistent browser partition

Embedded pages use the Electron partition `persist:adblock`. It has a prebuilt ad/tracker blocker and browser-compatible request handling for Reddit. The feed HTTP client also uses this session for Reddit RSS requests because anonymous Node networking is aggressively rate-limited.

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

Selecting an article follows the reverse read path: React invokes `window.api.articles.get`, the preload forwards the request, `ArticleService` reads SQLite, and the renderer normalises/sanitises content before display.

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
| [Troubleshooting](docs/troubleshooting.md) | Users/operators | Electron installation, SQLite bindings, HTTP 429, media and AI issues. |

## Security boundaries and limitations

- Feed URL validation blocks obvious private and loopback hosts, but it is a lightweight hostname/IP-prefix guard rather than a DNS-rebinding-proof network sandbox.
- The renderer has `contextIsolation` enabled and `nodeIntegration` disabled.
- Article HTML is stored raw and sanitised at render time. Code must never render `content_html` without DOMPurify.
- Embedded web content is less trusted than the application UI and is isolated in a dedicated partition; header rewriting for Reddit is deliberately scoped to Reddit/Reddit media domains.
- `webSecurity` is currently disabled on the main application window to support local AI/browser workflows. Contributors should not treat the renderer as a safe place for secrets.
- AI provider URLs are user-configured local endpoints. Albatros does not authenticate, host or proxy them.

## Documentation maintenance

When behaviour changes, update the focused guide and the README if the change affects installation or user-visible features. Verify names against the preload API and package scripts instead of documenting planned functionality as if it already exists.
