import { BrowserWindow } from 'electron'
import { Marked, type Token, type Tokens } from 'marked'

// Builds Word, Excel, PowerPoint and PDF files from simple input the model writes well:
// markdown for documents, rows for spreadsheets, title + bullets for slides.

export type Sheet = { name: string; rows: (string | number | boolean | null)[][] }
export type Slide = { title: string; bullets?: string[]; notes?: string }

// Documents

type Run = { text: string; bold?: boolean; italics?: boolean; code?: boolean; link?: string }

function runs(tokens: Token[] | undefined, style: Omit<Run, 'text'> = {}): Run[] {
  const out: Run[] = []
  for (const t of tokens ?? []) {
    if (t.type === 'strong') out.push(...runs((t as Tokens.Strong).tokens, { ...style, bold: true }))
    else if (t.type === 'em') out.push(...runs((t as Tokens.Em).tokens, { ...style, italics: true }))
    else if (t.type === 'codespan') out.push({ ...style, code: true, text: decode((t as Tokens.Codespan).text) })
    else if (t.type === 'link') out.push(...runs((t as Tokens.Link).tokens, { ...style, link: (t as Tokens.Link).href }))
    else if (t.type === 'br') out.push({ ...style, text: '\n' })
    else if ('tokens' in t && t.tokens) out.push(...runs(t.tokens, style))
    else if ('text' in t) out.push({ ...style, text: decode(String(t.text)) })
  }
  return out
}

function decode(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

export async function makeDocx(markdown: string, title?: string): Promise<Buffer> {
  const d = await import('docx')
  const lexer = new Marked({ gfm: true })
  const toRuns = (rs: Run[]): (InstanceType<typeof d.TextRun> | InstanceType<typeof d.ExternalHyperlink>)[] =>
    rs.map((r) => {
      const run = new d.TextRun({ text: r.text, bold: r.bold, italics: r.italics, font: r.code ? 'Consolas' : undefined, style: r.link ? 'Hyperlink' : undefined })
      return r.link && /^https?:\/\//.test(r.link) ? new d.ExternalHyperlink({ link: r.link, children: [run] }) : run
    })
  const headings = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6]
  const blocks: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = []

  const list = (l: Tokens.List, level: number): void => {
    for (const item of l.items) {
      const inline = item.tokens.filter((t) => t.type !== 'list')
      blocks.push(
        new d.Paragraph({
          children: toRuns(runs(inline.flatMap((t) => ('tokens' in t && t.tokens ? t.tokens : [t])))),
          ...(l.ordered ? { numbering: { reference: 'numbers', level } } : { bullet: { level } })
        })
      )
      for (const sub of item.tokens) if (sub.type === 'list') list(sub as Tokens.List, Math.min(level + 1, 8))
    }
  }

  for (const t of lexer.lexer(markdown)) {
    if (t.type === 'heading') blocks.push(new d.Paragraph({ heading: headings[(t as Tokens.Heading).depth - 1], children: toRuns(runs((t as Tokens.Heading).tokens)) }))
    else if (t.type === 'paragraph') blocks.push(new d.Paragraph({ children: toRuns(runs((t as Tokens.Paragraph).tokens)), spacing: { after: 120 } }))
    else if (t.type === 'list') list(t as Tokens.List, 0)
    else if (t.type === 'blockquote') blocks.push(new d.Paragraph({ children: toRuns(runs((t as Tokens.Blockquote).tokens, { italics: true })), indent: { left: 480 } }))
    else if (t.type === 'code') {
      for (const line of (t as Tokens.Code).text.split('\n')) blocks.push(new d.Paragraph({ children: [new d.TextRun({ text: line, font: 'Consolas', size: 19 })], shading: { type: d.ShadingType.CLEAR, fill: 'F3F3F3', color: 'auto' } }))
    } else if (t.type === 'hr') blocks.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } } }))
    else if (t.type === 'table') {
      const tbl = t as Tokens.Table
      const row = (cells: Tokens.TableCell[], header: boolean): InstanceType<typeof d.TableRow> =>
        new d.TableRow({
          tableHeader: header,
          children: cells.map((c) => new d.TableCell({ children: [new d.Paragraph({ children: toRuns(runs(c.tokens, header ? { bold: true } : {})) })], shading: header ? { type: d.ShadingType.CLEAR, fill: 'EDEDED', color: 'auto' } : undefined }))
        })
      blocks.push(new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows: [row(tbl.header, true), ...tbl.rows.map((r) => row(r, false))] }))
      blocks.push(new d.Paragraph({}))
    }
  }

  const doc = new d.Document({
    title,
    creator: 'Orbit',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        {
          reference: 'numbers',
          levels: Array.from({ length: 9 }, (_, level) => ({ level, format: d.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } }))
        }
      ]
    },
    sections: [{ children: blocks }]
  })
  return d.Packer.toBuffer(doc)
}

// Spreadsheets

export async function makeXlsx(sheets: Sheet[]): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Orbit'
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1', { views: [{ state: 'frozen', ySplit: 1 }] })
    s.rows.forEach((r, ri) => {
      r.forEach((v, ci) => {
        if (typeof v === 'string' && v.startsWith('=') && refersToItself(v, ri + 1, ci + 1)) {
          throw new Error(`The formula in ${colName(ci + 1)}${ri + 1} (${v}) includes its own cell. Row 1 is the first row you gave, so check the row numbers.`)
        }
      })
      ws.addRow(r.map((v) => (typeof v === 'string' && v.startsWith('=') && v.length > 1 ? { formula: v.slice(1) } : v)))
    })
    const header = ws.getRow(1)
    header.font = { bold: true }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } }
    ws.columns.forEach((col, i) => {
      const widest = Math.max(...s.rows.map((r) => String(r[i] ?? '').length), 4)
      col.width = Math.min(60, widest + 2)
    })
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

function colName(n: number): string {
  let s = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function colNum(s: string): number {
  return [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
}

/** Models often write =SUM(B2:B5) in B5. Excel calls that a circular reference; catch it here. */
function refersToItself(formula: string, row: number, col: number): boolean {
  for (const m of formula.matchAll(/(?<![A-Z!])\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/gi)) {
    const [c1, r1] = [colNum(m[1]), Number(m[2])]
    const [c2, r2] = m[3] ? [colNum(m[3]), Number(m[4])] : [c1, r1]
    if (row >= Math.min(r1, r2) && row <= Math.max(r1, r2) && col >= Math.min(c1, c2) && col <= Math.max(c1, c2)) return true
  }
  return false
}

// Slides

export async function makePptx(slides: Slide[], title?: string): Promise<Buffer> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Orbit'
  if (title) pptx.title = title
  slides.forEach((s, i) => {
    const slide = pptx.addSlide()
    const first = i === 0 && !s.bullets?.length
    slide.addText(s.title, first
      ? { x: 0.8, y: 2.6, w: 11.7, h: 1.5, fontSize: 40, bold: true, color: '1F2937', fontFace: 'Calibri' }
      : { x: 0.6, y: 0.4, w: 12.1, h: 1, fontSize: 30, bold: true, color: '1F2937', fontFace: 'Calibri' })
    if (s.bullets?.length) {
      slide.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.8, y: 1.6, w: 11.7, h: 5.4, fontSize: 20, color: '374151', fontFace: 'Calibri', valign: 'top', paraSpaceAfter: 8 }
      )
    }
    if (s.notes) slide.addNotes(s.notes)
  })
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
}

// PDF: markdown to HTML, printed by a hidden window with scripts off and no network.

const PDF_CSS = `
body { font: 11pt/1.5 Calibri, 'Segoe UI', sans-serif; color: #1f2937; margin: 0; }
h1 { font-size: 22pt; margin: 0 0 10pt; } h2 { font-size: 16pt; margin: 18pt 0 6pt; } h3 { font-size: 13pt; margin: 14pt 0 4pt; }
p { margin: 0 0 8pt; } ul, ol { margin: 0 0 8pt; padding-left: 20pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 12pt; font-size: 10pt; }
th, td { border: 1px solid #d1d5db; padding: 4pt 6pt; text-align: left; vertical-align: top; } th { background: #f3f4f6; }
code { font-family: Consolas, monospace; font-size: 9.5pt; background: #f3f4f6; padding: 0 2pt; }
pre { background: #f3f4f6; padding: 8pt; white-space: pre-wrap; } pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #d1d5db; margin: 0 0 8pt; padding-left: 10pt; color: #4b5563; }
a { color: #1d4ed8; } hr { border: 0; border-top: 1px solid #d1d5db; margin: 12pt 0; }`

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function makePdf(markdown: string, title?: string): Promise<Buffer> {
  const marked = new Marked({ gfm: true, renderer: { html: ({ text }) => escape(text) } })
  const body = marked.parse(markdown, { async: false })
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(title ?? '')}</title><style>${PDF_CSS}</style></head><body>${body}</body></html>`
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, offscreen: true } })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0.7, bottom: 0.7, left: 0.7, right: 0.7 } })
  } finally {
    win.destroy()
  }
}
