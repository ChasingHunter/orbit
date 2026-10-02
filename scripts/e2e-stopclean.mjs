// Stopping an answer (Stop hotkey) leaves the partial answer without an error line. One request.
// Run: npm run build && node scripts/e2e-stopclean.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-stopclean-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' } }))
const app = await electron.launch({ executablePath: process.env.ORBIT_EXE, args: process.env.ORBIT_EXE ? [] : [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.waitForSelector('textarea')
await bar.fill('textarea', 'Write a 2000 word story about a lighthouse keeper.')
await bar.keyboard.press('Enter')
await bar.waitForFunction(() => document.body.innerText.length > 600, null, { timeout: 90_000 })
await app.evaluate(() => globalThis.__orbit.onPanic())
await bar.waitForTimeout(4000)
const text = await bar.evaluate(() => document.body.innerText)
check('the partial story stays', text.length > 600)
check('no diagnostic or error line after stopping', !/sdk_diagnostic|error_during_execution/i.test(text), text.slice(-200).replace(/\s+/g, ' '))

await app.close()
process.exit(failed ? 1 : 0)
