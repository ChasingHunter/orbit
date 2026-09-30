// Continue a chat from History, and a background task asking the user a question.
// A few small model calls. Run: npm run build && node scripts/e2e-continue.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-continue-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku', research: 'claude:haiku' } })
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
async function ask(text) {
  const n = await bar.locator('[data-state="done"]').count()
  await bar.fill('textarea', text)
  await bar.keyboard.press('Enter')
  await bar.waitForFunction((k) => document.querySelectorAll('[data-state="done"]').length > k, n, { timeout: 90_000 })
  return (await bar.locator('[data-state="done"]').last().innerText()).replace(/\s+/g, ' ')
}
const db = (sql) =>
  app.evaluate((_e, q) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const d = new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
    return d.prepare(q).all()
  }, sql)

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await ask('My project codename is Heliotrope. Just reply OK.')
await bar.keyboard.press('Control+n')
const [conv] = await db('SELECT id FROM conversations')

// Reopen it from History, as the dashboard button does.
await app.evaluate(({ ipcMain }, id) => ipcMain.emit('dash:continue', {}, id), conv.id)
await bar.waitForSelector('text=Continuing')
const restored = await bar.locator('text=Heliotrope').count()
check('earlier messages shown again', restored >= 1)
const answer = await ask('What is my project codename?')
check('model remembers the earlier chat', /heliotrope/i.test(answer), answer.slice(0, 100))
const rows = await db(`SELECT COUNT(*) n FROM messages WHERE conversation_id = '${conv.id}'`)
const convs = await db('SELECT COUNT(*) n FROM conversations')
check('new messages added to the same conversation', rows[0].n === 4 && convs[0].n === 1, `${rows[0].n} messages, ${convs[0].n} conversations`)
await bar.screenshot({ path: join(root, 'out', 'e2e', 'continue.png') })

// A background task asks a question and waits.
await bar.keyboard.press('Control+n')
await app.evaluate(() =>
  globalThis.__orbit.tasks.start(
    'colour check',
    'Use the ask_user tool to ask which colour to use, with the options "Red" and "Blue". Then reply with only the chosen colour in capital letters.',
    'quick'
  )
)
await bar.waitForSelector('[data-testid="question"]', { timeout: 90_000 })
await bar.screenshot({ path: join(root, 'out', 'e2e', 'question.png') })
await bar.click('[data-testid="question"] button:has-text("Blue")')
let task
for (let i = 0; i < 60 && task?.status !== 'done' && task?.status !== 'failed'; i++) {
  await bar.waitForTimeout(1000)
  task = await app.evaluate(() => globalThis.__orbit.tasks.list()[0])
}
check('background task used the answer', task?.status === 'done' && /BLUE/.test(task.result ?? ''), `${task?.status} ${(task?.result ?? task?.error ?? '').slice(0, 60)}`)

await app.close()
process.exit(failed ? 1 : 0)
