// Pages e2e: make_page saves an HTML page, it opens in a locked-down window where scripts and the
// bundled Chart.js work but the network, Node, popups and navigation don't. One small model call.
// Run: npm run build && node scripts/e2e-pages.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-pages-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
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

const html = `<!doctype html><html><body><h1 id="t">Fruit</h1><canvas id="c" width="400" height="200"></canvas>
<script src="orbit-page://lib/chart.js"></script>
<script>
window.chartOk = typeof Chart === 'function'
window.chart = new Chart(document.getElementById('c'), { type: 'bar', data: { labels: ['Apples', 'Pears'], datasets: [{ label: 'Sold', data: [3, 5] }] }, options: { animation: false } })
fetch('https://example.com').then(() => (window.net = 'reached'), () => (window.net = 'blocked'))
window.nodeThere = typeof require !== 'undefined' || typeof process !== 'undefined'
window.popup = window.open('https://example.com') ? 'opened' : 'blocked'
</script></body></html>`
const r = await tool('make_page', { name: 'fruit', html })
const path = r.output.match(/^Saved (.+)$/m)?.[1]
check('saves the page as a temporary file', !r.isError && path && existsSync(path) && /Temporary/.test(path), r.output.split('\n')[0])

await app.evaluate((_e, p) => void globalThis.__orbit.openPage(p), path)
let page
for (let i = 0; i < 40 && !page; i++) {
  page = app.windows().find((w) => w.url().startsWith('orbit-page:'))
  if (!page) await bar.waitForTimeout(250)
}
await page.waitForFunction(() => window.net !== undefined, null, { timeout: 15_000 })
const state = await page.evaluate(() => ({ chartOk: window.chartOk, bars: window.chart?.getDatasetMeta(0).data.length, net: window.net, node: window.nodeThere, popup: window.popup, title: document.getElementById('t').textContent }))
check('the page runs, with Chart.js drawing', state.chartOk && state.bars === 2 && state.title === 'Fruit', JSON.stringify(state))
check('no network from the page', state.net === 'blocked')
check('no Node in the page', state.node === false)
check('no popups', state.popup === 'blocked')
await page.evaluate(() => (location.href = 'https://example.com'))
await bar.waitForTimeout(500)
check('it can not navigate away', page.url().startsWith('orbit-page:'), page.url())
await page.screenshot({ path: join(root, 'out', 'e2e', 'page-window.png') })
await page.close()

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.fill('textarea', 'Make me a page with a bar chart of my weekly runs: Mon 5 km, Wed 8 km, Sat 12 km.')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 120_000 })
const answer = await bar.locator('[data-state="done"]').last().innerText()
const made = answer.match(/[\w-]+\.html/)?.[0]
const file = made && join(dataDir, 'files', 'Temporary', made)
check('the model makes a chart page with the bundled Chart.js', !!file && existsSync(file) && readFileSync(file, 'utf8').includes('orbit-page://lib/chart.js'), made)
check('the answer shows the page with Open', (await bar.locator('button:has-text("Open")').count()) > 0)

await app.close()
process.exit(failed ? 1 : 0)
