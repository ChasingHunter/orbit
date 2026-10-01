// Writing to the user's folders e2e: only writable folders, blocked file types, links can't lead
// out, every change backed up and undoable (batches as one), conflicts caught, approval card
// preview, Settings toggle, Logs "Undo anyway", and one real model call doing a batch rename.
// Run: npm run build && node scripts/e2e-writes.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-writes-profile')
const work = join(dataDir, 'work') // writable
const ref = join(dataDir, 'reference') // read-only
const secret = join(dataDir, 'private')
const snaps = join(dataDir, 'snapshots')
rmSync(dataDir, { recursive: true, force: true })
for (const d of [work, ref, secret, join(dataDir, 'files'), snaps]) mkdirSync(d, { recursive: true })
symlinkSync(secret, join(work, 'sneaky'), 'junction')
writeFileSync(join(ref, 'keep.txt'), 'read only')
writeFileSync(join(work, 'notes.md'), '# Notes\n\nStatus: draft\nOwner: me\n')
writeFileSync(join(dataDir, 'files', 'report.md'), '# Report made by Orbit\n')
const blob = randomBytes(300_000)
writeFileSync(join(work, 'photo.bin'), blob)
for (const [n, id] of [['scan_001.pdf', 17], ['scan_002.pdf', 18], ['scan_003.pdf', 19]]) writeFileSync(join(work, n), `%PDF fake invoice ${id}`)
// A stale backup that pruning should remove.
const STALE = `${Date.parse('2020-01-01')}-old.txt`
writeFileSync(join(snaps, STALE), 'stale')

writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({
    voice: { engine: 'off' },
    models: { chat: 'claude:haiku', quick: 'claude:haiku' },
    permissions: { level: 'full' },
    files: { allowedFolders: [work, ref], writableFolders: [work], snapshotDays: 30 }
  })
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
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input), { name, input })
const lastChange = () => app.evaluate(async () => (await globalThis.__orbit.recentChanges())[0])
const undoLast = (force = false) =>
  app.evaluate(async (_e, f) => {
    const [last] = await globalThis.__orbit.recentChanges()
    try {
      return { ok: globalThis.__orbit.undoChange(last.id, f) }
    } catch (err) {
      return { error: err.message, conflict: !!err.conflict }
    }
  }, force)
const read = (p) => readFileSync(p, 'utf8')
const setSettings = (fn) => app.evaluate((_e, src) => globalThis.__orbit.settings.update(new Function('d', src)), fn)

// Tools only exist when a folder is writable.
const names = async () => (await app.evaluate(() => globalThis.__orbit.measureTools())).map((t) => t.name)
check('write tools offered when a folder is writable', (await names()).includes('move_files'))
await setSettings('d.files.writableFolders = []')
check('and hidden when none is', !(await names()).some((n) => ['create_file', 'edit_file', 'move_files', 'delete_files', 'copy_file'].includes(n)))
await setSettings(`d.files.writableFolders = [${JSON.stringify(work)}]`)

// Create
let r = await tool('create_file', { path: join(work, 'todo.txt'), content: 'buy milk' })
check('creates a file in a writable folder', !r.isError && read(join(work, 'todo.txt')) === 'buy milk', r.output)
r = await tool('create_file', { path: join(work, 'todo.txt'), content: 'again' })
check('never overwrites on create', r.isError && /already exists/.test(r.output))
r = await tool('create_file', { path: join(ref, 'x.txt'), content: 'x' })
check('refuses a read-only folder', r.isError && /can't change files in/.test(r.output), r.output.slice(0, 80))
r = await tool('create_file', { path: join(work, 'run.bat'), content: 'echo hi' })
check('refuses files that run when opened', r.isError && /\.bat/.test(r.output))
r = await tool('create_file', { path: join(work, 'sneaky', 'x.txt'), content: 'x' })
check('a junction can\'t lead out', r.isError && !existsSync(join(secret, 'x.txt')), r.output.slice(0, 80))
check('stale backups are pruned', !existsSync(join(snaps, STALE)))
await undoLast()
check('undo removes a created file', !existsSync(join(work, 'todo.txt')))

// Edit (read first, as the model must)
await tool('read_file', { path: join(work, 'notes.md') })
r = await tool('edit_file', { path: join(work, 'notes.md'), edits: [{ find: 'Status: draft', replace: 'Status: final' }] })
check('edits by find and replace', !r.isError && read(join(work, 'notes.md')).includes('Status: final'))
r = await tool('edit_file', { path: join(work, 'notes.md'), edits: [{ find: 'e', replace: 'E' }] })
check('refuses an ambiguous find', r.isError && /appears \d+ times/.test(r.output))
r = await tool('edit_file', { path: join(work, 'photo.bin'), content: 'x' })
check('only edits text files', r.isError && /Only text files/.test(r.output))
writeFileSync(join(work, 'notes.md'), read(join(work, 'notes.md')) + 'Added by me later\n')
let u = await undoLast()
check('undo stops if you changed the file since', u.conflict && /changed after Orbit edited it/.test(u.error), u.error)
const before = readdirSync(snaps).length
u = await undoLast(true)
check('undo anyway restores the original', !u.error && read(join(work, 'notes.md')).includes('Status: draft'))
check('and keeps your newer version as a backup', readdirSync(snaps).length === before + 1 && readdirSync(snaps).some((n) => read(join(snaps, n)).includes('Added by me later')))

// Batch rename: one entry, one undo
r = await tool('move_files', { moves: [{ from: join(work, 'scan_001.pdf'), to: 'invoice-17.pdf' }, { from: join(work, 'scan_002.pdf'), to: 'invoice-18.pdf' }, { from: join(work, 'scan_003.pdf'), to: 'invoice-19.pdf' }] })
check('renames a batch', !r.isError && ['invoice-17.pdf', 'invoice-18.pdf', 'invoice-19.pdf'].every((n) => existsSync(join(work, n))))
check('as one journal entry', /Renamed 3 files/.test((await lastChange()).summary), (await lastChange()).summary)
r = await tool('move_files', { moves: [{ from: join(work, 'invoice-17.pdf'), to: 'same.pdf' }, { from: join(work, 'invoice-18.pdf'), to: 'same.pdf' }] })
check('refuses two files ending up with one name, before moving any', r.isError && existsSync(join(work, 'invoice-17.pdf')))
await undoLast()
check('one undo puts all three back', ['scan_001.pdf', 'scan_002.pdf', 'scan_003.pdf'].every((n) => existsSync(join(work, n))))

// Delete (binary safe)
r = await tool('delete_files', { paths: [join(work, 'photo.bin')] })
check('deletes', !r.isError && !existsSync(join(work, 'photo.bin')))
await undoLast()
check('undo brings back the exact bytes', existsSync(join(work, 'photo.bin')) && readFileSync(join(work, 'photo.bin')).equals(blob))

// Copy out of Orbit's files folder
r = await tool('copy_file', { from: join(dataDir, 'files', 'report.md'), to: work })
check('copies a file Orbit made into your folder', !r.isError && read(join(work, 'report.md')).includes('Report made by Orbit'))
r = await tool('copy_file', { from: join(dataDir, 'files', 'report.md'), to: work })
check('never overwrites on copy', r.isError && /already exists/.test(r.output))

// Approval card preview (Careful asks before destructive tools)
await setSettings("d.permissions.level = 'careful'")
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
const pending = tool('move_files', { moves: [{ from: join(work, 'scan_001.pdf'), to: 'a.pdf' }, { from: join(work, 'scan_002.pdf'), to: 'b.pdf' }] })
await bar.waitForSelector('text=APPROVAL NEEDED')
const card = await bar.locator('pre').last().innerText()
check('approval card lists each rename', card.includes('scan_001.pdf, renamed to a.pdf') && card.includes('scan_002.pdf, renamed to b.pdf'), card.replace(/\n/g, ' | '))
check('card title says what it does', await bar.locator('text=Move or rename 2 files').isVisible())
await bar.screenshot({ path: join(root, 'out', 'e2e', 'bar-approval-rename.png') })
await bar.click('button:has-text("Deny")')
r = await pending
check('deny changes nothing', r.isError && existsSync(join(work, 'scan_001.pdf')))

// The model doing it, end to end, with the card.
await bar.fill('textarea', `In ${work}, rename scan_001.pdf, scan_002.pdf and scan_003.pdf to invoice-17.pdf, invoice-18.pdf and invoice-19.pdf, in one go.`)
await bar.keyboard.press('Enter')
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 90_000 })
check('the model batches the renames into one approval', (await bar.locator('pre').last().innerText()).split('\n').filter((l) => l.includes('renamed to')).length === 3)
await bar.click('button:has-text("Approve")')
await bar.waitForSelector('[data-state="done"]', { timeout: 90_000 })
check('and they happen', ['invoice-17.pdf', 'invoice-18.pdf', 'invoice-19.pdf'].every((n) => existsSync(join(work, n))))

// Dashboard: toggle and Logs undo with a conflict
writeFileSync(join(work, 'invoice-17.pdf'), 'changed by me')
await app.evaluate(() => globalThis.__orbit.openDashboard('logs'))
let dash
for (let i = 0; i < 20 && !dash; i++) {
  dash = app.windows().find((w) => w.url().includes('dashboard'))
  if (!dash) await bar.waitForTimeout(250)
}
await dash.waitForSelector('text=Recent changes')
await dash.locator('button:has-text("Undo")').first().click()
await dash.waitForSelector('text=Undo anyway')
check('Logs asks before undoing over your changes', await dash.locator('text=was changed after Orbit moved it').isVisible())
await dash.click('button:has-text("Undo anyway")')
await dash.waitForFunction(() => document.body.innerText.includes('undone'))
check('Undo anyway moves them back', ['scan_001.pdf', 'scan_002.pdf', 'scan_003.pdf'].every((n) => existsSync(join(work, n))))

await dash.evaluate(() => {
  const btn = [...document.querySelectorAll('nav button, aside button, a')].find((b) => b.textContent.trim() === 'Settings')
  btn?.click()
})
await dash.waitForSelector('text=Folders Orbit can use')
const boxes = dash.locator('label:has-text("Orbit can change files here") input')
check('Settings shows which folders are writable', (await boxes.count()) === 2 && (await boxes.nth(0).isChecked()) && !(await boxes.nth(1).isChecked()))
await boxes.nth(1).click()
await dash.waitForFunction(() => document.querySelectorAll("label input[type=checkbox]:checked").length === 2, null, { timeout: 5000 }).catch(() => {})
const saved = JSON.parse(read(join(dataDir, 'settings.json')))
check('turning one on saves it', saved.files.writableFolders.includes(ref), JSON.stringify(saved.files.writableFolders))
await dash.screenshot({ path: join(root, 'out', 'e2e', 'dash-folders.png') })

await app.close()
process.exit(failed ? 1 : 0)
