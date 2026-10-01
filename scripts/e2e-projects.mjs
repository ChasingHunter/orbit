// Projects e2e: pinned files are indexed and the matching part reaches the model without a tool
// call, changed and removed files are reindexed, memories stay with their project, chats are
// tagged, and the bar and dashboard show projects. One small model call.
// Run: npm run build && node scripts/e2e-projects.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-projects-profile')
const folder = join(dataDir, 'kitchen-docs')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(folder, { recursive: true })
const filler = (n) => Array.from({ length: n }, (_, i) => `Line ${i}: general notes about cabinets, paint colours and lighting options.`).join('\n')
writeFileSync(join(folder, 'suppliers.md'), `${filler(60)}\n\nThe tile supplier is Azulejo Brothers and their quote was 4,200 EUR.\n\n${filler(60)}`)
writeFileSync(join(folder, 'old.txt'), 'The plumber is Rivera Plumbing.')
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' } }))

const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const P = (fn, ...args) => app.evaluate((_e, a) => globalThis.__orbit.projects[a.fn](...a.args), { fn, args })
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input, 'chat'), { name, input })

const id = await P('saveProject', { name: 'Kitchen', instructions: 'Answer in one short sentence.' })
await P('addPath', id, folder)
let proj = await P('getProject', id)
check('pinned folder is indexed in chunks', proj.files === 2 && proj.chunks > 3, `${proj.files} files, ${proj.chunks} chunks`)
check('search finds the right chunk', (await P('searchProject', id, 'tile supplier quote'))[0]?.text.includes('Azulejo'))

writeFileSync(join(folder, 'suppliers.md'), 'The tile supplier is now Ceramica Nova.')
unlinkSync(join(folder, 'old.txt'))
await P('indexProject', id)
proj = await P('getProject', id)
check('changed and removed files are reindexed', proj.files === 1 && (await P('searchProject', id, 'tile supplier'))[0]?.text.includes('Ceramica') && !(await P('searchProject', id, 'plumber')).length)
writeFileSync(join(folder, 'suppliers.md'), `${filler(60)}\n\nThe tile supplier is Azulejo Brothers and their quote was 4,200 EUR.\n\n${filler(60)}`)
await P('indexProject', id)

// Memories stay with their project
await P('setActiveProject', id)
await tool('remember', { text: 'The kitchen deadline is 12 December.' })
await P('setActiveProject', undefined)
const outside = await tool('recall', { query: 'kitchen deadline' })
await P('setActiveProject', id)
const inside = await tool('recall', { query: 'kitchen deadline' })
check('a memory saved in a project only comes up there', !/12 December/.test(outside.output) && /12 December/.test(inside.output), `${outside.output.slice(0, 40)} | ${inside.output.slice(0, 40)}`)

// The bar
await P('setActiveProject', undefined)
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.waitForSelector('select[aria-label="Project"]')
await bar.selectOption('select[aria-label="Project"]', id)
await bar.waitForTimeout(300)
await bar.fill('textarea', 'Who is our tile supplier and what did they quote?')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 90_000 })
const answer = await bar.locator('[data-state="done"]').last().innerText()
check('the matching part of a pinned file reaches the model, no tool needed', /Azulejo/.test(answer) && /4,?200/.test(answer) && !/search_project|read_file/.test(answer), answer.replace(/\s+/g, ' ').slice(0, 140))
const conv = await app.evaluate(() => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  return new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db')).prepare('SELECT project_id FROM conversations ORDER BY rowid DESC LIMIT 1').get()
})
check('the chat belongs to the project', conv?.project_id === id)

await app.evaluate(() => globalThis.__orbit.openDashboard('projects'))
let dash
for (let i = 0; i < 20 && !dash; i++) {
  dash = app.windows().find((w) => w.url().includes('dashboard'))
  if (!dash) await bar.waitForTimeout(250)
}
await dash.waitForSelector('[data-project="Kitchen"]')
check('Projects page shows it with its files', /1 file indexed/.test(await dash.locator('[data-project="Kitchen"]').innerText()))
await dash.screenshot({ path: join(root, 'out', 'e2e', 'dash-projects.png') })

await app.close()
process.exit(failed ? 1 : 0)
