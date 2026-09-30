// Scheduler e2e: model-created reminder lands at the right time, a reminder fires,
// and a reminder that came due while Orbit was closed is caught up on start.
// Shows two small test notifications. Run: npm run build && node scripts/e2e-scheduler.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-scheduler-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku' } }))

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

// A reminder that was due an hour ago, written straight to the DB as if Orbit had been closed.
await app.evaluate(() => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const path = process.getBuiltinModule('node:path')
  const db = new DatabaseSync(path.join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
  globalThis.__orbit.scheduler.list() // creates the table
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  db.prepare(
    "INSERT INTO schedules (id, kind, title, payload, cron, run_at, enabled, missed, created_at) VALUES ('missed1', 'reminder', 'Test: missed', ?, NULL, ?, 1, 'ask', ?)"
  ).run(JSON.stringify({ text: 'Orbit test: missed reminder' }), hourAgo, new Date(Date.now() - 7200_000).toISOString())
  globalThis.__orbit.scheduler.start()
})
await bar.waitForTimeout(500)
const missed = await app.evaluate(() => globalThis.__orbit.scheduler.get('missed1'))
check('missed one-off caught up on start', missed?.last_run_at && missed.enabled === 0, JSON.stringify({ last: missed?.last_run_at, enabled: missed?.enabled }))

// Fires on time.
await app.evaluate(() =>
  globalThis.__orbit.scheduler.add({ id: 'soon1', kind: 'reminder', title: 'Test: fires', payload: { text: 'Orbit test: reminder fired' }, at: new Date(Date.now() + 2500) })
)
await bar.waitForTimeout(4500)
const fired = await app.evaluate(() => globalThis.__orbit.scheduler.get('soon1'))
check('reminder fired on time', !!fired?.last_run_at && fired.enabled === 0)

// Rejects the past.
const pastError = await app.evaluate(() => {
  try {
    globalThis.__orbit.scheduler.add({ kind: 'reminder', title: 'x', payload: {}, at: new Date(Date.now() - 60_000) })
    return null
  } catch (e) {
    return e.message
  }
})
check('past time rejected', /past/.test(pastError ?? ''), pastError ?? '')

// Model sets a relative reminder.
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
const before = Date.now()
await bar.fill('textarea', 'Remind me in 30 minutes to stretch.')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 90_000 })
const answer = (await bar.locator('[data-state="done"]').last().innerText()).replace(/\s+/g, ' ')
const created = await app.evaluate(() => globalThis.__orbit.scheduler.list(true, 'reminder').find((s) => /stretch/i.test(s.title)))
const offsetMin = created?.run_at ? (new Date(created.run_at).getTime() - before) / 60_000 : NaN
check('model set reminder ~30 min out', Math.abs(offsetMin - 30) < 2, `${offsetMin.toFixed(1)} min; ${answer.slice(0, 100)}`)

await app.close()
process.exit(failed ? 1 : 0)
