// UX fixes from the first round of hands-on testing: the bar's header stays after a new chat, a
// chat keeps its context when tools change mid-way (e.g. a folder was just allowed), History shows
// the model that answered, file paths in History are links, and Logs shows the diff of an edit.
// Two small model calls.
// Run: npm run build && node scripts/e2e-ux.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-ux-profile')
const work = join(dataDir, 'work')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
writeFileSync(join(work, 'notes.md'), 'one\ntwo\n')
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:sonnet', quick: 'claude:haiku' }, permissions: { level: 'full' }, files: { allowedFolders: [work], writableFolders: [] } })
)
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
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
const ask = async (text, n) => {
  await bar.fill('textarea', text)
  await bar.keyboard.press('Enter')
  await bar.waitForFunction((k) => document.querySelectorAll('[data-state="done"]').length >= k, n, { timeout: 90_000 })
  return bar.locator('[data-state="done"]').last().innerText()
}

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.waitForSelector('textarea')
check('the header is there on a fresh bar', await bar.locator('[data-bar-header]').isVisible())
await bar.selectOption('select[aria-label="Model for this chat"]', 'claude:haiku')
await ask('Remember for this chat only: my code word is MANGO. Just reply OK.', 1)
// Allowing a folder mid-chat adds tools, which needs a new model session.
await app.evaluate((_e, w) => globalThis.__orbit.settings.update((d) => (d.files.writableFolders = [w])), work)
const answer = await ask('What is my code word? One word.', 2)
check('the chat keeps its context when tools change mid-way', /MANGO/i.test(answer), answer.replace(/\s+/g, ' ').slice(0, 80))
const conv = await sql('SELECT model FROM conversations')
check('History records the model that actually answered', conv[0]?.model === 'claude:haiku', conv[0]?.model)
await bar.keyboard.press('Control+N')
await bar.waitForTimeout(300)
check('the header is still there after a new chat', await bar.locator('[data-bar-header]').isVisible())

// A file edit, then Logs and History
await app.evaluate((_e, p) => globalThis.__orbit.callTool('read_file', { path: p }, 'chat'), join(work, 'notes.md'))
await app.evaluate((_e, p) => globalThis.__orbit.callTool('edit_file', { path: p, edits: [{ find: 'two', replace: 'three' }] }, 'chat'), join(work, 'notes.md'))
await app.evaluate((_e, p) => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
  const t = new Date().toISOString()
  db.prepare('INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('c-paths', 'Paths', 'claude:haiku', t, t)
  db.prepare('INSERT INTO messages (conversation_id, role, text, created_at) VALUES (?, ?, ?, ?)').run('c-paths', 'assistant', `Saved your chart to ${p} and also \`${p}\`.`, t)
}, join(work, 'notes.md'))
await app.evaluate(() => globalThis.__orbit.openDashboard('history'))
let dash
for (let i = 0; i < 20 && !dash; i++) {
  dash = app.windows().find((w) => w.url().includes('dashboard'))
  if (!dash) await bar.waitForTimeout(250)
}
await dash.waitForSelector('text=Paths')
await dash.click('text=Paths')
await dash.waitForSelector('[data-path]', { timeout: 5000 }).catch(() => {})
check('file paths in History are links', (await dash.locator('[data-path]').count()) === 2)
await dash.evaluate(() => {
  const btn = [...document.querySelectorAll('nav button, aside button, a')].find((b) => b.textContent.trim() === 'Logs')
  btn?.click()
})
await dash.waitForSelector('text=Show changes')
await dash.click('text=Show changes')
const diff = await dash.locator('[data-diff]').innerText()
check('Logs shows the diff of an edit', /-two/.test(diff) && /\+three/.test(diff), diff.replace(/\n/g, ' | ').slice(0, 80))
await dash.screenshot({ path: join(root, 'out', 'e2e', 'dash-logs-diff.png') })

await app.close()
process.exit(failed ? 1 : 0)
