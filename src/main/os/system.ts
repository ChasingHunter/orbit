import { app, Notification } from 'electron'
import electronUpdater from 'electron-updater'
import { settings } from '../settingsStore'
import { showUpdateInTray } from './tray'

// Start with Windows and updates from GitHub Releases. Both only apply to the installed app.

export function applyStartWithWindows(): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: settings.current.ui.startWithWindows, args: ['--hidden'] })
}

let timer: NodeJS.Timeout | undefined
let announced = false

export function startAutoUpdates(): void {
  if (!app.isPackaged || timer) return
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = { info: () => {}, warn: console.warn, error: console.error, debug: () => {} }

  // Orbit lives in the tray and starts with Windows, so people rarely quit it. Waiting for a quit
  // could leave an update sitting for weeks; the notification and the tray offer a restart instead.
  const install = (): void => autoUpdater.quitAndInstall(true, true)
  autoUpdater.on('update-downloaded', (info) => {
    showUpdateInTray(info.version, install)
    if (announced) return
    announced = true
    const n = new Notification({ title: `Orbit ${info.version} is ready`, body: 'Click to restart and update now, or it installs the next time Orbit quits.' })
    n.on('click', install)
    n.show()
  })
  autoUpdater.on('error', (err) => console.warn('[update] check failed:', err.message))
  const check = (): void => {
    if (settings.current.ui.autoUpdate) void autoUpdater.checkForUpdates().catch(() => {})
  }
  setTimeout(check, 30_000)
  timer = setInterval(check, 6 * 3_600_000)
}
