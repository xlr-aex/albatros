# Albatros RSS Reader — Documentation

This document provides an ultra-detailed overview of the architecture, data flow, and underlying logic of the Albatros application. It is primarily intended for developers and advanced users who want to modify or understand the system at a granular level.


---

## 1. Application Architecture

Albatros is an Electron-based desktop application built using a rigid separation of concerns:

- **Main Process** (`src/main/`): Powered by Node.js, this process handles file system access, SQLite database initialization and querying (via **better-sqlite3**), the background synchronization engine, and secure outbound networking (RSS and AI LLM calls).
- **Renderer Process** (`src/renderer/`): The user interface, built with React 19 and Zustand. It operates in an isolated context where it cannot access Node.js APIs or the network directly. The UI relies on `@tanstack/react-virtual` for virtualizing long lists of articles and `DOMPurify` to ensure all external RSS content is safely stripped of malicious scripts.

- **Preload Script** (`src/preload/`): Exposes a typed, deterministic API (via `contextBridge`) to the frontend renderer. It routes UI requests to the Main process via established IPC channels.

---

## 2. The Database Layer (SQLite via sql.js)

At its core, Albatros is an offline-first application, relying heavily on a native, locally-stored SQLite database.

### Full-Text Search (FTS4)
We use `FTS4` to guarantee instantaneous searches across tens of thousands of articles. Rather than duplicating content, Albatros uses an **External Content Table** configuration (`content="articles"`), making the search index ultra-efficient in terms of storage. 

Explicit **Database Triggers** (`src/main/db/triggers.sql`) maintain synchronization:
When an article is `INSERTED`, `UPDATED`, or `DELETED`, SQLite automatically mirrors these mutations into the virtual `articles_fts` table. This keeps the full-text search perfectly synced with zero application-level overhead.


### Denormalization and Metrics
Computing `unread_count` for feeds dynamically via a `SELECT COUNT(*)` on every UI render is computationally expensive. Albatros denormalizes this data:
- The `feeds` table contains an `unread_count` column.
- Highly optimized SQLite triggers automatically increment/decrement this column whenever an article's `is_read` flag mutations occur or when new unread articles are scraped.

---

## 3. The RAG AI Assistant (AiDigestView)

Albatros features a sophisticated, completely local **Retrieval-Augmented Generation (RAG)** pipeline to interact with your RSS feeds mathematically using AI.

### Local LLM Integration
The `AiDigestView.tsx` limits external dependencies by supporting local API providers out of the box:
- **LM Studio** (`http://127.0.0.1:1234/v1`)
- **Ollama** (`http://127.0.0.1:11434/api`)

### How The Digest Works:
1. **Context Extraction**: Upon user prompt, the application interacts with the SQLite backend (via IPC) to retrieve context from thousands of recent articles based on the `timeframe` and selected feed groups (`sourceId`).
2. **Secure IPC Stream**: The Renderer never fetches LLM data directly. Instead, it sends a request to the Main Process, which manages the network stream to LM Studio or Ollama. This ensures the Renderer remains isolated from the network.
3. **System Prompts**: The AI interprets this data against strict prompts instructing it to act as an "analytical assistant". It must meticulously synthesize the provided knowledge payload and insert precise citation markers (`[ID]`).
4. **Streaming & Formatting**: Text chunks stream from the Main Process to the React UI via IPC events. During streaming, regex pipelines parse the `[ID]` strings and convert them into clickable HTML citation badges.


---

## 4. The Sync Engine

The background synchronization logic pulls XML, JSON, and Atom feeds continuously.

- **Exponential Backoff**: If a feed throws HTTP errors, the scraper dynamically lowers its refresh frequency to prevent UI blocks or being banned by standard providers.
- **Cache Invalidation**: Leverages HTTP standard headers `ETag` and `Last-Modified`. If a server returns an HTTP `304 Not Modified`, the feed parser gracefully skips the database ingestion step, keeping bandwidth ultra low.
- **SSRF Network Guards**: Albatros employs an aggressive defense mechanism within the `cross-fetch` layer, refusing any HTTP redirects or canonical requests pointing toward local network ranges (`localhost`, `127.0.0.x`, `192.168.x.x`, `10.x.x.x`) to prevent spoofing from poisoned RSS URLs.

---

## 5. Security Posture

Because Albatros ingests code from thousands of untrusted XML and HTML sources across the entire internet, we assume a zero-trust model:
1. **Zero-Network Renderer**: 100% of network requests (RSS Sync AND AI LLM calls) happen exclusively in the Main Process. The Renderer cannot `fetch` anything.
2. The renderer uses `DOMPurify` to strip `<script>`, `onload`, and similar vector attributes out of standard articles.
3. Strict Content-Security-Policy (CSP) ensures no external connections or scripts can be executed within the UI context.
4. `webSecurity` is strictly enabled, with no CORS or network bypasses allowed for the Renderer process.


---

*This document is the central hub for understanding the architecture of Albatros.*
