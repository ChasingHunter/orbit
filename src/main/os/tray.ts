import { Menu, Tray, nativeImage, shell } from 'electron'
import { dataDir, paths } from '../paths'

let tray: Tray | undefined

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

export function createTray(actions: { openBar: () => void; screenshot: () => void; quit: () => void }): void {
  tray = new Tray(icon())
  tray.setToolTip('Orbit')
  tray.on('click', actions.openBar)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ask Orbit', click: actions.openBar },
      { label: 'Screenshot && ask', click: actions.screenshot },
      { type: 'separator' },
      { label: 'Edit settings.json', click: () => void shell.openPath(paths.settings) },
      { label: 'Open data folder', click: () => void shell.openPath(dataDir) },
      { type: 'separator' },
      { label: 'Quit Orbit', click: actions.quit }
    ])
  )
}
