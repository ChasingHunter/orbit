import { z } from 'zod'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { paths } from '../../../paths'
import { defineTool } from '../types'
import { saveOwnBinary, saveOwnFile } from '../../changes'
import { makeDocx, makePdf, makePptx, makeXlsx } from '../../office'
import { extractText, OFFICE_TYPES } from '../../extract'
import { inTemp, TEMP_DAYS, trackMade } from '../../madeFiles'
import { isRunnable } from '../../userFiles'

/** Resolves a name inside Orbit's files folder and refuses anything that escapes it. */
export function inFiles(name: string): string {
  const full = resolve(paths.files, name.replace(/^[/\\]+/, ''))
  const rel = relative(paths.files, full)
  if (!rel || rel.startsWith('..') || resolve(paths.files, rel) !== full) throw new Error('Files can only be saved inside Orbit\'s files folder')
  if (isRunnable(full)) throw new Error(`Orbit doesn't save ${extname(full)} files, since opening one runs it. Show the user the text instead.`)
  return full
}

export const saveFile = defineTool({
  name: 'save_file',
  description:
    "Save text (markdown, CSV, JSON, notes, reports) as a file in Orbit's files folder (%APPDATA%\\Orbit\\files). Use a short name like 2026-10-01-tech-digest.md; subfolders are allowed. Overwrites a file with the same name.",
  input: {
    name: z.string().describe('File name, e.g. digests/2026-10-01.md'),
    content: z.string()
  },
  risk: 'local', // confined to Orbit's own folder
  run: async ({ name, content }) => {
    const file = inFiles(name)
    saveOwnFile(file, content)
    return `Saved ${file}`
  }
})

export const readSavedFile = defineTool({
  name: 'read_saved_file',
  description: "Read a file from Orbit's files folder, or list the folder when name is empty.",
  input: { name: z.string().optional() },
  risk: 'read',
  run: async ({ name }) => {
    if (!name) {
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((f) => {
          const p = join(dir, f)
          return statSync(p).isDirectory() ? walk(p) : [relative(paths.files, p)]
        })
      return walk(paths.files).join('\n') || 'The files folder is empty.'
    }
    const file = inFiles(name)
    const ext = extname(file).toLowerCase()
    const text = OFFICE_TYPES.has(ext) || ext === '.pdf' ? await extractText(file) : readFileSync(file, 'utf8')
    return text.length > 30_000 ? text.slice(0, 30_000) + '\n…[truncated]' : text
  }
})

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const makeFile = defineTool({
  name: 'make_file',
  description:
    "Make a docx, pdf, xlsx or pptx in Orbit's files folder. docx/pdf: markdown. xlsx: sheets of rows, row 1 is the header, strings like =SUM(B2:B9) are formulas. pptx: slides. copy_file can then put it in the user's folder.",
  input: {
    name: z.string().describe('e.g. q3-report'),
    format: z.enum(['docx', 'pdf', 'xlsx', 'pptx']),
    title: z.string().optional(),
    markdown: z.string().optional(),
    sheets: z.array(z.object({ name: z.string(), rows: z.array(z.array(cell)) })).optional(),
    slides: z.array(z.object({ title: z.string(), bullets: z.array(z.string()).optional(), notes: z.string().optional() })).optional()
  },
  risk: 'local', // a new file in Orbit's own folder; never overwrites
  run: async ({ name, format, title, markdown, sheets, slides }, { source }) => {
    let data: Buffer
    if (format === 'docx' || format === 'pdf') {
      if (!markdown?.trim()) throw new Error(`markdown is required for ${format}`)
      data = format === 'docx' ? await makeDocx(markdown, title) : await makePdf(markdown, title)
    } else if (format === 'xlsx') {
      if (!sheets?.length) throw new Error('sheets is required for xlsx')
      data = await makeXlsx(sheets)
    } else {
      if (!slides?.length) throw new Error('slides is required for pptx')
      data = await makePptx(slides, title)
    }
    const base = name.replace(/\.(docx|pdf|xlsx|pptx)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim() || 'document'
    return saveMade(`${base}.${format}`, data, source)
  }
})

/**
 * Files made while chatting are temporary until the user keeps or saves them (see madeFiles.ts);
 * workflow files go straight to the files folder.
 */
export function saveMade(name: string, data: Buffer, source: 'chat' | 'workflow'): string {
  if (isRunnable(name)) throw new Error(`Orbit doesn't save ${extname(name)} files, since opening one runs it. Show the user the text instead.`)
  if (source === 'workflow') return `Saved ${saveOwnBinary(inFiles(name), data)}`
  const saved = saveOwnBinary(inTemp(name), data)
  trackMade(saved)
  return `Saved ${saved}\n(Temporary: the user can keep it or save a copy from the chat; otherwise it's cleaned up after ${TEMP_DAYS} days unused.)`
}

export const makePage = defineTool({
  name: 'make_page',
  description:
    "Make an interactive HTML page (a chart, calculator, small tool, dashboard or visual explainer) and open it for the user. One self-contained file: inline CSS and JS, no internet (it's blocked). For charts load <script src=\"orbit-page://lib/chart.js\"></script> (Chart.js 4).",
  input: {
    name: z.string().describe('File name, e.g. sales-chart'),
    html: z.string().describe('The whole HTML document')
  },
  risk: 'local',
  describe: ({ name }) => `Make page ${name}`,
  run: async ({ name, html }, { source }) => {
    const base = name.replace(/\.html?$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim() || 'page'
    const out = saveMade(`${base}.html`, Buffer.from(html, 'utf8'), source)
    const path = out.match(/^Saved (.+)$/m)?.[1]
    if (path && source === 'chat') openPageSoon(path)
    return `${out}\nIt's open in its own window; the user can reopen it from the chat.`
  }
})

let opener: ((path: string) => void) | undefined
/** The window module registers itself here (tools can't import Electron windows directly). */
export function setPageOpener(fn: (path: string) => void): void {
  opener = fn
}
function openPageSoon(path: string): void {
  opener?.(path)
}
