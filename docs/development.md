# Development guide

## Repository layout

```text
albatros/
├─ src/main/
│  ├─ db/          SQLite connection, schema, triggers and migrations
│  ├─ ipc/         allow-listed IPC handlers
│  ├─ services/    feeds, articles, search, settings, OPML and Laya
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

Electron Vite builds three parts:

- `out/main/index.js`: privileged Electron main process;
- `out/preload/index.js`: isolated bridge;
- `out/renderer/`: browser React bundle.

During development, Vite serves the renderer on port 5273. It reloads the renderer after a change. Electron runs the main and preload code.

Development uses a separate `albatros-dev` application-data directory. It does not open the installed app's database or Chromium cache. The development MCP server uses port `8766` by default. Set `ALBATROS_MCP_PORT` before startup to choose a different port.

## Recommended toolchain

Use Node.js 20 or 22 LTS and npm. `better-sqlite3` contains native code. Build it for Electron's ABI. A build for the local Node ABI is not sufficient. `npm install` runs `electron-builder install-app-deps` in the `postinstall` step.

Use npm with `package-lock.json`. Do not use pnpm unless you also change the lockfile and install workflow. pnpm can change `node_modules`. An interrupted install can leave the Electron executable missing.

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

Run all four commands. Each command must finish without an error. New code must not add lint warnings.

## Native dependency recovery

If `node_modules/electron/dist/electron` or `electron.exe` is absent:

```bash
node node_modules/electron/install.js
```

If Electron starts but SQLite reports an ABI/module-version error:

```bash
npx electron-builder install-app-deps
```

Do not use `npm rebuild better-sqlite3` with an unsupported Node version. That command builds for Node. Albatros needs a build for Electron 34.

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

The unit tests cover logic that does not need a live service:

- RSS/Atom/JSON parser normalisation and thumbnail extraction;
- article HTML/image recovery and Reddit player conversion;
- formatting utilities.
- feed URL validation and feed-properties editing.

For a publisher-specific defect, use a small feed sample that shows the defect. Test different feed formats and image attributes. Avoid many tests that use almost the same sample.

Use an integration or manual test for network rate limits and Electron session behavior. Limit each test to one provider request. Keep live network tests out of the default unit test suite.

## Manual smoke-test checklist

1. Start with `npm run dev` and confirm the three panes render.
2. Sync one ordinary feed and one Reddit feed.
3. Confirm the Sync icon rotates until completion and flashes green three times.
4. Open an article with a large image and resize the reading pane.
5. Open a Reddit image post and a Reddit-hosted video post.
6. Open a Reddit link with **⧉ In App** and confirm the embedded page renders (not black) after the anti-bot challenge.
7. Confirm cached articles remain visible when a provider is offline/deferred.
8. Search for a multi-word query and navigate to a result.
9. Create a Laya folder, select its source feeds and check classification progress.
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
