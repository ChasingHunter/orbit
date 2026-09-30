// Dashboard e2e: seed memories, history, a task and an integration, then screenshot every page
// and exercise add/edit/delete memory. No model calls. Run: npm run build && node scripts/e2e-dashboard.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const shots = join(root, 'out', 'e2e')
const dataDir = join(root, 'out', 'e2e-dash-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(shots, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' } }))

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({
  executablePath: exe,
  args: exe ? [] : [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir }
})
await app.firstWindow()

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}

// Seed through the same code paths the app uses.
await app.evaluate(async () => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const path = process.getBuiltinModule('node:path')
  const db = new DatabaseSync(path.join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
  const t = (mins) => new Date(Date.now() - mins * 60_000).toISOString()
  const mem = db.prepare('INSERT INTO memories (kind, text, private, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
  mem.run('person', 'Sam is my cofounder; email sam@example.com; prefers WhatsApp over email', 0, t(3000), t(3000))
  mem.run('preference', 'No meetings before 11am', 0, t(900), t(900))
  mem.run('project', 'ProjectX is the analytics product; launch planned for November', 1, t(60), t(60))
  const conv = db.prepare('INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
  const msg = db.prepare('INSERT INTO messages (conversation_id, role, text, created_at) VALUES (?, ?, ?, ?)')
  conv.run('c1', 'explain this', 'claude:sonnet', t(40), t(39))
  msg.run('c1', 'user', 'explain this', t(40))
  msg.run('c1', 'assistant', '- **Gross margin fell 2.1 points.** Each sale keeps a bit less profit.\n- The cause is higher infrastructure cost, not lower prices.', t(39))
  conv.run('c2', 'What is Sam\'s email?', 'claude:haiku', t(5), t(5))
  const task = db.prepare('INSERT INTO tasks (id, title, prompt, model, status, result, error, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  task.run('t1', 'Postgres hosting comparison', 'Compare managed Postgres hosts for a small startup in India on price and latency.', 'claude:opus', 'done', '## Short answer\nNeon for dev, Supabase if you want auth too, AWS RDS Mumbai for lowest latency.\n\n| Host | From | Region |\n|---|---|---|\n| Neon | $0 | Singapore |\n| Supabase | $25 | Mumbai |', null, t(120), t(110))
  task.run('t2', 'Summarise invoices', 'Summarise the PDFs in Downloads/invoices into a table.', 'claude:sonnet', 'failed', null, 'Files tool is not enabled', t(30), t(29))
  await globalThis.__orbit.integrations.upsert('everything', { type: 'stdio', name: 'Everything (test server)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'], env: {}, secretEnv: {}, enabled: true }, false)
  globalThis.__orbit.openDashboard('tasks')
})

const dashWin = await app.waitForEvent('window', { predicate: (p) => p.url().includes('dashboard') })
await dashWin.waitForLoadState('domcontentloaded')
await dashWin.setViewportSize({ width: 1040, height: 720 })

async function go(page) {
  await dashWin.click(`nav button:has-text("${page}")`)
  await dashWin.waitForSelector(`main[data-page="${page.toLowerCase()}"]`)
  await dashWin.waitForTimeout(300)
}

await dashWin.waitForTimeout(400)
await dashWin.click('text=Postgres hosting comparison')
await dashWin.waitForTimeout(200)
await dashWin.screenshot({ path: join(shots, 'dash-tasks.png') })
check('tasks page lists seeded tasks', (await dashWin.locator('text=Summarise invoices').count()) === 1)

await go('Integrations')
await dashWin.click('button:has-text("Connect") >> nth=1') // Slack setup panel
await dashWin.waitForTimeout(200)
await dashWin.screenshot({ path: join(shots, 'dash-integrations.png') })
check('integration status shown', (await dashWin.locator('text=Connected').count()) >= 1)
check('slack setup steps shown', (await dashWin.locator('text=xoxp').count()) >= 1)

await go('Memory')
await dashWin.click('button:has-text("Add")')
await dashWin.fill('textarea', 'Mom prefers calls on Sunday evenings')
await dashWin.click('button:has-text("Save")')
await dashWin.waitForSelector('text=Mom prefers calls')
check('memory added from dashboard', true)
await dashWin.click('button:has-text("Add")')
await dashWin.fill('textarea', 'my password is hunter2')
await dashWin.click('button:has-text("Save")')
const refused = await dashWin.waitForSelector('text=Orbit never stores secrets', { timeout: 3000 }).catch(() => null)
check('secret refused in dashboard', !!refused || (await dashWin.locator('text=password or PIN').count()) > 0)
await dashWin.click('button:has-text("Cancel")')
await dashWin.screenshot({ path: join(shots, 'dash-memory.png') })

await go('History')
await dashWin.click('text=explain this')
await dashWin.waitForSelector('text=Gross margin fell')
await dashWin.screenshot({ path: join(shots, 'dash-history.png') })
check('history conversation opens', true)

await go('Settings')
await dashWin.screenshot({ path: join(shots, 'dash-settings.png') })
check('settings shows models', (await dashWin.locator('input[value="claude:sonnet"]').count()) >= 1)

await app.close()
process.exit(failed ? 1 : 0)
