<img width="2172" height="724" alt="image" src="https://github.com/user-attachments/assets/0346e921-2e8c-4371-9ff7-54567759fbbb" />


  **A desktop feed reader that keeps your data on your computer.**

  > [!WARNING]
  > Albatros is under development. Features, database fields, and the MCP interface can change. Back up your local database before you install a new release.

  RSS · Atom · JSON Feed · Reddit · YouTube channels

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

Albatros stores your feeds, downloaded articles, and reading state on your computer. Use the three-pane interface to read feeds and public YouTube channels. You can still read Reddit posts already stored in your database. Laya folders sort posts on your computer. You do not need an account or an Albatros server.

> [!NOTE]
> Reddit ended RSS feed support on November 13, 2026. Existing Reddit posts remain in your local database, but new Reddit posts may no longer sync. See [Reddit feed troubleshooting](docs/troubleshooting.md#reddit-feeds-show-http-429-or-remain-empty).

## Features

| Reading | Media |
|---|---|
| Clean three-pane desktop layout | Responsive, high-quality article images |
| Feed folders and unread counters | Reddit comments and HLS video playback |
| Editable feed name and URL | YouTube channel video posts |
| Saved posts and full-text search | Lazy loading with reliable fallbacks |
| Offline access to downloaded content | Embedded browser with ad blocking |
| GitHub links, repositories and issue feeds | Inline previews for linked content |

| Sync | Local classification |
|---|---|
| RSS, Atom, JSON Feed and YouTube channels | Local SQLite database |
| Adaptive scheduling and HTTP caching | No telemetry |
| Rate-limit-aware Reddit queue | No Albatros cloud service |
| OPML import and export | Laya folders and on-device sorting |

## Advanced search

Use the search field to find articles stored on your computer. A plain word also finds words that start with the same letters. You can use more than one operator in a query.

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

Excluded words filter results. The list and reader highlight matched words and phrases, but they do not highlight excluded words.

## Installation

<div align="center">

### Download Albatros

| Windows | macOS | Linux |
|:---:|:---:|:---:|
| [![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-238636?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/xlr-aex/albatros/releases/latest) | [![macOS](https://img.shields.io/badge/macOS-DMG-1f2430?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/xlr-aex/albatros/releases/latest) | [![Linux](https://img.shields.io/badge/Linux-AppImage-FCC624?style=for-the-badge&logo=linux&logoColor=111111)](https://github.com/xlr-aex/albatros/releases/latest) |
| `.exe` installer | `.dmg` disk image | Portable `.AppImage` |

[View all releases →](https://github.com/xlr-aex/albatros/releases)

</div>

Download the file for your system from the latest release. On Linux, make the AppImage executable before you open it: `chmod +x Albatros-*.AppImage`.

To add a YouTube channel, enter a public channel URL such as `https://www.youtube.com/@handle`. Albatros reads the public video list if the RSS feed is not available. If YouTube shows a consent or anti-bot page, open the channel in the built-in browser and try again. To change a feed name or URL, open **Feed Properties**. When you change a URL, Albatros keeps the articles already stored and refreshes the feed.

### Development

Use Node.js 20 or 22 LTS and npm 9 or later.

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

Laya folders sort new posts on your computer. Create a folder in **Laya folders**. Then select source groups or individual feeds. Albatros checks each post against each applicable folder rule. A post can appear in more than one folder. The top progress bar shows all Laya work. Each folder shows its own progress. Laya does not need a separate model service.

The first time you use Laya on Windows, Albatros downloads Python and the required Laya files into its application-data directory. It does not change the system Python installation. See [Laya folders](docs/laya-folders.md) for source rules, controls, and fault finding.

<img width="1892" height="667" alt="image" src="https://github.com/user-attachments/assets/397b9709-1a84-43c7-bb09-8a63df8967ca" />

<img width="1917" height="1012" alt="image" src="https://github.com/user-attachments/assets/a928dea5-781a-4645-b898-ce14f186eff0" />

## MCP server

Albatros starts a local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server when the desktop application starts. An MCP client can search articles stored on your computer. It can also manage source groups, feeds, and Laya folders when you request these actions.

| Setting | Value |
|---|---|
| Endpoint | `http://127.0.0.1:8765/mcp` |
| Authentication | `Authorization: Bearer <token>` |
| Default exposure | Loopback only (this computer) |

Albatros prints a bearer token in its terminal at startup. To use the same token each time, set `ALBATROS_MCP_TOKEN` to at least 24 characters before you start Albatros. To change the port, set `ALBATROS_MCP_PORT`.

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

Read-only tools list groups and feeds, search posts, show recent posts and post details, report Laya status, and provide a technology radar. Other tools create groups and feeds or change Laya folders. Keep the token private. Do not expose the MCP port to the internet. See the [MCP guide](docs/mcp.md) for client setup and examples.


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

See the [changelog](CHANGELOG.md) for release highlights.

## Data and privacy

Albatros stores `albatros.db` in Electron's application-data directory. Albatros does not collect telemetry. Close the application before you copy the database for a backup.

## Contributing

```bash
npm run lint
npm run build:check
npm run test:unit
npm run build
```

Keep network, file, and database operations in the Electron main process. Expose only the required methods through the preload bridge. Add focused tests when you change behavior.

## License

Released under the [MIT License](LICENSE).
