# Albatros RSS Reader

A fast, privacy-focused desktop RSS/Atom/JSON feed reader built with Electron, React, and SQLite.

Inspired by the classical layout of Inoreader, Albatros offers a powerful 3-pane interface optimized for heavy reading, keyboard navigation, and local-first data ownership.

## Features

- **Local-First Architecture**: All feeds, articles, and reading states are stored in a local SQLite database (`sql.js` WASM compile).
- **Format Support**: Automatically detects and parses RSS 2.0, Atom 1.0, and JSON Feed 1.1.
- **Smart Polling**: Adaptive sync engine that backs off failing/quiet feeds and scales up actively publishing ones, saving bandwidth.
- **SSRF Protection**: Built-in network guards to prevent malicious feeds from scanning your local network or localhost.
- **Privacy Native**: Sanitizes all incoming HTML via DOMPurify instantly before render. No trackers, no telemetry.
- **Full Text Search**: Instant searching across all downloaded articles via SQLite FTS5.
- **Infinite Scroll Reading**: Virtualized article lists capable of rendering thousands of items at 60fps.
- **OPML Workflows**: Standard OPML 2.0 import and export for mass subscription management.

## Project Structure

This project follows a strict strict separation of concerns, generated via `electron-vite`:

```
albatros/
├── src/
│   ├── main/          # Node.js backend (Sync Engine, SQLite, IPC handlers)
│   ├── preload/       # Security bridge (window.api)
│   └── renderer/      # React 19 Frontend (Zustand, CSS Modules)
├── docs/              # Architecture references
└── package.json       # Scripts & dependencies
```

## Documentation

For a detailed breakdown of how Albatros operates under the hood, refer to the following internal guides:

1. [Architecture Overview](docs/architecture.md)
2. [Database Schema & Triggers](docs/database.md)
3. [Sync Engine & Parsing](docs/sync-engine.md)
4. [IPC API Bridge](docs/api-ipc.md)

## Development Setup

### Prerequisites

- Node.js 20+
- npm 9+

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Running Locally

To start the Vite dev server and launch the Electron app in development mode:

```bash
npm run dev
```

### Building for Production

To compile TypeScript, bundle with Vite, and build the Electron executables for your current platform:

```bash
npm run build
```

The compiled binaries will be placed in the `dist/` and `out/` directories depending on the builder config.

## Tech Stack

- **Core**: Electron, TypeScript, Node.js (`undici` for networking).
- **Frontend**: React 19, Zustand (State), Radix UI (Primitives), `@tanstack/react-virtual` (Performance).
- **Backend/Storage**: `sql.js` (WebAssembly SQLite), `fast-xml-parser`, `dompurify`.
- **Tooling**: Vite (`electron-vite`), ESLint, Prettier.

## License

MIT License
