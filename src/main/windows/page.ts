import { BrowserWindow, session } from 'electron'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join } from 'node:path'

// Pages Orbit makes (charts, small tools, dashboards) open in their own window that's locked
// down like a website with nothing to talk to: scripts run, but there's no Node, no network
// (every request except this page's own scheme is blocked), no popups and no navigation away.
// A copy of Chart.js is served at orbit-page://lib/chart.js so charts work offline.

const SCHEME = 'orbit-page'
const PARTITION = 'orbit-pages'

/** Registered before app ready, in the same call as the other custom schemes. */
export const pageScheme: Electron.CustomScheme = { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }

const files = new Map<string, string>()
let ready = false

function prepare(): Electron.Session {
  const ses = session.fromPartition(PARTITION)
  if (ready) return ses
  ready = true
  // The package's main file sits in dist/, next to the browser build.
  const chart = join(dirname(createRequire(__filename).resolve('chart.js')), 'chart.umd.min.js')
  ses.protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url)
    if (url.host === 'lib' && url.pathname === '/chart.js') return new Response(readFileSync(chart), { headers: { 'content-type': 'text/javascript' } })
    const file = files.get(url.host)
    if (!file || url.pathname !== `/${encodeURIComponent(basename(file))}`) return new Response('not found', { status: 404 })
    const html = readFileSync(file, 'utf8')
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Belt and braces with the request blocker below: nothing leaves this page.
        'content-security-policy': `default-src ${SCHEME}: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; form-action 'none'; frame-src 'none'`
      }
    })
  })
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(orbit-page|data|blob|devtools):/.test(d.url) }))
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  return ses
}

export function openPage(file: string): BrowserWindow {
  if (extname(file).toLowerCase() !== '.html') throw new Error('Only .html pages open here')
  const ses = prepare()
  const id = `p${files.size + 1}`
  files.set(id, file)
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    title: basename(file),
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  void win.loadURL(`${SCHEME}://${id}/${encodeURIComponent(basename(file))}`)
  return win
}
