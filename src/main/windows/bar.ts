import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import type { BarEvent } from '@shared/types'
import { settings } from '../settingsStore'

const WIDTH = 720
const MIN_HEIGHT = 64
const MAX_HEIGHT = 640

let win: BrowserWindow | undefined
let onBlur: (() => void) | undefined

/** Called when the user clicks outside the bar (if ui.hideOnBlur). */
export function setBarBlurHandler(fn: () => void): void {
  onBlur = fn
}

export function createBar(): BrowserWindow {
  win = new BrowserWindow({
    width: WIDTH,
    height: MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.setAlwaysOnTop(true, 'pop-up-menu')
  // Links in answers open in the user's browser, never inside Orbit.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.on('blur', () => {
    if (settings.current.ui.hideOnBlur && !win?.webContents.isDevToolsOpened()) onBlur?.()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/bar/index.html`)
  else void win.loadFile(join(__dirname, '../renderer/bar/index.html'))
  return win
}

export function bar(): BrowserWindow {
  if (!win || win.isDestroyed()) return createBar()
  return win
}

export function sendToBar(e: BarEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send('bar:event', e)
}

export function showBar(): void {
  const w = bar()
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const [, h] = w.getSize()
  let x = Math.round(workArea.x + (workArea.width - WIDTH) / 2)
  let y = Math.round(workArea.y + workArea.height * 0.22)
  if (settings.current.ui.barPosition === 'cursor') {
    x = Math.min(Math.max(cursor.x - WIDTH / 2, workArea.x), workArea.x + workArea.width - WIDTH)
    y = Math.min(cursor.y + 24, workArea.y + workArea.height - h)
  }
  w.setPosition(x, y)
  w.show()
  w.focus()
}

export function hideBar(): void {
  if (win?.isVisible()) win.hide()
}

export function resizeBar(height: number): void {
  const w = bar()
  const h = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)))
  const [curW, curH] = w.getSize()
  if (curH !== h) w.setSize(curW, h)
}
