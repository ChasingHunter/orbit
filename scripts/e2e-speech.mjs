// Spoken replies e2e with Pocket TTS (needs `uvx pocket-tts` to work) and the Windows voice.
// Playback is muted in the test window. A few small model calls.
// Run: npm run build && node scripts/e2e-speech.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-speech-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku' }, speech: { engine: 'pocket', when: 'voice', voice: 'alba', port: 8124 } })
)

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({ executablePath: exe, args: exe ? [] : [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}

// Mute playback and count the audio that reaches the bar.
await bar.evaluate(() => {
  AudioBufferSourceNode.prototype.connect = function () {
    return this
  }
  window.__audio = { bytes: 0, first: 0, stops: 0 }
  window.orbit.onEvent((e) => {
    if (e.type === 'audio') {
      if (!window.__audio.bytes) window.__audio.first = performance.now()
      window.__audio.bytes += e.pcm.byteLength
    }
    if (e.type === 'audio-stop') window.__audio.stops++
  })
})
const audio = () => bar.evaluate(() => ({ ...window.__audio, now: performance.now() }))
const reset = () => bar.evaluate(() => Object.assign(window.__audio, { bytes: 0, first: 0 }))

// Start Pocket (the first run downloads nothing if the model is cached; the server takes a few seconds).
const t0 = Date.now()
await app.evaluate(() => globalThis.__orbit.speaker.say('Warming up.'))
let a
for (let i = 0; i < 90 && !(a = await audio()).bytes; i++) await bar.waitForTimeout(1000)
check('Orbit starts its own Pocket TTS server', a.bytes > 0, `first audio after ${((Date.now() - t0) / 1000).toFixed(1)}s including startup`)

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await app.evaluate(() =>
  globalThis.__orbit.sendToBar({ type: 'open', context: [], autoSubmitMs: null, speak: 'voice', quickActions: [] })
)

// A question that came from dictation is spoken.
await reset()
await app.evaluate(() => globalThis.__orbit.sendToBar({ type: 'listening', value: true }))
await bar.fill('textarea', 'In two short sentences, why is the sky blue?')
await app.evaluate(() => globalThis.__orbit.sendToBar({ type: 'listening', value: false }))
const sent = await bar.evaluate(() => performance.now())
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 90_000 })
await bar.waitForTimeout(6000)
a = await audio()
check('voice-asked answer is spoken', a.bytes > 48_000, `${(a.bytes / 48000).toFixed(1)}s of audio, first sound ${((a.first - sent) / 1000).toFixed(1)}s after sending`)

// A typed question is not.
await bar.keyboard.press('Control+n')
await reset()
await bar.fill('textarea', 'Say hi in three words.')
await bar.keyboard.press('Enter')
await bar.waitForFunction(() => document.querySelectorAll('[data-state="done"]').length > 0, null, { timeout: 90_000 })
await bar.waitForTimeout(3000)
check('typed answer stays quiet', (await audio()).bytes === 0)

// Read aloud button, then stop.
await reset()
await bar.click('button:has-text("Read aloud")')
for (let i = 0; i < 20 && !(await audio()).bytes; i++) await bar.waitForTimeout(500)
const stopsBefore = (await audio()).stops
await app.evaluate(({ ipcMain }) => ipcMain.emit('bar:speak-stop', {}))
await bar.waitForTimeout(300)
check('Read aloud speaks, and stop stops', (await audio()).stops > stopsBefore)

// Windows voice fallback.
await app.evaluate(() => globalThis.__orbit.settings.update((d) => void (d.speech.engine = 'windows')))
await reset()
await app.evaluate(() => globalThis.__orbit.speaker.say('Testing the Windows voice.'))
for (let i = 0; i < 20 && !(await audio()).bytes; i++) await bar.waitForTimeout(500)
check('Windows voice works too', (await audio()).bytes > 20_000)

await app.close()
process.exit(failed ? 1 : 0)
