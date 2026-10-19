<img width="2172" height="724" alt="image" src="https://github.com/user-attachments/assets/0346e921-2e8c-4371-9ff7-54567759fbbb" />


  **A private, local-first desktop feed reader.**

  RSS · Atom · JSON Feed · Reddit

  <br />

[![Download for Windows](https://img.shields.io/badge/Download_for_Windows-Latest_Release-238636?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/xlr-aex/albatros/releases/latest)

  <br />

  [![Electron](https://img.shields.io/badge/Electron-34-1f2430?style=for-the-badge&logo=electron&logoColor=9feaf9)](https://www.electronjs.org/)
  [![React](https://img.shields.io/badge/React-19-1f2430?style=for-the-badge&logo=react&logoColor=61dafb)](https://react.dev/)
  [![SQLite](https://img.shields.io/badge/SQLite-Local-1f2430?style=for-the-badge&logo=sqlite&logoColor=44a2d9)](https://sqlite.org/)
  [![License](https://img.shields.io/badge/License-MIT-1f2430?style=for-the-badge)](LICENSE)

  <br />

  [Features](#features) · [Installation](#installation) · [Local Laya folders](#local-laya-folders) · [Documentation](#documentation)
</div>

---

<img width="1917" height="992" alt="image" src="https://github.com/user-attachments/assets/ac4bbd3b-2009-49f3-b1f4-aa69ac1a1b03" />

---

Albatros keeps subscriptions, downloaded articles and reading state on your computer. It combines a focused three-pane interface with reliable synchronisation, rich Reddit support and local Laya sorting—without requiring an account or hosted backend.

## Features

| Reading | Media |
|---|---|
| Clean three-pane desktop layout | Responsive, high-quality article images |
| Feed folders and unread counters | Reddit comments and HLS video playback |
| Saved posts and full-text search | Lazy loading with reliable fallbacks |
| Offline access to downloaded content | Embedded browser with ad blocking |

| Sync | Local classification |
|---|---|
| RSS, Atom, JSON Feed and Reddit | Local SQLite database |
| Adaptive scheduling and HTTP caching | No telemetry |
| Rate-limit-aware Reddit queue | No Albatros cloud service |
| OPML import and export | Laya folders and on-device sorting |

## Installation

<div align="center">

### Télécharger Albatros

| Windows | macOS | Linux |
|:---:|:---:|:---:|
| [![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-238636?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/xlr-aex/albatros/releases/latest) | [![macOS](https://img.shields.io/badge/macOS-DMG-1f2430?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/xlr-aex/albatros/releases/latest) | [![Linux](https://img.shields.io/badge/Linux-AppImage-FCC624?style=for-the-badge&logo=linux&logoColor=111111)](https://github.com/xlr-aex/albatros/releases/latest) |
| Installeur `.exe` | Image disque `.dmg` | Application portable `.AppImage` |

[Voir toutes les versions →](https://github.com/xlr-aex/albatros/releases)

</div>

Téléchargez le fichier correspondant à votre système depuis la dernière release. Sous Linux, rendez le fichier AppImage exécutable avant de l’ouvrir : `chmod +x Albatros-*.AppImage`.

### Développement

Node.js 20 ou 22 LTS et npm 9+ sont recommandés.

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

Laya folders sort new posts locally according to rules you define. Create a folder from **Laya folders**, select its source groups or individual feeds, then let the background worker classify new posts. The top gauge shows overall progress; each folder card shows its own source-scope progress. The former Chatbot and external local-model configuration are no longer part of Albatros.

The first use on Windows downloads a private Python runtime and the local Laya dependencies into Albatros’ application-data directory. Nothing is installed system-wide. See [Laya folders](docs/laya-folders.md) for scope rules, controls and troubleshooting.

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
