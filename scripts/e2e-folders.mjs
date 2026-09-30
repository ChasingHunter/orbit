// Folder access e2e: list, read a real PDF, refuse paths outside allowed folders (including via a
// junction), and a folder trigger whose agent reads the new PDF. One small model call.
// Run: npm run build && node scripts/e2e-folders.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-folders-profile')
const allowed = join(dataDir, 'allowed')
const secret = join(dataDir, 'private')
rmSync(dataDir, { recursive: true, force: true })
for (const d of [allowed, secret, join(dataDir, 'workflows'), join(dataDir, 'files')]) mkdirSync(d, { recursive: true })
writeFileSync(join(secret, 'diary.txt'), 'private stuff')
symlinkSync(secret, join(allowed, 'sneaky'), 'junction')

/** Builds a small valid one-page PDF with the given lines of text. */
function makePdf(lines) {
  const content = `BT /F1 14 Tf 72 720 Td 18 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) '`).join(' ')} ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}
writeFileSync(join(allowed, 'invoice-17.pdf'), makePdf(['Invoice 17 from Acme Cloud', 'Amount due: USD 1,240.00', 'Due date: 15 October 2026']))

writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' }, files: { allowedFolders: [allowed] } })
)
writeFileSync(
  join(dataDir, 'workflows', 'invoice-inbox.yaml'),
  `name: invoice-inbox
trigger: { folder: { path: "${allowed.replace(/\\/g, '/')}", pattern: "*.pdf" } }
model: quick
steps:
  - id: read
    tool: read_file
    args: { path: "{{trigger.file}}" }
  - id: summary
    agent: "From this invoice, reply with only: vendor, amount, due date, separated by ' | '."
    input: "{{steps.read.output}}"
  - id: save
    tool: save_file
    args: { name: "invoices.txt", content: "{{trigger.name}}: {{steps.summary.output}}" }
`
)

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
const tool = (name, input) => app.evaluate((_e, a) => globalThis.__orbit.callTool(a.name, a.input), { name, input })

const listing = await tool('list_folder', { path: allowed, pattern: '*.pdf' })
check('lists the allowed folder', !listing.isError && listing.output.includes('invoice-17.pdf'), listing.output.split('\n')[0])

const pdf = await tool('read_file', { path: join(allowed, 'invoice-17.pdf') })
check('reads text out of a PDF', !pdf.isError && /Amount due: USD 1,240\.00/.test(pdf.output), pdf.output.replace(/\s+/g, ' ').slice(0, 120))

const outside = await tool('read_file', { path: join(dataDir, 'settings.json') })
check('refuses a file outside the allowed folders', outside.isError && /isn't allowed/.test(outside.output), outside.output.slice(0, 90))

const junction = await tool('read_file', { path: join(allowed, 'sneaky', 'diary.txt') })
check('refuses escaping through a junction', junction.isError && /isn't allowed/.test(junction.output), junction.output.slice(0, 90))

// A new PDF lands; the workflow reads and summarises it.
writeFileSync(join(allowed, 'invoice-18.pdf'), makePdf(['Invoice 18 from Northwind Hosting', 'Amount due: EUR 89.50', 'Due date: 2 November 2026']))
let run
for (let i = 0; i < 60 && run?.status !== 'done' && run?.status !== 'failed'; i++) {
  await bar.waitForTimeout(1000)
  run = await app.evaluate(() => globalThis.__orbit.workflows.runs('invoice-inbox', 1)[0])
}
const saved = existsSync(join(dataDir, 'files', 'invoices.txt')) ? readFileSync(join(dataDir, 'files', 'invoices.txt'), 'utf8') : ''
check('folder trigger read the new PDF', run?.status === 'done' && /invoice-18\.pdf: .*Northwind.*89\.50.*2 November 2026/i.test(saved.replace(/\s+/g, ' ')), saved || run?.error)

await app.close()
process.exit(failed ? 1 : 0)
