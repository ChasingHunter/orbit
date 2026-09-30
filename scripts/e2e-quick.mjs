// Quick actions and the browser-tab chip. Uses a few small model calls.
// Your clipboard is saved before and restored after the copy test.
// Run: npm run build && node scripts/e2e-quick.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-quick-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(join(root, 'out', 'e2e'), { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku' } }))

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
const open = (context) =>
  app.evaluate((_e, ctx) => {
    const o = globalThis.__orbit
    o.sendToBar({ type: 'reset' })
    o.sendToBar({ type: 'open', context: ctx, autoSubmitMs: null, quickActions: o.settings.current.quickActions })
  }, context)
const done = async () => {
  const n = await bar.locator('[data-state="done"]').count()
  await bar.waitForFunction((k) => document.querySelectorAll('[data-state="done"]').length > k, n, { timeout: 90_000 })
  return (await bar.locator('[data-state="done"]').last().innerText()).replace(/\s+/g, ' ')
}

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
const savedClipboard = await app.evaluate(({ clipboard }) => clipboard.readText())

// No selection: no quick actions.
await open([{ kind: 'window', id: 'w', app: 'notepad.exe', title: 'notes.txt' }])
await bar.waitForTimeout(300)
check('no quick actions without a selection', (await bar.locator('[data-testid="quick-actions"]').count()) === 0)

// With a selection they show up.
const selection = {
  kind: 'selection',
  id: 's',
  app: 'chrome.exe',
  text: 'The central bank raised the repo rate by 25 basis points to curb inflation, which rose to 6.2 percent last month, its highest in over a year.'
}
await open([selection])
await bar.waitForSelector('[data-testid="quick-actions"]')
await bar.screenshot({ path: join(root, 'out', 'e2e', 'quick-actions.png') })
check('quick actions shown with a selection', (await bar.locator('[data-testid="quick-actions"] button').count()) === 5)

let answer = ''
const summariseDone = done()
await bar.click('[data-testid="quick-actions"] >> text=Summarise')
answer = await summariseDone
check('Summarise answers in the bar', /repo|rate|inflation/i.test(answer), answer.slice(0, 120))

// Reply copies its draft.
await open([{ ...selection, id: 's2', text: 'Hey, are you free for a quick call about the launch tomorrow at 4?' }])
await bar.waitForSelector('[data-testid="quick-actions"]')
const replyDone = done()
await bar.click('[data-testid="quick-actions"] >> text=Reply')
answer = await replyDone
const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
check('Reply copies the draft', clip.length > 10 && answer.includes('Copied to your clipboard'), clip.slice(0, 80))
await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), savedClipboard)

// The browser tab chip reaches the model.
await open([{ kind: 'url', id: 'u', url: 'https://github.com/ChasingHunter/orbit/issues' }])
await bar.waitForTimeout(200)
const askDone = done()
await bar.fill('textarea', 'Which site and section am I looking at? One short sentence, no tools.')
await bar.keyboard.press('Enter')
answer = await askDone
check('open tab reaches the model', /github/i.test(answer) && /issue/i.test(answer), answer.slice(0, 120))
await bar.screenshot({ path: join(root, 'out', 'e2e', 'url-chip.png') })

await app.close()
process.exit(failed ? 1 : 0)
