// Browser e2e against a small local site: open and read pages as text plus numbered controls,
// click, type, choose and press, approvals by level, password and pay controls always asking
// (even at Full, with no "allow for this chat"), and the stop hotkey closing the browser.
// One small model call. Runs Edge headless.
// Run: npm run build && node scripts/e2e-browser.mjs
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-browser-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const posted = []
const site = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    res.setHeader('content-type', 'text/html')
    if (req.url === '/') return res.end('<h1>Lighthouse Bakery</h1><p>Fresh bread daily.</p><a href="/order">Order online</a>')
    if (req.url === '/order' && req.method === 'POST') {
      posted.push(new URLSearchParams(body).toString())
      return res.end('<h1>Thanks for your order</h1>')
    }
    if (req.url === '/order')
      return res.end(`<h1>Order</h1><form method="post" action="/order">
        <label>Name <input name="name"></label>
        <label>Loaf <select name="loaf"><option>Sourdough</option><option>Rye</option></select></label>
        <label>Password <input type="password" name="pw"></label>
        <button type="submit">Send order</button></form><button>Pay now</button>`)
    res.statusCode = 404
    res.end('nope')
  })
})
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${site.address().port}`
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' }, permissions: { level: 'trusted' } }))

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
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input, 'chat'), { name, input })
const id = (page, label) => Number(page.match(new RegExp(`\\[(\\d+)\\] [^\\n]*"${label}`))?.[1])
const setLevel = (l) => app.evaluate((_e, lv) => globalThis.__orbit.settings.update((d) => (d.permissions.level = lv)), l)

let r = await tool('browser_look', { action: 'open', url: base })
check('opens a page and reads it as text', !r.isError && r.output.includes('Lighthouse Bakery') && r.output.includes('<untrusted_page'), r.output.slice(0, 80))
check('lists the controls with numbers', /\[1\] link "Order online"/.test(r.output))
check('labels come through intact', /input\(password\) "Password"/.test((await tool('browser_look', { action: 'open', url: base + '/order' })).output))
await tool('browser_look', { action: 'open', url: base })
r = await tool('browser_act', { action: 'click', id: id(r.output, 'Order online') })
check('clicks a link (Trusted: no question)', !r.isError && r.output.includes('<h1>') === false && r.output.includes('Order'), r.output.slice(0, 120))
const order = r.output
r = await tool('browser_act', { action: 'type', id: id(order, 'Name'), text: 'Sam' })
check('types into a field', !r.isError && /"Name[^"]*" value="Sam"/.test(r.output))
r = await tool('browser_act', { action: 'select', id: id(order, 'Loaf'), text: 'Rye' })
check('chooses an option', !r.isError, r.output.slice(0, 60))

await setLevel('full')
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
let pending = tool('browser_act', { action: 'type', id: id(order, 'Password'), text: 'hunter2' })
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 15_000 })
const card = await bar.locator('pre').last().innerText()
check('a password field asks even at Full', card.includes('password, payment or purchase'))
check('the password is masked on the card', card.includes('•••••••') && !card.includes('hunter2'))
check('and there is no "allow for this chat"', (await bar.locator('button:has-text("Allow for this chat")').count()) === 0)
await bar.click('button:has-text("Deny")')
r = await pending
check('denied: nothing typed', r.isError)
pending = tool('browser_act', { action: 'click', id: id(order, 'Pay now') })
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 15_000 })
check('a Pay button asks even at Full', (await bar.locator('text=Click "Pay now"').count()) === 1)
await bar.click('button:has-text("Deny")')
await pending
r = await tool('browser_act', { action: 'click', id: id(order, 'Send order') })
check('ordinary buttons run at Full', !r.isError && r.output.includes('Thanks for your order') && /name=Sam&loaf=Rye/.test(posted[0] ?? ''), posted[0])
await bar.screenshot({ path: join(root, 'out', 'e2e', 'bar-browser.png') })

await setLevel('careful')
pending = tool('browser_act', { action: 'press', text: 'Enter' })
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 15_000 })
check('Careful asks before acting on a site', (await bar.locator('text=APPROVAL NEEDED · browser_act').count()) >= 1)
await bar.click('button:has-text("Deny")')
await pending

// Through the model
await bar.keyboard.press('Control+N')
await bar.fill('textarea', `Open ${base} in your browser (browser_look) and tell me the bakery's name and tagline.`)
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 120_000 })
const answer = await bar.locator('[data-state="done"]').last().innerText()
check('the model browses', /browser_look/.test(answer) && /Lighthouse Bakery/i.test(answer) && /fresh bread/i.test(answer), answer.replace(/\s+/g, ' ').slice(0, 140))

await app.evaluate(() => globalThis.__orbit.onPanic?.())
await bar.waitForTimeout(500)
check('the stop hotkey closes the browser', !(await app.evaluate(() => globalThis.__orbit.browserOpen?.())))

await app.close()
site.close()
process.exit(failed ? 1 : 0)
