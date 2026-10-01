import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { app } from 'electron'
import { settings } from '../settingsStore'
import { paths } from '../paths'
import { onUndo, recordChange, UndoConflict } from './journal'
import { logInfo } from '../log'
import { ensureRoom } from './disk'

// Changes Orbit makes in your own folders. Only folders you marked writable, never anything
// else. Before a file is changed, moved or deleted, its bytes are copied to
// %APPDATA%\Orbit\snapshots, and the change goes in the undo journal. Deleting never really
// deletes: the file is moved into the snapshot store. Undo checks the file wasn't changed since.

export type FileOp =
  | { op: 'create'; path: string; after: string }
  | { op: 'edit'; path: string; snap: string; after: string; /** Unified diff, for Logs. */ diff?: string }
  | { op: 'delete'; path: string; snap: string }
  | { op: 'move'; from: string; to: string; after: string }

/** Files Orbit won't create or rename to: double-clicking them runs something. */
const BLOCKED_EXT = new Set([
  '.exe', '.dll', '.com', '.scr', '.msi', '.msix', '.appx', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.hta', '.lnk', '.url', '.reg', '.cpl', '.jar', '.pif', '.sys', '.inf'
])
const MAX_FILE = 200 * 1024 * 1024

/** True for files that run something when opened. Orbit never makes or opens these. */
export function isRunnable(path: string): boolean {
  return BLOCKED_EXT.has(extname(path).toLowerCase())
}

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
  if (!roots.length) throw new Error('No folder is writable yet. Ask the user for write access with request_access (kind write_folder).')
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
    if (isRunnable(abs)) throw new Error(`Orbit doesn't create ${extname(abs)} files, since opening one runs it`)
  }
  if (!roots.some((r) => inside(r, real))) {
    throw new Error(`Orbit can't change files in ${dirname(real)} (writable: ${roots.join(', ')}). Ask for it with request_access (kind write_folder).`)
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

/** When a backup was taken, from its name. (Not the file's date: copies keep the original's.) */
export function snapshotTime(name: string): number {
  const t = Number(name.match(/^(\d{12,})-/)?.[1])
  return Number.isFinite(t) && t > 0 ? t : 0
}

/** Throws unless the backup holds exactly the bytes it should. Nothing is changed before this passes. */
function verifySnap(dest: string, hash: string, of: string): void {
  if (!existsSync(dest) || hashFile(dest) !== hash) {
    rmSync(dest, { force: true })
    throw new Error(`Couldn't make a reliable backup of ${basename(of)}, so it wasn't changed`)
  }
}

/** Copies a file into the snapshot store, checks the copy, and returns its name there. */
export function keepCopy(path: string): string {
  ensureRoom(statSync(path).size, `back up ${basename(path)} first`)
  const hash = hashFile(path)
  const name = snapName(path)
  const dest = join(snapDir(), name)
  copyFileSync(path, dest)
  verifySnap(dest, hash, path)
  return name
}

/** Moves a file into the snapshot store (a delete you can undo), checking it arrived intact. */
function keepByMoving(path: string): string {
  const hash = hashFile(path)
  const name = snapName(path)
  const dest = join(snapDir(), name)
  try {
    renameSync(path, dest)
  } catch {
    // Different drive: copy, check, and only then remove the original.
    ensureRoom(statSync(path).size, `back up ${basename(path)} first`)
    copyFileSync(path, dest)
    verifySnap(dest, hash, path)
    unlinkSync(path)
    return name
  }
  verifySnap(dest, hash, path)
  return name
}

/** Writes through a temporary file and a rename, so a crash can't leave a half-written file. */
function writeAtomic(path: string, content: string | Buffer): void {
  const tmp = `${path}.orbit-${randomUUID().slice(0, 8)}.tmp`
  writeFileSync(tmp, content)
  try {
    renameSync(tmp, path)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

export function restoreSnap(snap: string, to: string): void {
  const src = join(paths.snapshots, snap)
  if (!existsSync(src)) throw new Error(`The backup of ${basename(to)} has expired (backups are kept ${settings.current.files.snapshotDays} days)`)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(src, to)
}

/**
 * Drops backups older than the retention window, then the oldest until under the size cap.
 * The cap also shrinks to a tenth of the free space, so backups never crowd out a full disk.
 */
export function pruneSnapshots(freeBytes = Number.POSITIVE_INFINITY): number {
  const dir = paths.snapshots
  if (!existsSync(dir)) return 0
  const { snapshotDays } = settings.current.files
  const snapshotMaxMb = Math.min(settings.current.files.snapshotMaxMb, (snapshotBytes() + freeBytes) / 10 / 1024 / 1024)
  const cutoff = Date.now() - snapshotDays * 86_400_000
  let freed = 0
  // Age comes from when the backup was taken (its name), never the file's date: a copy keeps the
  // original's modified time, so an old file's fresh backup would otherwise look expired at once.
  const files = readdirSync(dir)
    .map((n) => {
      const s = statSync(join(dir, n))
      return { n, s, at: snapshotTime(n) || s.birthtimeMs || s.mtimeMs }
    })
    .sort((a, b) => a.at - b.at)
  let total = files.reduce((t, f) => t + f.s.size, 0)
  const dayAgo = Date.now() - 86_400_000
  for (const f of files) {
    if (f.at >= cutoff && total <= snapshotMaxMb * 1024 * 1024) break
    // Over the size cap, a backup under a day old still stays: it's the one most likely needed.
    if (f.at >= cutoff && f.at > dayAgo) break
    rmSync(join(dir, f.n), { force: true })
    total -= f.s.size
    freed += f.s.size
  }
  return freed
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

export function editText(path: string, content: string, diff?: string): FileOp {
  const snap = keepCopy(path)
  writeAtomic(path, content)
  return { op: 'edit', path, snap, after: hashFile(path), diff }
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

onUndo('file', (u) => {
  if (u.kind !== 'file') return
  if (u.snap) restoreSnap(u.snap, u.path)
  else if (u.previous === null) rmSync(u.path, { force: true })
  else {
    mkdirSync(dirname(u.path), { recursive: true })
    writeFileSync(u.path, u.previous)
  }
})

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

