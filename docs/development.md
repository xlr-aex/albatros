# Development guide

## Repository layout

```text
albatros/
├─ src/main/
│  ├─ db/          SQLite connection, schema, triggers and migrations
│  ├─ ipc/         allow-listed IPC handlers
│  ├─ services/    feeds, articles, search, settings, OPML and summaries
│  ├─ sync/        HTTP client, feed parser, scheduler and sync engine
│  └─ index.ts     Electron bootstrap and session/window configuration
├─ src/preload/    typed contextBridge API
├─ src/renderer/
│  ├─ src/components/
│  ├─ src/store/   Zustand stores
│  ├─ src/styles/  global styles and design tokens
│  └─ src/utils/   renderer-safe normalisation/formatting helpers
├─ docs/           focused documentation and assets
├─ electron.vite.config.ts
├─ package.json
└─ tsconfig.*.json
```

## Runtime processes

Electron Vite builds three targets:

- `out/main/index.js`: privileged Electron main process;
- `out/preload/index.js`: isolated bridge;
- `out/renderer/`: browser React bundle.

During development, Vite serves the renderer on port 5273 and reloads it while Electron runs the main/preload outputs.

## Recommended toolchain

Use Node.js 20 or 22 LTS and npm. `better-sqlite3` is a native dependency and must target Electron's ABI, not merely the host Node ABI. `npm install` runs `electron-builder install-app-deps` automatically through `postinstall`.

Do not install this npm project with pnpm unless the lockfile and lifecycle workflow are deliberately migrated: pnpm may restructure `node_modules`, and interrupted installs can leave Electron's binary absent.

## Local workflow

```bash
npm install
npm run dev
```

Before handing off a change:

```bash
npm run lint
npm run build:check
npm run test:unit
npm run build
```

All four commands must pass with zero errors and zero warnings. Existing unrelated issues should not be mechanically rewritten as part of a focused fix, but new code may not introduce new lint findings.

## Native dependency recovery

If `node_modules/electron/dist/electron` or `electron.exe` is absent:

```bash
node node_modules/electron/install.js
```

If Electron starts but SQLite reports an ABI/module-version error:

```bash
npx electron-builder install-app-deps
```

Avoid `npm rebuild better-sqlite3` under an unsupported bleeding-edge Node version; that rebuild targets Node, while the application needs Electron 34.

## Change boundaries

### Main-process work

- Keep network, filesystem, SQLite and native Electron operations here.
- Validate external input at the IPC and URL boundaries.
- Use prepared statements and transactions for batches.
- Add a versioned migration for persistent schema changes.
- Never block database transactions on a network request.

### Preload work

- Expose the smallest method needed by the renderer.
- Keep argument/return types synchronized with services and renderer declarations.
- Return unsubscribe functions for event listeners.

### Renderer work

- Keep privileged code out of React.
- Sanitize external HTML at the final rendering boundary.
- Reuse Zustand stores for cross-pane state.
- Preserve virtualisation for potentially large lists.
- Account for loading, empty, cached, deferred and error states separately.

## Testing strategy

The fast unit suite currently concentrates on deterministic logic:

- RSS/Atom/JSON parser normalisation and thumbnail extraction;
- article HTML/image recovery and Reddit player conversion;
- formatting utilities.

When fixing a publisher-specific sample, reduce the feed fragment to the smallest fixture that demonstrates the behaviour. Test distinct publisher formats once; duplicating ten nearly identical samples provides less value than covering different namespaces/lazy-loading conventions.

Network rate limiting and Electron session behaviour require an integration or manual smoke test. Keep such tests bounded to one provider request and do not add live-network tests to the default unit suite.

## Manual smoke-test checklist

1. Start with `npm run dev` and confirm the three panes render.
2. Sync one ordinary feed and one Reddit feed.
3. Confirm the Sync icon rotates until completion and flashes green three times.
4. Open an article with a large image and resize the reading pane.
5. Open a Reddit image post and a Reddit-hosted video post.
6. Open a Reddit link with **⧉ In App** and confirm the embedded page renders (not black) after the anti-bot challenge.
7. Confirm cached articles remain visible when a provider is offline/deferred.
8. Search for a multi-word query and navigate to a result.
9. If AI is enabled, test provider detection and one streamed digest.
10. Restart the app and confirm database state persists.

## Generated and local files

Do not commit:

- `node_modules/`, `out/` or packaged release output;
- local `albatros.db`, WAL/SHM files or AppData content;
- temporary `electron.vite.config.<timestamp>.mjs` files;
- scratch network diagnostics;
- model credentials or private endpoint tokens.

## Commit guidance

Keep code, tests and matching docs together when they describe one behaviour. Before pushing, inspect `git diff --cached`, verify the remote branch has not advanced and make sure temporary diagnostic files remain untracked.
