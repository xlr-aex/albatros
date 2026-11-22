# Troubleshooting

## `Error: Electron uninstall`

`electron-vite` found the npm package, but it cannot find the Electron executable. This can happen after `npm install --ignore-scripts` or an interrupted install.

```bash
node node_modules/electron/install.js
npx electron-builder install-app-deps
npm run dev
```

Confirm `node_modules/electron/dist/electron.exe` exists on Windows (or the equivalent executable on macOS/Linux).

## `Cannot find module ... electron-vite` or `vitest`

`node_modules` is incomplete, or another package manager changed it. This project uses npm and `package-lock.json`.

```bash
npm install
```

If another package manager stopped during installation, check the path to its temporary files. Remove only those files. Then install with npm. Keep the project and user-data directories.

## `better_sqlite3.node` ABI/module-version error

The native module was built for Node instead of Electron.

```bash
npx electron-builder install-app-deps
```

Use Node 20 or 22 LTS for development. Node 26 can require a local compiler because a prebuilt module may be unavailable. Albatros still needs a build for Electron.

## Visual C++/ClangCL build failure on Windows

First, try the Electron rebuild command above. If you must compile from source, install Visual Studio Build Tools and the toolset named in the error. Do not change the platform toolset only to hide the error. Check ABI compatibility.

## Sync icon does not rotate

- Make sure the running window was restarted after rebuilding main/preload code.
- Open the main-process console and look for `[Scheduler] tick`.
- A full sync emits a batch `syncing` event and only emits completion after all active work ends.
- `prefers-reduced-motion` intentionally shortens animations for accessibility.

## Sync is slow

Ordinary feeds can sync together. Reddit feeds sync one at a time to reduce HTTP 429 errors. If you have many Reddit feeds, sync can take tens of seconds. Albatros checks empty feeds first.

Do not select **Sync** again while a sync runs. Albatros combines overlapping full sync requests. More requests will not make Reddit faster.

## Embedded Reddit page is black or empty

Reddit serves a JavaScript anti-bot challenge; the embedded webview normally solves it automatically within a few seconds. If the page stays black:

1. Restart the app so the adblocker engine reloads with the current config.
2. Check the main-process console for `Refused to execute inline script` errors sourced from `@cliqz/adblocker-electron` — this means cosmetic filtering was re-enabled, which breaks Reddit's strict CSP. The engine config in `src/main/index.ts` must keep `loadCosmeticFilters: false`.
3. Verify the engine cache file is `adblocker-engine-v2.bin`; an older cache restores the old config. Delete `adblocker-engine*.bin` in the app-data directory and restart to force a fresh download.
4. Use **↗ Browser** as an immediate fallback.

## Reddit feeds show HTTP 429 or remain empty

A subreddit page URL must use the Atom endpoint, for example `https://www.reddit.com/r/homeautomation/.rss`. Albatros converts page URLs when you add a feed and repairs older subscriptions after a successful sync.

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
