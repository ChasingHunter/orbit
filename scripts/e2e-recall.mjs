// Memory and project context, battle-tested with the questions that failed in real use: saved
// memories are known in a new chat however the question is worded, recall can list them, a memory
// past the instruction budget is still found, and in a project "summarise the data" reads the
// pinned files. Several small Haiku calls.
// Run: npm run build && node scripts/e2e-recall.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-recall-profile')
const docs = join(dataDir, 'ps')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(docs, { recursive: true })
writeFileSync(join(docs, 'deliverability-email-list.csv'), 'email,provider\nseed1@gmail.com,Gmail\nseed2@outlook.com,Outlook\nseed3@yahoo.com,Yahoo\n')
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' } }))

const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input, 'chat'), { name, input })
const one = (s) => s.replace(/\s+/g, ' ').slice(0, 140)
let asked = 0
const fresh = async (q) => {
  await bar.keyboard.press('Control+N')
  await bar.waitForTimeout(200)
  await bar.fill('textarea', q)
  await bar.keyboard.press('Enter')
  asked = 1
  await bar.waitForFunction(() => document.querySelectorAll('[data-state="done"]').length === 1, null, { timeout: 90_000 })
  return bar.locator('[data-state="done"]').last().innerText()
}

await tool('remember', { text: 'I value honesty; prefer direct, honest answers.', kind: 'preference' })
await tool('remember', { text: 'I like fishes.', kind: 'preference' })
await tool('remember', { text: 'Maya is my sister; she lives in Pune.', kind: 'person' })

let r = await tool('recall', { query: 'like' })
check('recall finds "like" (it used to be thrown away as a filler word)', /fishes/.test(r.output), one(r.output))
r = await tool('recall', { query: 'fish' })
check('recall matches word forms (fish finds fishes)', /fishes/.test(r.output))
r = await tool('recall', { query: 'preferences' })
check('recall lists a kind', /honesty/.test(r.output) && /fishes/.test(r.output) && !/Maya/.test(r.output))
r = await tool('recall', { query: 'all' })
check('recall lists everything', /Maya/.test(r.output) && /fishes/.test(r.output))

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.waitForSelector('textarea')
let a = await fresh('What do I like?')
check('a new chat knows "what do I like?"', /fish/i.test(a), one(a))
a = await fresh('How should you talk to me?')
check('and "how should you talk to me?"', /honest|direct/i.test(a), one(a))
a = await fresh('Who is Maya?')
check('and who people are', /sister/i.test(a), one(a))

// Past the instruction budget: 300 filler memories, then one specific fact.
await app.evaluate(() => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
  const t = new Date().toISOString()
  const ins = db.prepare("INSERT INTO memories (kind, text, private, created_at, updated_at) VALUES ('note', ?, 0, ?, ?)")
  for (let i = 0; i < 300; i++) ins.run(`Filler note number ${i} about nothing in particular.`, t, t)
  db.prepare("INSERT INTO memories (kind, text, private, created_at, updated_at) VALUES ('note', ?, 0, '2020-01-01', '2020-01-01')").run('My bike lock is the blue Kryptonite one.')
})
a = await fresh('Which bike lock is mine? One short sentence.')
check('a memory that did not fit in the instructions is still found', /kryptonite|blue/i.test(a), one(a))
await app.evaluate(() => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db')).prepare("DELETE FROM memories WHERE text LIKE 'Filler note%'").run()
})

// Projects
const id = await app.evaluate((_e, d) => {
  const p = globalThis.__orbit.projects
  const pid = p.saveProject({ name: 'Test project', instructions: 'Keep answers short.' })
  return p.addPath(pid, d).then(() => pid)
}, docs)
// The bar picks up new projects when it gets focus.
await bar.evaluate(() => window.dispatchEvent(new Event('focus')))
await bar.waitForSelector('select[aria-label="Project"]')
await bar.selectOption('select[aria-label="Project"]', id)
await bar.waitForTimeout(300)
a = await fresh('Summarise the data')
check('in a project, "summarise the data" reads the pinned files', /3|three/i.test(a) && /gmail|outlook|yahoo|email/i.test(a), one(a))

await app.close()
process.exit(failed ? 1 : 0)
