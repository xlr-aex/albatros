<div align="center">
  <img src="docs/assets/logo.png" alt="Albatros Logo" width="160" />

  # Albatros RSS Reader
</div>

[![Electron](https://img.shields.io/badge/Electron-34.x-blue?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react&logoColor=white)](https://reactjs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-FTS5-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Albatros** is a high-performance, privacy-native desktop RSS/Atom/JSON feed reader. Designed for users who value speed, local-first data ownership, and a clean, 3-pane reading experience reminiscent of classical readers like Inoreader or Google Reader.

Built on a robust foundation of **Electron**, **React 19**, and **SQLite (sql.js WASM)**, Albatros offers a seamless bridge between the traditional web and a modern, offline-first desktop application.

---

## 🚀 Key Features

### 🛡️ Privacy & Security First
- **Zero Telemetry**: No tracking, no data collection. Your subscriptions and reading habits stay on your machine.
- **Local-First Architecture**: Your entire database resides locally. Albatros works perfectly offline with all your downloaded content.
- **SSRF Network Guards**: Built-in protection against Server-Side Request Forgery, preventing malicious feeds from scanning your local network or localhost.
- **Instant Sanitization**: All incoming HTML is passed through **DOMPurify** at the ingestion layer, ensuring no malicious scripts reach your renderer.

### ⚡ Performance at Scale
- **Virtualization**: Utilizing `@tanstack/react-virtual`, the article list remains buttery smooth (60fps) even with tens of thousands of items.
- **Smart Sync Engine**: An adaptive polling system that scales fetch intervals based on update frequency and handles exponential backoff for failing feeds.
- **Bandwidth Efficiency**: Full support for **ETag** and **Last-Modified** HTTP headers to avoid re-downloading unchanged feed content.

### 🔍 Advanced Search & Organization
- **Global Search**: Powered by **SQLite FTS4** (Full-Text Search) with **Trigram tokenization**, allowing for instant, partial-word matching across your entire library.
- **Logical Grouping**: Organize feeds into custom folders with aggregate unread counts.
- **Contextual Views**: Dedicated "Unread", "Starred", "Today", and "Saved" views to keep your focus where it matters.

---

## ⌨️ Productivity & UX

Albatros is designed for "power readers." Almost every action is mapped to a keyboard shortcut for a mouse-free experience.

### Keyboard Shortcuts

| Category | Command | Key |
|---|---|---|
| **Navigation** | Next Article | `j` or `↓` |
| | Previous Article | `k` or `↑` |
| | Select Current | `Enter` / `Space` |
| **Actions** | Toggle Read/Unread | `m` |
| | Toggle Starred | `s` |
| | Open in Browser | `v` |
| | Share/Link Popup | `l` |
| **System** | Toggle Search | `/` |
| | Focus Sidebar | `q` |
| | Close Modal/Popup | `Esc` |

---

## 🛠️ Technical Architecture

Albatros follows a strict separation of concerns to maximize security and stability:

- **Main Process**: Handles the SQLite database (sql.js), the Background Sync Engine, and secure networking via `undici`.
- **Renderer Process**: A React 19 application using **Zustand** for ultra-fast state management and **CSS Modules** for scoped, performant styling.
- **Preload Script**: Acts as a secure, typed bridge between the two processes, exposing no raw Node.js APIs to the frontend.

### Tech Stack
- **Runtime**: Electron 34, Node.js 22.
- **Frontend**: React 19, Radix UI Primitives, Lucide Icons.
- **Database**: SQLite (WASM via `sql.js`) with custom Triggers and FTS4.
- **Tooling**: Vite (`electron-vite`), TypeScript, Vitest (Unit), Playwright (E2E).

---

## 📦 Getting Started

### Prerequisites
- Node.js **20+**
- npm **9+**

### Installation
```bash
# Clone the repository
git clone https://github.com/xlr-aex/albatros.git
cd albatros

# Install dependencies
npm install
```

### Development
```bash
# Start the dev server & Electron app
npm run dev
```

### Production Build
```bash
# Build for the current platform
npm run build
```

---

## 📖 Internal Documentation

For developers or advanced users wanting to dive deeper into the implementation:

- 🏗️ **[Architecture Overview](docs/architecture.md)** — Detailed IPC and process mapping. (Coming Soon)
- 🔌 **[IPC API Bridge](docs/api-ipc.md)** — Communication protocols between Main and Renderer.
- 🗄️ **[Database Schema](docs/database.md)** — Relational design and search triggers.
- 🔄 **[Sync Engine](docs/sync-engine.md)** — Polling logic and parser architecture.
- 🎨 **[UI/UX Design](docs/ui-ux.md)** — Design tokens and accessibility patterns.

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.
