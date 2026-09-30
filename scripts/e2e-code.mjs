// Code e2e: run_python works (packages, files in and out, charts) and can't reach the network,
// the disk or Node; limits stop runaway code. run_command stays hidden until turned on, shows its
// plain description on the approval card and in the log, and a denial runs nothing.
// Two small model calls. Package downloads are cached in out/models-cache between runs.
// Run: npm run build && node scripts/e2e-code.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-code-profile')
const docs = join(dataDir, 'docs')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(docs, { recursive: true })
writeFileSync(join(docs, 'sales.csv'), 'month,amount\nJan,100\nFeb,250\nMar,175\n')
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({
    voice: { engine: 'off' },
    models: { chat: 'claude:haiku', quick: 'claude:haiku' },
    permissions: { level: 'careful' },
    files: { allowedFolders: [docs] },
    tools: { python: { timeoutSec: 60, memoryMb: 1024 } }
  })
)

const exe = process.env.ORBIT_EXE ? resolve(process.env.ORBIT_EXE) : undefined
const app = await electron.launch({
  executablePath: exe,
  args: exe ? [] : [join(root, 'out', 'main', 'index.js')],
  env: { ...process.env, ORBIT_E2E: '1', ORBIT_DATA_DIR: dataDir, ORBIT_MODELS_DIR: join(root, 'out', 'models-cache') }
})
const bar = await app.firstWindow()
await bar.waitForLoadState('domcontentloaded')

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input), { name, input })
const py = (code, files) => tool('run_python', { description: 'test', code, files })
const setSettings = (src) => app.evaluate((_e, s) => globalThis.__orbit.settings.update(new Function('d', s)), src)
const one = (s) => s.replace(/\s+/g, ' ').slice(0, 140)

// Python
let r = await py('print(sum(range(10)))\n6 * 7')
check('runs Python and returns output and the last value', !r.isError && r.output.includes('45') && r.output.includes('Result: 42'), one(r.output))
r = await py("import pandas as pd\ndf = pd.read_csv('/in/sales.csv')\nprint(df.amount.sum())", [join(docs, 'sales.csv')])
check('reads files copied in, with pandas', !r.isError && /525/.test(r.output), one(r.output))
r = await py("import matplotlib.pyplot as plt\nplt.bar(['a','b'], [1,2])\nplt.savefig('chart.png')\nprint('ok')")
const chart = r.output.match(/Saved (.+chart\.png)/)?.[1]
check('saves charts to Orbit files', !r.isError && chart && existsSync(chart) && readFileSync(chart).subarray(1, 4).toString() === 'PNG', one(r.output))
r = await py("from pyodide.http import pyfetch\nr = await pyfetch('https://example.com')\nprint(r.status)")
check('no internet', r.isError || /Error/.test(r.output), one(r.output))
r = await py("import js\nprint(js.eval(\"fetch('https://example.com').then(() => 'reached', () => 'blocked')\"))\nimport asyncio\nprint(await js.eval(\"fetch('https://example.com').then(() => 'reached', () => 'blocked')\"))")
check('no internet through JavaScript either', !/reached/.test(r.output), one(r.output))
r = await py("import js\nprint(hasattr(js, 'process'), hasattr(js, 'require'))")
check('no Node from inside the sandbox', /False False/.test(r.output), one(r.output))
r = await py("print(open('C:/Windows/win.ini').read())")
check("can't read the user's disk", r.isError || /Error/.test(r.output), one(r.output))
r = await py('x = 1', [join(dataDir, 'settings.json')])
check('only copies in files Orbit may read', r.isError && /isn't allowed/.test(r.output), one(r.output))
r = await py('print(1/0)')
check('Python errors come back readable, without Pyodide internals', r.isError && /ZeroDivisionError/.test(r.output) && r.output.trimStart().startsWith('File "<exec>"') , one(r.output))
await setSettings('d.tools.python.timeoutSec = 5')
const t0 = Date.now()
r = await py('while True:\n    pass')
check('runaway code is stopped at the time limit', r.isError && /time limit/.test(r.output) && Date.now() - t0 < 20_000, `${one(r.output)} in ${Date.now() - t0} ms`)
await setSettings('d.tools.python.timeoutSec = 60')
r = await py('print("still works")')
check('the next run is fresh', !r.isError && /still works/.test(r.output))

// Commands
const names = async () => (await app.evaluate(() => globalThis.__orbit.measureTools())).map((t) => t.name)
check('run_command is hidden until turned on', !(await names()).includes('run_command'))
await app.evaluate(() => globalThis.__orbit.openDashboard('permissions'))
let dash
for (let i = 0; i < 20 && !dash; i++) {
  dash = app.windows().find((w) => w.url().includes('dashboard'))
  if (!dash) await bar.waitForTimeout(250)
}
await dash.waitForSelector('text=Let Orbit run commands')
await dash.click('input[aria-label="Let Orbit run commands"]')
await bar.waitForTimeout(400)
check('turning it on in Permissions offers it', (await names()).includes('run_command'))
await dash.screenshot({ path: join(root, 'out', 'e2e', 'dash-permissions-commands.png') })

await app.evaluate(() => globalThis.__orbit.onBarHotkey())
let pending = tool('run_command', { description: 'Make a test folder', command: `New-Item -ItemType Directory -Path '${join(dataDir, 'made-by-command')}'` })
await bar.waitForSelector('text=APPROVAL NEEDED')
check('the card leads with the plain description', await bar.locator('text=Make a test folder').isVisible())
check('and shows the exact command and a warning', (await bar.locator('pre').last().innerText()).includes('New-Item') && (await bar.locator('text=full permissions').count()) > 0)
await bar.click('button:has-text("Deny")')
r = await pending
check('deny runs nothing', r.isError && !existsSync(join(dataDir, 'made-by-command')))

await setSettings("d.permissions.level = 'full'")
r = await tool('run_command', { description: 'Say hello', command: "Write-Output 'héllo'; exit 3" })
check('runs PowerShell, keeps UTF-8, reports the exit code', !r.isError && r.output.includes('Exit code 3') && r.output.includes('héllo'), one(r.output))
await setSettings('d.tools.commands.timeoutSec = 5')
r = await tool('run_command', { description: 'Wait', command: 'Start-Sleep 60' })
check('commands stop at the time limit', /time limit/.test(r.output), one(r.output))
await setSettings("d.tools.commands.timeoutSec = 120; d.permissions.level = 'careful'")
const audit = readFileSync(join(dataDir, 'logs', 'audit.jsonl'), 'utf8')
check('the description is in the log', audit.includes('"description":"Say hello"'))

// Through the model
await bar.fill('textarea', 'Use Python to work out the 25th Fibonacci number (F1 = F2 = 1). Just the number.')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 120_000 })
const fib = await bar.locator('[data-state="done"]').last().innerText()
check('the model uses Python', /75025/.test(fib) && /run_python/.test(fib), one(fib))

await bar.fill('textarea', "What's this PC's computer name? Run a command to check.")
await bar.keyboard.press('Enter')
await bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 90_000 })
const title = await bar.locator('.text-sm.text-zinc-100').last().innerText()
check('the model writes a plain description for its command', title.length > 3 && title.length < 60 && !/^run_command$/.test(title), title)
await bar.screenshot({ path: join(root, 'out', 'e2e', 'bar-command-approval.png') })
await bar.click('button:has-text("Approve")')
await bar.waitForFunction(() => document.querySelectorAll('[data-state="done"]').length > 1, null, { timeout: 90_000 })
const name = await bar.locator('[data-state="done"]').last().innerText()
check('and answers from its output', name.toUpperCase().includes(process.env.COMPUTERNAME.toUpperCase()), one(name))

await app.close()
process.exit(failed ? 1 : 0)
