import { ftsQuery, getDb, now } from './db'
import { activeProject } from './projects'

export const MEMORY_KINDS = ['profile', 'person', 'preference', 'project', 'note'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export type Memory = {
  id: number
  kind: MemoryKind
  text: string
  private: boolean
  created_at: string
  updated_at: string
  /** Set when it was saved while a project was active; it then only applies there. */
  project_id?: string | null
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
    .prepare('INSERT INTO memories (kind, text, private, created_at, updated_at, project_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING *')
    .get(kind, text.trim(), isPrivate ? 1 : 0, t, t, activeProject() ?? null) as Row
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
  if (!q) {
    // Nothing searchable in the words: fall back to a plain substring match.
    const t = text.trim().toLowerCase()
    if (t.length < 2) return []
    return listMemories()
      .filter((m) => (includePrivate || !m.private) && (!m.project_id || m.project_id === activeProject()) && m.text.toLowerCase().includes(t))
      .slice(0, limit)
  }
  const rows = getDb()
    .prepare(
      `SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid
       WHERE memories_fts MATCH ? ${includePrivate ? '' : 'AND m.private = 0'}
         AND (m.project_id IS NULL OR m.project_id = ?)
       ORDER BY bm25(memories_fts) LIMIT ?`
    )
    .all(q, activeProject() ?? '', limit) as Row[]
  return rows.map(toMemory)
}

/** About 1,500 tokens of memories always go in the model's instructions; more than that is searched. */
const PROMPT_CHARS = 6000
const KIND_ORDER: Record<string, number> = { profile: 0, preference: 1, person: 2, project: 3, note: 4 }

/**
 * Saved memories for the model's standing instructions, the way ChatGPT and Claude carry them: the
 * model always knows them, whatever words the question uses. Global ones plus the active project's,
 * profile and preferences first, newest first within a kind. Private ones only go to local models.
 * Returns what fits and whether some were left out (those are still found by search and recall).
 */
export function memoriesForPrompt(includePrivate: boolean): { memories: Memory[]; more: number } {
  const all = listMemories()
    .filter((m) => (includePrivate || !m.private) && (!m.project_id || m.project_id === activeProject()))
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || b.updated_at.localeCompare(a.updated_at))
  const out: Memory[] = []
  let used = 0
  for (const m of all) {
    if (used + m.text.length + 12 > PROMPT_CHARS) break
    out.push(m)
    used += m.text.length + 12
  }
  return { memories: out, more: all.length - out.length }
}

/** Every memory of one kind, or all of them, for recall's "list" mode. */
export function memoriesByKind(kind?: string, limit = 50): Memory[] {
  return listMemories()
    .filter((m) => (!kind || m.kind === kind) && (!m.project_id || m.project_id === activeProject()))
    .slice(0, limit)
}

export function listMemories(): Memory[] {
  return (getDb().prepare('SELECT * FROM memories ORDER BY updated_at DESC').all() as Row[]).map(toMemory)
}
