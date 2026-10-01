// Asking for access: when a folder isn't allowed or writable (or commands are off), Orbit asks on
// a card, changes the setting when approved and carries on with the request by itself. Whole
// drives and system folders are never granted, and Full autonomy still asks. One model request
// (it continues on its own after the grant).
// Run: npm run build && node scripts/e2e-access.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-access-profile')
// Outside the profile: Orbit never grants folders inside its own data folder.
const ps = join(root, 'out', 'e2e-access-ps')
rmSync(dataDir, { recursive: true, force: true })
rmSync(ps, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(ps, { recursive: true })
writeFileSync(join(ps, 'notes.txt'), 'hello')
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' }, permissions: { level: 'full' }, files: { allowedFolders: [], writableFolders: [] } }))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input, 'chat'), { name, input })
const saved = () => JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.waitForSelector('textarea')
let r = await Promise.race([tool('request_access', { kind: 'write_folder', path: 'C:' + String.fromCharCode(92), reason: 'test' }), bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 3000 }).then(() => 'card', () => 'none')])
const inside = await tool('request_access', { kind: 'write_folder', path: join(root, 'out'), reason: 'test' })
check('a folder containing Orbit data is never granted either', inside.isError && /contains system or app folders/.test(inside.output), inside.output.slice(0, 90))
check('a whole drive is never granted', typeof r === 'object' && r.isError && /whole drive/.test(r.output), typeof r === 'object' ? r.output.slice(0, 90) : r)

await bar.fill('textarea', `Rename notes.txt in ${ps} to notes-2026.txt`)
await bar.keyboard.press('Enter')
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 90_000 })
const title = await bar.locator('.text-sm.text-zinc-100').last().innerText()
check('Orbit asks for access on a card, even at Full', /Let Orbit (change files in|run commands)/.test(title), title)
check('the card has no "allow for this chat"', (await bar.locator('button:has-text("Allow for this chat")').count()) === 0)
await bar.screenshot({ path: join(root, 'out', 'e2e', 'bar-request-access.png') })
await bar.click('button:has-text("Approve")')
await bar.waitForFunction(() => document.body.innerText.includes('Continuing'), null, { timeout: 90_000 }).catch(async () => console.log('BAR TEXT:', (await bar.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600)))
check('approving changes the setting', saved().files.writableFolders.some((f) => f.toLowerCase() === ps.toLowerCase()) || saved().tools?.commands?.enabled === true)
for (let i = 0; i < 120 && !existsSync(join(ps, 'notes-2026.txt')); i++) await bar.waitForTimeout(500)
check('and Orbit carries on and does it, without being asked again', existsSync(join(ps, 'notes-2026.txt')) && !existsSync(join(ps, 'notes.txt')))

await app.close()
process.exit(failed ? 1 : 0)
