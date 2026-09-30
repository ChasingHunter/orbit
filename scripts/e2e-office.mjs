// Office files e2e: make_file builds docx, pdf, xlsx and pptx that read back correctly, never
// overwrites, can be undone, and shows a file chip in the bar. One small model call.
// Run: npm run build && node scripts/e2e-office.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ExcelJS from 'exceljs'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-office-profile')
const files = join(dataDir, 'files')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(files, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' }, permissions: { level: 'careful' } }))

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
const readBack = async (name) => (await tool('read_saved_file', { name })).output

const md = `# Quarterly report\n\nRevenue grew **12%** this quarter, see [the site](https://example.com).\n\n## Highlights\n\n- New office in Pune\n- Two hires\n  - one designer\n\n1. Ship v2\n2. Hire sales\n\n| Region | Revenue |\n|---|---|\n| India | 120 |\n| EU | 80 |\n\n\`\`\`\nnpm run build\n\`\`\``

let r = await tool('make_file', { name: 'q3-report', format: 'docx', title: 'Q3', markdown: md })
check('makes a Word file', !r.isError && existsSync(join(files, 'q3-report.docx')), r.output)
let text = await readBack('q3-report.docx')
check('Word file has headings, lists and the table', ['Quarterly report', 'Revenue grew 12%', 'New office in Pune', 'one designer', 'Hire sales', 'India', '120', 'npm run build'].every((s) => text.includes(s)), text.replace(/\s+/g, ' ').slice(0, 160))

r = await tool('make_file', { name: 'q3-report', format: 'docx', markdown: '# Second' })
check('never overwrites: numbers the new one', !r.isError && /q3-report \(2\)\.docx/.test(r.output), r.output)

r = await tool('make_file', { name: 'q3-report', format: 'pdf', title: 'Q3', markdown: md + '\n\n<script>alert(1)</script>' })
text = r.isError ? '' : await readBack('q3-report.pdf')
check('makes a PDF with the same content', !r.isError && text.includes('Quarterly report') && text.includes('India'), text.replace(/\s+/g, ' ').slice(0, 120))
check('raw HTML in a PDF stays text', text.includes('<script>alert(1)</script>'))

r = await tool('make_file', { name: 'budget', format: 'xlsx', sheets: [{ name: 'Costs', rows: [['Item', 'Price'], ['Hosting', 30], ['Domain', 12], ['Total', '=SUM(B2:B3)']] }] })
check('makes an Excel file', !r.isError && existsSync(join(files, 'budget.xlsx')), r.output)
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(join(files, 'budget.xlsx'))
const ws = wb.getWorksheet('Costs')
check('formulas are real formulas', ws.getCell('B4').formula === 'SUM(B2:B3)', JSON.stringify(ws.getCell('B4').value))
check('header is bold and frozen', ws.getRow(1).font?.bold === true && ws.views[0]?.ySplit === 1)

r = await tool('make_file', { name: 'pitch', format: 'pptx', title: 'Pitch', slides: [{ title: 'Orbit' }, { title: 'Why', bullets: ['Works in every app', 'Your own models'], notes: 'Keep it short' }] })
text = r.isError ? '' : await readBack('pitch.pptx')
check('makes a PowerPoint deck', !r.isError && /slide 1 ---\nOrbit/.test(text) && text.includes('Works in every app'), text.replace(/\n/g, ' | ').slice(0, 120))

r = await tool('make_file', { name: 'loop', format: 'xlsx', sheets: [{ name: 'S', rows: [['Item', 'Price'], ['A', 1], ['Total', '=SUM(B2:B3)']] }] })
check('catches a formula that includes its own cell', r.isError && /B3 \(=SUM\(B2:B3\)\) includes its own cell/.test(r.output), r.output.slice(0, 90))
r = await tool('make_file', { name: 'x', format: 'xlsx' })
check('says what is missing', r.isError && /sheets is required/.test(r.output))

const undone = await app.evaluate(async () => {
  const [last] = await globalThis.__orbit.recentChanges()
  return globalThis.__orbit.undoChange(last.id)
})
check('undo removes a made file', !existsSync(join(files, 'pitch.pptx')), undone)

// Through the model, with the chip in the answer.
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.fill('textarea', 'Make me a spreadsheet called fruits with apples 3, pears 4 and plums 5, and a total row that adds them up with a formula.')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 120_000 })
const made = existsSync(join(files, 'fruits.xlsx'))
let formula = ''
if (made) {
  const w = new ExcelJS.Workbook()
  await w.xlsx.readFile(join(files, 'fruits.xlsx'))
  w.eachSheet((s) => s.eachRow((row) => row.eachCell((c) => (formula ||= c.formula ?? ''))))
}
check('the model makes the spreadsheet with a working formula', made && /^SUM\(B2:B4\)$/i.test(formula), formula || 'no file')
check('the answer shows the file with Open and Show in folder', (await bar.locator('text=fruits.xlsx').count()) > 0 && (await bar.locator('button:has-text("Show in folder")').count()) > 0)
await bar.screenshot({ path: join(root, 'out', 'e2e', 'bar-made-file.png') })

await app.close()
process.exit(failed ? 1 : 0)
