import { app, clipboard, globalShortcut, ipcMain, Notification } from 'electron'
import { randomUUID } from 'node:crypto'
import type { ContextItem } from '@shared/types'
import type { DashPage } from '@shared/dash'
import { join } from 'node:path'
import { dataDir, ensureDataDirs } from './paths'
import { installLogging, logInfo } from './log'
import { settings } from './settingsStore'
import { setSecret } from './secrets'
import { Conversation } from './core/conversation'
import { denyAllApprovals, resolveApproval, setApprovalPresenter } from './core/approvals'
import { bar, createBar, hideBar, resizeBar, sendToBar, setBarBlurHandler, showBar } from './windows/bar'
import { bindHotkeys } from './os/hotkeys'
import { createTray } from './os/tray'
import { currentSelection, startSelectionHook, stopSelectionHook } from './os/selection'
import { snipRegion } from './os/screenshot'
import { VoiceController } from './voice/controller'
import { transcribe, warmUp } from './voice/localStt'
import { integrations } from './integrations/manager'
import { tasks } from './core/tasks'
import { scheduler } from './core/scheduler'
import { registerDashboardIpc } from './dashboardIpc'
import { openDashboard } from './windows/dashboard'
import { pasteInto } from './os/writeback'
import { foregroundWindow, waitForModifiersReleased, windowInfo, type Hwnd } from './os/win32'

ensureDataDirs()
installLogging((message) => sendToBar({ type: 'notice', level: 'error', text: `Internal error: ${message}` }))

// Keep Chromium caches out of the user-facing data folder.
app.setPath('userData', join(dataDir, 'chromium'))
if (!app.requestSingleInstanceLock()) app.quit()

let prevWindow: Hwnd // window the user was in before Orbit took focus (for Replace)
const voice = new VoiceController(sendToBar)
const conversation = new Conversation((turnId, event) => sendToBar({ type: 'agent', turnId, event }))

function autoSubmitMs(): number | null {
  const v = settings.current.voice
  return v.autoSubmit ? v.autoSubmitDelayMs : null
}

/** Grabs active window + selection from the app the user is in, before the bar steals focus. */
async function captureContext(): Promise<ContextItem[]> {
  const hwnd = foregroundWindow()
  const info = windowInfo(hwnd)
  if (info.app.toLowerCase() === 'electron.exe' || info.app.toLowerCase() === 'orbit.exe') return []
  prevWindow = hwnd
  const items: ContextItem[] = []
  if (info.app) items.push({ kind: 'window', id: randomUUID(), app: info.app, title: info.title })
  // Selection fallback may simulate Ctrl+C; wait until the hotkey's modifiers are up.
  await waitForModifiersReleased()
  const sel = currentSelection()
  if (sel) items.push({ kind: 'selection', id: randomUUID(), text: sel.text, app: sel.app || info.app })
  return items
}

/** Bar hotkey: open (+ start dictation) → press again to stop dictation → again to restart. */
async function onBarHotkey(): Promise<void> {
  const w = bar()
  if (!w.isVisible()) {
    const context = await captureContext()
    sendToBar({ type: 'open', context, autoSubmitMs: autoSubmitMs() })
    showBar()
    if (settings.current.voice.startOnBarOpen) await voice.start()
    return
  }
  w.focus()
  await voice.toggle()
}

async function onScreenshot(): Promise<void> {
  const wasVisible = bar().isVisible()
  const context = wasVisible ? [] : await captureContext()
  await voice.cancel()
  hideBar()
  const snip = await snipRegion().catch((err) => {
    console.error('[snip]', err)
    return undefined
  })
  if (!wasVisible) sendToBar({ type: 'open', context, autoSubmitMs: autoSubmitMs() })
  if (snip) {
    sendToBar({
      type: 'context-add',
      item: { kind: 'screenshot', id: randomUUID(), mediaType: 'image/png', ...snip }
    })
  }
  showBar()
}

function onPanic(): void {
  conversation.cancel()
  tasks.cancelAll()
  denyAllApprovals()
  new Notification({ title: 'Orbit', body: 'Stopped all running tasks.' }).show()
}

function rebindHotkeys(): void {
  const failed = bindHotkeys(settings.current.hotkeys, {
    bar: () => void onBarHotkey(),
    screenshot: () => void onScreenshot(),
    panic: onPanic
  })
  if (failed.length) {
    new Notification({ title: 'Orbit: hotkey conflict', body: `Could not register: ${failed.join(', ')}` }).show()
  }
}

/** Slash commands handled locally, never sent to a model. */
function handleCommand(text: string): boolean {
  const [cmd, ...args] = text.trim().split(/\s+/)
  if (cmd === '/key') {
    const [name, value] = args
    if (!name || !value) sendToBar({ type: 'notice', level: 'error', text: 'Usage: /key <name> <value>' })
    else {
      setSecret(name, value)
      sendToBar({ type: 'notice', level: 'info', text: `Saved key "${name}" (encrypted).` })
    }
    return true
  }
  if (cmd === '/install-voice') {
    void voice.install()
    return true
  }
  if (cmd === '/new') {
    conversation.reset()
    sendToBar({ type: 'reset' })
    return true
  }
  return false
}

function registerIpc(): void {
  ipcMain.handle('bar:submit', (_e, text: string, context: ContextItem[]) => {
    if (handleCommand(text)) return { turnId: '' }
    return { turnId: conversation.submit(text, context) }
  })
  ipcMain.on('bar:cancel', () => conversation.cancel())
  ipcMain.on('bar:new', () => conversation.reset())
  ipcMain.on('bar:approve', (_e, id: string, ok: boolean) => resolveApproval(id, ok))
  ipcMain.on('bar:voice-toggle', () => void voice.toggle())
  ipcMain.on('bar:voice-ended', () => voice.ended())
  ipcMain.handle('stt:transcribe', async (_e, samples: Float32Array) => {
    const t0 = Date.now()
    const text = await transcribe(samples)
    logInfo(`stt: ${(samples.length / 16000).toFixed(1)}s audio -> ${text.length} chars in ${Date.now() - t0} ms`)
    return text
  })
  ipcMain.on('bar:hide', () => {
    void voice.cancel()
    hideBar()
  })
  ipcMain.on('bar:copy', (_e, text: string) => void clipboard.writeText(text))
  ipcMain.handle('bar:replace', (_e, text: string) => pasteInto(prevWindow, text, hideBar))
  ipcMain.on('bar:screenshot', () => void onScreenshot())
  ipcMain.on('bar:resize', (_e, h: number) => resizeBar(h))
  ipcMain.on('bar:dashboard', (_e, page?: DashPage) => {
    hideBar()
    openDashboard(page)
  })
}

app.whenReady().then(() => {
  ensureDataDirs()
  settings.load()
  settings.watch()
  settings.on('change', rebindHotkeys)

  registerIpc()
  registerDashboardIpc()
  void integrations.startAll()
  tasks.markInterrupted()
  scheduler.register(
    'reminder',
    (s) => {
      const { text } = JSON.parse(s.payload) as { text: string }
      new Notification({ title: 'Reminder', body: text }).show()
      if (bar().isVisible()) sendToBar({ type: 'notice', level: 'info', text: `Reminder: ${text}` })
    },
    (s, { missedAt }) => {
      const { text } = JSON.parse(s.payload) as { text: string }
      new Notification({ title: 'Missed reminder', body: `${text} (was due ${missedAt?.toLocaleString()})` }).show()
    }
  )
  setApprovalPresenter((request) => {
    sendToBar({ type: 'approval', request })
    if (!bar().isVisible()) showBar()
  })
  createBar()
  setBarBlurHandler(() => {
    void voice.cancel()
    hideBar()
  })
  createTray({
    openBar: () => void onBarHotkey(),
    screenshot: () => void onScreenshot(),
    dashboard: () => openDashboard(),
    quit: () => app.quit()
  })
  if (process.env.ORBIT_E2E) {
    // Test hook for scripts/e2e.ts; never set in normal runs.
    Object.assign(globalThis, { __orbit: { onBarHotkey, onScreenshot, sendToBar, settings, voice, integrations, tasks, openDashboard, scheduler } })
    return
  }
  startSelectionHook()
  rebindHotkeys()
  scheduler.start()
  warmUp()
})

// Tray app: closing windows never quits.
app.on('window-all-closed', () => {})
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopSelectionHook()
  conversation.reset()
})
