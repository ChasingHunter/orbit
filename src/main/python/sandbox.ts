import { app, BrowserWindow, net, protocol, session } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { paths } from '../paths'
import { logInfo } from '../log'

// Runs Python (Pyodide, compiled to WebAssembly) in a hidden, sandboxed Chromium page: the same
// isolation a website gets. The page has no Node, no file access, and every network request is
// blocked. Its only source is the orbit-py: scheme below, which serves Pyodide itself and the
// packages listed in Pyodide's lock file. Packages are downloaded once by Orbit (checked against
// the lock file's SHA-256) and cached, so Python can't use the scheme to reach anything else.
// Each run gets a fresh page, so nothing carries over between runs.

const SCHEME = 'orbit-py'
const PARTITION = 'orbit-python'
const CORE = new Set(['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'])

type LockPackage = { file_name: string; sha256: string; imports: string[] }

let pyodideDir = ''
let version = ''
let lock: Record<string, LockPackage> = {}
let byFile = new Map<string, LockPackage>()

/** Call before app ready: the scheme needs fetch and CORS support for Pyodide's loader. */
export function registerPythonScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
}

function load(): void {
  if (pyodideDir) return
  pyodideDir = dirname(createRequire(__filename).resolve('pyodide/package.json'))
  version = (JSON.parse(readFileSync(join(pyodideDir, 'package.json'), 'utf8')) as { version: string }).version
  lock = (JSON.parse(readFileSync(join(pyodideDir, 'pyodide-lock.json'), 'utf8')) as { packages: Record<string, LockPackage> }).packages
  byFile = new Map(Object.values(lock).map((p) => [p.file_name, p]))
}

const cacheDir = (): string => join(paths.models, 'pyodide', version)

const RUNNER = `<!doctype html><meta charset="utf-8"><script type="module">
import { loadPyodide } from './pyodide.mjs'
window.runPython = async (job) => {
  const out = []
  const py = await loadPyodide({ indexURL: '${SCHEME}://pyodide/', stdout: (s) => out.push(s), stderr: (s) => out.push(s) })
  py.FS.mkdirTree('/in'); py.FS.mkdirTree('/out')
  for (const f of job.files) py.FS.writeFile('/in/' + f.name, Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)))
  let result = null, error = null
  try {
    py.runPython("import os; os.environ['MPLBACKEND'] = 'Agg'; os.chdir('/out')")
    await py.loadPackagesFromImports(job.code, { messageCallback: () => {} })
    const value = await py.runPythonAsync(job.code)
    if (value !== undefined && value !== null) result = String(value?.toString?.() ?? value)
  } catch (e) {
    // Drop Pyodide's own frames: the traceback that matters starts at the user's code.
    const lines = String(e.message ?? e).split('\\n').filter(Boolean)
    const own = lines.findIndex((l) => l.includes('File "<exec>"'))
    error = (own >= 0 ? lines.slice(own) : lines.slice(-6)).slice(-12).join('\\n')
  }
  const files = []
  const walk = (dir, rel) => {
    for (const name of py.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue
      const p = dir + '/' + name, r = rel ? rel + '/' + name : name
      if (py.FS.isDir(py.FS.stat(p).mode)) walk(p, r)
      else {
        const bytes = py.FS.readFile(p)
        let bin = ''
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        files.push({ name: r, b64: btoa(bin) })
      }
    }
  }
  walk('/out', '')
  return { output: out.join('\\n'), result, error, files }
}
window.ready = true
</script>`

async function serve(req: Request): Promise<Response> {
  const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
  if (name === 'runner.html') return new Response(RUNNER, { headers: { 'content-type': 'text/html' } })
  if (CORE.has(name)) {
    const type = name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.mjs') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : 'application/zip'
    return new Response(readFileSync(join(pyodideDir, name)), { headers: { 'content-type': type } })
  }
  const pkg = byFile.get(name)
  if (!pkg) return new Response('not found', { status: 404 })
  return new Response(await cachedPackage(pkg), { headers: { 'content-type': 'application/zip' } })
}

/** Downloads a package from Pyodide's CDN the first time, checks its hash, and keeps it. */
async function cachedPackage(pkg: LockPackage): Promise<Buffer> {
  const file = join(cacheDir(), pkg.file_name)
  if (existsSync(file)) return readFileSync(file)
  const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${pkg.file_name}`
  const t0 = Date.now()
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`Couldn't download ${pkg.file_name} (${res.status})`)
  const data = Buffer.from(await res.arrayBuffer())
  if (createHash('sha256').update(data).digest('hex') !== pkg.sha256) throw new Error(`${pkg.file_name} didn't match its checksum`)
  mkdirSync(cacheDir(), { recursive: true })
  writeFileSync(file + '.part', data)
  renameSync(file + '.part', file)
  logInfo(`python: cached ${pkg.file_name} (${Math.round(data.length / 1e6)} MB) in ${Date.now() - t0} ms`)
  return data
}

let prepared = false
function prepare(): Electron.Session {
  load()
  const ses = session.fromPartition(PARTITION)
  if (prepared) return ses
  prepared = true
  ses.protocol.handle(SCHEME, (req) => serve(req).catch((err: Error) => new Response(err.message, { status: 502 })))
  // Nothing but orbit-py: gets out of this page.
  ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !details.url.startsWith(`${SCHEME}:`) }))
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  return ses
}

export type PythonJob = { code: string; files: { name: string; data: Buffer }[]; timeoutMs: number; memoryMb: number }
export type PythonResult = { output: string; result: string | null; error: string | null; files: { name: string; data: Buffer }[] }

export async function runPython(job: PythonJob, signal?: AbortSignal): Promise<PythonResult> {
  const ses = prepare()
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  let stop: ((why: string) => void) | undefined
  const stopped = new Promise<never>((_, reject) => (stop = (why) => reject(new Error(why))))
  const timer = setTimeout(() => stop?.(`Stopped after ${job.timeoutMs / 1000} s (the time limit)`), job.timeoutMs)
  const onAbort = (): void => stop?.('Cancelled')
  signal?.addEventListener('abort', onAbort)
  // Memory: the page's process is checked twice a second and stopped if it grows past the limit.
  const watch = setInterval(() => {
    const pid = win.isDestroyed() ? 0 : win.webContents.getOSProcessId()
    const kb = app.getAppMetrics().find((m) => m.pid === pid)?.memory.workingSetSize ?? 0
    if (kb > job.memoryMb * 1024) stop?.(`Stopped: used more than ${job.memoryMb} MB of memory`)
  }, 500)
  try {
    const run = (async () => {
      await win.loadURL(`${SCHEME}://pyodide/runner.html`)
      await win.webContents.executeJavaScript('new Promise((r) => { const t = setInterval(() => window.ready && (clearInterval(t), r()), 20) })')
      const payload = { code: job.code, files: job.files.map((f) => ({ name: f.name, b64: f.data.toString('base64') })) }
      return (await win.webContents.executeJavaScript(`runPython(${JSON.stringify(payload)})`)) as {
        output: string
        result: string | null
        error: string | null
        files: { name: string; b64: string }[]
      }
    })()
    run.catch(() => {}) // after a stop, the page's promise fails when the window closes
    const r = await Promise.race([run, stopped])
    return { output: r.output, result: r.result, error: r.error, files: r.files.map((f) => ({ name: f.name, data: Buffer.from(f.b64, 'base64') })) }
  } finally {
    clearTimeout(timer)
    clearInterval(watch)
    signal?.removeEventListener('abort', onAbort)
    if (!win.isDestroyed()) win.destroy()
  }
}

/** For the Setup page: how much the package cache holds. */
export function pythonCacheDir(): string {
  load()
  return cacheDir()
}
