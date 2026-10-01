// Phone e2e against a fake Telegram API: set up from the dashboard, pair with the code, strangers
// ignored, questions answered, approvals as buttons, /new, unpair. Two small model calls.
// Run: npm run build && node scripts/e2e-phone.mjs
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-phone-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' } }))

// Fake Telegram
const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const queue = []
const sent = []
let nextId = 1
const waiters = []
const push = (u) => {
  queue.push({ update_id: nextId++, ...u })
  waiters.splice(0).forEach((w) => w())
}
const tg = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', async () => {
    const [, token, method] = req.url.match(/^\/bot([^/]+)\/(\w+)/) ?? []
    const data = body ? JSON.parse(body) : {}
    const reply = (result) => res.end(JSON.stringify({ ok: true, result }))
    if (token !== TOKEN) return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }))
    if (method === 'getMe') return reply({ username: 'orbit_test_bot' })
    if (method === 'getUpdates') {
      if (!queue.some((u) => u.update_id >= (data.offset ?? 0))) await new Promise((r) => (waiters.push(r), setTimeout(r, 1000)))
      return reply(queue.filter((u) => u.update_id >= (data.offset ?? 0)))
    }
    if (method === 'sendMessage') sent.push(data)
    reply({ message_id: sent.length })
  })
})
await new Promise((r) => tg.listen(0, '127.0.0.1', r))

const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir, ORBIT_TELEGRAM_API: `http://127.0.0.1:${tg.address().port}` }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const until = async (fn, ms = 90_000) => {
  for (let t = 0; t < ms; t += 250) {
    const v = fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 250))
  }
}
const say = (chat, text) => push({ message: { chat: { id: chat }, text } })
const to = (chat) => sent.filter((m) => m.chat_id === chat)

await app.evaluate(() => globalThis.__orbit.openDashboard('settings'))
let dash
for (let i = 0; i < 20 && !dash; i++) {
  dash = app.windows().find((w) => w.url().includes('dashboard'))
  if (!dash) await bar.waitForTimeout(250)
}
await dash.waitForSelector('text=Phone (Telegram)')
await dash.fill('input[aria-label="Bot token"]', 'not a token')
await dash.click('button:has-text("Save") >> nth=-1')
check('rejects something that is not a bot token', await dash.waitForSelector("text=doesn't look like a bot token", { timeout: 5000 }).then(() => true, () => false))
await dash.fill('input[aria-label="Bot token"]', TOKEN)
await dash.click('button:has-text("Save") >> nth=-1')
await dash.waitForSelector('[data-phone="waiting"]', { timeout: 10_000 })
const waiting = await dash.locator('[data-phone="waiting"]').innerText()
const code = waiting.match(/\b\d{6}\b/)?.[0]
check('shows a pairing code and the bot name', !!code && /@orbit_test_bot/.test(waiting), waiting.slice(0, 80))

say(999, 'hello?')
say(999, '000000')
await new Promise((r) => setTimeout(r, 1500))
check('strangers get nothing', to(999).length === 0)
say(42, `/start ${code}`)
await until(() => to(42).length)
check('pairs with the code', /Paired with Orbit/.test(to(42)[0]?.text ?? ''), to(42)[0]?.text)
await dash.waitForSelector('[data-phone="paired"]', { timeout: 5000 })
check('the dashboard shows it paired', true)
say(999, `/start ${code}`)
await new Promise((r) => setTimeout(r, 1500))
check('the code only works once, and other chats stay ignored', to(999).length === 0)

say(42, 'What is the capital of Japan? One word.')
await until(() => to(42).length >= 2)
check('answers a question from the phone', /Tokyo/i.test(to(42)[1]?.text ?? ''), to(42)[1]?.text)

await app.evaluate(() => globalThis.__orbit.settings.update((d) => (d.permissions.level = 'strict')))
say(42, 'Remember that I prefer window seats when I fly.')
const ask = await until(() => to(42).find((m) => m.reply_markup))
check('approvals arrive as buttons', !!ask && /Approve\?/.test(ask.text) && ask.reply_markup.inline_keyboard[0].length === 2, ask?.text?.slice(0, 80))
const approve = ask.reply_markup.inline_keyboard[0].find((b) => b.text === 'Approve').callback_data
push({ callback_query: { id: 'cb1', data: approve, message: { chat: { id: 42 }, message_id: 7, text: ask.text } } })
const final = await until(() => to(42).slice(-1)[0] !== ask && !to(42).slice(-1)[0].reply_markup && to(42).length > 3 && to(42).slice(-1)[0])
const saved = await app.evaluate(() => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  return new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db')).prepare("SELECT text FROM memories WHERE text LIKE '%window%'").all()
})
check('approving on the phone lets it go ahead', saved.length === 1, final?.text?.slice(0, 80))

say(42, '/new')
await until(() => to(42).some((m) => m.text === 'New chat.'))
check('/new starts over', to(42).some((m) => m.text === 'New chat.'))
await dash.click('button:has-text("Unpair")')
await bar.waitForTimeout(400)
check('unpairing forgets the chat', (await app.evaluate(() => globalThis.__orbit.settings.current.phone.chatId)) === 0)

await app.close()
tg.close()
process.exit(failed ? 1 : 0)
