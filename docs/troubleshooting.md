# Troubleshooting

## `Error: Electron uninstall`

`electron-vite` found the npm package but not Electron's downloaded executable. This usually follows `npm install --ignore-scripts` or an interrupted install.

```bash
node node_modules/electron/install.js
npx electron-builder install-app-deps
npm run dev
```

Confirm `node_modules/electron/dist/electron.exe` exists on Windows (or the equivalent executable on macOS/Linux).

## `Cannot find module ... electron-vite` or `vitest`

`node_modules` is incomplete or was restructured by another package manager. This repository is npm/`package-lock.json` based.

```bash
npm install
```

If a different package manager was interrupted, remove only its local temporary store after verifying the path, then reinstall with npm. Do not delete the project or user-data directory.

## `better_sqlite3.node` ABI/module-version error

The native binding was built for host Node instead of Electron.

```bash
npx electron-builder install-app-deps
```

Node 20/22 LTS is recommended for development. Node 26 may lack a compatible prebuilt Node binary and fall back to a local compiler, but the application still needs an Electron-targeted rebuild.

## Visual C++/ClangCL build failure on Windows

Prefer the Electron prebuild/rebuild command above. If compilation from source is genuinely required, install the Visual Studio Build Tools workload and the toolset named in the error. Do not change the project's platform toolset merely to suppress the message without verifying ABI compatibility.

## Sync icon does not rotate

- Make sure the running window was restarted after rebuilding main/preload code.
- Open the main-process console and look for `[Scheduler] tick`.
- A full sync emits a batch `syncing` event and only emits completion after all active work ends.
- `prefers-reduced-motion` intentionally shortens animations for accessibility.

## Sync is slow

Ordinary providers run concurrently, but Reddit is intentionally serialised and spaced to avoid HTTP 429. A library with many subreddit subscriptions may therefore take tens of seconds. Empty feeds are prioritised.

Do not repeatedly click Sync: the scheduler coalesces overlapping full refreshes, and repeated provider traffic cannot make Reddit faster.

## Embedded Reddit page is black or empty

Reddit serves a JavaScript anti-bot challenge; the embedded webview normally solves it automatically within a few seconds. If the page stays black:

1. Restart the app so the adblocker engine reloads with the current config.
2. Check the main-process console for `Refused to execute inline script` errors sourced from `@cliqz/adblocker-electron` — this means cosmetic filtering was re-enabled, which breaks Reddit's strict CSP. The engine config in `src/main/index.ts` must keep `loadCosmeticFilters: false`.
3. Verify the engine cache file is `adblocker-engine-v2.bin`; an older cache restores the old config. Delete `adblocker-engine*.bin` in the app-data directory and restart to force a fresh download.
4. Use **↗ Browser** as an immediate fallback.

## Reddit feeds show HTTP 429 or remain empty

Albatros uses the persistent Chromium session for Reddit RSS and honours provider cooldowns. If 429 persists:

1. stop clicking Sync and wait for the cooldown;
2. verify Reddit opens in the embedded/external browser on the same network;
3. restart the app after updating so the Chromium-session fetch path is active;
4. test one feed using its per-feed refresh action;
5. inspect recent `sync_log` rows for `deferred` versus `error`.

Existing cached articles should remain visible. A blank badge means the local database truly has no stored normal post for that feed; it is not merely a hidden error indicator.

## Red indicator remains beside a feed

Permanent errors increment `error_count`; transient rate limits use `deferred` and reset the permanent error count. A feed may be disabled after ten consecutive genuine failures. Check whether its URL still returns a valid RSS/Atom/JSON feed and update the subscription URL if the publisher moved it.

## Article image is tiny, blurry or absent

- A publisher may expose only a small thumbnail.
- Hotlink protection may reject requests without its expected referrer/cookies.
- The reader attempts an original-size URL and falls back to the RSS thumbnail.
- Use **Browser** when the source requires scripts or authentication.

When reporting a bug, include the feed URL and one article URL—not ten samples from the same publisher.

## Reddit video is black or behaves like an image

Restart the app after media changes so the renderer bundle updates. Albatros needs the post's Reddit JSON metadata to locate the HLS playlist. If metadata cannot load, it shows a poster/browser fallback. Verify that `hls.js` is installed and the production build contains an HLS chunk.

## Local AI does not connect

### Ollama

- Confirm `http://127.0.0.1:11434/api/tags` responds.
- Verify the configured model is installed.
- Use the base URL without `/api` at the end.

### LM Studio

- Start the local server, not only the desktop UI.
- Confirm `/v1/models` responds on the configured port.
- Use the base URL with or without `/v1`; Albatros normalises the chat-completions path.

The background summariser waits after failures so an offline model does not create a tight retry loop.

## Database backup or corruption concerns

Close Albatros before copying `albatros.db`, because WAL mode may have an active `-wal` file. Preserve the original file before attempting recovery. OPML export can restore subscriptions but not article state.

## Useful verification commands

```bash
npm run build:check
npm run test:unit
npm run build
```

For dependency checks on Windows PowerShell:

```powershell
Test-Path node_modules\electron\dist\electron.exe
Test-Path node_modules\better-sqlite3\build\Release\better_sqlite3.node
```
