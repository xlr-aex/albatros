/**
 * @file services/LayaRuntimeService.ts
 * @description Self-contained Python runtime bootstrap for the local Laya workers.
 *
 * Nothing is installed system-wide.  On the first Laya use Windows downloads a
 * small embeddable Python distribution into Albatros' user-data directory, then
 * installs the worker dependencies there.  Subsequent launches reuse it.
 */

import { app } from 'electron'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PYTHON_VERSION = '3.10.11'
const PYTHON_ZIP_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'
const REQUIREMENTS = [
  'laya==0.4.7',
  'fastapi==0.115.8',
  'uvicorn==0.30.6',
  'sentence-transformers==6.1.0',
]

function run(executable: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `Le programme s'est arrêté avec le code ${code ?? 'inconnu'}.`))
    })
  })
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Téléchargement impossible (${response.status}).`)
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()))
}

export class LayaRuntimeService {
  private installPromise: Promise<string> | null = null

  private get root(): string {
    return path.join(app.getPath('userData'), 'laya-runtime')
  }

  private get python(): string {
    return path.join(this.root, process.platform === 'win32' ? 'python.exe' : 'bin', process.platform === 'win32' ? '' : 'python3')
  }

  private get readyMarker(): string {
    return path.join(this.root, '.albatros-laya-ready')
  }

  /** Resolves the private interpreter after creating it when required. */
  ensure(): Promise<string> {
    if (existsSync(this.python) && existsSync(this.readyMarker)) return Promise.resolve(this.python)
    if (!this.installPromise) this.installPromise = this.install()
    return this.installPromise
  }

  private async install(): Promise<string> {
    if (process.platform !== 'win32') {
      throw new Error('Le runtime Laya intégré est actuellement disponible pour Windows uniquement.')
    }

    await fs.mkdir(this.root, { recursive: true })
    const zipPath = path.join(this.root, 'python-embed.zip')
    const getPipPath = path.join(this.root, 'get-pip.py')

    try {
      await download(PYTHON_ZIP_URL, zipPath)
      await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${this.root.replace(/'/g, "''")}' -Force`,
      ], this.root)

      // The embeddable distribution intentionally disables site-packages.
      // Enable only its private site-packages directory; no system Python leaks in.
      const pthPath = path.join(this.root, 'python310._pth')
      const pth = await fs.readFile(pthPath, 'utf8')
      await fs.writeFile(pthPath, `${pth.replace(/^#?import site\s*$/m, 'import site')}\nLib\\site-packages\n`)

      await download(GET_PIP_URL, getPipPath)
      await run(this.python, [getPipPath, '--disable-pip-version-check'], this.root)
      await run(this.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', ...REQUIREMENTS], this.root)
      await fs.writeFile(this.readyMarker, `${PYTHON_VERSION}\n`, 'utf8')
      return this.python
    } finally {
      await Promise.all([fs.unlink(zipPath).catch(() => {}), fs.unlink(getPipPath).catch(() => {})])
    }
  }
}
