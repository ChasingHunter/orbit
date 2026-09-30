// Drives the built app with Playwright and screenshots each bar state.
// Run: npm run build && node scripts/e2e.mjs   (sends one real prompt to the chat model)
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const shots = join(root, 'out', 'e2e')
const dataDir = join(root, 'out', 'e2e-profile')

rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(shots, { recursive: true })
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku' } })
)

const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
const shot = async (name) => {
  await bar.waitForTimeout(250)
  await bar.screenshot({ path: join(shots, `${name}.png`) })
  console.log('shot', name)
}
const send = (event) => app.evaluate((_e, ev) => globalThis.__orbit.sendToBar(ev), event)

// 1. Open with context chips
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await send({
  type: 'open',
  autoSubmitMs: null,
  context: [
    { kind: 'window', id: 'w', app: 'AcroRd32.exe', title: 'Q3 report.pdf - Adobe Acrobat Reader' },
    { kind: 'selection', id: 's', app: 'AcroRd32.exe', text: 'Revenue grew 18% QoQ driven by enterprise expansion, while gross margin compressed 2.1pp due to infra costs.' }
  ]
})
await shot('01-open-context')

// 2. Real answer from the chat model (small quota use)
await bar.fill('textarea', 'In 2 short bullets: what does gross margin compressing 2.1pp mean?')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 90_000 })
await shot('02-answer')

// 3. Approval card
await send({
  type: 'approval',
  request: { id: 'a1', tool: 'gmail.send', title: 'Send email to sam@example.com: "Q3 summary"', input: { to: 'sam@example.com', subject: 'Q3 summary', body: 'Hi Sam,\n\nRevenue grew 18%…' } }
})
await shot('03-approval')

// 4. Listening state
await send({ type: 'listening', value: true })
await shot('04-listening')
await send({ type: 'listening', value: false })

// 5. Error notice
await send({ type: 'notice', level: 'error', text: 'Claude usage limit reached until 3:00 PM.' })
await shot('05-notice')

// 6. Escape hides the bar
await bar.keyboard.press('Escape')
await bar.waitForTimeout(300)
const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
console.log('visible after Esc:', visible)

await app.close()
