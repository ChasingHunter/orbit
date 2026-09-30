// Autonomy levels, per-tool overrides, "allow for this chat", and pre-approved workflow steps.
// No model calls. Run: npm run build && node scripts/e2e-permissions.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-permissions-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(join(dataDir, 'workflows'), { recursive: true })
mkdirSync(join(root, 'out', 'e2e'), { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' } }))
writeFileSync(
  join(dataDir, 'workflows', 'preapproved.yaml'),
  'name: preapproved\nsteps:\n  - id: note\n    tool: save_file\n    args: { name: pre.txt, content: ok }\n    approved: true\n'
)
const WF = 'name: made-by-test\nsteps:\n  - id: n\n    tool: notify\n    args: { title: t, body: b }\n'

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({ executablePath: exe, args: exe ? [] : [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
await app.evaluate(() => globalThis.__orbit.onBarHotkey())

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const level = (l) => app.evaluate((_e, v) => globalThis.__orbit.settings.update((d) => void (d.permissions.level = v)), l)
const override = (name, p) => app.evaluate((_e, a) => globalThis.__orbit.settings.update((d) => void (a.p === null ? delete d.tools.policy[a.name] : (d.tools.policy[a.name] = a.p))), { name, p })
const card = () => bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 1500 }).then(() => true).catch(() => false)
/** Calls a tool; if an approval card shows, answers it with `answer`. Returns [askedFirst, result]. */
async function call(name, input, answer = 'Approve') {
  const pending = app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input), { name, input })
  const asked = await card()
  if (asked) await bar.click(`button:has-text("${answer}")`)
  return [asked, await pending]
}

// careful (default)
let [asked, r] = await call('save_file', { name: 'a.txt', content: 'x' })
check("careful: Orbit's own changes don't ask", !asked && !r.isError)
;[asked, r] = await call('create_workflow', { yaml: WF })
check('careful: setting up automation asks', asked && !r.isError, r.output.slice(0, 60))

// strict
await level('strict')
;[asked] = await call('recall', { query: 'x' })
check('strict: even reads ask', asked)
;[asked] = await call('recall', { query: 'x' })
check('strict: "Approve" is just this once', asked)
;[asked] = await call('recall', { query: 'x' }, 'Allow for this chat')
;[asked, r] = await call('recall', { query: 'x' })
check('strict: "Allow for this chat" stops asking', !asked && !r.isError)
await app.evaluate(({ ipcMain }) => ipcMain.emit('bar:new', {}))
;[asked] = await call('recall', { query: 'x' })
check('a new chat asks again', asked)

// pre-approved workflow step
await override('save_file', 'ask')
const runStrict = app.evaluate(() => globalThis.__orbit.workflows.run('preapproved', 'manual'))
const askedStrict = await card()
if (askedStrict) await bar.click('button:has-text("Approve")')
await runStrict
await level('careful')
const runCareful = app.evaluate(() => globalThis.__orbit.workflows.run('preapproved', 'manual'))
const askedCareful = await card()
await runCareful
check('pre-approved step runs at careful, asks at strict', askedStrict && !askedCareful)
check('workflow approval cards have no "for this chat" option', !(await bar.locator('text=Allow for this chat').count()))
await override('save_file', null)

// overrides
await override('notify', 'never')
;[asked, r] = await call('notify', { title: 't', body: 'b' })
check('"never" blocks a tool', !asked && r.isError && /turned off/.test(r.output))
await override('notify', null)

// full
await level('full')
;[asked, r] = await call('create_workflow', { yaml: WF.replace('made-by-test', 'made-in-full') })
check('full: nothing asks', !asked && !r.isError)

// the page
await level('careful')
await app.evaluate(() => globalThis.__orbit.openDashboard('permissions'))
const d = await app.waitForEvent('window', { predicate: (p) => p.url().includes('dashboard') })
await d.waitForLoadState('domcontentloaded')
await d.setViewportSize({ width: 1040, height: 900 })
await d.click('button[role="radio"]:has-text("Ask for everything")')
await d.waitForTimeout(400)
const saved = await app.evaluate(() => globalThis.__orbit.settings.current.permissions.level)
await d.screenshot({ path: join(root, 'out', 'e2e', 'dash-permissions.png'), fullPage: true })
check('choosing a level on the page saves it', saved === 'strict', saved)

await app.close()
process.exit(failed ? 1 : 0)
