import { appendFile } from 'node:fs/promises'
import { paths } from '../paths'

export type AuditEntry = {
  at: string
  tool: string
  input: unknown
  decision: 'allowed' | 'approved' | 'denied' | 'blocked'
  ok?: boolean
  output?: string
}

/** Append-only JSONL log of every tool call. Moves to SQLite on Day 2. */
export function audit(entry: Omit<AuditEntry, 'at'>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry, output: entry.output?.slice(0, 2000) })
  appendFile(paths.audit, line + '\n').catch((err) => console.error('[audit] write failed', err))
}
