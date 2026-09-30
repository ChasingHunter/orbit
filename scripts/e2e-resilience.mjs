// Offline fallback, the "use local model for now" offer after a limit, memory suggestion chips,
// and the Logs page. Needs Ollama running with a model. A few small model calls.
// Run: npm run build && node scripts/e2e-resilience.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-resilience-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(join(root, 'out', 'e2e'), { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku' } }))

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
async function launch(extraEnv) {
  const app = await electron.launch({
    executablePath: exe,
    args: exe ? [] : [join(root, 'out', 'main', 'index.js')],
    env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir, ...extraEnv }
  })
  const bar = await app.firstWindow()
  await bar.waitForLoadState('domcontentloaded')
  await app.evaluate(() => globalThis.__orbit.onBarHotkey())
  const ask = async (text) => {
    const n = await bar.locator('[data-state="done"]').count()
    await bar.fill('textarea', text)
    await bar.keyboard.press('Enter')
    await bar.waitForFunction((k) => document.querySelectorAll('[data-state="done"]').length > k, n, { timeout: 120_000 })
    return (await bar.locator('[data-state="done"]').last().innerText()).replace(/\s+/g, ' ')
  }
  return { app, bar, ask }
}

// --- offline ---
{
  const { app, bar, ask } = await launch({ ORBIT_E2E_OFFLINE: '1' })
  const answer = await ask('Reply with just the word pong.')
  const notice = await bar.locator("text=You're offline").count()
  check('offline answer comes from a local model', notice === 1 && /pong/i.test(answer), answer.slice(0, 60))

  await app.evaluate(() => globalThis.__orbit.conversation.offerFallback(Math.floor(Date.now() / 1000) + 3600))
  await bar.waitForSelector('button:has-text("Use it for now")')
  await bar.screenshot({ path: join(root, 'out', 'e2e', 'limit-offer.png') })
  await bar.click('button:has-text("Use it for now")')
  const using = await bar.waitForSelector('text=until Orbit restarts', { timeout: 5000 }).catch(() => null)
  check('limit offer switches to the local model', !!using)
  await app.close()
}

// --- online: memory suggestion and logs ---
{
  const { app, bar, ask } = await launch({})
  await ask("My dentist is Dr. Mehta at Smile Care, her number is 022 5555 0100. Anyway, what's one quick flossing tip?")
  const chip = await bar.waitForSelector('[data-testid="memory-suggestion"]', { timeout: 10_000 }).catch(() => null)
  check('memory suggestion offered', !!chip, chip ? (await chip.innerText()).replace(/\s+/g, ' ').slice(0, 90) : '')
  await bar.screenshot({ path: join(root, 'out', 'e2e', 'memory-suggestion.png') })
  if (chip) await bar.click('[data-testid="memory-suggestion"] button:has-text("Save")')
  await bar.waitForTimeout(500)
  const mems = await app.evaluate(() => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const d = new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
    return d.prepare('SELECT text FROM memories').all().map((r) => r.text)
  })
  check('saved only after clicking Save', mems.length === 1 && /Mehta/.test(mems[0]), mems.join(' | '))

  await app.evaluate(() => globalThis.__orbit.openDashboard('logs'))
  const d = await app.waitForEvent('window', { predicate: (p) => p.url().includes('dashboard') })
  await d.waitForLoadState('domcontentloaded')
  await d.setViewportSize({ width: 1040, height: 720 })
  await d.waitForSelector('button:has-text("suggest_memory")')
  await d.screenshot({ path: join(root, 'out', 'e2e', 'dash-logs.png') })
  check('logs page lists tool calls', (await d.locator('button:has-text("suggest_memory")').count()) >= 1)
  await app.close()
}

process.exit(failed ? 1 : 0)
