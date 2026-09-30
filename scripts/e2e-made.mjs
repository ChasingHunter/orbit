// Temporary files e2e: files made while chatting start temporary, workflow files are kept, Keep
// and Save as work, the daily cleanup removes unused, saved-elsewhere and expired files but not
// opened or kept ones, and the chip shows each state. One small model call.
// Run: npm run build && node scripts/e2e-made.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-made-profile')
const files = join(dataDir, 'files')
const temp = join(files, 'Temporary')
const elsewhere = join(dataDir, 'my-downloads')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(elsewhere, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' }, permissions: { level: 'full' } }))

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({
  executablePath: exe,
  args: exe ? [] : [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir, ORBIT_MODELS_DIR: join(root, 'out', 'models-cache') }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const tool = (name, input, source) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input, a.source), { name, input, source })
const made = (fn, ...args) => app.evaluate((_e, a) => globalThis.__orbit.made[a.fn](...a.args), { fn, args })
const sql = (q, ...args) =>
  app.evaluate(
    (_e, { q, args }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
      return new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db')).prepare(q).run(...args).changes
    },
    { q, args }
  )
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString()
const doc = (name, source) => tool('make_file', { name, format: 'docx', markdown: `# ${name}` }, source)

let r = await doc('chat-doc', 'chat')
check('files made in a chat start temporary', !r.isError && existsSync(join(temp, 'chat-doc.docx')) && /Temporary/.test(r.output), r.output.split('\n')[0])
r = await doc('workflow-doc', 'workflow')
check('files made by a workflow are kept', !r.isError && existsSync(join(files, 'workflow-doc.docx')))
r = await tool('run_python', { description: 'x', code: "open('out.txt','w').write('hi')" }, 'chat')
check('Python output from a chat is temporary too', !r.isError && existsSync(join(temp, 'out.txt')), r.output.split('\n')[0])
check('a new file has 14 days', (await made('stateOf', join(temp, 'chat-doc.docx'))).daysLeft === 14)

// Keep
const kept = await made('keep', join(temp, 'out.txt'))
check('Keep moves it to the files folder for good', kept === join(files, 'out.txt') && existsSync(kept) && !existsSync(join(temp, 'out.txt')))

// Save a copy elsewhere (the dialog part is the OS's; this is what happens after it)
for (const n of ['saved', 'unused', 'opened', 'fresh']) await doc(n, 'chat')
await made('saveCopy', join(temp, 'saved.docx'), join(elsewhere, 'saved.docx'))
check('Save as copies it out', existsSync(join(elsewhere, 'saved.docx')))
check('and gives Orbit\'s copy 3 days', (await made('stateOf', join(temp, 'saved.docx'))).daysLeft === 3)

// Age them
await sql('UPDATE made_files SET created_at = ? WHERE path LIKE ?', ago(4), '%saved.docx')
await sql('UPDATE made_files SET created_at = ? WHERE path LIKE ?', ago(20), '%unused.docx')
await sql('UPDATE made_files SET created_at = ?, opened_at = ? WHERE path LIKE ?', ago(20), ago(1), '%opened.docx')
await sql('UPDATE made_files SET created_at = ? WHERE path LIKE ?', ago(20), '%chat-doc.docx')
await made('keep', join(temp, 'chat-doc.docx'))
await app.evaluate(() => globalThis.__orbit.runCleanup())
check('unused for 14 days: cleaned up', !existsSync(join(temp, 'unused.docx')))
check('saved elsewhere 4 days ago: cleaned up, your copy stays', !existsSync(join(temp, 'saved.docx')) && existsSync(join(elsewhere, 'saved.docx')))
check('opened recently: stays', existsSync(join(temp, 'opened.docx')))
check('new: stays', existsSync(join(temp, 'fresh.docx')))
check('kept: stays, however old', existsSync(join(files, 'chat-doc.docx')))
check('workflow files: stay', existsSync(join(files, 'workflow-doc.docx')))
r = await tool('read_file', { path: join(temp, 'unused.docx') })
check('reading a cleaned-up file says so', r.isError && /temporary file and has been cleaned up/.test(r.output), r.output.slice(0, 90))

// The chip, through the model
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.fill('textarea', 'Make a short Word document called packing-list with three things to pack for a beach trip.')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 120_000 })
await bar.waitForSelector('[data-made-file="temporary"]', { timeout: 5000 }).catch(() => {})
const chip = bar.locator('[data-made-file]').last()
check('the chip says it is temporary', /temporary, 14 days left/.test(await chip.innerText()), await chip.innerText())
await bar.screenshot({ path: join(root, 'out', 'e2e', 'bar-temporary-file.png') })
await chip.locator('button:has-text("Keep")').click()
await bar.waitForSelector('[data-made-file="kept"]')
check('Keep in the chip keeps it', existsSync(join(files, 'packing-list.docx')) && (await chip.innerText()).includes('kept'))

const storage = await app.evaluate(() => globalThis.__orbit.storageReport())
check('Storage shows temporary files separately', storage.items.some((i) => i.id === 'temporary'))

await app.close()
process.exit(failed ? 1 : 0)
