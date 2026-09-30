import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

// Turns a file into plain text for the model: PDFs, Office files and plain text formats.
// Used by read_file and by attachments in the bar.

export const TEXT_TYPES = new Set([
  '.txt', '.md', '.csv', '.tsv', '.json', '.log', '.xml', '.yaml', '.yml', '.html', '.htm', '.ini', '.srt',
  '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.ps1', '.bat', '.sql', '.css', '.toml', '.env.example'
])
export const OFFICE_TYPES = new Set(['.docx', '.xlsx', '.pptx'])
export const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

export function canExtract(file: string): boolean {
  const ext = extname(file).toLowerCase()
  return ext === '.pdf' || TEXT_TYPES.has(ext) || OFFICE_TYPES.has(ext)
}

export async function extractText(file: string): Promise<string> {
  const ext = extname(file).toLowerCase()
  if (ext === '.pdf') return pdfText(file)
  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ path: file })
    return value.replace(/\n{3,}/g, '\n\n').trim()
  }
  if (ext === '.xlsx') return xlsxText(file)
  if (ext === '.pptx') return pptxText(file)
  if (TEXT_TYPES.has(ext)) {
    const text = readFileSync(file, 'utf8')
    if (ext === '.html' || ext === '.htm') return text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    return text
  }
  throw new Error(`Can't read ${ext || 'this kind of'} files. Supported: PDF, Word, Excel, PowerPoint, images and plain text formats.`)
}

async function pdfText(file: string): Promise<string> {
  const { extractText: unpdf, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)))
  const { totalPages, text: pages } = await unpdf(pdf, { mergePages: false })
  const text = (pages as string[]).map((p, i) => `--- page ${i + 1} of ${totalPages} ---\n${p.trim()}`).join('\n\n')
  if (!text.replace(/--- page.*---/g, '').trim()) return '(This PDF has no text layer; it is probably scanned. Try a screenshot instead.)'
  return text
}

/** Each sheet as CSV, which models read well and costs fewer tokens than a table. */
async function xlsxText(file: string): Promise<string> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const out: string[] = []
  wb.eachSheet((sheet) => {
    const rows: string[] = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => csvCell(cellValue(v)))
      rows.push(cells.join(','))
    })
    out.push(`--- sheet "${sheet.name}" (${sheet.rowCount} rows) ---\n${rows.join('\n')}`)
  })
  return out.join('\n\n')
}

function cellValue(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: string; richText?: { text: string }[]; hyperlink?: string }
    if (o.result !== undefined) return cellValue(o.result)
    if (o.richText) return o.richText.map((r) => r.text).join('')
    if (o.text !== undefined) return o.text
    return ''
  }
  return String(v)
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function pptxText(file: string): Promise<string> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(readFileSync(file))
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  const out: string[] = []
  for (const [i, name] of slides.entries()) {
    const xml = await zip.files[name].async('string')
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join('')).filter(Boolean)
    out.push(`--- slide ${i + 1} ---\n${paras.join('\n')}`)
  }
  return out.join('\n\n')
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
