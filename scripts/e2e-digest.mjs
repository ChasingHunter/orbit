// Daily tech digest e2e: add the template from the dashboard, run it, check the saved digest.
// Uses live feeds and one Sonnet call. Run: npm run build && node scripts/e2e-digest.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const shots = join(root, 'out', 'e2e')
const dataDir = join(root, 'out', 'e2e-digest-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(shots, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:sonnet' } }))

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({
  executablePath: exe,
  args: exe ? [] : [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir }
})
await app.firstWindow()

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}

await app.evaluate(() => globalThis.__orbit.openDashboard('workflows'))
const dash = await app.waitForEvent('window', { predicate: (p) => p.url().includes('dashboard') })
await dash.waitForLoadState('domcontentloaded')
await dash.setViewportSize({ width: 1040, height: 760 })
await dash.waitForSelector('text=Daily tech digest')
await dash.screenshot({ path: join(shots, 'digest-templates.png') })
await dash.click('button:has-text("Add")')
await dash.waitForSelector('text=daily-tech-digest')
check('schedule shown in plain words', (await dash.locator('text=Every day at 08:30').count()) === 1)

const t0 = Date.now()
await dash.click('button:has-text("Run now")')
await dash.click('text=daily-tech-digest')
let run
for (let i = 0; i < 150 && run?.status !== 'done' && run?.status !== 'failed'; i++) {
  await dash.waitForTimeout(2000)
  run = await app.evaluate(() => globalThis.__orbit.workflows.runs('daily-tech-digest', 1)[0])
}
const secs = Math.round((Date.now() - t0) / 1000)
check('digest run finished', run?.status === 'done', `${run?.status} in ${secs}s ${run?.error ?? ''}`)

const file = join(dataDir, 'files', 'digests', `tech-${new Date().toISOString().slice(0, 10)}.md`)
const digest = existsSync(file) ? readFileSync(file, 'utf8') : ''
const sections = ['Top of the day', 'AI', 'Startups', 'Worth trying', 'Hacker News'].filter((s) => digest.includes(s))
check('digest saved with its sections', sections.length >= 4, `${sections.join(', ')} (${digest.length} chars)`)
check('digest links to sources', (digest.match(/\]\(https?:\/\//g) ?? []).length >= 10, `${(digest.match(/\]\(https?:\/\//g) ?? []).length} links`)

await dash.waitForTimeout(800)
await dash.screenshot({ path: join(shots, 'digest-run.png'), fullPage: true })
console.log('\n----- digest (first 1800 chars) -----\n' + digest.slice(0, 1800))

await app.close()
process.exit(failed ? 1 : 0)
