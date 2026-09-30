import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { app } from 'electron'
import { settings } from '../settingsStore'
import { paths } from '../paths'
import { onUndo, recordChange, UndoConflict } from './journal'
import { logInfo } from '../log'

// Changes Orbit makes in your own folders. Only folders you marked writable, never anything
// else. Before a file is changed, moved or deleted, its bytes are copied to
// %APPDATA%\Orbit\snapshots, and the change goes in the undo journal. Deleting never really
// deletes: the file is moved into the snapshot store. Undo checks the file wasn't changed since.

export type FileOp =
  | { op: 'create'; path: string; after: string }
  | { op: 'edit'; path: string; snap: string; after: string }
  | { op: 'delete'; path: string; snap: string }
  | { op: 'move'; from: string; to: string; after: string }

/** Files Orbit won't create or rename to: double-clicking them runs something. */
const BLOCKED_EXT = new Set([
  '.exe', '.dll', '.com', '.scr', '.msi', '.msix', '.appx', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.hta', '.lnk', '.url', '.reg', '.cpl', '.jar', '.pif', '.sys', '.inf'
])
const MAX_FILE = 200 * 1024 * 1024

function expand(p: string): string {
  return p.replace(/^~(?=[\\/]|$)/, app.getPath('home')).replace(/^%(\w+)%/, (_m, v: string) => {
    const known: Record<string, string> = { DOWNLOADS: app.getPath('downloads'), DESKTOP: app.getPath('desktop'), DOCUMENTS: app.getPath('documents') }
    return known[v.toUpperCase()] ?? process.env[v] ?? ''
  })
}

/** Folders Orbit may change files in (a subset of the folders it can read). */
export function writableFolders(): string[] {
  const readable = new Set(settings.current.files.allowedFolders)
  return settings.current.files.writableFolders.filter((f) => readable.has(f)).map(expand).filter(Boolean)
}

function inside(root: string, p: string): boolean {
  const rel = relative(root.toLowerCase(), p.toLowerCase())
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-z]:/i.test(rel))
}

function realRoots(): string[] {
  return writableFolders().flatMap((r) => {
    try {
      return [realpathSync(r)]
    } catch {
      return []
    }
  })
}

/**
 * Resolves a path Orbit wants to change and refuses anything outside the writable folders,
 * including through links. For a file that doesn't exist yet, the nearest existing parent is
 * resolved instead, so a junction inside a writable folder can't lead out of it.
 */
export function writablePath(path: string, want: 'existing-file' | 'new-file'): string {
  const roots = realRoots()
  if (!roots.length) throw new Error("No folder is writable. In Settings > Folders, turn on \"Orbit can change files here\" for one.")
  const abs = /^[a-z]:|^[\\/]/i.test(path) ? resolve(path) : resolve(roots[0], path)
  let real: string
  if (want === 'existing-file') {
    if (!existsSync(abs)) throw new Error(`Not found: ${abs}`)
    if (lstatSync(abs).isSymbolicLink()) throw new Error(`${abs} is a link; Orbit only changes real files`)
    real = realpathSync(abs)
    if (!statSync(real).isFile()) throw new Error(`${abs} is a folder; Orbit only changes files`)
    if (statSync(real).size > MAX_FILE) throw new Error(`${basename(abs)} is over 200 MB, too big to back up first, so Orbit won't change it`)
  } else {
    if (existsSync(abs)) throw new Error(`${abs} already exists`)
    let parent = dirname(abs)
    while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent)
    real = join(realpathSync(parent), relative(parent, abs))
    if (BLOCKED_EXT.has(extname(abs).toLowerCase())) throw new Error(`Orbit doesn't create ${extname(abs)} files, since opening one runs it`)
  }
  if (!roots.some((r) => inside(r, real))) {
    throw new Error(`Orbit can't change files in ${dirname(real)}. Writable folders: ${roots.join(', ')}`)
  }
  return real
}

export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// Snapshot store

function snapDir(): string {
  mkdirSync(paths.snapshots, { recursive: true })
  return paths.snapshots
}

function snapName(from: string): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}${extname(from).toLowerCase()}`
}

/** Copies a file into the snapshot store and returns its name there. */
export function keepCopy(path: string): string {
  const name = snapName(path)
  copyFileSync(path, join(snapDir(), name))
  return name
}

/** Moves a file into the snapshot store (a delete you can undo). */
function keepByMoving(path: string): string {
  const name = snapName(path)
  const dest = join(snapDir(), name)
  try {
    renameSync(path, dest)
  } catch {
    // Different drive: copy, then remove.
    copyFileSync(path, dest)
    unlinkSync(path)
  }
  return name
}

function restoreSnap(snap: string, to: string): void {
  const src = join(paths.snapshots, snap)
  if (!existsSync(src)) throw new Error(`The backup of ${basename(to)} has expired (backups are kept ${settings.current.files.snapshotDays} days)`)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(src, to)
}

/** Drops backups older than the retention window, then the oldest until under the size cap. */
export function pruneSnapshots(): void {
  const dir = paths.snapshots
  if (!existsSync(dir)) return
  const { snapshotDays, snapshotMaxMb } = settings.current.files
  const cutoff = Date.now() - snapshotDays * 86_400_000
  const files = readdirSync(dir)
    .map((n) => ({ n, s: statSync(join(dir, n)) }))
    .sort((a, b) => a.s.mtimeMs - b.s.mtimeMs)
  let total = files.reduce((t, f) => t + f.s.size, 0)
  for (const f of files) {
    if (f.s.mtimeMs >= cutoff && total <= snapshotMaxMb * 1024 * 1024) break
    rmSync(join(dir, f.n), { force: true })
    total -= f.s.size
  }
}

export function snapshotBytes(): number {
  if (!existsSync(paths.snapshots)) return 0
  return readdirSync(paths.snapshots).reduce((t, n) => t + statSync(join(paths.snapshots, n)).size, 0)
}

// Operations. Each returns the op to journal; the caller records one entry per tool call.

export function createText(path: string, content: string): FileOp {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, { flag: 'wx' })
  return { op: 'create', path, after: hashFile(path) }
}

export function copyIn(from: string, to: string): FileOp {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to, 1 /* COPYFILE_EXCL */)
  return { op: 'create', path: to, after: hashFile(to) }
}

export function editText(path: string, content: string): FileOp {
  const snap = keepCopy(path)
  writeFileSync(path, content)
  return { op: 'edit', path, snap, after: hashFile(path) }
}

export function remove(path: string): FileOp {
  return { op: 'delete', path, snap: keepByMoving(path) }
}

export function move(from: string, to: string): FileOp {
  mkdirSync(dirname(to), { recursive: true })
  const after = hashFile(from)
  try {
    renameSync(from, to)
  } catch {
    copyFileSync(from, to, 1)
    unlinkSync(from)
  }
  return { op: 'move', from, to, after }
}

export function recordFileOps(summary: string, ops: FileOp[]): void {
  if (ops.length) recordChange(summary, { kind: 'user-files', ops })
  pruneSnapshots()
}

// Undo

function sameAs(path: string, hash: string): boolean {
  return existsSync(path) && hashFile(path) === hash
}

/** What would be lost by undoing, or [] if it's safe. */
function conflicts(ops: FileOp[]): string[] {
  const out: string[] = []
  for (const o of ops) {
    if (o.op === 'create' && existsSync(o.path) && !sameAs(o.path, o.after)) out.push(`${basename(o.path)} was changed after Orbit created it`)
    if (o.op === 'edit' && existsSync(o.path) && !sameAs(o.path, o.after)) out.push(`${basename(o.path)} was changed after Orbit edited it`)
    if (o.op === 'delete' && existsSync(o.path)) out.push(`there's a new ${basename(o.path)} where the deleted one was`)
    if (o.op === 'move') {
      if (existsSync(o.from)) out.push(`there's a new ${basename(o.from)} where the moved one came from`)
      else if (existsSync(o.to) && !sameAs(o.to, o.after)) out.push(`${basename(o.to)} was changed after Orbit moved it`)
    }
  }
  return out
}

onUndo('user-files', (u, force) => {
  if (u.kind !== 'user-files') return
  const found = conflicts(u.ops)
  if (found.length && !force) throw new UndoConflict(`${found.slice(0, 3).join('; ')}${found.length > 3 ? ` (and ${found.length - 3} more)` : ''}. Undo anyway? Your newer versions are kept as backups.`)
  // Anything undo would overwrite or remove is backed up first, so even a forced undo loses nothing.
  const backUp = (p: string): void => {
    if (existsSync(p)) logInfo(`undo: kept ${p} as snapshot ${keepCopy(p)}`)
  }
  for (const o of [...u.ops].reverse()) {
    if (o.op === 'create') {
      if (existsSync(o.path)) {
        if (!sameAs(o.path, o.after)) backUp(o.path)
        rmSync(o.path, { force: true })
      }
    } else if (o.op === 'edit') {
      if (existsSync(o.path) && !sameAs(o.path, o.after)) backUp(o.path)
      restoreSnap(o.snap, o.path)
    } else if (o.op === 'delete') {
      backUp(o.path)
      restoreSnap(o.snap, o.path)
    } else if (o.op === 'move') {
      if (!existsSync(o.to)) throw new Error(`${basename(o.to)} isn't there anymore, so it can't be moved back`)
      backUp(o.from)
      mkdirSync(dirname(o.from), { recursive: true })
      if (existsSync(o.from)) rmSync(o.from, { force: true })
      renameSync(o.to, o.from)
    }
  }
})

