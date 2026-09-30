// Settings e2e: change a hotkey by pressing keys, switch voice to hold mode, flip toggles.
// No model calls. Run: npm run build && node scripts/e2e-settings.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-settings-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' } }))

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({ executablePath: exe, args: exe ? [] : [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
await app.firstWindow()
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const saved = () => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))

await app.evaluate(() => globalThis.__orbit.openDashboard('settings'))
const d = await app.waitForEvent('window', { predicate: (p) => p.url().includes('dashboard') })
await d.waitForLoadState('domcontentloaded')
await d.setViewportSize({ width: 1040, height: 1100 })

const barRow = d.locator('div', { hasText: 'Open the bar and talk' }).last()
await barRow.locator('button:has-text("Change")').click()
await d.keyboard.press('KeyK') // no modifier: refused
check('combo without Ctrl/Alt/Win refused', (await d.locator('text=Include Ctrl, Alt or Win').count()) === 1)
await d.keyboard.press('Control+Alt+KeyK')
await d.waitForTimeout(400)
check('hotkey changed by pressing keys', saved().hotkeys.bar === 'Control+Alt+K', saved().hotkeys.bar)

await d.selectOption('select[aria-label="How the hotkey records"]', 'hold')
await d.waitForTimeout(300)
check('voice switched to hold-to-talk', saved().voice.mode === 'hold')

await d.locator('label', { hasText: 'Start when Windows starts' }).locator('input').uncheck()
await d.waitForTimeout(300)
check('start-with-Windows toggle saved', saved().ui.startWithWindows === false)
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
check('real version shown', (await d.locator(`text=Version ${version}`).count()) === 1, version)
check('sidebar shows the new hotkey', (await d.locator('aside kbd', { hasText: 'K' }).count()) === 1)
await d.screenshot({ path: join(root, 'out', 'e2e', 'dash-settings-full.png'), fullPage: true })

await app.close()
process.exit(failed ? 1 : 0)
