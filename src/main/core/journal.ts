import { EventEmitter } from 'node:events'
import { getDb, now } from './db'
import type { FileOp } from './userFiles'

// Undo journal for changes Orbit makes to its own things (files folder, memories, reminders,
// workflows) and to files in folders you made writable (see userFiles.ts). Each entry stores
// what's needed to put things back. Actions in other services (a sent email) can't be undone;
// those are covered by approvals and the audit log.

export type Undo =
  /** A file in Orbit's own folder. snap: backup of the old version; previous: old text (entries from before 0.9). */
  | { kind: 'file'; path: string; previous: string | null; snap?: string }
  | { kind: 'memory-added'; id: number }
  | { kind: 'memory-removed'; memory: { kind: string; text: string; private: boolean } }
  | { kind: 'memory-edited'; id: number; before: { kind: string; text: string; private: boolean } }
  | { kind: 'schedule-added'; id: string }
  | { kind: 'schedule-removed'; row: Record<string, unknown> }
  | { kind: 'workflow-saved'; name: string; file: string; previous: string | null }
  | { kind: 'workflow-removed'; file: string; yaml: string }
  | { kind: 'user-files'; ops: FileOp[] }

export type Change = { id: number; at: string; source: string; summary: string; undo: Undo; undone_at: string | null }

/** Undoing would overwrite something changed since. Undo again with force to go ahead. */
export class UndoConflict extends Error {
  readonly conflict = true
}

type Handler = (u: Undo, force: boolean) => void
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

/** Reverses one change. Throws if it was already undone or can't be, or UndoConflict. */
export function undoChange(id: number, force = false): string {
  const row = db().prepare('SELECT * FROM journal WHERE id = ?').get(id) as (Omit<Change, 'undo'> & { undo: string }) | undefined
  if (!row) throw new Error(`No change #${id}`)
  if (row.undone_at) throw new Error('That change was already undone')
  const undo = JSON.parse(row.undo) as Undo
  const fn = handlers.get(undo.kind)
  if (!fn) throw new Error(`Can't undo ${undo.kind}`)
  fn(undo, force)
  db().prepare('UPDATE journal SET undone_at = ? WHERE id = ?').run(now(), id)
  journalEvents.emit('change')
  return `Undid: ${row.summary}`
}

/** Drops entries older than `days` and keeps at most `max`. Returns how many went. */
export function pruneJournal(days: number, max = 10_000): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const d = db()
  const old = Number(d.prepare('DELETE FROM journal WHERE at < ?').run(cutoff).changes)
  const extra = Number(d.prepare('DELETE FROM journal WHERE id NOT IN (SELECT id FROM journal ORDER BY id DESC LIMIT ?)').run(max).changes)
  return old + extra
}
