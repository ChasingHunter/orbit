import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { DashPage } from '@shared/dash'

let win: BrowserWindow | undefined

export function dashboardWindow(): BrowserWindow | undefined {
  return win && !win.isDestroyed() ? win : undefined
}

export function openDashboard(page?: DashPage): void {
  const existing = dashboardWindow()
  if (existing) {
    if (page) existing.webContents.send('dash:navigate', page)
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }
  win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Orbit',
    backgroundColor: '#18181b',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/dashboard/index.html${page ? `#${page}` : ''}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/dashboard/index.html'), { hash: page })
  }
  win.once('ready-to-show', () => win?.show())
}

export function notifyDashboard(what: 'integrations' | 'tasks' | 'memory' | 'history' | 'settings' | 'workflows' | 'logs' | 'projects'): void {
  dashboardWindow()?.webContents.send('dash:changed', what)
}
