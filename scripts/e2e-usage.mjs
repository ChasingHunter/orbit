// Token usage: per-turn recording, quick actions on the quick model, the background budget, and
// the Usage page. A few small model calls; shows one "paused" notification.
// Run: npm run build && node scripts/e2e-usage.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-usage-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(join(root, 'out', 'e2e'), { recursive: true })
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:sonnet', quick: 'claude:haiku', research: 'claude:haiku' }, budget: { backgroundDailyTokens: 50_000 } })
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
const sql = (q) =>
  app.evaluate((_e, s) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const d = new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
    return d.prepare(s).all()
  }, q)

// A quick action that starts a chat runs on the quick model even though chat is Sonnet.
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await app.evaluate(() =>
  globalThis.__orbit.sendToBar({
    type: 'open',
    autoSubmitMs: null,
    context: [{ kind: 'selection', id: 's', app: 'x', text: 'Teh quick brown fox jump over the lazzy dog.' }],
    quickActions: globalThis.__orbit.settings.current.quickActions
  })
)
await bar.click('[data-testid="quick-actions"] >> text=Explain')
await bar.waitForSelector('[data-state="done"]', { timeout: 90_000 })
const rows = await sql('SELECT source, model, input, output, cache_read, cache_write FROM usage')
check('quick action ran on the quick model', rows.length >= 1 && rows.every((r) => /haiku/.test(r.model)), rows.map((r) => r.model).join(', '))
check('usage recorded per turn, not running totals', rows.every((r) => r.output < 2000), JSON.stringify(rows[0]))

// Background budget: pretend 60k tokens of workflow use today, then a task must not start.
await sql(`INSERT INTO usage (at, source, label, model, input, output, cache_read, cache_write) VALUES ('${new Date().toISOString()}', 'workflow', 'daily-tech-digest', 'claude-sonnet-5-5', 40000, 20000, 0, 0)`)
await app.evaluate(() => globalThis.__orbit.tasks.start('over budget', 'Say hi.', 'quick'))
let task
for (let i = 0; i < 20 && task?.status !== 'failed' && task?.status !== 'done'; i++) {
  await bar.waitForTimeout(300)
  task = await app.evaluate(() => globalThis.__orbit.tasks.list()[0])
}
check('background task refused over budget', task?.status === 'failed' && /budget/.test(task.error ?? ''), task?.error ?? task?.status)

// Chat is never blocked by the budget.
await bar.keyboard.press('Control+n')
await bar.fill('textarea', 'Reply with just: ok')
await bar.keyboard.press('Enter')
await bar.waitForFunction(() => [...document.querySelectorAll('[data-state="done"]')].some((e) => /ok/i.test(e.textContent ?? '')), null, { timeout: 90_000 })
check('chat still works over the background budget', true)

await app.evaluate(() => globalThis.__orbit.openDashboard('usage'))
const d = await app.waitForEvent('window', { predicate: (p) => p.url().includes('dashboard') })
await d.waitForLoadState('domcontentloaded')
await d.setViewportSize({ width: 1040, height: 820 })
await d.waitForSelector('text=Background budget today')
await d.waitForTimeout(400)
await d.screenshot({ path: join(root, 'out', 'e2e', 'dash-usage.png') })
check('usage page shows the budget over its limit', (await d.locator('text=60k of 50k').count()) === 1)

await app.close()
process.exit(failed ? 1 : 0)
