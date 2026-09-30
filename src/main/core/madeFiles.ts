import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { shell } from 'electron'
import { paths } from '../paths'
import { getDb, now } from './db'
import { ensureRoom } from './disk'
import { logInfo } from '../log'

// Files Orbit makes while you chat (documents, spreadsheets, charts) start out temporary, like a
// file Claude generates that you haven't downloaded. They live in files\Temporary and go to the
// Recycle Bin when nobody has opened them for 14 days, 3 days after you saved a copy elsewhere,
// or when the folder passes 2 GB (least recently used first, never anything under a day old).
// Keep moves one to the main files folder, where nothing is ever removed. Files made by
// workflows skip all this: workflows write files on purpose, often to append to them later.

export const TEMP_DAYS = 14
const SAVED_DAYS = 3
const MAX_TEMP = 2 * 1024 ** 3

export const tempDir = (): string => join(paths.files, 'Temporary')

const SCHEMA = `CREATE TABLE IF NOT EXISTS made_files (
  path TEXT PRIMARY KEY, created_at TEXT NOT NULL, opened_at TEXT, saved_to TEXT
);`

function db(): ReturnType<typeof getDb> {
  const d = getDb()
  d.exec(SCHEMA)
  return d
}

type Row = { path: string; created_at: string; opened_at: string | null; saved_to: string | null }
const row = (path: string): Row | undefined => db().prepare('SELECT * FROM made_files WHERE lower(path) = lower(?)').get(path) as Row | undefined

export function isTemporary(path: string): boolean {
  const rel = relative(tempDir().toLowerCase(), path.toLowerCase())
  return !!rel && !rel.startsWith('..')
}

/** Records a file just made in Temporary. */
export function trackMade(path: string): void {
  db().prepare('INSERT OR REPLACE INTO made_files (path, created_at) VALUES (?, ?)').run(path, now())
}

export function markOpened(path: string): void {
  db().prepare('UPDATE made_files SET opened_at = ? WHERE lower(path) = lower(?)').run(now(), path)
}

/** Copies a temporary file somewhere you chose; Orbit's own copy then only stays a few days. */
export function saveCopy(path: string, to: string): void {
  ensureRoom(statSync(path).size, `save ${basename(path)}`)
  copyFileSync(path, to)
  markSaved(path, to)
}

export function markSaved(path: string, to: string): void {
  if (isTemporary(path)) db().prepare('UPDATE made_files SET saved_to = ? WHERE lower(path) = lower(?)').run(to, path)
}

function unique(dir: string, name: string): string {
  let target = join(dir, name)
  for (let n = 2; existsSync(target); n++) target = join(dir, `${basename(name, extname(name))} (${n})${extname(name)}`)
  return target
}

/** Moves a temporary file into the main files folder for good. Returns its new path. */
export function keep(path: string): string {
  if (!isTemporary(path)) return path
  const target = unique(paths.files, basename(path))
  renameSync(path, target)
  db().prepare('DELETE FROM made_files WHERE lower(path) = lower(?)').run(path)
  return target
}

export type MadeState = { state: 'temporary' | 'kept' | 'gone'; daysLeft?: number; savedTo?: string }

export function stateOf(path: string): MadeState {
  if (!existsSync(path)) return { state: 'gone' }
  if (!isTemporary(path)) return { state: 'kept' }
  const r = row(path)
  const since = Date.parse(r?.opened_at ?? r?.created_at ?? new Date(statSync(path).mtimeMs).toISOString())
  const days = r?.saved_to ? SAVED_DAYS : TEMP_DAYS
  return { state: 'temporary', daysLeft: Math.max(0, Math.ceil(days - (Date.now() - since) / 86_400_000)), savedTo: r?.saved_to ?? undefined }
}

/** The daily sweep. Expired files go to the Recycle Bin, so a mistake can still be undone by hand. */
export async function sweepTemporary(): Promise<number> {
  const dir = tempDir()
  if (!existsSync(dir)) return 0
  const files = readdirSync(dir)
    .map((n) => join(dir, n))
    .filter((p) => statSync(p).isFile())
    .map((p) => {
      const r = row(p)
      const st = statSync(p)
      const last = Date.parse(r?.opened_at ?? r?.created_at ?? st.mtime.toISOString())
      const made = Date.parse(r?.created_at ?? st.mtime.toISOString())
      return { p, size: st.size, last, made, saved: !!r?.saved_to }
    })
    .sort((a, b) => a.last - b.last)
  const day = 86_400_000
  let total = files.reduce((t, f) => t + f.size, 0)
  let freed = 0
  for (const f of files) {
    const expired = Date.now() - f.last > (f.saved ? SAVED_DAYS : TEMP_DAYS) * day
    const overCap = total > MAX_TEMP && Date.now() - f.made > day
    if (!expired && !overCap) continue
    try {
      // Tests run on the user's PC; they shouldn't fill its Recycle Bin.
      if (process.env.ORBIT_E2E) rmSync(f.p)
      else await shell.trashItem(f.p)
    } catch (err) {
      logInfo(`made files: couldn't move ${f.p} to the Recycle Bin`, err)
      continue
    }
    db().prepare('DELETE FROM made_files WHERE lower(path) = lower(?)').run(f.p)
    total -= f.size
    freed += f.size
  }
  return freed
}

export function ensureTempDir(): string {
  mkdirSync(tempDir(), { recursive: true })
  return tempDir()
}

export function inTemp(name: string): string {
  return join(ensureTempDir(), basename(name))
}

