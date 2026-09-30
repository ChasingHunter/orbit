// Workflows e2e: step workflow with a review card, retries and failure, declining a review,
// missed-run catch-up, and creating a workflow by asking in the bar.
// Uses a little Claude quota and shows a few test notifications.
// Run: npm run build && node scripts/e2e-workflows.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-workflows-profile')
const wfDir = join(dataDir, 'workflows')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(wfDir, { recursive: true })
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku', research: 'claude:haiku' } })
)

writeFileSync(
  join(wfDir, 'test-digest.yaml'),
  `name: test-digest
description: Fetch a page, summarise it, review, notify
model: quick
steps:
  - id: fetch
    tool: web_fetch
    args: { url: "https://example.com" }
  - id: summarize
    agent: "Summarise this page in one short sentence."
    input: "{{steps.fetch.output}}"
  - id: review
    approval: { title: "Digest for {{date}}", preview: "{{steps.summarize.output}}", timeout: 2m }
  - id: never
    when: "{{steps.nothing.output}}"
    tool: notify
    args: { title: "should not run", body: "x" }
  - id: tell
    tool: notify
    args: { title: "Orbit test workflow", body: "{{steps.summarize.output}}" }
`
)
writeFileSync(
  join(wfDir, 'test-broken.yaml'),
  `name: test-broken
steps:
  - id: missing
    tool: this_tool_does_not_exist
    retries: 1
`
)
writeFileSync(
  join(wfDir, 'test-missed.yaml'),
  `name: test-missed
trigger: { cron: "0 * * * *" }
missed: run
steps:
  - id: ping
    tool: get_context
`
)

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
const lastRun = (name) => app.evaluate((_e, n) => globalThis.__orbit.workflows.runs(n, 1)[0], name)
const stepsOf = (id) => app.evaluate((_e, r) => globalThis.__orbit.workflows.steps(r), id)

// 1. Full step workflow, approving the review card in the bar.
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
const run1 = app.evaluate(() => globalThis.__orbit.workflows.run('test-digest', 'manual'))
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 90_000 })
await bar.screenshot({ path: join(root, 'out', 'e2e', 'workflow-review.png') })
await bar.click('button:has-text("Approve")')
const id1 = await run1
const r1 = await lastRun('test-digest')
const s1 = await stepsOf(id1)
check('step workflow finished', r1.status === 'done', r1.error ?? '')
check('steps ran in order with one skipped', s1.map((s) => `${s.step_id}:${s.status}`).join(' ') === 'fetch:done summarize:done review:done never:skipped tell:done', s1.map((s) => `${s.step_id}:${s.status}`).join(' '))
check('output piped between steps', (s1.find((s) => s.step_id === 'tell')?.input ?? '').includes(s1.find((s) => s.step_id === 'summarize')?.output?.slice(0, 20) ?? '##'))

// 2. Failure with retries.
await app.evaluate(() => globalThis.__orbit.workflows.run('test-broken', 'manual'))
const r2 = await lastRun('test-broken')
const s2 = await stepsOf(r2.id)
check('broken step fails the run after retry', r2.status === 'failed' && s2[0]?.status === 'failed', `${r2.error}`)

// 3. Declining the review stops the run before notify.
const run3 = app.evaluate(() => globalThis.__orbit.workflows.run('test-digest', 'manual'))
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 90_000 })
await bar.click('button:has-text("Deny")')
const id3 = await run3
const r3 = await lastRun('test-digest')
const s3 = await stepsOf(id3)
check('declined review cancels the run', r3.status === 'cancelled' && !s3.some((s) => s.step_id === 'tell'), `${r3.status} ${r3.error}`)

// 4. Missed hourly run (last ran 3 hours ago) is caught up because missed: run.
await app.evaluate(() => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const path = process.getBuiltinModule('node:path')
  const db = new DatabaseSync(path.join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
  const t = new Date(Date.now() - 3 * 3600_000).toISOString()
  db.prepare("UPDATE schedules SET last_run_at = ?, created_at = ? WHERE id = 'wf:test-missed'").run(t, t)
  globalThis.__orbit.scheduler.start()
})
let r4
for (let i = 0; i < 20 && r4?.status !== 'done'; i++) {
  await bar.waitForTimeout(500)
  r4 = await lastRun('test-missed')
}
check('missed scheduled run caught up', r4?.status === 'done' && r4.trigger === 'missed', JSON.stringify(r4 && { status: r4.status, trigger: r4.trigger }))

// 5. Create a workflow by asking.
await bar.keyboard.press('Control+n')
await bar.fill(
  'textarea',
  'Create a workflow called morning-hello that runs every weekday at 8am. One step: use the notify tool with title "Good morning" and body "Time to plan the day". Mark that step approved.'
)
await bar.keyboard.press('Enter')
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 120_000 })
await bar.screenshot({ path: join(root, 'out', 'e2e', 'workflow-create.png') })
await bar.click('button:has-text("Approve")')
await bar.waitForSelector('[data-state="done"]', { timeout: 120_000 })
const file = join(wfDir, 'morning-hello.yaml')
const saved = existsSync(file) ? readFileSync(file, 'utf8') : ''
const sched = await app.evaluate(() => {
  const s = globalThis.__orbit.scheduler.get('wf:morning-hello')
  return s && { cron: s.cron, next: globalThis.__orbit.scheduler.nextRunOf(s)?.toString() }
})
check('workflow saved from a request, with a real notify tool step', /tool:\s*notify/.test(saved) && /cron/.test(saved), saved.replace(/\s+/g, ' ').slice(0, 160))
check('and scheduled for a weekday 8:00', !!sched && /(Mon|Tue|Wed|Thu|Fri) .* 08:00:00/.test(sched.next ?? ''), JSON.stringify(sched))

await app.close()
process.exit(failed ? 1 : 0)
