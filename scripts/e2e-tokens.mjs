// Token savings e2e: connected services' tools stay out of the always-on list and are looked up
// on demand (with the real tool's approvals), long pages come back in pieces, and long chats get
// a nudge. Uses Hugging Face (no sign-in) and a local page. Two small model calls.
// Run: npm run build && node scripts/e2e-tokens.mjs
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-tokens-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' } }))

const long = `<html><body><article><h1>Long page</h1>${'<p>Filler paragraph about nothing in particular. </p>'.repeat(600)}<p>END MARKER</p></article></body></html>`
const site = createServer((_q, res) => (res.setHeader('content-type', 'text/html'), res.end(long)))
await new Promise((r) => site.listen(0, '127.0.0.1', r))

const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir, ORBIT_E2E_LONG_CHAT: '2000' }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const tools = () => app.evaluate(() => globalThis.__orbit.measureTools())
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input, 'chat'), { name, input })
const total = (t) => t.reduce((a, b) => a + b.chars, 0)

const before = total(await tools())
await app.evaluate(() => globalThis.__orbit.integrations.upsert('huggingface', { type: 'http', name: 'Hugging Face', url: 'https://huggingface.co/mcp', enabled: true, secretHeaders: {} }, true))
for (let i = 0; i < 40; i++) {
  const s = await app.evaluate(() => globalThis.__orbit.integrations.states())
  if (s[0]?.status === 'connected') break
  await bar.waitForTimeout(500)
}
let t = await tools()
const svc = t.find((x) => x.name === 'service_tools')
check("a connected service's tools aren't sent with every message", !t.some((x) => /^huggingface__/.test(x.name)) && !!svc)
check('only a short entry is added', total(t) - before < 1500, `+${total(t) - before} chars`)
await app.evaluate(() => globalThis.__orbit.settings.update((d) => (d.tools.connectorsOnDemand = false)))
t = await tools()
const upFront = total(t) - before
check('(loading them up front would add more)', upFront > total(await (async () => t)()) - before - 1 && upFront > 2000, `+${upFront} chars`)
await app.evaluate(() => globalThis.__orbit.settings.update((d) => (d.tools.connectorsOnDemand = true)))

let r = await tool('service_tools', { service: 'Hugging Face' })
check('service_tools lists the tools with their arguments', !r.isError && /run one with service_call/.test(r.output) && /: /.test(r.output), r.output.slice(0, 90))

// The real tool's approval still applies through service_call.
await app.evaluate(() => globalThis.__orbit.settings.update((d) => (d.permissions.level = 'strict')))
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
const name = r.output.match(/\n\n([\w-]+):/)?.[1]
const pending = tool('service_call', { service: 'huggingface', tool: name, args: {} })
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 15_000 })
check("service_call asks with the real tool's card", (await bar.locator(`text=APPROVAL NEEDED · huggingface__`).count()) === 1, name)
await bar.click('button:has-text("Deny")')
await pending
await app.evaluate(() => globalThis.__orbit.settings.update((d) => (d.permissions.level = 'careful')))

r = await tool('web_fetch', { url: `http://127.0.0.1:${site.address().port}/` })
check('long pages come back in a piece, with a way to read on', r.output.length < 9000 && /pass offset 8000 to read on/.test(r.output) && !r.output.includes('END MARKER'), `${r.output.length} chars`)

await bar.fill('textarea', 'Using my Hugging Face connection, find one popular text-classification model. Just its name.')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 120_000 })
const answer = await bar.locator('[data-state="done"]').last().innerText()
check('the model looks up the service and uses it', /service_tools/.test(answer) && /service_call/.test(answer), answer.replace(/\s+/g, ' ').slice(0, 160))
await bar.waitForSelector('text=This chat is getting long', { timeout: 5000 }).catch(() => {})
check('a long chat gets a nudge with a New chat button', (await bar.locator('text=This chat is getting long').count()) === 1 && (await bar.locator('button:has-text("New chat")').count()) === 1)
await bar.screenshot({ path: join(root, 'out', 'e2e', 'bar-long-chat.png') })

await app.close()
site.close()
process.exit(failed ? 1 : 0)
