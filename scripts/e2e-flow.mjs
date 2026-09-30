// Branches, loops and parallel steps e2e. One small model call (the yes/no branch).
// Run: npm run build && node scripts/e2e-flow.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-flow-profile')
const wfDir = join(dataDir, 'workflows')
const files = join(dataDir, 'files')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(wfDir, { recursive: true })
mkdirSync(files, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' } }))
writeFileSync(join(files, 'list.json'), JSON.stringify(['alpha', 'beta', 'gamma']))
writeFileSync(join(files, 'news.txt'), '1. Rust 2.0 released\n   https://example.com/rust\n2. New GPU from Nvidia\n   https://example.com/gpu')
writeFileSync(join(files, 'flag.txt'), 'yes')
writeFileSync(join(files, 'sms.txt'), 'Your HDFC card ending 4411 was charged Rs 4,999 at Amazon.')

writeFileSync(
  join(wfDir, 'flow-test.yaml'),
  `name: flow-test
steps:
  - id: load
    parallel:
      - id: list
        tool: read_saved_file
        args: { name: list.json }
      - id: news
        tool: read_saved_file
        args: { name: news.txt }
      - id: flag
        tool: read_saved_file
        args: { name: flag.txt }
      - id: sms
        tool: read_saved_file
        args: { name: sms.txt }
  - id: each
    foreach: "{{steps.list.output}}"
    concurrency: 2
    steps:
      - id: save
        tool: save_file
        args: { name: "item-{{index}}.txt", content: "{{item}}" }
  - id: headlines
    foreach: "{{steps.news.output}}"
    steps:
      - id: save
        tool: save_file
        args: { name: "news-{{index}}.txt", content: "{{item}}" }
  - id: by_flag
    if: "{{steps.flag.output}}"
    then:
      - id: yes
        tool: save_file
        args: { name: then.txt, content: took then }
    else:
      - id: no
        tool: save_file
        args: { name: else.txt, content: took else }
  - id: is_payment
    if: { ask: "Is this message about money being paid or charged?", input: "{{steps.sms.output}}" }
    then:
      - id: note
        tool: save_file
        args: { name: payment.txt, content: "payment noted" }
`
)

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
const read = (n) => (existsSync(join(files, n)) ? readFileSync(join(files, n), 'utf8') : null)

const t0 = Date.now()
const runId = await app.evaluate(() => globalThis.__orbit.workflows.run('flow-test', 'manual'))
const run = await app.evaluate((_e, id) => globalThis.__orbit.workflows.runs('flow-test', 5).find((r) => r.id === id), runId)
const steps = await app.evaluate((_e, id) => globalThis.__orbit.workflows.steps(id), runId)
const ids = steps.map((s) => `${s.step_id}:${s.status}`)
check('run finished', run.status === 'done', `${run.error ?? ''} (${Date.now() - t0} ms)`)
check('parallel steps all ran', ['load.list', 'load.news', 'load.flag', 'load.sms'].every((i) => ids.includes(`${i}:done`)))
check('foreach over a JSON list', read('item-1.txt') === 'alpha' && read('item-2.txt') === 'beta' && read('item-3.txt') === 'gamma')
check('foreach over a numbered list keeps each item whole', (read('news-1.txt') ?? '').includes('Rust 2.0') && (read('news-1.txt') ?? '').includes('example.com/rust') && (read('news-2.txt') ?? '').includes('GPU'), JSON.stringify(read('news-1.txt')))
check('loop iterations logged separately', ids.includes('each[2].save:done') && ids.includes('headlines[2].save:done'))
check('template branch took then', read('then.txt') === 'took then' && read('else.txt') === null)
check('model-decided branch said yes', read('payment.txt') === 'payment noted', steps.find((s) => s.step_id === 'is_payment')?.input ?? '')

await app.close()
process.exit(failed ? 1 : 0)
