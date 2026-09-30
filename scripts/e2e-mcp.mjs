// MCP e2e: connect a local stdio server and Notion's remote server (without signing in),
// then have the model call an MCP tool through the approval card.
// Run: npm run build && node scripts/e2e-mcp.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-mcp-profile')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
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

const states = await app.evaluate(async () => {
  const m = globalThis.__orbit.integrations
  await m.upsert('everything', { type: 'stdio', name: 'Everything', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'], env: {}, secretEnv: {}, enabled: true }, false)
  // Non-interactive on purpose: must end in needs-auth without opening a browser.
  await m.upsert('notion', { type: 'http', name: 'Notion', url: 'https://mcp.notion.com/mcp', enabled: true, secretHeaders: {} }, false)
  return m.states()
})
const everything = states.find((s) => s.id === 'everything')
check('stdio server connected', everything?.status === 'connected' && everything.toolCount > 0, JSON.stringify(everything))
console.log('notion state:', JSON.stringify(states.find((s) => s.id === 'notion')))

const echoWrites = await app.evaluate(() => globalThis.__orbit.integrations.tools().find((t) => t.name === 'everything__echo')?.sideEffect)
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.fill('textarea', 'Use the Everything echo tool to echo the text "orbit-mcp-ok", then tell me exactly what it returned.')
await bar.keyboard.press('Enter')
// Tools the server marks read-only run without asking; everything else needs approval.
const card = await Promise.race([
  bar.waitForSelector('text=APPROVAL NEEDED', { timeout: 60_000 }).catch(() => null),
  bar.waitForSelector('[data-state="done"]', { timeout: 60_000 }).then(() => null).catch(() => null)
])
check(`approval ${echoWrites ? 'shown' : 'skipped'} for ${echoWrites ? 'writing' : 'read-only'} tool`, !!card === !!echoWrites)
if (card) await bar.click('button:has-text("Approve")')
await bar.waitForSelector('[data-state="done"]', { timeout: 90_000 })
const answer = await bar.locator('[data-state="done"]').last().innerText()
check('model got the MCP result', answer.includes('orbit-mcp-ok'), answer.replace(/\s+/g, ' ').slice(0, 160))
await bar.screenshot({ path: join(root, 'out', 'e2e', 'mcp-answer.png') })

await app.close()
process.exit(failed ? 1 : 0)
