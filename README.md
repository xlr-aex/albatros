<img width="2172" height="724" alt="image" src="https://github.com/user-attachments/assets/0346e921-2e8c-4371-9ff7-54567759fbbb" />


  **A private, local-first desktop feed reader.**

  > [!WARNING]
  > Albatros is actively under construction. Features, the data model, and the MCP interface may change between releases. Use release builds with care and keep a backup of your local database.

  RSS · Atom · JSON Feed · Reddit

  <br />

[![Download for Windows](https://img.shields.io/badge/Download_for_Windows-Latest_Release-238636?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/xlr-aex/albatros/releases/latest)

  <br />

  [![Electron](https://img.shields.io/badge/Electron-34-1f2430?style=for-the-badge&logo=electron&logoColor=9feaf9)](https://www.electronjs.org/)
  [![React](https://img.shields.io/badge/React-19-1f2430?style=for-the-badge&logo=react&logoColor=61dafb)](https://react.dev/)
  [![SQLite](https://img.shields.io/badge/SQLite-Local-1f2430?style=for-the-badge&logo=sqlite&logoColor=44a2d9)](https://sqlite.org/)
  [![License](https://img.shields.io/badge/License-MIT-1f2430?style=for-the-badge)](LICENSE)

  <br />

  [Features](#features) · [Installation](#installation) · [Local Laya folders](#local-laya-folders) · [MCP server](#mcp-server) · [Documentation](#documentation)
</div>

---

<img width="1917" height="977" alt="image" src="https://github.com/user-attachments/assets/5ceaf7f3-2e58-4432-b1c4-f681dd6d75a2" />

---

Albatros keeps subscriptions, downloaded articles and reading state on your computer. It combines a focused three-pane interface with reliable synchronisation, rich Reddit support and local Laya sorting—without requiring an account or hosted backend.

## Features

| Reading | Media |
|---|---|
| Clean three-pane desktop layout | Responsive, high-quality article images |
| Feed folders and unread counters | Reddit comments and HLS video playback |
| Saved posts and full-text search | Lazy loading with reliable fallbacks |
| Offline access to downloaded content | Embedded browser with ad blocking |
| GitHub links, repositories and issue feeds | Inline previews for linked content |

| Sync | Local classification |
|---|---|
| RSS, Atom, JSON Feed and Reddit | Local SQLite database |
| Adaptive scheduling and HTTP caching | No telemetry |
| Rate-limit-aware Reddit queue | No Albatros cloud service |
| OPML import and export | Laya folders and on-device sorting |

## Advanced search

The search field supports a compact query language for finding articles in your local library. Plain terms are prefix-matched, and the operators below can be combined in one query.

| Operator | Example | Meaning |
|---|---|---|
| Word | `ransomware` | Find a word. |
| Exact phrase | `"data breach"` | Find those words together in that order. |
| Exclusion | `ransomware -bitcoin` | Exclude a word. |
| Either | `LockBit OR Akira` | Match either clause. |
| Both | `ransomware AND france` | Require both clauses. Whitespace also implies `AND`. |
| Grouping | `(LockBit OR Akira) france` | Control boolean precedence. |
| Phrase wildcard | `"ransomware * hospital"` | Match the terms close together, with a short gap allowed between them. |
| Before a date | `before:2026-01-01` | Articles published before the given day. |
| After a date | `after:2026-01-01` | Articles published on or after the given day. |
| Year range | `ransomware 2025..2026` | Restrict results to an inclusive year range. |

Negative clauses filter results but are not highlighted. Positive terms and phrases are highlighted in the list and article reader.

## Installation

<div align="center">

### Download Albatros

| Windows | macOS | Linux |
|:---:|:---:|:---:|
| [![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-238636?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/xlr-aex/albatros/releases/latest) | [![macOS](https://img.shields.io/badge/macOS-DMG-1f2430?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/xlr-aex/albatros/releases/latest) | [![Linux](https://img.shields.io/badge/Linux-AppImage-FCC624?style=for-the-badge&logo=linux&logoColor=111111)](https://github.com/xlr-aex/albatros/releases/latest) |
| `.exe` installer | `.dmg` disk image | Portable `.AppImage` |

[View all releases →](https://github.com/xlr-aex/albatros/releases)

</div>

Download the file for your platform from the latest release. On Linux, make the AppImage executable before opening it: `chmod +x Albatros-*.AppImage`.

### Development

Node.js 20 or 22 LTS and npm 9+ are recommended.

```bash
git clone https://github.com/xlr-aex/albatros.git
cd albatros
npm install
npm run dev
```

<div align="center">

| Development | Verification | Production |
|:---:|:---:|:---:|
| `npm run dev` | `npm run test:unit` | `npm run build` |
| Start Electron and Vite | Run the unit suite | Create the application build |

</div>

## Local Laya folders

Laya folders sort new posts locally according to rules you define. Create a folder from **Laya folders**, select its source groups or individual feeds, then let the background worker evaluate new posts for each matching folder independently. A post may therefore appear in several folders. The top gauge shows overall progress; each folder card shows its own source-scope progress. Laya does not require an external model runtime.

The first use on Windows downloads a private Python runtime and the local Laya dependencies into Albatros’ application-data directory. Nothing is installed system-wide. See [Laya folders](docs/laya-folders.md) for scope rules, controls and troubleshooting.

<img width="1892" height="667" alt="image" src="https://github.com/user-attachments/assets/397b9709-1a84-43c7-bb09-8a63df8967ca" />

<img width="1917" height="1012" alt="image" src="https://github.com/user-attachments/assets/a928dea5-781a-4645-b898-ce14f186eff0" />

## MCP server

Albatros starts an authenticated, local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server with the desktop application. It lets an MCP client search your locally stored feed library and, when explicitly requested, manage source groups, feeds, and Laya folders.

| Setting | Value |
|---|---|
| Endpoint | `http://127.0.0.1:8765/mcp` |
| Authentication | `Authorization: Bearer <token>` |
| Default exposure | Loopback only (this computer) |

The application prints a bearer token to its terminal when it starts. To use a stable token, set `ALBATROS_MCP_TOKEN` to a value of at least 24 characters before launching Albatros. You can also change the port with `ALBATROS_MCP_PORT`.

```json
{
  "mcpServers": {
    "albatros": {
      "serverUrl": "http://127.0.0.1:8765/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ALBATROS_TOKEN"
      }
    }
  }
}
```

Available read-only tools cover source-group and feed discovery, post search, recent posts, post details, Laya status and folders, and a technology radar. Separate tools can create source groups and feeds or create and update Laya folders. Do not expose the local MCP port to the public internet; keep the token private. For client-specific setup and usage examples, see the [MCP guide](docs/mcp.md).


## Keyboard navigation

| Previous article | Next article | Close dialog |
|:---:|:---:|:---:|
| `k` or `↑` | `j` or `↓` | `Esc` |

## Documentation

| Start here | Technical guides | Help |
|---|---|---|
| [Documentation overview](DOCUMENTATION.md) | [Development](docs/development.md) | [Troubleshooting](docs/troubleshooting.md) |
| [UI and accessibility](docs/ui-ux.md) | [Sync engine](docs/sync-engine.md) | [Media and Reddit](docs/media-and-reddit.md) |
| [Laya folders](docs/laya-folders.md) | [Database](docs/database.md) · [IPC API](docs/api-ipc.md) | |

## Data and privacy

The database is stored locally as `albatros.db` in Electron's application-data directory. Albatros does not collect telemetry. Close the application before manually copying the database for backup.

## Contributing

```bash
npm run lint
npm run build:check
npm run test:unit
npm run build
```

Keep privileged operations in the Electron main process, expose only narrow methods through the preload bridge, and include focused tests with behavioural changes.

## License

Released under the [MIT License](LICENSE).
