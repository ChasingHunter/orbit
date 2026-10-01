// Workflow checks: arguments are validated against each tool's real inputs when saving, obvious
// type slips ("15" for a number) are fixed instead of failing at run time, and create_file can
// number a file instead of failing on a second run. No model calls.
// Run: npm run build && node scripts/e2e-wfcheck.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-wfcheck-profile')
const out = join(dataDir, 'out')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, permissions: { level: 'full' }, files: { allowedFolders: [out], writableFolders: [out] } }))
const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir } })
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input, 'chat'), { name, input })
const wf = (steps) => `name: t\ntrigger: { manual: true }\nsteps:\n${steps}`
const path = join(out, 'digest.md').replaceAll(String.fromCharCode(92), '/')

let r = await tool('create_workflow', { yaml: wf(`  - id: fetch\n    tool: read_feed\n    args: { url: "https://hnrss.org/frontpage", limti: 5 }\n`) })
check('a misspelled argument is caught when saving', r.isError && /no argument "limti"/.test(r.output), r.output.slice(0, 140))
r = await tool('create_workflow', { yaml: wf(`  - id: save\n    tool: create_file\n    args: { content: "x" }\n`) })
check('a missing required argument is caught', r.isError && /argument "path"/.test(r.output), r.output.slice(0, 140))
r = await tool('create_workflow', { yaml: wf(`  - id: save\n    tool: create_file\n    args: { path: "{{date}}.md", content: "{{steps.x.output}}" }\n`) })
check('templated values are allowed', !r.isError, r.output.slice(0, 100))
r = await tool('create_workflow', { yaml: wf(`  - id: save\n    tool: create_file\n    args: { path: "${path}", content: "hello", ifExists: number }\n`) })
check('a valid workflow saves', !r.isError, r.output.slice(0, 100))
await app.evaluate(() => globalThis.__orbit.workflows.run('t', 'manual'))
await app.evaluate(() => globalThis.__orbit.workflows.run('t', 'manual'))
await bar.waitForTimeout(1500)
check('a second run the same day numbers the file instead of failing', existsSync(join(out, 'digest.md')) && existsSync(join(out, 'digest (2).md')))

r = await tool('read_file', { path: join(out, 'digest.md'), maxChars: '2000' })
check('"2000" for a number is fixed, not an error', !r.isError, r.output.slice(0, 60))
r = await tool('read_file', { path: join(out, 'digest.md'), maxChars: 'lots' })
check('real type errors still fail', r.isError)

await app.close()
process.exit(failed ? 1 : 0)
