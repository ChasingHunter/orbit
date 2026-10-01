// Tavily e2e against a fake API: a pasted tvly- key is recognised, searches are counted, and when
// the free allowance runs out Orbit hands searching to Claude until next month. No model calls.
// Run: npm run build && node scripts/e2e-tavily.mjs
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-tavily-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' } }))

let used = 0
const LIMIT = 2
const api = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer tvly-test-123') return (res.statusCode = 401), res.end('bad key')
    if (used >= LIMIT) return (res.statusCode = 432), res.end(JSON.stringify({ detail: { error: 'This request exceeds your plan.' } }))
    used++
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ results: [{ title: 'Node.js', url: 'https://nodejs.org', content: 'Node.js 24 is the current LTS.' }] }))
  })
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))

const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir, ORBIT_TAVILY_API: `http://127.0.0.1:${api.address().port}` }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input, 'chat'), { name, input })
const searchCheck = async () => (await app.evaluate(() => globalThis.__orbit.runChecks())).find((c) => c.id === 'search')

let c = await searchCheck()
check('without a key, Setup points to a free Tavily key', c.action?.label === 'Get a free Tavily key' && /app\.tavily\.com/.test(c.action.target))

await app.evaluate(() => globalThis.__orbit.openDashboard('setup'))
let dash
for (let i = 0; i < 20 && !dash; i++) {
  dash = app.windows().find((w) => w.url().includes('dashboard'))
  if (!dash) await bar.waitForTimeout(250)
}
await dash.waitForSelector('text=Web search key')
const input = dash.locator('input[type="password"]').first()
await input.fill('tvly-test-123')
await dash.locator('button:has-text("Save")').first().click()
await bar.waitForTimeout(500)
check('a pasted tvly- key switches search to Tavily', (await app.evaluate(() => globalThis.__orbit.settings.current.tools.webSearch.provider)) === 'tavily')

let r = await tool('web_search', { query: 'node lts' })
check('searches through Tavily', !r.isError && r.output.includes('Node.js 24'), r.output.slice(0, 60))
await tool('web_search', { query: 'again' })
c = await searchCheck()
check('counts searches this month', /2 searches this month/.test(c.detail), c.detail)

r = await tool('web_search', { query: 'one too many' })
check('when the allowance runs out, it says so', /used up this month's free searches/.test(r.output), r.output.slice(0, 90))
const paused = await app.evaluate(() => globalThis.__orbit.settings.current.tools.webSearch.pausedUntil)
const next = new Date()
check('and hands searching to Claude until the 1st of next month', !!paused && new Date(paused).getDate() === 1 && new Date(paused).getMonth() === (next.getMonth() + 1) % 12, paused)
c = await searchCheck()
check('Setup shows it', /used up/.test(c.detail), c.detail.slice(-90))

await app.close()
api.close()
process.exit(failed ? 1 : 0)
