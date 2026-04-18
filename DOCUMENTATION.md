# Albatros RSS Reader — Documentation

This document provides an ultra-detailed overview of the architecture, data flow, and underlying logic of the Albatros application. It is primarily intended for developers and advanced users who want to modify or understand the system at a granular level.

---

## 1. Application Architecture

Albatros is an Electron-based desktop application built using a rigid separation of concerns:

- **Main Process** (`src/main/`): Powered by Node.js, this process handles file system access, SQLite database initialization and querying (via `sql.js` WASM), the background synchronization engine, and secure outbound networking.
- **Renderer Process** (`src/renderer/`): The user interface, built with React 19 and Zustand. It operates in an isolated context where it cannot access Node.js APIs directly. The UI relies on `@tanstack/react-virtual` for virtualizing long lists of articles and `DOMPurify` to ensure all external RSS content is safely stripped of malicious scripts.
- **Preload Script** (`src/preload/`): Exposes a typed, deterministic API (via `contextBridge`) to the frontend renderer. It routes UI requests to the Main process via established IPC channels.

---

## 2. The Database Layer (SQLite via sql.js)

At its core, Albatros is an offline-first application, relying heavily on a native, locally-stored SQLite database.

### Full-Text Search (FTS4)
We use `FTS4` to guarantee instantaneous searches across tens of thousands of articles. Rather than dynamically calculating search indices in the background or during search time, Albatros uses explicit **Database Triggers** (`src/main/db/triggers.sql`). 

When an article is `INSERTED`, `UPDATED`, or `DELETED`, SQLite automatically mirrors these mutations into the hidden `articles_fts` content table. This keeps the full-text search perfectly synced with zero application-level overhead.

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
1. **Context Extraction**: Upon user prompt, the application interacts with the SQLite backend via `window.api.articles.getForDigest`. It retrieves context from thousands of recent articles based on the `timeframe` and selected feed groups (`sourceId`).
2. **System Prompts**: The AI interprets this data against strict prompts instructing it to act as an "analytical assistant". It must meticulously synthesize the provided knowledge payload and insert precise citation markers (`[ID]`).
3. **Streaming & Formatting**: Responses from the LLM stream directly into the React UI. During streaming, regex pipelines parse the `[ID]` strings and convert them into clickable HTML citation badges (using `marked` for Markdown preprocessing and `DOMPurify` to whitelist specific `href`, `class`, and `title` tags).

---

## 4. The Sync Engine

The background synchronization logic pulls XML, JSON, and Atom feeds continuously.

- **Exponential Backoff**: If a feed throws HTTP errors, the scraper dynamically lowers its refresh frequency to prevent UI blocks or being banned by standard providers.
- **Cache Invalidation**: Leverages HTTP standard headers `ETag` and `Last-Modified`. If a server returns an HTTP `304 Not Modified`, the feed parser gracefully skips the database ingestion step, keeping bandwidth ultra low.
- **SSRF Network Guards**: Albatros employs an aggressive defense mechanism within the `cross-fetch` layer, refusing any HTTP redirects or canonical requests pointing toward local network ranges (`localhost`, `127.0.0.x`, `192.168.x.x`, `10.x.x.x`) to prevent spoofing from poisoned RSS URLs.

---

## 5. Security Posture

Because Albatros ingests code from thousands of untrusted XML and HTML sources across the entire internet, we assume a zero-trust model:
1. All network requests happen exclusively in the Main Process. The Renderer cannot `fetch` random URLs.
2. The renderer uses `DOMPurify` to strip `<script>`, `onload`, and similar vector attributes out of standard articles before they are placed in `<div dangerouslySetInnerHTML />`.
3. Strict Content-Security-Policy (CSP) inside the Electron build ensures no external scripts or non-authorized images connect without explicit proxying.

---

*This document is the central hub for understanding the architecture of Albatros.*
