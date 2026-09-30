// Undo journal: every kind of change to Orbit's own things can be reversed, from the Logs page
// and by asking. One small model call. Run: npm run build && node scripts/e2e-undo.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-undo-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(join(dataDir, 'files'), { recursive: true })
mkdirSync(join(root, 'out', 'e2e'), { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku' }, permissions: { level: 'full' } }))

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({ executablePath: exe, args: exe ? [] : [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
await app.evaluate(() => globalThis.__orbit.scheduler.start())

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input), { name, input })
const undoLast = () => app.evaluate(async () => {
  const [last] = await globalThis.__orbit.recentChanges()
  return globalThis.__orbit.undoChange(last.id)
})
const sql = (q) => app.evaluate((_e, s) => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  return new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db')).prepare(s).all()
}, q)
const file = join(dataDir, 'files', 'note.md')

// files
await tool('save_file', { name: 'note.md', content: 'first' })
await undoLast()
check('undo a new file removes it', !existsSync(file))
await tool('save_file', { name: 'note.md', content: 'first' })
await tool('save_file', { name: 'note.md', content: 'second' })
await undoLast()
check('undo an overwrite brings the old content back', readFileSync(file, 'utf8') === 'first')

// memories
await tool('remember', { text: 'My gym is Cult Fit on MG Road' })
await undoLast()
check('undo remember', (await sql('SELECT COUNT(*) n FROM memories'))[0].n === 0)
await tool('remember', { text: 'Sam is my cofounder' })
const [{ id }] = await sql('SELECT id FROM memories')
await tool('forget', { id })
await undoLast()
check('undo forget brings the memory back', (await sql("SELECT text FROM memories"))[0]?.text === 'Sam is my cofounder')

// reminders
const at = new Date(Date.now() + 3600_000).toISOString()
await tool('set_reminder', { text: 'Stretch', at })
await undoLast()
check('undo a reminder', (await sql("SELECT COUNT(*) n FROM schedules WHERE kind = 'reminder'"))[0].n === 0)
await tool('set_reminder', { text: 'Call mom', at })
const [{ id: rid }] = await sql("SELECT id FROM schedules WHERE kind = 'reminder'")
await tool('cancel_reminder', { id: rid.slice(0, 8) })
await undoLast()
const back = await app.evaluate((_e, i) => {
  const s = globalThis.__orbit.scheduler.get(i)
  return s && { title: s.title, next: globalThis.__orbit.scheduler.nextRunOf(s)?.toISOString() }
}, rid)
check('undo cancel puts the reminder back and schedules it', back?.title === 'Call mom' && !!back.next, JSON.stringify(back))

// workflows
const wfFile = join(dataDir, 'workflows', 'undo-me.yaml')
await tool('create_workflow', { yaml: 'name: undo-me\nsteps:\n  - id: n\n    tool: notify\n    args: { title: t, body: b }\n' })
await undoLast()
check('undo creating a workflow', !existsSync(wfFile))
await tool('create_workflow', { yaml: 'name: undo-me\nsteps:\n  - id: n\n    tool: notify\n    args: { title: t, body: b }\n' })
await tool('delete_workflow', { name: 'undo-me' })
await undoLast()
check('undo deleting a workflow', existsSync(wfFile))

// double undo is refused
const again = await app.evaluate(async () => {
  const [last] = await globalThis.__orbit.recentChanges()
  try {
    globalThis.__orbit.undoChange(last.id)
    return 'undone twice'
  } catch (e) {
    return e.message
  }
})
check('a change can only be undone once', /already undone/.test(again), again)

// "undo that" in chat
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.fill('textarea', 'Remember that my locker code is at the front desk, not with me.')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 90_000 })
const before = (await sql('SELECT COUNT(*) n FROM memories'))[0].n
await bar.fill('textarea', 'Actually undo that.')
await bar.keyboard.press('Enter')
await bar.waitForFunction(() => document.querySelectorAll('[data-state="done"]').length > 1, null, { timeout: 90_000 })
const after = (await sql('SELECT COUNT(*) n FROM memories'))[0].n
check('"undo that" in chat reverses the last change', after === before - 1, `${before} -> ${after}`)

// Logs page Undo button
await app.evaluate(() => globalThis.__orbit.openDashboard('logs'))
const d = await app.waitForEvent('window', { predicate: (p) => p.url().includes('dashboard') })
await d.waitForLoadState('domcontentloaded')
await d.setViewportSize({ width: 1040, height: 800 })
await d.waitForSelector('text=Recent changes')
await d.screenshot({ path: join(root, 'out', 'e2e', 'dash-changes.png') })
const n1 = (await sql('SELECT COUNT(*) n FROM journal WHERE undone_at IS NULL'))[0].n
await d.locator('button:has-text("Undo")').first().click()
await d.waitForTimeout(500)
const n2 = (await sql('SELECT COUNT(*) n FROM journal WHERE undone_at IS NULL'))[0].n
check('Undo button on the Logs page works', n2 === n1 - 1, `${n1} -> ${n2}`)

await app.close()
process.exit(failed ? 1 : 0)
