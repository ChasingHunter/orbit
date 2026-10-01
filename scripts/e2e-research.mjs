// Deep research e2e: the approval card shows the estimate and budget, a low budget refuses to
// start, and one real run (cut to a single sub-question to keep it cheap) plans, searches and
// writes a report with sources, with progress on the Tasks page.
// Run: npm run build && node scripts/e2e-research.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-research-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku', research: 'claude:haiku' }, permissions: { level: 'careful' }, budget: { backgroundDailyTokens: 300000 } })
)

const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir, ORBIT_E2E_RESEARCH_PARTS: '1' }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input, 'chat'), { name, input })

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
let pending = tool('deep_research', { question: 'What are the main differences between SQLite WAL mode and rollback journal mode?', depth: 'quick' })
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 15_000 })
const card = await bar.locator('pre').last().innerText()
check('asks first, with tokens, time and budget', /about \d+k tokens, usually 3 to 5 minutes/.test(card) && /300k left today/.test(card), card.replace(/\n/g, ' | '))
await bar.screenshot({ path: join(root, 'out', 'e2e', 'bar-research-approval.png') })
await bar.click('button:has-text("Approve")')
let r = await pending
check('starts in the background', !r.isError && /Started deep research/.test(r.output), r.output.slice(0, 100))

let task
for (let i = 0; i < 360 && task?.status !== 'done' && task?.status !== 'failed'; i++) {
  await bar.waitForTimeout(1000)
  task = (await app.evaluate(() => globalThis.__orbit.tasks.list(1)))[0]
  if (task?.progress && !globalThis.seen?.includes(task.progress)) (globalThis.seen ??= []).push(task.progress)
}
check('shows progress while it runs', (globalThis.seen ?? []).some((p) => /Researching 1 of 1/.test(p)) && (globalThis.seen ?? []).includes('Writing the report'), (globalThis.seen ?? []).join(' > '))
check('finishes with a report', task?.status === 'done', task?.error ?? task?.status)
const report = task?.result ?? ''
check('the report cites sources', /## Sources/.test(report) && /\[1\]/.test(report) && /https?:\/\//.test(report), report.slice(0, 120).replace(/\n/g, ' '))
check('and says what it cost', /Used about \d+k tokens/.test(report), report.match(/Used about \d+k tokens/)?.[0])
check('it is saved as a file', readdirSync(join(dataDir, 'files')).some((f) => /research/.test(f) && f.endsWith('.md')))

await app.evaluate(() => globalThis.__orbit.settings.update((d) => (d.budget.backgroundDailyTokens = 50000)))
pending = tool('deep_research', { question: 'Anything', depth: 'thorough' })
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 15_000 })
await bar.click('button:has-text("Approve")')
r = await pending
check('refuses to start when the budget is too low', /Not started/.test(r.output), r.output.slice(0, 120))

await app.close()
process.exit(failed ? 1 : 0)
