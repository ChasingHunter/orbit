import { BrowserWindow, desktopCapturer, ipcMain, screen, type NativeImage } from 'electron'
import { join } from 'node:path'

export type Snip = { base64: string; width: number; height: number }
type Rect = { x: number; y: number; width: number; height: number }

// Vision models downscale large images anyway; keep payloads small.
const MAX_EDGE = 1568

async function captureDisplay(display: Electron.Display): Promise<NativeImage> {
  const { width, height } = display.size
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * display.scaleFactor), height: Math.round(height * display.scaleFactor) }
  })
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!src) throw new Error('No screen source available')
  return src.thumbnail
}

function shrink(img: NativeImage): NativeImage {
  const { width, height } = img.getSize()
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  return scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }) : img
}

/**
 * Freezes the display under the cursor, lets the user drag a region, returns it as PNG.
 * Resolves undefined if cancelled (Esc / right-click).
 */
export async function snipRegion(): Promise<Snip | undefined> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const full = await captureDisplay(display)

  const win = new BrowserWindow({
    ...display.bounds,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    enableLargerThanScreen: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/snip/index.html`)
  else await win.loadFile(join(__dirname, '../renderer/snip/index.html'))
  win.webContents.send('snip:image', full.toDataURL())
  win.show()
  win.focus()

  const rect = await new Promise<Rect | null>((resolve) => {
    const onDone = (e: Electron.IpcMainEvent, r: Rect | null): void => {
      if (e.sender !== win.webContents) return
      ipcMain.off('snip:done', onDone)
      resolve(r)
    }
    ipcMain.on('snip:done', onDone)
    win.on('closed', () => {
      ipcMain.off('snip:done', onDone)
      resolve(null)
    })
  })
  if (!win.isDestroyed()) win.destroy()
  if (!rect || rect.width < 4 || rect.height < 4) return undefined

  const s = display.scaleFactor
  const cropped = shrink(
    full.crop({
      x: Math.round(rect.x * s),
      y: Math.round(rect.y * s),
      width: Math.round(rect.width * s),
      height: Math.round(rect.height * s)
    })
  )
  const size = cropped.getSize()
  return { base64: cropped.toPNG().toString('base64'), width: size.width, height: size.height }
}
