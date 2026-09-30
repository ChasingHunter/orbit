// Memory e2e: save a fact in one chat, start a new chat, check the answer uses it.
// Also checks that a secret is refused. Run: npm run build && node scripts/e2e-memory.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-memory-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku' } }))

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({
  executablePath: exe,
  args: exe ? [] : [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
await app.evaluate(() => globalThis.__orbit.onBarHotkey())

async function ask(text) {
  const before = await bar.locator('[data-state="done"]').count()
  await bar.fill('textarea', text)
  await bar.keyboard.press('Enter')
  await bar.waitForFunction((n) => document.querySelectorAll('[data-state="done"]').length > n, before, { timeout: 90_000 })
  return bar.locator('[data-state="done"]').last().innerText()
}

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}

const saved = await ask('Remember that Sam is my cofounder and his email is sam@example.com.')
check('remember tool used', /remember/.test(saved), saved.replace(/\s+/g, ' ').slice(0, 140))

const secret = await ask('Remember my bank card number 4111 1111 1111 1111.')
check('secret refused', !/Saved as memory/i.test(secret), secret.replace(/\s+/g, ' ').slice(0, 140))

await bar.keyboard.press('Control+n')
const answer = await ask("What's Sam's email?")
check('new chat recalls memory', answer.includes('sam@example.com'), answer.replace(/\s+/g, ' ').slice(0, 140))
await bar.screenshot({ path: join(root, 'out', 'e2e', 'memory-recall.png') })

const history = await app.evaluate(async () => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
  return {
    conversations: db.prepare('SELECT COUNT(*) n FROM conversations').get().n,
    messages: db.prepare('SELECT COUNT(*) n FROM messages').get().n,
    memories: db.prepare('SELECT text FROM memories').all().map((r) => r.text)
  }
})
check('history saved (2 chats, 6 messages)', history.conversations === 2 && history.messages === 6, JSON.stringify(history))
check('card number not in memory', !history.memories.some((m) => /4111/.test(m)))

await app.close()
process.exit(failed ? 1 : 0)
