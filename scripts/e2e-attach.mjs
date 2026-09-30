// Attachments e2e: Word, Excel, PowerPoint, long text and pasted images get into the bar and to
// the model; unreadable files are refused; old attachments are pruned. One small model call.
// Run: npm run build && node scripts/e2e-attach.mjs
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, 'out', 'e2e-attach-profile')
const src = join(dataDir, 'elsewhere')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(src, { recursive: true })
mkdirSync(join(dataDir, 'attachments', '2020-01-01'), { recursive: true })
writeFileSync(join(dataDir, 'attachments', '2020-01-01', 'old.txt'), 'old')

// Fixtures, built in place so the repo carries no binary files.
async function docx(path, text) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`)
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }))
}
async function pptx(path, slides) {
  const zip = new JSZip()
  slides.forEach((t, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`))
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }))
}
await docx(join(src, 'brief.docx'), 'The code word is PELICAN-42.')
await pptx(join(src, 'deck.pptx'), ['Q3 review', 'Revenue up &amp; to the right'])
const wb = new ExcelJS.Workbook()
const sheet = wb.addWorksheet('Costs')
sheet.addRows([['Item', 'Price'], ['Hosting', 30], ['Domain', 12]])
sheet.getCell('B4').value = { formula: 'SUM(B2:B3)', result: 42 }
await wb.xlsx.writeFile(join(src, 'costs.xlsx'))
writeFileSync(join(src, 'long.txt'), 'start. ' + 'filler text. '.repeat(3000) + 'THE END MARKER')
writeFileSync(join(src, 'archive.zip'), 'PK')
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voice: { engine: 'off' }, models: { chat: 'claude:haiku', quick: 'claude:haiku' }, files: { allowedFolders: [] } }))

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

check('old attachments are pruned at startup', !existsSync(join(dataDir, 'attachments', '2020-01-01')))

// Extraction, straight through the API the bar uses.
const res = await bar.evaluate((files) => window.orbit.attachPaths(files), ['brief.docx', 'costs.xlsx', 'deck.pptx', 'long.txt', 'archive.zip'].map((f) => join(src, f)))
const byName = Object.fromEntries(res.items.map((i) => [i.name, i]))
check('reads Word', /PELICAN-42/.test(byName['brief.docx']?.text ?? ''))
check('reads Excel as CSV, with formula results', /Hosting,30/.test(byName['costs.xlsx']?.text ?? '') && /,42/.test(byName['costs.xlsx']?.text ?? ''), byName['costs.xlsx']?.text.replace(/\n/g, ' | '))
check('reads PowerPoint slides in order', /slide 1 ---\nQ3 review[\s\S]*slide 2 ---\nRevenue up & to the right/.test(byName['deck.pptx']?.text ?? ''))
const long = byName['long.txt']
check('long files are cut, with the full length noted', long && long.text.length === 20_000 && long.chars > 39_000, long && `${long.text.length} of ${long.chars}`)
check('unreadable files are refused with a reason', res.errors.length === 1 && /archive\.zip: can't read \.zip/.test(res.errors[0]), res.errors[0])
check('attachments are copies in Orbit\'s folder', res.items.every((i) => i.path.startsWith(join(dataDir, 'attachments'))))

const tail = await tool('read_file', { path: long.path, offset: long.chars - 100 })
check('read_file can read on past the cut', !tail.isError && tail.output.includes('THE END MARKER'), tail.output.slice(-80))
const outside = await tool('read_file', { path: join(src, 'brief.docx') })
check('the original folder is still off limits', outside.isError, outside.output.slice(0, 80))

// The bar: picker, paste (image and a file with no path), drop.
await app.evaluate(() => globalThis.__orbit.onBarHotkey())
await bar.waitForSelector('textarea')
await bar.setInputFiles('input[type=file]', [join(src, 'brief.docx'), join(src, 'costs.xlsx'), join(src, 'archive.zip')])
await bar.waitForFunction(() => document.body.innerText.includes('costs.xlsx'))
const text = await bar.evaluate(() => document.body.innerText)
check('picker adds file chips', text.includes('brief.docx') && /costs\.xlsx · \d+ KB/.test(text))
check('picker shows why a file was refused', /Couldn't attach archive\.zip/.test(text))

await bar.evaluate(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 2400
  canvas.height = 1200
  const g = canvas.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 2400, 1200)
  g.fillStyle = '#000'
  g.font = 'bold 260px sans-serif'
  g.fillText('BLUE MOON', 300, 700)
  const png = await new Promise((r) => canvas.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([png], 'poster.png', { type: 'image/png' }))
  dt.items.add(new File(['meeting moved to Thursday'], 'note.md', { type: 'text/markdown' }))
  document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await bar.waitForFunction(() => document.body.innerText.includes('poster.png') && document.body.innerText.includes('note.md'))
const thumb = await bar.evaluate(() => {
  const img = [...document.querySelectorAll('img')].find((i) => i.src.startsWith('data:image'))
  return new Promise((r) => {
    const probe = new Image()
    probe.onload = () => r(probe.naturalWidth)
    probe.src = img.src
  })
})
check('pasted images are shrunk to 1568 px', thumb === 1568, `${thumb}px`)
check('pasted files without a path attach too', (await bar.evaluate(() => document.body.innerText)).includes('note.md'))

await bar.evaluate(() => {
  const dt = new DataTransfer()
  dt.items.add(new File(['dropped text'], 'dropped.txt', { type: 'text/plain' }))
  document.querySelector('.p-2').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
})
await bar.waitForFunction(() => document.body.innerText.includes('dropped.txt'))
check('dropping a file attaches it', true)
await bar.screenshot({ path: join(root, 'out', 'e2e', 'bar-attachments.png') })

// One real question over all of it.
await bar.fill('textarea', 'Answer in one line, format "CODE | TOTAL | POSTER": the code word in the Word file, the total in the spreadsheet, and the words on the image.')
await bar.keyboard.press('Enter')
await bar.waitForSelector('[data-state="done"]', { timeout: 120_000 })
const answer = await bar.locator('[data-state="done"]').last().innerText()
check('the model sees Word, Excel and the image', /PELICAN-42/.test(answer) && /42/.test(answer.replace('PELICAN-42', '')) && /BLUE MOON/i.test(answer), answer.replace(/\s+/g, ' ').slice(0, 120))
const saved = await app.evaluate(() => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(process.getBuiltinModule('node:path').join(process.env.ORBIT_DATA_DIR, 'orbit.db'))
  return db.prepare("SELECT * FROM messages WHERE role = 'user' ORDER BY rowid DESC LIMIT 1").all()
})
check('history notes what was attached', /\(attached: brief\.docx, costs\.xlsx, poster\.png, note\.md, dropped\.txt\)/.test((saved[0]?.text ?? saved[0]?.content) ?? ''), (saved[0]?.text ?? saved[0]?.content).slice(-90))

await app.close()
process.exit(failed ? 1 : 0)
