// Background tasks e2e: hand off a job, check it finishes and saves a file; then run parallel sub-agents.
// Run: npm run build && node scripts/e2e-tasks.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-tasks-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku', research: 'claude:haiku' } })
)

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({
  executablePath: exe,
  args: exe ? [] : [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
await app.evaluate(() => globalThis.__orbit.onBarHotkey())

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
async function ask(text) {
  const before = await bar.locator('[data-state="done"]').count()
  await bar.fill('textarea', text)
  await bar.keyboard.press('Enter')
  await bar.waitForFunction((n) => document.querySelectorAll('[data-state="done"]').length > n, before, { timeout: 120_000 })
  return (await bar.locator('[data-state="done"]').last().innerText()).replace(/\s+/g, ' ')
}

const t0 = Date.now()
const started = await ask('In the background, write me a 3-line poem about satellites. Call the task "satellite poem".')
check('handed off quickly', /start_background_task/.test(started) && Date.now() - t0 < 60_000, started.slice(0, 120))

let task
for (let i = 0; i < 60 && task?.status !== 'done' && task?.status !== 'failed'; i++) {
  await bar.waitForTimeout(2000)
  task = await app.evaluate(() => globalThis.__orbit.tasks.list()[0])
}
check('background task finished', task?.status === 'done', `${task?.status} ${task?.error ?? ''}`)
const files = existsSync(join(dataDir, 'files')) ? readdirSync(join(dataDir, 'files')) : []
check('result saved to files/', files.some((f) => f.endsWith('.md')), files.join(', '))

const parallel = await ask(
  'Use spawn_agents with two agents: one answers "what is 17 times 23", the other answers "what is the capital of Australia". Then give me both answers.'
)
check('spawn_agents ran both', /spawn_agents/.test(parallel) && parallel.includes('391') && /Canberra/.test(parallel), parallel.slice(0, 200))
await bar.screenshot({ path: join(root, 'out', 'e2e', 'tasks.png') })

await app.close()
process.exit(failed ? 1 : 0)
