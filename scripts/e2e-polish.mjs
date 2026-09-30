// Chat polish e2e: model picker (this chat only), Retry, Edit last message, and math rendering.
// Four tiny Haiku calls.
// Run: npm run build && node scripts/e2e-polish.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-polish-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:sonnet', quick: 'claude:haiku' } }))

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
const sql = (q) =>
  app.evaluate((_e, s) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    return new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db')).prepare(s).all()
  }, q)
const doneCount = () => bar.evaluate(() => document.querySelectorAll('[data-state="done"]').length)
const waitDone = (n) => bar.waitForFunction((k) => document.querySelectorAll('[data-state="done"]').length >= k, n, { timeout: 90_000 })
const lastAnswer = () => bar.locator('[data-state="done"]').last().innerText()

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.waitForSelector('select[aria-label="Model for this chat"]')
const picker = bar.locator('select[aria-label="Model for this chat"]')
check('picker starts on the default chat model', (await picker.inputValue()) === 'claude:sonnet')
await picker.selectOption('claude:haiku')

await bar.fill('textarea', 'What is the capital of France? One word.')
await bar.keyboard.press('Enter')
await waitDone(1)
check('first answer', /Paris/i.test(await lastAnswer()))
const models = await sql('SELECT DISTINCT model FROM usage')
check('the picked model answered', models.length > 0 && models.every((m) => /haiku/i.test(m.model)), models.map((m) => m.model).join(', '))

// Retry: same question, the old exchange is replaced.
await bar.click('button:has-text("Retry")')
await bar.waitForFunction(() => document.querySelectorAll('[data-state="running"]').length === 0 && document.querySelectorAll('[data-state="done"]').length === 1, null, { timeout: 90_000 })
const afterRetry = await sql('SELECT role, text FROM messages ORDER BY id')
check('retry replaces the last exchange', afterRetry.length === 2 && afterRetry[0].text === 'What is the capital of France? One word.', JSON.stringify(afterRetry.map((m) => m.role)))
check('retry keeps one user bubble', (await bar.locator('text=What is the capital of France? One word.').count()) === 1)

// Edit: new text in place of the old message.
await bar.hover('text=What is the capital of France? One word.')
await bar.click('button[aria-label="Edit message"]')
check('edit puts the message back in the input', (await bar.inputValue('textarea')) === 'What is the capital of France? One word.')
check('edit shows a banner', await bar.locator('text=Editing your last message').isVisible())
await bar.fill('textarea', 'What is the capital of Japan? One word.')
await bar.keyboard.press('Enter')
await bar.waitForFunction(() => document.querySelectorAll('[data-state="running"]').length === 0 && document.body.innerText.includes('capital of Japan'), null, { timeout: 90_000 })
await waitDone(1)
const afterEdit = await sql('SELECT role, text FROM messages ORDER BY id')
check('edit replaces the message in history', afterEdit.length === 2 && afterEdit[0].text === 'What is the capital of Japan? One word.' && /Tokyo/i.test(afterEdit[1].text), afterEdit.map((m) => m.text).join(' / '))
check('the old message is gone from the bar', (await bar.locator('text=capital of France').count()) === 0)

// The model only knows the edited version.
await bar.fill('textarea', 'Which capital city did you name in your last answer? One word.')
await bar.keyboard.press('Enter')
await waitDone(2)
check('the model sees the edited exchange, not the old one', /Tokyo/i.test(await lastAnswer()) && !/Paris/i.test(await lastAnswer()), await lastAnswer())
check('picked model stays for the chat', (await picker.inputValue()) === 'claude:haiku')

await bar.keyboard.press('Control+N')
await bar.waitForTimeout(300)
check('new chat goes back to the default model', (await picker.inputValue()) === 'claude:sonnet')

// Math, via a saved conversation (no model call).
const conv = await app.evaluate(() => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
  const id = 'math-1'
  const t = new Date().toISOString()
  db.prepare('INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, 'Math', 'claude:haiku', t, t)
  db.prepare('INSERT INTO messages (conversation_id, role, text, created_at) VALUES (?, ?, ?, ?)').run(id, 'user', 'formulas?', t)
  db.prepare('INSERT INTO messages (conversation_id, role, text, created_at) VALUES (?, ?, ?, ?)').run(id, 'assistant', 'Energy is $E = mc^2$.\n\n$$\\int_0^1 x\\,dx = \\frac{1}{2}$$\n\nPrice: $5 and $10.', t)
  return id
})
await app.evaluate(({ ipcMain }, id) => ipcMain.emit('dash:continue', {}, id), conv)
await bar.waitForSelector('text=Continuing "Math"')
const math = await bar.evaluate(() => ({ inline: document.querySelectorAll('.katex').length, display: document.querySelectorAll('.katex-display').length, text: document.body.innerText }))
check('inline and display math render', math.inline >= 2 && math.display === 1, `${math.inline} katex, ${math.display} display`)
check('dollar amounts are left alone', math.text.includes('Price: $5 and $10.'))
check('restored chats can be retried', await bar.locator('button:has-text("Retry")').isVisible())
await bar.screenshot({ path: join(root, 'out', 'e2e', 'bar-math.png') })

await app.close()
process.exit(failed ? 1 : 0)
