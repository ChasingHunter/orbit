import { Menu, Tray, nativeImage, shell } from 'electron'
import { dataDir, paths } from '../paths'

let tray: Tray | undefined
let actions: TrayActions | undefined
let update: { version: string; install: () => void } | undefined

type TrayActions = {
  openBar: () => void
  screenshot: () => void
  dashboard: () => void
  quit: () => void
}

/** 16x16 ring icon drawn in code, so there is no binary asset to maintain. */
function icon(): Electron.NativeImage {
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5)
      const a = d > 7.5 ? 0 : d > 5.5 ? 255 : d < 2.2 ? 255 : 0
      const i = (y * size + x) * 4
      buf[i] = 250 // B
      buf[i + 1] = 160 // G
      buf[i + 2] = 90 // R
      buf[i + 3] = a
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

function buildMenu(): void {
  if (!tray || !actions) return
  const a = actions
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...(update ? [{ label: `Restart to update to ${update.version}`, click: update.install }, { type: 'separator' as const }] : []),
      { label: 'Ask Orbit', click: a.openBar },
      { label: 'Screenshot && ask', click: a.screenshot },
      { label: 'Open dashboard', click: a.dashboard },
      { type: 'separator' },
      { label: 'Edit settings.json', click: () => void shell.openPath(paths.settings) },
      { label: 'Open data folder', click: () => void shell.openPath(dataDir) },
      { type: 'separator' },
      { label: 'Quit Orbit', click: a.quit }
    ])
  )
  tray.setToolTip(update ? `Orbit (update ${update.version} ready)` : 'Orbit')
}

export function createTray(a: TrayActions): void {
  actions = a
  tray = new Tray(icon())
  tray.on('click', a.openBar)
  buildMenu()
}

/** Adds a "Restart to update" item once an update has downloaded. */
export function showUpdateInTray(version: string, install: () => void): void {
  update = { version, install }
  buildMenu()
}
