// Skills e2e: Orbit's skills are on and Claude's are off until switched on, use_skill only exists
// when something is on and lists just names and descriptions, the model loads and follows a
// skill, and skill files are readable. One small model call.
// Run: npm run build && node scripts/e2e-skills.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-skills-profile')
const claudeDir = join(dataDir, 'fake-claude-skills')
rmSync(dataDir, { recursive: true, force: true })
const skill = (dir, name, description, body, extra) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
  if (extra) writeFileSync(join(dir, extra[0]), extra[1])
}
skill(join(dataDir, 'skills', 'status-haiku'), 'status-haiku', 'How to write a status update when the user asks for one.', 'Write every status update as a haiku: three lines, 5-7-5 syllables. Sign it on a fourth line with the code word read from code.txt in this skill folder.', ['code.txt', 'MARMALADE'])
skill(join(claudeDir, 'commit-style'), 'commit-style', 'How to write git commit messages.', 'Use the imperative mood.')
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' } }))

const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir, ORBIT_CLAUDE_SKILLS_DIR: claudeDir }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const useSkillDesc = async () => (await app.evaluate(() => globalThis.__orbit.measureTools())).find((t) => t.name === 'use_skill')

await app.evaluate(() => globalThis.__orbit.openDashboard('skills'))
let dash
for (let i = 0; i < 20 && !dash; i++) {
  dash = app.windows().find((w) => w.url().includes('dashboard'))
  if (!dash) await bar.waitForTimeout(250)
}
await dash.waitForSelector('text=From Claude')
check("Orbit's skill is on", await dash.locator('[data-skill="orbit:status-haiku"] input').isChecked())
check("Claude's skill starts off", !(await dash.locator('[data-skill="claude:commit-style"] input').isChecked()))
const t = await useSkillDesc()
check('use_skill lists only skills that are on, as one line each', t && t.chars < 900, t && `${t.chars} chars`)
await dash.click('[data-skill="claude:commit-style"] input')
await bar.waitForTimeout(400)
const listed = await app.evaluate(() => globalThis.__orbit.settings.current.skills.onFromClaude)
check('switching a Claude skill on is saved', listed.includes('claude:commit-style'))
await dash.click('[data-skill="orbit:status-haiku"] input')
await dash.click('[data-skill="claude:commit-style"] input')
await bar.waitForTimeout(400)
check('with every skill off, use_skill disappears', !(await useSkillDesc()))
await dash.click('[data-skill="orbit:status-haiku"] input')
await bar.waitForTimeout(400)
await dash.screenshot({ path: join(root, 'out', 'e2e', 'dash-skills.png') })

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.fill('textarea', 'Give me a status update on the garden project: the tomatoes are planted and the fence is half done.')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 120_000 })
const answer = await bar.locator('[data-state="done"]').last().innerText()
check('the model loads the skill and follows it, including its files', /use_skill/.test(answer) && /MARMALADE/.test(answer), answer.replace(/\s+/g, ' ').slice(0, 200))

await app.close()
process.exit(failed ? 1 : 0)
