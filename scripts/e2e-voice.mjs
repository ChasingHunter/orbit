// Voice e2e: Chromium's fake mic plays a WAV; drives hotkey → record → stop → local transcribe → auto-submit.
// Run: npm run build && node scripts/e2e-voice.mjs [path.wav]
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const wav = resolve(process.argv[2] ?? join(root, 'out', 'stt', 'sample0.wav'))
const dataDir = join(root, 'out', 'e2e-voice-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ voice: { engine: 'local', autoSubmitDelayMs: 300 }, models: { chat: 'claude:haiku' } })
)

// ORBIT_EXE=dist/win-unpacked/Orbit.exe tests the packaged app instead of the dev build.
const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({
  executablePath: exe,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
    ...(exe ? [] : [join(root, 'out', 'main', 'index.js')])
  ],
  env: {
    ...process.env,
    ORBIT_E2E: '1',
    ORBIT_DATA_DIR: dataDir,
    ORBIT_MODELS_DIR: join(process.env.APPDATA, 'Orbit', 'models')
  }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')

const hotkey = () => app.evaluate(() => globalThis.__orbit.onBarHotkey())
await hotkey() // open + start recording
await bar.waitForTimeout(7000) // let the WAV play into the fake mic
await bar.screenshot({ path: join(root, 'out', 'e2e', 'voice-01-listening.png') })
const t0 = Date.now()
await hotkey() // stop → transcribe
await bar.waitForFunction(() => document.querySelector('[data-state]') !== null, null, { timeout: 30_000 })
const transcribeMs = Date.now() - t0
const userText = await bar.locator('.justify-end div').first().innerText()
console.log(`transcript (${transcribeMs} ms to submit):`, userText)
await bar.waitForSelector('[data-state="done"]', { timeout: 90_000 })
await bar.screenshot({ path: join(root, 'out', 'e2e', 'voice-02-answer.png') })
await app.close()
