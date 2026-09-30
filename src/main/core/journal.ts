import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import { getDb, now } from './db'

// Undo journal for changes Orbit makes to its own things (files folder, memories, reminders,
// workflows). Each entry stores what's needed to put things back. Actions in other services
// (a sent email) can't be undone; those are covered by approvals and the audit log.

export type Undo =
  | { kind: 'file'; path: string; previous: string | null }
  | { kind: 'memory-added'; id: number }
  | { kind: 'memory-removed'; memory: { kind: string; text: string; private: boolean } }
  | { kind: 'memory-edited'; id: number; before: { kind: string; text: string; private: boolean } }
  | { kind: 'schedule-added'; id: string }
  | { kind: 'schedule-removed'; row: Record<string, unknown> }
  | { kind: 'workflow-saved'; name: string; file: string; previous: string | null }
  | { kind: 'workflow-removed'; file: string; yaml: string }

export type Change = { id: number; at: string; source: string; summary: string; undo: Undo; undone_at: string | null }

type Handler = (u: Undo) => void
const handlers = new Map<Undo['kind'], Handler>()
export const journalEvents = new EventEmitter()

const SCHEMA = `CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, source TEXT NOT NULL, summary TEXT NOT NULL, undo TEXT NOT NULL, undone_at TEXT
);`

function db(): ReturnType<typeof getDb> {
  const d = getDb()
  d.exec(SCHEMA)
  return d
}

/** Modules that know how to reverse their own changes register here. */
export function onUndo(kind: Undo['kind'], fn: Handler): void {
  handlers.set(kind, fn)
}

/** Records a change. source: who made it ("Orbit" for the model, "you" for the dashboard). */
export function recordChange(summary: string, undo: Undo, source = 'Orbit'): void {
  db().prepare('INSERT INTO journal (at, source, summary, undo) VALUES (?, ?, ?, ?)').run(now(), source, summary.slice(0, 200), JSON.stringify(undo))
  journalEvents.emit('change')
}

export function recentChanges(limit = 50): Change[] {
  return (db().prepare('SELECT * FROM journal ORDER BY id DESC LIMIT ?').all(limit) as (Omit<Change, 'undo'> & { undo: string })[]).map((r) => ({
    ...r,
    undo: JSON.parse(r.undo) as Undo
  }))
}

/** Reverses one change. Throws if it was already undone or can't be. */
export function undoChange(id: number): string {
  const row = db().prepare('SELECT * FROM journal WHERE id = ?').get(id) as (Omit<Change, 'undo'> & { undo: string }) | undefined
  if (!row) throw new Error(`No change #${id}`)
  if (row.undone_at) throw new Error('That change was already undone')
  const undo = JSON.parse(row.undo) as Undo
  const fn = handlers.get(undo.kind)
  if (!fn) throw new Error(`Can't undo ${undo.kind}`)
  fn(undo)
  db().prepare('UPDATE journal SET undone_at = ? WHERE id = ?').run(now(), id)
  journalEvents.emit('change')
  return `Undid: ${row.summary}`
}

// Files are simple enough to handle here.
const MAX_KEEP = 5 * 1024 * 1024

/** Current contents of a file before overwriting it, or null if it doesn't exist (or is too big to keep). */
export function snapshot(path: string): string | null {
  if (!existsSync(path)) return null
  const buf = readFileSync(path)
  return buf.length > MAX_KEEP ? null : buf.toString('utf8')
}

onUndo('file', (u) => {
  if (u.kind !== 'file') return
  if (u.previous === null) rmSync(u.path, { force: true })
  else {
    mkdirSync(dirname(u.path), { recursive: true })
    writeFileSync(u.path, u.previous)
  }
})
