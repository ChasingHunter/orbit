import { z } from 'zod'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { defineTool } from '../types'
import { structuredPatch } from 'diff'
import { assertReadAndUnchanged, noteRead } from '../../readTracker'
import { checked } from './folders'
import { TEXT_TYPES } from '../../extract'
import { markSaved } from '../../madeFiles'
import { copyIn, createText, editText, move, recordFileOps, remove, writableFolders, writablePath, type FileOp } from '../../userFiles'

// Changing files in the user's own folders. Only offered to the model once a folder is marked
// writable. Each call is one journal entry with one Undo, however many files it touches.

const available = (): boolean => writableFolders().length > 0
const MAX_TEXT = 5 * 1024 * 1024
const MAX_BATCH = 500

/** "Downloads\invoices\a.pdf" instead of the full path, for cards and summaries. */
function show(p: string): string {
  const root = writableFolders().find((r) => !relative(r.toLowerCase(), p.toLowerCase()).startsWith('..'))
  return root ? join(basename(root), relative(root, p)) : p
}

function clip(s: string, n = 400): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** With ifExists "number", the first free "name (n).ext" next to an existing file. */
function freeName(path: string, ifExists?: 'fail' | 'number'): string {
  if (ifExists !== 'number' || !existsSync(path)) return path
  const ext = extname(path)
  const stem = path.slice(0, path.length - ext.length)
  for (let n = 2; ; n++) if (!existsSync(`${stem} (${n})${ext}`)) return `${stem} (${n})${ext}`
}

export const createFile = defineTool({
  name: 'create_file',
  description: "Create a new text file in one of the user's writable folders. Fails if it already exists (use edit_file to change a file).",
  input: {
    path: z.string().describe('Full path, or relative to the first writable folder'),
    content: z.string(),
    ifExists: z.enum(['fail', 'number']).optional().describe('number: save as "name (2).ext" instead of failing; good for workflows that may run twice')
  },
  risk: 'local',
  available,
  describe: ({ path }) => `Create ${basename(path)}`,
  preview: ({ path, content, ifExists }) => `${show(writablePath(freeName(path, ifExists), 'new-file'))}\n\n${clip(content, 800)}`,
  run: async ({ path, content, ifExists }) => {
    if (Buffer.byteLength(content) > MAX_TEXT) throw new Error('Content is over 5 MB')
    const target = writablePath(freeName(path, ifExists), 'new-file')
    recordFileOps(`Created ${show(target)}`, [createText(target, content)])
    return `Created ${target}`
  }
})

/**
 * The file after the edit. Works on a \n-only copy so finds match whatever line endings the file
 * uses, then puts the file's own endings back. A whole-content rewrite also keeps the file's final
 * newline (or lack of one), so repeated edits can't pile up blank lines at the end.
 */
function editedContent(file: string, edits: { find: string; replace: string }[] | undefined, content: string | undefined): { before: string; after: string } {
  if (!TEXT_TYPES.has(extname(file).toLowerCase())) throw new Error(`Only text files can be edited (not ${extname(file) || 'this type'})`)
  if (edits?.length && content !== undefined) throw new Error('Give either edits or content, not both')
  const before = readFileSync(file, 'utf8')
  const crlf = before.includes('\r\n')
  const lf = (t: string): string => t.replace(/\r\n/g, '\n')
  let text = lf(before)
  if (content !== undefined) {
    text = lf(content).replace(/\n+$/, '') + (/\n$/.test(text) ? '\n' : '')
  } else {
    if (!edits?.length) throw new Error('Give either edits or content')
    for (const e of edits) {
      const find = lf(e.find)
      const count = text.split(find).length - 1
      if (count !== 1) throw new Error(`"${clip(e.find, 60)}" appears ${count} times in the file; it must appear exactly once. Include more surrounding text.`)
      text = text.replace(find, () => lf(e.replace))
    }
  }
  return { before, after: crlf ? text.replace(/\n/g, '\r\n') : text }
}

/** A git-style diff of the change (context of 3 lines), for the approval card and Logs. */
function diffOf(file: string, before: string, after: string): string {
  const patch = structuredPatch(basename(file), basename(file), before.replace(/\r\n/g, '\n'), after.replace(/\r\n/g, '\n'), '', '', { context: 3 })
  const body = patch.hunks.map((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n')).join('\n')
  return body || '(no change)'
}

export const editFile = defineTool({
  name: 'edit_file',
  description:
    "Change a text file in the user's writable folders. Read it with read_file first. Prefer exact find/replace edits (each find must appear once, include enough surrounding text); give the whole new content only to rewrite most of the file. The old version is backed up and can be undone.",
  input: {
    path: z.string(),
    edits: z.array(z.object({ find: z.string().min(1), replace: z.string() })).optional(),
    content: z.string().optional().describe('Whole new content, instead of edits')
  },
  risk: 'destructive',
  available,
  previewKind: 'diff',
  describe: ({ path }) => `Edit ${basename(path)}`,
  preview: ({ path, edits, content }) => {
    const file = writablePath(path, 'existing-file')
    if (!TEXT_TYPES.has(extname(file).toLowerCase())) throw new Error(`Only text files can be edited (not ${extname(file) || 'this type'})`)
    assertReadAndUnchanged(file)
    const { before, after } = editedContent(file, edits, content)
    const was = before.split('\n').length
    const kept = after.split('\n').length
    const warn = kept < was / 2 && was > 4 ? `Careful: this leaves ${kept} of ${was} lines.\n` : ''
    return `${warn}${show(file)}\n${diffOf(file, before, after)}`
  },
  run: async ({ path, edits, content }) => {
    const file = writablePath(path, 'existing-file')
    if (!TEXT_TYPES.has(extname(file).toLowerCase())) throw new Error(`Only text files can be edited (not ${extname(file) || 'this type'})`)
    assertReadAndUnchanged(file)
    const { before, after } = editedContent(file, edits, content)
    if (Buffer.byteLength(after) > MAX_TEXT) throw new Error('Result is over 5 MB')
    if (after === before) return `No change: ${basename(file)} already reads that way.`
    const diff = diffOf(file, before, after)
    recordFileOps(`Edited ${show(file)}`, [editText(file, after, diff.slice(0, 20_000))])
    // Orbit knows the new content, so a follow-up edit doesn't need another read.
    noteRead(file)
    return `Edited ${file}:\n${diff.slice(0, 4000)}`
  }
})

/** Target of a move: a full path, or an existing folder to move into. */
function moveTarget(from: string, to: string, base = dirname(from)): string {
  const abs = /^[a-z]:|^[\\/]/i.test(to) ? to : join(base, to)
  const into = existsSync(abs) && statSync(abs).isDirectory() ? join(abs, basename(from)) : abs
  return writablePath(into, 'new-file')
}

function planMoves(moves: { from: string; to: string }[]): { from: string; to: string }[] {
  if (moves.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} files per call`)
  const plan = moves.map((m) => {
    const from = writablePath(m.from, 'existing-file')
    return { from, to: moveTarget(from, m.to) }
  })
  const targets = new Set<string>()
  for (const p of plan) {
    const key = p.to.toLowerCase()
    if (targets.has(key)) throw new Error(`Two files would end up as ${basename(p.to)}`)
    targets.add(key)
  }
  return plan
}

function moveLine(p: { from: string; to: string }): string {
  return dirname(p.from) === dirname(p.to) ? `${basename(p.from)}, renamed to ${basename(p.to)}` : `${show(p.from)}, moved to ${show(dirname(p.to))}`
}

export const moveFiles = defineTool({
  name: 'move_files',
  description:
    "Rename or move files within the user's writable folders. `to` is a new name (same folder), a full path, or an existing folder. Never overwrites. Batch many files in one call; the user approves and can undo them together.",
  input: { moves: z.array(z.object({ from: z.string(), to: z.string() })).min(1) },
  risk: 'destructive',
  available,
  describe: ({ moves }) => (moves.length === 1 ? `Move ${basename(moves[0].from)}` : `Move or rename ${plural(moves.length, 'file')}`),
  preview: ({ moves }) => planMoves(moves).map(moveLine).join('\n'),
  run: async ({ moves }) => {
    const plan = planMoves(moves)
    const ops: FileOp[] = []
    try {
      for (const p of plan) ops.push(move(p.from, p.to))
    } finally {
      // Record what did happen even if one failed halfway, so it can still be undone.
      const renames = plan.every((p) => dirname(p.from) === dirname(p.to))
      recordFileOps(ops.length === 1 ? moveLine(plan[0]) : `${renames ? 'Renamed' : 'Moved'} ${plural(ops.length, 'file')} in ${show(dirname(plan[0].from))}`, ops)
    }
    return `Done: ${plural(ops.length, 'file')}.\n${plan.map(moveLine).join('\n')}`
  }
})

export const deleteFiles = defineTool({
  name: 'delete_files',
  description: "Delete files (not folders) in the user's writable folders. They're kept as backups for a while, so this can be undone.",
  input: { paths: z.array(z.string()).min(1) },
  risk: 'destructive',
  available,
  describe: ({ paths }) => (paths.length === 1 ? `Delete ${basename(paths[0])}` : `Delete ${plural(paths.length, 'file')}`),
  preview: ({ paths }) => {
    if (paths.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} files per call`)
    return paths.map((p) => show(writablePath(p, 'existing-file'))).join('\n')
  },
  run: async ({ paths }) => {
    if (paths.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} files per call`)
    const files = paths.map((p) => writablePath(p, 'existing-file'))
    const ops: FileOp[] = []
    try {
      for (const f of files) ops.push(remove(f))
    } finally {
      recordFileOps(ops.length === 1 ? `Deleted ${show(files[0])}` : `Deleted ${plural(ops.length, 'file')}`, ops)
    }
    return `Deleted ${plural(ops.length, 'file')} (kept as backups, can be undone).`
  }
})

export const copyFile = defineTool({
  name: 'copy_file',
  description:
    "Copy a file into one of the user's writable folders: from Orbit's files folder (e.g. a document Orbit made), an attachment, or another allowed folder. Never overwrites.",
  input: { from: z.string(), to: z.string().describe('Full path, or an existing writable folder') },
  risk: 'local',
  available,
  describe: ({ from }) => `Copy ${basename(from)}`,
  preview: ({ from, to }) => {
    const src = checked(from)
    return `${basename(src)}, copied to ${show(dirname(moveTarget(src, to, writableFolders()[0])))}`
  },
  run: async ({ from, to }) => {
    const src = checked(from)
    const dest = moveTarget(src, to, writableFolders()[0])
    recordFileOps(`Copied ${basename(src)} to ${show(dirname(dest))}`, [copyIn(src, dest)])
    markSaved(src, dest)
    return `Copied to ${dest}`
  }
})
