import { app, Notification, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronUpdater from 'electron-updater'
import { settings } from '../settingsStore'
import { showUpdateInTray } from './tray'

// Start with Windows and updates from GitHub Releases. Both only apply to the installed app.

/** A packaged build running from a source checkout's dist folder: only ever on the developer's PC. */
export function isBuildFolderCopy(): boolean {
  return app.isPackaged && /[\\/]dist[\\/]win-unpacked[\\/]/i.test(process.execPath)
}

const installedExe = (): string => join(process.env.LOCALAPPDATA ?? join(app.getPath('home'), 'AppData', 'Local'), 'Programs', 'Orbit', 'Orbit.exe')

/**
 * A build-folder copy started outside of tests (once, a stale Start Menu shortcut did this after
 * an update) hands over to the installed Orbit and exits, so it never takes over the user's setup.
 * Returns true if it handed over. Call before taking the single-instance lock.
 */
export function handOffToInstalled(): boolean {
  if (!isBuildFolderCopy() || process.env.ORBIT_E2E || !existsSync(installedExe())) return false
  spawn(installedExe(), ['--hidden'], { detached: true, stdio: 'ignore' }).unref()
  app.exit(0)
  return true
}

/** The installed Orbit points its Start Menu shortcut back at itself if something changed it. */
export function repairShortcut(): void {
  if (!app.isPackaged || process.env.ORBIT_E2E || isBuildFolderCopy()) return
  const link = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Orbit.lnk')
  try {
    if (existsSync(link) && shell.readShortcutLink(link).target.toLowerCase() !== process.execPath.toLowerCase()) {
      shell.writeShortcutLink(link, 'update', { target: process.execPath, cwd: dirname(process.execPath) })
    }
  } catch {
    // a shortcut we can't read or write is left as it is
  }
}

export function applyStartWithWindows(): void {
  // Tests run packaged builds from dist/ on the user's PC; they must never repoint the real login item.
  if (!app.isPackaged || process.env.ORBIT_E2E || isBuildFolderCopy()) return
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
