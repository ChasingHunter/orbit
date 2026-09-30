// Storage e2e: cleanup removes old logs, backups, attachment copies, run history, undo history,
// usage rows and unused Python packages by age and size, keeps what it should, shrinks the
// database, clips huge tool inputs in the log, and undo of a big own file works. No model calls.
// Run: npm run build && node scripts/e2e-storage.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-storage-profile')
const models = join(dataDir, 'models')
rmSync(dataDir, { recursive: true, force: true })
const old = (p, daysAgo) => utimesSync(p, new Date(Date.now() - daysAgo * 86_400_000), new Date(Date.now() - daysAgo * 86_400_000))
const MB = 1024 * 1024

// Rotated tool logs: two too old, and seven recent ones (only five are kept).
mkdirSync(join(dataDir, 'logs'), { recursive: true })
for (let i = 0; i < 9; i++) {
  const f = join(dataDir, 'logs', `audit-2026-0${i}.jsonl`)
  writeFileSync(f, 'x'.repeat(1000))
  old(f, i < 2 ? 120 : i)
}
// Attachments: an old day, and three recent days over a 100 MB cap.
for (const [d, mb] of [['2020-01-01', 1], ['2026-09-27', 45], ['2026-09-28', 45], ['2026-09-29', 45]]) {
  mkdirSync(join(dataDir, 'attachments', d), { recursive: true })
  writeFileSync(join(dataDir, 'attachments', d, 'a.bin'), Buffer.alloc(mb * MB))
}
// Backups: one expired.
mkdirSync(join(dataDir, 'snapshots'), { recursive: true })
writeFileSync(join(dataDir, 'snapshots', '1-old.txt'), 'old')
old(join(dataDir, 'snapshots', '1-old.txt'), 40)
writeFileSync(join(dataDir, 'snapshots', '2-new.txt'), 'new')
// Python packages from an older Pyodide.
mkdirSync(join(models, 'pyodide', '0.1.0'), { recursive: true })
writeFileSync(join(models, 'pyodide', '0.1.0', 'old.whl'), 'x')

writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ voice: { engine: 'off' }, permissions: { level: 'full' }, storage: { attachmentsMaxMb: 100, logDays: 90, workflowRunDays: 30, chatDays: 0 } })
)

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({
  executablePath: exe,
  args: exe ? [] : [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir, ORBIT_MODELS_DIR: models }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const sql = (q, ...args) =>
  app.evaluate(
    (_e, { q, args }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
      const db = new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
      const st = db.prepare(q)
      return /^\s*select/i.test(q) ? st.all(...args) : st.run(...args).changes
    },
    { q, args }
  )
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input), { name, input })
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString()

// Make sure every table exists, then seed history.
await app.evaluate(() => globalThis.__orbit.workflows.runs(undefined, 1))
await app.evaluate(() => globalThis.__orbit.recentChanges())
const big = 'y'.repeat(3000)
for (let i = 0; i < 30; i++) await sql('INSERT INTO workflow_runs (id, workflow, trigger, status, output, started_at) VALUES (?, ?, ?, ?, ?, ?)', `a${i}`, 'hourly-check', 'schedule', 'done', big, ago(60 + i))
for (let i = 0; i < 5; i++) await sql('INSERT INTO workflow_runs (id, workflow, trigger, status, output, started_at) VALUES (?, ?, ?, ?, ?, ?)', `b${i}`, 'monthly', 'schedule', 'done', big, ago(60 + i))
for (let i = 0; i < 30; i++) await sql('INSERT INTO workflow_steps (run_id, step_id, kind, status, output, started_at) VALUES (?, ?, ?, ?, ?, ?)', `a${i}`, 's1', 'tool', 'done', big, ago(60 + i))
for (let i = 0; i < 2000; i++) await sql('INSERT INTO journal (at, source, summary, undo) VALUES (?, ?, ?, ?)', ago(40), 'Orbit', 'old change', JSON.stringify({ kind: 'memory-added', id: 1, pad: 'z'.repeat(20000) }))
await sql('INSERT INTO journal (at, source, summary, undo) VALUES (?, ?, ?, ?)', ago(1), 'Orbit', 'recent change', JSON.stringify({ kind: 'memory-added', id: 1 }))
await sql('CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY, at TEXT NOT NULL, source TEXT NOT NULL, label TEXT, model TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL)')
await sql('INSERT INTO usage (at, source, label, model, input, output, cache_read, cache_write) VALUES (?, ?, ?, ?, 1, 1, 0, 0)', ago(500), 'chat', 'x', 'm')
await sql('INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', 'old-chat', 'Old chat', 'm', ago(200), ago(200))
const dbSize = () => readFileSync(join(dataDir, 'orbit.db')).length + (existsSync(join(dataDir, 'orbit.db-wal')) ? readFileSync(join(dataDir, 'orbit.db-wal')).length : 0)

// Undo of a big file in Orbit's own folder (used to delete it instead of restoring it).
const first = 'a'.repeat(6 * MB)
await tool('save_file', { name: 'big.txt', content: first })
await tool('save_file', { name: 'big.txt', content: 'short' })
await app.evaluate(async () => {
  const [last] = await globalThis.__orbit.recentChanges()
  return globalThis.__orbit.undoChange(last.id)
})
const restored = existsSync(join(dataDir, 'files', 'big.txt')) ? readFileSync(join(dataDir, 'files', 'big.txt'), 'utf8') : ''
check('undo brings back a big overwritten file', restored.length === first.length, `${restored.length} chars`)

// The 6 MB write is in the tool log, clipped.
const auditLine = readFileSync(join(dataDir, 'logs', 'audit.jsonl'), 'utf8').split('\n').find((l) => l.includes('"big.txt"'))
check('huge tool inputs are clipped in the log', auditLine && auditLine.length < 5000, `${auditLine?.length} chars`)

const before = dbSize()
const report = await app.evaluate(() => globalThis.__orbit.runCleanup())
const logs = readdirSync(join(dataDir, 'logs')).filter((n) => n.startsWith('audit-'))
check('old rotated logs go, the newest five stay', logs.length === 5 && !logs.includes('audit-2026-00.jsonl'), logs.join(', '))
const days = readdirSync(join(dataDir, 'attachments')).sort()
check('attachments: old day and oldest over the cap go, newest stays', days.join(',') === '2026-09-28,2026-09-29', days.join(','))
check('expired backups go', !existsSync(join(dataDir, 'snapshots', '1-old.txt')) && existsSync(join(dataDir, 'snapshots', '2-new.txt')))
check('backups still needed for undo stay', readdirSync(join(dataDir, 'snapshots')).length >= 2)
const runs = await sql("SELECT workflow, COUNT(*) n FROM workflow_runs GROUP BY workflow ORDER BY workflow")
check('old workflow runs go, the latest 20 per workflow stay', JSON.stringify(runs) === JSON.stringify([{ workflow: 'hourly-check', n: 20 }, { workflow: 'monthly', n: 5 }]), JSON.stringify(runs))
for (let i = 0; i < 3100; i++) await sql('INSERT INTO workflow_runs (id, workflow, trigger, status, started_at) VALUES (?, ?, ?, ?, ?)', `c${i}`, 'every-5-min', 'schedule', 'done', ago(i / 300))
await app.evaluate(() => globalThis.__orbit.runCleanup())
const total = (await sql('SELECT COUNT(*) n FROM workflow_runs'))[0].n
check('run history never goes over 3,000 runs, plus the latest 20 per workflow', total <= 3025 && total >= 3000, String(total))
await sql("DELETE FROM workflow_runs WHERE workflow = 'every-5-min'")
check('their step logs go too', (await sql('SELECT COUNT(*) n FROM workflow_steps'))[0].n === 20)
const journal = await sql('SELECT summary FROM journal')
check('undo history older than the backups goes', !journal.some((j) => j.summary === 'old change') && journal.some((j) => j.summary === 'recent change'))
check('year-old usage rows go', (await sql('SELECT COUNT(*) n FROM usage WHERE at < ?', ago(400)))[0].n === 0)
check('chats are kept by default', (await sql("SELECT COUNT(*) n FROM conversations WHERE id = 'old-chat'"))[0].n === 1)
check('packages for an old Python go', !existsSync(join(models, 'pyodide', '0.1.0')))
const after = dbSize()
check('the database file shrinks', after < before - 20 * MB, `${Math.round(before / MB)} MB -> ${Math.round(after / MB)} MB`)
check('the report adds up what it freed', report.freed > 80 * MB && report.freed < 100 * MB, `${Math.round(report.freed / MB)} MB`)

await app.evaluate(() => globalThis.__orbit.settings.update((d) => (d.storage.chatDays = 90)))
await app.evaluate(() => globalThis.__orbit.runCleanup())
check('a chat limit removes older chats', (await sql("SELECT COUNT(*) n FROM conversations WHERE id = 'old-chat'"))[0].n === 0)

// Storage card
await app.evaluate(() => globalThis.__orbit.openDashboard('usage'))
let dash
for (let i = 0; i < 20 && !dash; i++) {
  dash = app.windows().find((w) => w.url().includes('dashboard'))
  if (!dash) await bar.waitForTimeout(250)
}
await dash.waitForSelector('text=Storage')
check('Storage card lists each kind of data', (await dash.locator('[data-storage]').count()) === 7)
await dash.click('button:has-text("Clean up now")')
await dash.waitForSelector('text=Last cleanup')
check('Clean up now runs and reports', await dash.locator('text=Last cleanup').isVisible())
await dash.locator('text=Storage').scrollIntoViewIfNeeded()
await dash.screenshot({ path: join(root, 'out', 'e2e', 'dash-storage.png') })

await app.close()
process.exit(failed ? 1 : 0)
