// Connectors e2e: the one-click list, search, connecting a hosted server, its tool cost, and
// adding your own by address. Uses two servers that need no sign-in. No model calls.
// Run: npm run build && node scripts/e2e-connectors.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-connectors-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' } }))

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

await app.evaluate(() => globalThis.__orbit.openDashboard('integrations'))
let dash
for (let i = 0; i < 20 && !dash; i++) {
  dash = app.windows().find((w) => w.url().includes('dashboard'))
  if (!dash) await bar.waitForTimeout(250)
}
await dash.waitForSelector('text=Add a service')
const cards = () => dash.locator('button:has-text("Connect")').count()
check('lists the one-click services', (await cards()) >= 23, String(await cards()))
await dash.fill('input[aria-label="Search services"]', 'jira')
check('search narrows the list', (await cards()) === 1 && (await dash.locator('text=Jira & Confluence').isVisible()))
await dash.fill('input[aria-label="Search services"]', 'hugging')
await dash.click('button:has-text("Connect")')
await dash.click('button:has-text("Continue in browser")')
await dash.waitForSelector('text=tokens when a task uses them', { timeout: 30_000 })
const line = await dash.locator('text=tokens when a task uses them').first().innerText()
check('connects a hosted service and shows what its tools cost', /\d+ tools, about [\d.]+k? tokens when a task uses them/.test(line), line)
const tools = await app.evaluate(() => globalThis.__orbit.measureTools())
check('the model knows about it, tools looked up when needed', tools.some((t) => t.name === 'service_tools'))

await dash.fill('input[aria-label="Search services"]', '')
await dash.click('button:has-text("Add your own")')
await dash.fill('input[placeholder="e.g. My CRM"]', 'Insecure')
await dash.fill('input[placeholder="https://example.com/mcp"]', 'http://example.com/mcp')
await dash.click('button:has-text("Add and connect")')
check('refuses plain http addresses', await dash.waitForSelector('text=Use an https:// address', { timeout: 10_000 }).then(() => true, () => false))
await dash.fill('input[placeholder="e.g. My CRM"]', 'Cloudflare docs')
await dash.fill('input[placeholder="https://example.com/mcp"]', 'https://docs.mcp.cloudflare.com/mcp')
await dash.click('button:has-text("Add and connect")')
await dash.waitForFunction(() => document.body.innerText.split('tokens when a task uses them').length > 2, null, { timeout: 30_000 })
check('adds your own by address, no JSON editing', JSON.parse(readFileSync(join(dataDir, 'integrations.json'), 'utf8')).servers['cloudflare-docs']?.url === 'https://docs.mcp.cloudflare.com/mcp')
await dash.screenshot({ path: join(root, 'out', 'e2e', 'dash-connectors.png') })

await app.close()
process.exit(failed ? 1 : 0)
