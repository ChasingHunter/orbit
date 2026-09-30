// Event triggers e2e: feed, page change, tool change, folder and webhook, against a local test
// server. No model calls. Run: npm run build && node scripts/e2e-triggers.mjs
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-triggers-profile')
const wfDir = join(dataDir, 'workflows')
const inbox = join(dataDir, 'inbox')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(wfDir, { recursive: true })
mkdirSync(inbox, { recursive: true })
mkdirSync(join(dataDir, 'files'), { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' } }))
writeFileSync(join(dataDir, 'files', 'status.txt'), 'all good')

// A feed and a page the test can change.
let feedItems = ['First post', 'Second post']
let price = '$49'
const server = createServer((req, res) => {
  if (req.url === '/feed.xml') {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' })
    res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Test feed</title>${feedItems
      .map((t) => `<item><title>${t}</title><link>http://localhost/p/${encodeURIComponent(t)}</link></item>`)
      .join('')}</channel></rss>`)
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<html><body><h1>Shop</h1><div class="price">${price}</div><p>Footer changes every time ${Date.now()}</p></body></html>`)
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const save = (name, body) => `  - id: save\n    tool: save_file\n    args: { name: "${name}", content: ${JSON.stringify(body)} }\n`
writeFileSync(join(wfDir, 'on-feed.yaml'), `name: on-feed\ntrigger: { feed: { url: "${base}/feed.xml", every: 1m } }\nsteps:\n${save('feed.txt', '{{trigger.count}} new:\n{{trigger.items}}')}`)
writeFileSync(join(wfDir, 'on-price.yaml'), `name: on-price\ntrigger: { page: { url: "${base}/shop", selector: ".price", every: 1m } }\nsteps:\n${save('price.txt', '{{trigger.changes}}')}`)
writeFileSync(join(wfDir, 'on-status.yaml'), `name: on-status\ntrigger: { poll: { tool: read_saved_file, args: { name: "status.txt" }, every: 1m } }\nsteps:\n${save('status-change.txt', '{{trigger.output}}')}`)
writeFileSync(join(wfDir, 'on-file.yaml'), `name: on-file\ntrigger: { folder: { path: "${inbox.replace(/\\/g, '/')}", pattern: "*.pdf" } }\nsteps:\n${save('file.txt', '{{trigger.name}}')}`)
writeFileSync(join(wfDir, 'on-hook.yaml'), `name: on-hook\ntrigger: { webhook: true }\nsteps:\n${save('hook.txt', '{{trigger.body}}')}`)
writeFileSync(join(wfDir, 'bad-poll.yaml'), `name: bad-poll\ntrigger: { poll: { tool: forget, args: { id: 1 }, every: 1m } }\nsteps:\n${save('never.txt', 'x')}`)

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
const out = (name) => (existsSync(join(dataDir, 'files', name)) ? readFileSync(join(dataDir, 'files', name), 'utf8') : '')
const checkNow = (name) => app.evaluate((_e, n) => globalThis.__orbit.triggers.checkNow(n), name)
const runsOf = (name) => app.evaluate((_e, n) => globalThis.__orbit.workflows.runs(n, 10), name)
const settle = () => bar.waitForTimeout(1200)

// Baselines: the first check records what's there without firing.
for (const n of ['on-feed', 'on-price', 'on-status']) await checkNow(n)
await settle()
check('first checks only record a baseline', (await runsOf('on-feed')).length + (await runsOf('on-price')).length + (await runsOf('on-status')).length === 0)

// Feed: one new post fires once, with just that post.
feedItems = ['Brand new launch', ...feedItems]
await checkNow('on-feed')
await settle()
await checkNow('on-feed') // nothing new the second time
await settle()
check('feed fires once for a new post', (await runsOf('on-feed')).length === 1 && /1 new:[\s\S]*Brand new launch/.test(out('feed.txt')) && !/First post/.test(out('feed.txt')), out('feed.txt').replace(/\s+/g, ' '))

// Page: price change fires with what changed; the footer outside the selector doesn't matter.
await checkNow('on-price')
await settle()
check('unchanged selector does not fire', (await runsOf('on-price')).length === 0)
price = '$29'
await checkNow('on-price')
await settle()
check('page change fires with the change', out('price.txt').trim() === '$29', out('price.txt'))

// Poll: a read-only tool's output changed.
writeFileSync(join(dataDir, 'files', 'status.txt'), 'deploy failed')
await checkNow('on-status')
await settle()
check('tool result change fires', /deploy failed/.test(out('status-change.txt')))

// Folder: a matching file fires, a non-matching one doesn't.
writeFileSync(join(inbox, 'notes.txt'), 'ignore me')
writeFileSync(join(inbox, 'invoice-42.pdf'), '%PDF-1.4 test')
await bar.waitForTimeout(4000)
check('new PDF in folder fires', out('file.txt') === 'invoice-42.pdf' && (await runsOf('on-file')).length === 1, out('file.txt'))

// Webhook: right key works, wrong key is refused.
const url = await app.evaluate(() => globalThis.__orbit.triggers.webhookUrl('on-hook'))
const bad = await fetch(url.replace(/key=\w+/, 'key=wrong'), { method: 'POST', body: 'nope' })
const ok = await fetch(url, { method: 'POST', body: 'build 812 passed' })
await settle()
check('webhook with key runs, wrong key refused', ok.status === 202 && bad.status === 404 && out('hook.txt') === 'build 812 passed', `${ok.status}/${bad.status} ${out('hook.txt')}`)

// A trigger pointed at a tool that changes things is refused.
const badState = await app.evaluate(() => globalThis.__orbit.triggers.status('bad-poll'))
check('polling a writing tool is refused', /read-only/.test(badState?.lastError ?? ''), badState?.lastError ?? 'no error')

await app.close()
server.close()
process.exit(failed ? 1 : 0)
