import { appendFile } from 'node:fs/promises'
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { paths } from '../paths'

export type AuditEntry = {
  at: string
  tool: string
  input: unknown
  decision: 'allowed' | 'approved' | 'denied' | 'blocked'
  ok?: boolean
  output?: string
}

// Append-only JSONL log of every tool call. Long strings in the input (file contents, code) are
// cut to 2,000 characters and outputs too, so one line stays small. At 10 MB the file is renamed
// to audit-<date>.jsonl and a new one starts; housekeeping deletes old ones.

const MAX_STRING = 2000
const ROTATE_AT = 10 * 1024 * 1024

function clipDeep(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…[${v.length - MAX_STRING} more characters]` : v
  if (depth > 6 || v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => clipDeep(x, depth + 1))
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clipDeep(x, depth + 1)]))
}

let writes = 0
export function audit(entry: Omit<AuditEntry, 'at'>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry, input: clipDeep(entry.input), output: entry.output?.slice(0, MAX_STRING) })
  // Checking the size every 50 writes keeps this cheap.
  if (++writes % 50 === 0) rotateAudit()
  appendFile(paths.audit, line + '\n').catch((err) => console.error('[audit] write failed', err))
}

export function rotateAudit(force = false): void {
  try {
    if (!existsSync(paths.audit) || (!force && statSync(paths.audit).size < ROTATE_AT)) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    renameSync(paths.audit, join(dirname(paths.audit), `audit-${stamp}.jsonl`))
  } catch {
    // a failed rotation just means the file grows a little longer
  }
}

/** Deletes rotated logs older than `days`, and all but the newest `keep`. Returns bytes freed. */
export function pruneAuditLogs(days: number, keep = 5): number {
  const dir = dirname(paths.audit)
  if (!existsSync(dir)) return 0
  const cutoff = Date.now() - days * 86_400_000
  const old = readdirSync(dir)
    .filter((n) => /^audit-.+\.jsonl$/.test(n) && n !== basename(paths.audit))
    .map((n) => ({ n, s: statSync(join(dir, n)) }))
    .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)
  let freed = 0
  old.forEach((f, i) => {
    if (i >= keep || f.s.mtimeMs < cutoff) {
      rmSync(join(dir, f.n), { force: true })
      freed += f.s.size
    }
  })
  return freed
}
