// Web search without a key: Claude models use Claude's own search through Orbit's permission
// check, it shows in the bar and the log, its token cost is recorded, and Strict asks first.
// Two small model calls.
// Run: npm run build && node scripts/e2e-search.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-search-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' }, permissions: { level: 'careful' } }))

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({
  executablePath: exe,
  args: exe ? [] : [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const sql = (q) =>
  app.evaluate((_e, s) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    return new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db')).prepare(s).all()
  }, q)

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.fill('textarea', 'Search the web: what is the latest stable version of Node.js right now? One line, with the source.')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 120_000 })
const answer = await bar.locator('[data-state="done"]').last().innerText()
check('Claude searches without a key', /web_search/.test(answer) && /v?\d{2}/.test(answer), answer.replace(/\s+/g, ' ').slice(0, 160))
const audit = readFileSync(join(dataDir, 'logs', 'audit.jsonl'), 'utf8')
check('the search is in the log', /"tool":"web_search".*"ok":true/.test(audit))
const usage = await sql("SELECT model, input + output + cache_write AS counted, cache_read FROM usage")
console.log('usage:', JSON.stringify(usage))

await app.evaluate(() => globalThis.__orbit.settings.update((d) => (d.permissions.level = 'strict')))
await bar.keyboard.press('Control+N')
await bar.fill('textarea', 'Search the web for the current population of Iceland.')
await bar.keyboard.press('Enter')
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 90_000 })
check('Strict asks before searching', (await bar.locator('text=APPROVAL NEEDED · web_search').count()) === 1)
await bar.click('button:has-text("Deny")')
await bar.waitForSelector('[data-state="done"]', { timeout: 90_000 })
check('deny is logged', /"tool":"web_search","input":[^\n]*"decision":"denied"/.test(readFileSync(join(dataDir, 'logs', 'audit.jsonl'), 'utf8')))

await app.close()
process.exit(failed ? 1 : 0)
