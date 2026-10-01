// File safety e2e, built from a real failure: editing a file last changed months ago lost its
// backup (copies keep the original's date, and cleanup judged age by that date), and a blind
// whole-file write replaced a document with one word. Covers backups of old files surviving
// cleanup, delete/undo of old files, read-before-edit, line endings, trailing newlines, the diff
// on the approval card, and backups being verified. No model calls.
// Run: npm run build && node scripts/e2e-safety.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-safety-profile')
const work = join(dataDir, 'work')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
const ORIGINAL = '# Setup guide\n\nStep 1: install.\nStep 2: configure.\nStep 3: run.\n'
const old = (p) => utimesSync(p, new Date('2025-01-15'), new Date('2025-01-15'))
writeFileSync(join(work, 'guide.md'), ORIGINAL)
old(join(work, 'guide.md'))
writeFileSync(join(work, 'old-notes.txt'), 'keep me')
old(join(work, 'old-notes.txt'))
writeFileSync(join(work, 'windows.txt'), 'line one\r\nline two\r\n')
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, permissions: { level: 'full' }, files: { allowedFolders: [work], writableFolders: [work] } }))

const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input, 'chat'), { name, input })
const undoLast = (force = false) =>
  app.evaluate(async (_e, f) => {
    const [last] = await globalThis.__orbit.recentChanges()
    try {
      return { ok: globalThis.__orbit.undoChange(last.id, f) }
    } catch (err) {
      return { error: err.message }
    }
  }, force)
const cleanup = () => app.evaluate(() => globalThis.__orbit.runCleanup())
const read = (p) => readFileSync(p, 'utf8')
const guide = join(work, 'guide.md')

// Read before edit
let r = await tool('edit_file', { path: guide, content: 'placeholder' })
check('a file that was never read can not be edited', r.isError && /Read guide\.md with read_file first/.test(r.output), r.output.slice(0, 80))
check('and it is untouched', read(guide) === ORIGINAL)
await tool('read_file', { path: guide })
writeFileSync(guide, ORIGINAL + 'typed by you\n')
old(guide)
r = await tool('edit_file', { path: guide, edits: [{ find: 'Step 3: run.', replace: 'Step 3: run it.' }] })
check('a file that changed after reading can not be edited', r.isError && /changed since you read it/.test(r.output))
writeFileSync(guide, ORIGINAL)
old(guide)

// The original failure: old file, whole rewrite, cleanup, undo
await tool('read_file', { path: guide })
r = await tool('edit_file', { path: guide, content: 'placeholder' })
check('a whole rewrite still works after reading', !r.isError && read(guide) === 'placeholder\n', JSON.stringify(read(guide)))
await cleanup()
const snaps = readdirSync(join(dataDir, 'snapshots'))
check("an old file's backup survives cleanup", snaps.some((n) => read(join(dataDir, 'snapshots', n)) === ORIGINAL), `${snaps.length} backups`)
let u = await undoLast()
check('and undo brings the original back exactly', !u.error && read(guide) === ORIGINAL, u.error)

// Deleting an old file
r = await tool('delete_files', { paths: [join(work, 'old-notes.txt')] })
await cleanup()
u = await undoLast()
check('a deleted old file survives cleanup and comes back', !r.isError && !u.error && read(join(work, 'old-notes.txt')) === 'keep me', u.error)

// Endings
await tool('read_file', { path: guide })
for (const body of ['A\nB\n\n', 'A\nB\n\n\n', 'A\nB']) {
  r = await tool('edit_file', { path: guide, content: body })
  await tool('read_file', { path: guide })
}
check('repeated rewrites never pile up blank lines', read(guide) === 'A\nB\n', JSON.stringify(read(guide)))
const win = join(work, 'windows.txt')
await tool('read_file', { path: win })
r = await tool('edit_file', { path: win, edits: [{ find: 'line one\nline two', replace: 'line one\nline 1.5\nline two' }] })
check('finds match across Windows line endings, and they are kept', !r.isError && read(win) === 'line one\r\nline 1.5\r\nline two\r\n', JSON.stringify(read(win)))
r = await tool('edit_file', { path: win, edits: [{ find: 'x', replace: 'y' }], content: 'z' })
check('edits and content together are refused', r.isError && /not both/.test(r.output))

// Diff on the approval card
await app.evaluate(() => globalThis.__orbit.settings.update((d) => (d.permissions.level = 'careful')))
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
writeFileSync(guide, ORIGINAL)
await tool('read_file', { path: guide })
const pending = tool('edit_file', { path: guide, content: 'placeholder' })
await bar.waitForSelector('[data-diff]', { timeout: 15_000 })
const diff = await bar.locator('[data-diff]').innerText()
check('the approval card shows a diff', /-Step 1: install\./.test(diff) && /\+placeholder/.test(diff), diff.replace(/\n/g, ' | ').slice(0, 120))
check('and warns when most of the file would go', (await bar.locator('pre, [data-diff]').first().innerText()).length > 0 && (await bar.locator('text=Careful: this leaves').count()) === 1)
await bar.screenshot({ path: join(root, 'out', 'e2e', 'bar-diff.png') })
await bar.click('button:has-text("Deny")')
await pending
check('denied: unchanged', read(guide) === ORIGINAL)

await app.close()
process.exit(failed ? 1 : 0)
