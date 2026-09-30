import { ftsQuery, getDb, now } from './db'

export const MEMORY_KINDS = ['profile', 'person', 'preference', 'project', 'note'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export type Memory = {
  id: number
  kind: MemoryKind
  text: string
  private: boolean
  created_at: string
  updated_at: string
}

type Row = Omit<Memory, 'private'> & { private: number }
const toMemory = (r: Row): Memory => ({ ...r, private: r.private === 1 })

// Things that must never be stored, whatever the model or user asks.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(?:\d[ -]?){13,19}\b/, 'a card or account number'],
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/, 'an API key'],
  [/\b(ghp|gho|github_pat|xox[abpr])[-_][A-Za-z0-9_-]{10,}/, 'an access token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'a cloud access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\b(password|passcode|passwd|pin|otp|cvv)\b\s*(is|:|=)/i, 'a password or PIN']
]

export function secretReason(text: string): string | undefined {
  return SECRET_PATTERNS.find(([re]) => re.test(text))?.[1]
}

export function addMemory(text: string, kind: MemoryKind = 'note', isPrivate = false): Memory {
  const reason = secretReason(text)
  if (reason) throw new Error(`Not saved: this looks like ${reason}. Orbit never stores secrets in memory.`)
  const t = now()
  const r = getDb()
    .prepare('INSERT INTO memories (kind, text, private, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING *')
    .get(kind, text.trim(), isPrivate ? 1 : 0, t, t) as Row
  return toMemory(r)
}

export function updateMemory(id: number, fields: { text?: string; kind?: MemoryKind; private?: boolean }): void {
  if (fields.text !== undefined) {
    const reason = secretReason(fields.text)
    if (reason) throw new Error(`Not saved: this looks like ${reason}.`)
  }
  const cur = getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row | undefined
  if (!cur) throw new Error(`No memory #${id}`)
  getDb()
    .prepare('UPDATE memories SET text = ?, kind = ?, private = ?, updated_at = ? WHERE id = ?')
    .run(
      fields.text ?? cur.text,
      fields.kind ?? cur.kind,
      fields.private === undefined ? cur.private : fields.private ? 1 : 0,
      now(),
      id
    )
}

export function deleteMemory(id: number): boolean {
  return Number(getDb().prepare('DELETE FROM memories WHERE id = ?').run(id).changes) > 0
}

export function getMemory(id: number): Memory | undefined {
  const r = getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row | undefined
  return r && toMemory(r)
}

/** Best matches for free text, most relevant first. */
export function searchMemories(text: string, limit = 8, includePrivate = true): Memory[] {
  const q = ftsQuery(text)
  if (!q) return []
  const rows = getDb()
    .prepare(
      `SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid
       WHERE memories_fts MATCH ? ${includePrivate ? '' : 'AND m.private = 0'}
       ORDER BY bm25(memories_fts) LIMIT ?`
    )
    .all(q, limit) as Row[]
  return rows.map(toMemory)
}

export function listMemories(): Memory[] {
  return (getDb().prepare('SELECT * FROM memories ORDER BY updated_at DESC').all() as Row[]).map(toMemory)
}
