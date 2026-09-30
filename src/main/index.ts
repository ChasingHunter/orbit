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
import { clearChatAllows } from './core/permissions'
import { answerQuestion, setQuestionPresenter } from './core/questions'
import { getConversation } from './core/history'
import { setMemorySuggestionPresenter } from './core/tools/builtins/suggest'
import { addMemory } from './core/memory'
import { Speaker, stopSpeechServer, warmUpSpeech } from './voice/speech'
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
import { workflows } from './workflows/engine'
import { triggers } from './workflows/triggers'
import { callTool, runnableTools } from './core/tools/registry'
import { recentChanges, undoChange } from './core/journal'
import { z } from 'zod'
import { browserUrl, startBrowserUrlHelper, stopBrowserUrlHelper } from './os/browserUrl'
import { registerDashboardIpc } from './dashboardIpc'
import { openDashboard } from './windows/dashboard'
import { pasteInto } from './os/writeback'
import { acceleratorKey, foregroundWindow, isKeyDown, waitForModifiersReleased, windowInfo, type Hwnd } from './os/win32'
import { applyStartWithWindows, startAutoUpdates } from './os/system'

ensureDataDirs()
installLogging((message) => sendToBar({ type: 'notice', level: 'error', text: `Internal error: ${message}` }))

// Keep Chromium caches out of the user-facing data folder.
app.setPath('userData', join(dataDir, 'chromium'))
if (!app.requestSingleInstanceLock()) app.quit()

let prevWindow: Hwnd // window the user was in before Orbit took focus (for Replace)
let prevApp = ''
const voice = new VoiceController(sendToBar)
const speaker = new Speaker(
  (pcm, rate) => sendToBar({ type: 'audio', pcm, rate }),
  () => {},
  (message) => sendToBar({ type: 'notice', level: 'error', text: `Couldn't speak: ${message}` })
)

function speakMode(): 'off' | 'voice' | 'always' {
  return settings.current.speech.engine === 'off' ? 'off' : settings.current.speech.when
}

function stopSpeaking(): void {
  speaker.stop()
  sendToBar({ type: 'audio-stop' })
}
const conversation = new Conversation(
  (turnId, event) => sendToBar({ type: 'agent', turnId, event }),
  (text, action) => sendToBar({ type: 'notice', level: 'info', text, action })
)

function autoSubmitMs(): number | null {
  const v = settings.current.voice
  return v.autoSubmit ? v.autoSubmitDelayMs : null
}

/** Grabs active window + selection from the app the user is in, before the bar steals focus. */
async function captureContext(): Promise<ContextItem[]> {
  // Automated tests must never pick up whatever the person has open on their screen.
  if (process.env.ORBIT_E2E) return []
  const hwnd = foregroundWindow()
  const info = windowInfo(hwnd)
  if (info.app.toLowerCase() === 'electron.exe' || info.app.toLowerCase() === 'orbit.exe') return []
  prevWindow = hwnd
  prevApp = info.app
  const items: ContextItem[] = []
  if (info.app) items.push({ kind: 'window', id: randomUUID(), app: info.app, title: info.title })
  // Selection fallback may simulate Ctrl+C; wait until the hotkey's modifiers are up.
  await waitForModifiersReleased()
  const sel = currentSelection()
  if (sel) items.push({ kind: 'selection', id: randomUUID(), text: sel.text, app: sel.app || info.app })
  return items
}

/**
 * Hold-to-talk: after the hotkey starts dictation, wait until its main key is released and stop.
 * A quick tap (under 350 ms) leaves dictation running, so tapping still works like toggle mode.
 */
async function stopWhenReleased(): Promise<void> {
  const vk = acceleratorKey(settings.current.hotkeys.bar)
  if (!vk) return
  const pressedAt = Date.now()
  while (isKeyDown(vk)) await new Promise((r) => setTimeout(r, 30))
  if (Date.now() - pressedAt >= 350 && voice.listening) await voice.stop()
}

/** Bar hotkey: open (+ start dictation) → press again to stop dictation → again to restart. */
async function onBarHotkey(): Promise<void> {
  const hold = settings.current.voice.mode === 'hold' && !process.env.ORBIT_E2E
  const w = bar()
  if (!w.isVisible()) {
    const context = await captureContext()
    stopSpeaking()
    sendToBar({ type: 'open', context, autoSubmitMs: autoSubmitMs(), speak: speakMode(), quickActions: settings.current.quickActions })
    showBar()
    attachBrowserUrl()
    if (settings.current.voice.startOnBarOpen) {
      await voice.start()
      if (hold) await stopWhenReleased()
    }
    return
  }
  w.focus()
  await voice.toggle()
  if (hold && voice.listening) await stopWhenReleased()
}

/** Adds the active tab's URL as a chip once it's known, without holding up the bar. */
function attachBrowserUrl(): void {
  if (!prevWindow || !prevApp) return
  void browserUrl(prevWindow, prevApp).then((url) => {
    if (url) sendToBar({ type: 'context-add', item: { kind: 'url', id: randomUUID(), url } })
  })
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
  if (!wasVisible) sendToBar({ type: 'open', context, autoSubmitMs: autoSubmitMs(), speak: speakMode(), quickActions: settings.current.quickActions })
  if (snip) {
    sendToBar({
      type: 'context-add',
      item: { kind: 'screenshot', id: randomUUID(), mediaType: 'image/png', ...snip }
    })
  }
  showBar()
}

function onPanic(): void {
  clearChatAllows()
  stopSpeaking()
  conversation.cancel()
  tasks.cancelAll()
  workflows.cancelAll()
  denyAllApprovals()
  new Notification({ title: 'Orbit', body: 'Stopped all running tasks.' }).show()
}

function rebindHotkeys(): string[] {
  const failed = bindHotkeys(settings.current.hotkeys, {
    bar: () => void onBarHotkey(),
    screenshot: () => void onScreenshot(),
    panic: onPanic
  })
  if (failed.length) {
    new Notification({ title: 'Orbit: hotkey conflict', body: `Could not register: ${failed.join(', ')}` }).show()
  }
  return failed
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
  if (cmd === '/use-model') {
    conversation.useModelForNow(args[0])
    sendToBar({ type: 'notice', level: 'info', text: args[0] ? `Using ${args[0]} until Orbit restarts.` : 'Back to your usual model.' })
    return true
  }
  if (cmd === '/run-workflow' && args[0]) {
    sendToBar({ type: 'notice', level: 'info', text: `Running ${args[0]}…` })
    void workflows.run(args[0], 'manual').then((id) => {
      const run = workflows.runs(args[0], 5).find((r) => r.id === id)
      sendToBar({ type: 'notice', level: run?.status === 'done' ? 'info' : 'error', text: run?.status === 'done' ? `${args[0]} finished.` : run?.error ?? 'Run failed' })
    })
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
  ipcMain.handle('bar:submit', (_e, text: string, context: ContextItem[], opts?: { quick?: boolean }) => {
    if (handleCommand(text)) return { turnId: '' }
    return { turnId: conversation.submit(text, context, opts) }
  })
  ipcMain.on('bar:cancel', () => conversation.cancel())
  ipcMain.on('bar:new', () => {
    clearChatAllows()
    conversation.reset()
  })
  ipcMain.on('bar:approve', (_e, id: string, decision: 'once' | 'chat' | 'deny') => resolveApproval(id, decision))
  ipcMain.on('bar:answer', (_e, id: string, text: string) => answerQuestion(id, text))
  ipcMain.handle('bar:save-memory', (_e, text: string) => void addMemory(text))
  ipcMain.handle('dash:set-hotkey', (_e, action: 'bar' | 'screenshot' | 'panic', accel: string) => {
    const before = settings.current.hotkeys[action]
    settings.update((d) => {
      d.hotkeys[action] = accel
    })
    const failed = process.env.ORBIT_E2E ? [] : rebindHotkeys()
    if (failed.some((f) => f.startsWith(action))) {
      settings.update((d) => {
        d.hotkeys[action] = before
      })
      if (!process.env.ORBIT_E2E) rebindHotkeys()
      throw new Error(`${accel.replace(/\+/g, ' + ')} is already used by another app. Pick a different combination.`)
    }
  })
  ipcMain.on('dash:continue', (_e, conversationId: string) => {
    const conv = getConversation(conversationId)
    if (!conv) return
    const messages = conversation.resume(conversationId)
    sendToBar({ type: 'reset' })
    sendToBar({ type: 'open', context: [], autoSubmitMs: null, quickActions: settings.current.quickActions })
    sendToBar({ type: 'restore', title: conv.title, messages })
    showBar()
  })
  ipcMain.on('bar:voice-toggle', () => void voice.toggle())
  ipcMain.on('bar:voice-ended', () => voice.ended())
  ipcMain.handle('stt:transcribe', async (_e, samples: Float32Array) => {
    const t0 = Date.now()
    const text = await transcribe(samples)
    logInfo(`stt: ${(samples.length / 16000).toFixed(1)}s audio -> ${text.length} chars in ${Date.now() - t0} ms`)
    return text
  })
  ipcMain.on('bar:speak', (_e, text: string) => speaker.say(text))
  ipcMain.handle('dash:test-speech', () => {
    stopSpeaking()
    speaker.say("Hi, I'm Orbit. This is how I'll sound when I answer you.")
  })
  ipcMain.on('bar:speak-stop', () => stopSpeaking())
  ipcMain.on('bar:hide', () => {
    stopSpeaking()
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
  settings.on('change', () => {
    warmUpSpeech()
    if (!process.env.ORBIT_E2E) rebindHotkeys()
    applyStartWithWindows()
  })

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
  setMemorySuggestionPresenter((s) => sendToBar({ type: 'memory-suggestion', ...s }))
  setQuestionPresenter((question) => {
    sendToBar({ type: 'question', question })
    if (!bar().isVisible()) showBar()
    new Notification({ title: 'Orbit has a question', body: question.question }).show()
  })
  setApprovalPresenter((request) => {
    sendToBar({ type: 'approval', request })
    if (!bar().isVisible()) showBar()
  })
  createBar()
  setBarBlurHandler(() => {
    stopSpeaking()
    void voice.cancel()
    hideBar()
  })
  createTray({
    openBar: () => void onBarHotkey(),
    screenshot: () => void onScreenshot(),
    dashboard: () => openDashboard(),
    quit: () => app.quit()
  })
  workflows.init((text, action) => {
    sendToBar({ type: 'notice', level: 'info', text, action })
    if (!bar().isVisible()) showBar()
  })
  if (process.env.ORBIT_E2E) {
    // Test hook for scripts/e2e.ts; never set in normal runs.
    Object.assign(globalThis, { __orbit: { onBarHotkey, onScreenshot, sendToBar, settings, voice, integrations, tasks, openDashboard, scheduler, workflows, triggers, conversation, speaker, recentChanges, undoChange,
      measureTools: () => runnableTools(() => []).map((t) => ({ name: t.name, chars: t.description.length + JSON.stringify(z.toJSONSchema(z.object(t.input))).length })),
      callTool: (name: string, input: unknown) => callTool(name, input, { signal: AbortSignal.timeout(60_000), context: [] }) } })
    return
  }
  startSelectionHook()
  startBrowserUrlHelper()
  rebindHotkeys()
  applyStartWithWindows()
  startAutoUpdates()
  warmUpSpeech()
  scheduler.start()
  warmUp()
})

// Tray app: closing windows never quits.
app.on('window-all-closed', () => {})
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopSelectionHook()
  stopBrowserUrlHelper()
  stopSpeechServer()
  conversation.reset()
})
