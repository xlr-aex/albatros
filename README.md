<div align="center">
  <img src="docs/assets/logo.png" alt="Albatros Logo" width="160" />

  # Albatros RSS Reader
</div>

[![Electron](https://img.shields.io/badge/Electron-34.x-blue?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react&logoColor=white)](https://reactjs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-FTS4-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Albatros** is a privacy-native desktop RSS/Atom/JSON feed reader. Designed for users who value speed, local-first data ownership, and a clean, 3-pane reading experience reminiscent of classical readers. 

Built on a robust foundation of **Electron**, **React 19**, and **better-sqlite3**, Albatros offers a high-performance, disk-backed database architecture. This ensures seamless bridge between the traditional web and a modern, offline-first desktop application, enhanced with an advanced local AI-powered RAG (Retrieval-Augmented Generation) assistant.

---

## 🚀 Key Features

### 🛡️ Privacy & Security First
- **Zero Telemetry**: No tracking, no data collection. Your subscriptions and reading habits stay entirely on your machine.
- **Local-First Architecture**: Your entire database resides locally. Albatros works perfectly offline with all your downloaded content.
- **SSRF Network Guards**: Built-in protection against Server-Side Request Forgery, preventing malicious feeds from scanning your local network or localhost endpoints.
- **Instant Sanitization**: All incoming HTML is passed through **DOMPurify** at the rendering layer, ensuring no malicious scripts can ever be executed.

### 🤖 Built-In AI Digest & RAG Capabilities
- **Local LLM Integration**: Connect directly to your local models using either **LM Studio** or **Ollama**, completely offline.
- **Retrieval-Augmented Generation (RAG)**: Use the "AiDigestView" to chat with your feeds. The system performs a deep scan of up to your last 10,000 articles using SQLite FTS4.
- **Strict Sourcing & Citations**: The AI Assistant is instructed to meticulously cite its sources. Clickable citation badges (e.g., `[123]`) route you directly to the exact article referenced in your database.
- **Custom Prompts**: Set customized instructions for summaries or news digests directly via your settings.

### ⚡ Technical Excellence
- **Hardware-Accelerated Virtualization**: Utilizing `@tanstack/react-virtual`, the UI is buttery smooth (60 FPS) rendering tens of thousands of items simultaneously.
- **Smart Sync Engine**: An adaptive polling system that scales fetch intervals based on update frequency and handles exponential backoff for failing feeds.
- **Bandwidth Efficiency**: Full support for `ETag` and `Last-Modified` HTTP headers to avoid re-downloading unchanged feed content.

### 🔍 Advanced Search & Organization
- **Global Search**: Powered by **SQLite FTS4** (Full-Text Search), providing instant semantic matching across your entire library.
- **Triggers-Driven Metrics**: Unread counts are computed via SQLite triggers for zero-overhead metrics calculation during render.
- **Contextual Views**: Dedicated "Unread", "Starred", "Today", and "Saved" views to keep your focus where it matters.
- **Reddit Native Comments**: Automatically fetches and renders Reddit comments for posts directly inside the article reader.

---

## ⌨️ Productivity & UX

Albatros is designed for "power readers." Almost every action is mapped to a keyboard shortcut for a mouse-free experience.

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

- **Main Process**: Handles the SQLite database (**better-sqlite3**), the Background Sync Engine, and secure networking via native `fetch` and custom FTS logic. Every network request, including those for AI models, is executed securely in this process.
- **Renderer Process**: A React 19 application using **Zustand** for state management and DOMPurify for HTML sanitization.
- **Preload Script**: Acts as a secure, typed bridge between the two processes, exposing no raw Node.js APIs to the frontend.

For a comprehensive technical deep-dive, see the official documentation.

👉 **[Go to DOCUMENTATION.md](./DOCUMENTATION.md)**

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

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.
