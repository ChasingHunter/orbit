import { statSync } from 'node:fs'
import { basename } from 'node:path'

// Read before write, as in Claude Code: the model may only edit a file it has read in this chat,
// and only if the file hasn't changed since. That rules out blind overwrites (writing a file it
// never looked at) and edits based on an out-of-date view. Cleared when a new chat starts.

const seen = new Map<string, { mtimeMs: number; size: number }>()
const key = (p: string): string => p.toLowerCase()

/** Records the file's state as the model now knows it (after reading it, or after Orbit wrote it). */
export function noteRead(path: string): void {
  const s = statSync(path)
  seen.set(key(path), { mtimeMs: s.mtimeMs, size: s.size })
}

export function assertReadAndUnchanged(path: string): void {
  const s = statSync(path)
  const r = seen.get(key(path))
  if (!r) throw new Error(`Read ${basename(path)} with read_file first, so the edit is based on what's actually in it.`)
  if (r.mtimeMs !== s.mtimeMs || r.size !== s.size) {
    throw new Error(`${basename(path)} changed since you read it. Read it again with read_file before editing.`)
  }
}

export function clearReads(): void {
  seen.clear()
}
