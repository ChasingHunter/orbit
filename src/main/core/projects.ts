import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ftsQuery, getDb, now } from './db'
import { canExtract, extractText } from './extract'
import { logInfo } from '../log'

// Projects: a name, your instructions, and files or folders you pin. Pinned files are split into
// chunks and indexed with full-text search once (and again when they change), so each message
// carries only the few chunks that match it instead of whole files. Memories saved and chats held
// while a project is active belong to it.

export type Project = { id: string; name: string; instructions: string; paths: string[]; files: number; chunks: number }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_paths (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, path TEXT NOT NULL, PRIMARY KEY (project_id, path));
CREATE TABLE IF NOT EXISTS project_files (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, path TEXT NOT NULL, mtime REAL NOT NULL, PRIMARY KEY (project_id, path));
CREATE VIRTUAL TABLE IF NOT EXISTS project_chunks USING fts5(text, path UNINDEXED, project_id UNINDEXED, tokenize='porter unicode61');
`
const CHUNK = 1500
const OVERLAP = 200
const MAX_FILES = 500
const MAX_BYTES = 10 * 1024 * 1024
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.venv', '__pycache__'])

let ready = false
function db(): ReturnType<typeof getDb> {
  const d = getDb()
  if (!ready) {
    // An index from before stemming is rebuilt: dropping it and the file list makes every pinned
    // file get indexed again on the next use.
    const old = d.prepare("SELECT sql FROM sqlite_master WHERE name = 'project_chunks'").get() as { sql: string } | undefined
    if (old && !/porter/.test(old.sql)) d.exec('DROP TABLE project_chunks; DELETE FROM project_files;')
    d.exec(SCHEMA)
    ready = true
  }
  return d
}

let active: string | undefined
export const activeProject = (): string | undefined => active
export function setActiveProject(id: string | undefined): void {
  active = id && getProject(id) ? id : undefined
  if (active) void indexProject(active).catch((err) => logInfo('projects: index failed', err))
}

export function listProjects(): Project[] {
  const rows = db().prepare('SELECT * FROM projects ORDER BY name').all() as { id: string; name: string; instructions: string }[]
  return rows.map((r) => getProject(r.id)!)
}

export function getProject(id: string): Project | undefined {
  const d = db()
  const r = d.prepare('SELECT * FROM projects WHERE id = ?').get(id) as { id: string; name: string; instructions: string } | undefined
  if (!r) return undefined
  const paths = (d.prepare('SELECT path FROM project_paths WHERE project_id = ? ORDER BY path').all(id) as { path: string }[]).map((p) => p.path)
  const files = (d.prepare('SELECT COUNT(*) n FROM project_files WHERE project_id = ?').get(id) as { n: number }).n
  const chunks = (d.prepare('SELECT COUNT(*) n FROM project_chunks WHERE project_id = ?').get(id) as { n: number }).n
  return { id: r.id, name: r.name, instructions: r.instructions, paths, files, chunks }
}

export function saveProject(p: { id?: string; name: string; instructions: string }): string {
  const name = p.name.trim()
  if (!name) throw new Error('Give the project a name')
  const id = p.id ?? randomUUID()
  const t = now()
  if (p.id) db().prepare('UPDATE projects SET name = ?, instructions = ?, updated_at = ? WHERE id = ?').run(name, p.instructions, t, id)
  else db().prepare('INSERT INTO projects (id, name, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, p.instructions, t, t)
  return id
}

export function deleteProject(id: string): void {
  const d = db()
  d.prepare('DELETE FROM project_chunks WHERE project_id = ?').run(id)
  d.prepare('DELETE FROM projects WHERE id = ?').run(id)
  if (active === id) active = undefined
}

export async function addPath(id: string, path: string): Promise<void> {
  if (!existsSync(path)) throw new Error(`Not found: ${path}`)
  db().prepare('INSERT OR IGNORE INTO project_paths (project_id, path) VALUES (?, ?)').run(id, path)
  await indexProject(id)
}

export async function removePath(id: string, path: string): Promise<void> {
  db().prepare('DELETE FROM project_paths WHERE project_id = ? AND path = ?').run(id, path)
  await indexProject(id)
}

function filesUnder(path: string, out: string[]): void {
  if (out.length >= MAX_FILES || !existsSync(path)) return
  const st = statSync(path)
  if (st.isFile()) {
    if (canExtract(path) && st.size <= MAX_BYTES) out.push(path)
    return
  }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    filesUnder(join(path, name), out)
  }
}

const indexing = new Map<string, Promise<void>>()

/** Brings the index up to date: new and changed files are (re)chunked, removed ones dropped. */
export function indexProject(id: string): Promise<void> {
  const running = indexing.get(id)
  if (running) return running
  const job = (async () => {
    const d = db()
    const p = getProject(id)
    if (!p) return
    const files: string[] = []
    for (const path of p.paths) filesUnder(path, files)
    const known = new Map((d.prepare('SELECT path, mtime FROM project_files WHERE project_id = ?').all(id) as { path: string; mtime: number }[]).map((r) => [r.path, r.mtime]))
    for (const f of files) {
      const mtime = statSync(f).mtimeMs
      if (known.get(f) === mtime) continue
      let text = ''
      try {
        text = await extractText(f)
      } catch (err) {
        logInfo(`projects: couldn't read ${f}`, err)
      }
      d.prepare('DELETE FROM project_chunks WHERE project_id = ? AND path = ?').run(id, f)
      const ins = d.prepare('INSERT INTO project_chunks (text, path, project_id) VALUES (?, ?, ?)')
      for (let i = 0; i < text.length; i += CHUNK - OVERLAP) {
        ins.run(text.slice(i, i + CHUNK), f, id)
        if (i + CHUNK >= text.length) break
      }
      d.prepare('INSERT OR REPLACE INTO project_files (project_id, path, mtime) VALUES (?, ?, ?)').run(id, f, mtime)
    }
    const present = new Set(files)
    for (const f of known.keys()) {
      if (present.has(f)) continue
      d.prepare('DELETE FROM project_chunks WHERE project_id = ? AND path = ?').run(id, f)
      d.prepare('DELETE FROM project_files WHERE project_id = ? AND path = ?').run(id, f)
    }
  })().finally(() => indexing.delete(id))
  indexing.set(id, job)
  return job
}

/** The chunks of the project's files that best match the text. */
export function searchProject(id: string, text: string, limit = 4): { path: string; text: string }[] {
  const q = ftsQuery(text)
  if (!q) return []
  return db()
    .prepare('SELECT path, text FROM project_chunks WHERE project_chunks MATCH ? AND project_id = ? ORDER BY bm25(project_chunks) LIMIT ?')
    .all(q, id, limit) as { path: string; text: string }[]
}

/** The indexed files of a project, for the model's instructions. */
export function projectFiles(id: string): string[] {
  return (db().prepare('SELECT path FROM project_files WHERE project_id = ? ORDER BY path').all(id) as { path: string }[]).map((r) => r.path)
}

/** Folders and files read_file may read while a project is active. */
export function projectPaths(): string[] {
  return active ? (getProject(active)?.paths ?? []) : []
}
