// Visual editor e2e: view the digest as a flow, then build, save and run a workflow by clicking.
// No model calls. Run: npm run build && node scripts/e2e-editor.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const shots = join(root, 'out', 'e2e')
const dataDir = join(root, 'out', 'e2e-editor-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(shots, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' } }))

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
const d = await app.waitForEvent('window', { predicate: (p) => p.url().includes('dashboard') })
await d.waitForLoadState('domcontentloaded')
await d.setViewportSize({ width: 1280, height: 820 })
const node = (text) => d.locator('.react-flow__node', { hasText: text }).first()
const panel = d.locator('div.w-\\[340px\\]')

// 1. The digest as a flow.
await d.click('button:has-text("Add")')
await d.click('text=daily-tech-digest')
await d.click('button:has-text("Edit visually")')
await d.waitForSelector('[data-testid="flow-canvas"] .react-flow__node')
await d.waitForTimeout(600)
const digestNodes = await d.locator('.react-flow__node').count()
check('digest drawn with its parallel fetches', digestNodes >= 10 && (await node('techcrunch').count()) === 1, `${digestNodes} nodes`)
await d.screenshot({ path: join(shots, 'editor-digest.png') })
await d.click('button:has-text("Close")')
await d.click('main button:has-text("Workflows")')

// 2. Build a new one by clicking.
await d.click('button:has-text("New workflow")')
await d.waitForSelector('[data-testid="flow-canvas"] .react-flow__node')
await panel.locator('input').first().fill('visual-test')
await node('Starts').click()
await panel.locator('select').first().selectOption('cron')
await d.click('button:has-text("Weekdays at 9:00")')
await node('write').click()
await panel.locator('button[title="Delete step"]').click()
await node('First step').click()
await panel.locator('button', { hasText: 'Tool' }).first().click()
await panel.locator('select').first().selectOption('save_file')
await panel.locator('textarea').first().fill('{ "name": "visual.txt", "content": "made in the editor on {{date}}" }')
await panel.locator('button:has-text("Add a step after this")').click()
await panel.locator('button', { hasText: 'If / else' }).click()
await panel.locator('input').nth(1).fill('{{steps.tool1.output}}')
await node('If yes: add a step').click()
await panel.locator('button', { hasText: 'Tool' }).first().click()
await panel.locator('select').first().selectOption('save_file')
await panel.locator('textarea').first().fill('{ "name": "branch.txt", "content": "yes branch" }')
await d.waitForTimeout(300)
await d.screenshot({ path: join(shots, 'editor-new.png') })
await d.click('button:has-text("Save")')
await d.waitForSelector('text=Saved ·', { timeout: 5000 }).catch(() => {})
const file = join(dataDir, 'workflows', 'visual-test.yaml')
const yaml = existsSync(file) ? readFileSync(file, 'utf8') : ''
check('saved as YAML with the schedule', /cron: 0 9 \* \* 1-5/.test(yaml), yaml.split('\n')[1] ?? '')
check('steps saved in order with the branch nested', /tool: save_file[\s\S]*if: "\{\{steps\.tool1\.output\}\}"[\s\S]*then:[\s\S]*branch\.txt/.test(yaml), yaml.replace(/\s+/g, ' ').slice(0, 200))

// 3. It runs.
await app.evaluate(() => globalThis.__orbit.workflows.run('visual-test', 'manual'))
const run = await app.evaluate(() => globalThis.__orbit.workflows.runs('visual-test', 1)[0])
const files = join(dataDir, 'files')
check('editor-built workflow runs', run.status === 'done' && existsSync(join(files, 'visual.txt')) && existsSync(join(files, 'branch.txt')), run.error ?? '')

// 4. Mistakes show up instead of saving.
await d.click('button:has-text("Edit visually")')
await d.waitForSelector('[data-testid="flow-canvas"] .react-flow__node')
// The panel opens on the workflow's settings.
await panel.locator('input').first().fill('Bad Name')
await d.click('button:has-text("Save")')
const err = await d.waitForSelector('text=lowercase letters', { timeout: 5000 }).catch(() => null)
check('invalid name is refused with a message', !!err)

await app.close()
process.exit(failed ? 1 : 0)
