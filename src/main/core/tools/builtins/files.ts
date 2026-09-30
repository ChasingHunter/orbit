import { z } from 'zod'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { paths } from '../../../paths'
import { defineTool } from '../types'
import { saveOwnFile } from '../../changes'

/** Resolves a name inside Orbit's files folder and refuses anything that escapes it. */
function inFiles(name: string): string {
  const full = resolve(paths.files, name.replace(/^[/\\]+/, ''))
  const rel = relative(paths.files, full)
  if (!rel || rel.startsWith('..') || resolve(paths.files, rel) !== full) throw new Error('Files can only be saved inside Orbit\'s files folder')
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
    const text = readFileSync(inFiles(name), 'utf8')
    return text.length > 30_000 ? text.slice(0, 30_000) + '\n…[truncated]' : text
  }
})
