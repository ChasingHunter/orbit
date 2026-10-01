// Fixes from the showcase dry run: runnable files are never saved or opened, and a project the
// user hasn't picked in the bar is still known by name. One model request (Haiku).
// Run: npm run build && node scripts/e2e-showfixes.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-showfixes-profile')
const proj = join(root, 'out', 'e2e-showfixes-cart')
rmSync(dataDir, { recursive: true, force: true })
rmSync(proj, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(proj, { recursive: true })
writeFileSync(join(proj, 'sales.csv'), 'month,location,cups\n2026-01,Station,1450\n2026-01,Park,700\n2026-02,Station,1530\n')
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' }, files: { allowedFolders: [], writableFolders: [] } }))
const app = await electron.launch({ executablePath: process.env.ORBIT_EXE, args: process.env.ORBIT_EXE ? [] : [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const tool = (name, input, source = 'chat') => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input, a.source), { name, input, source })

let r = await tool('save_file', { name: 'cleanup.bat', content: 'del /q *' })
check('save_file refuses a .bat', r.isError && /runs it/.test(r.output), r.output.slice(0, 80))
r = await tool('save_file', { name: 'tools/x.ps1', content: 'rm -r ~' }, 'workflow')
check('and a .ps1 from a workflow', r.isError, r.output.slice(0, 80))
r = await tool('make_page', { name: 'evil.bat', html: '<p>x</p>' })
check('a page named .bat still saves as .html', !r.isError && /evil\.bat\.html|evil-bat\.html|evil\.html/i.test(r.output) && !/\.bat$/m.test(r.output.split('\n')[0]), r.output.split('\n')[0])

const id = await app.evaluate(async (_e, p) => {
  const m = globalThis.__orbit.projects
  const id = m.saveProject({ name: 'Coffee Cart', instructions: '' })
  await m.addPath(id, p)
  await m.indexProject(id)
  return id
}, proj)
r = await tool('search_project', { query: 'Station cups', project: 'coffee cart' })
check('search_project finds a project by name without picking it', !r.isError && /Station/.test(r.output), r.output.slice(0, 80))

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.waitForSelector('textarea')
await bar.fill('textarea', 'How many cups did the Station sell in January, according to my coffee cart project?')
await bar.keyboard.press('Enter')
await bar.waitForFunction(() => document.body.innerText.includes('Retry'), null, { timeout: 120_000 }).catch(() => {})
const answer = await bar.evaluate(() => document.body.innerText)
check('a new chat knows the project by name', /1,?450/.test(answer), answer.replace(/\s+/g, ' ').slice(-200))
check('without picking it in the bar', !(await app.evaluate(() => globalThis.__orbit.projects.activeProject())), String(id))

await app.close()
process.exit(failed ? 1 : 0)
