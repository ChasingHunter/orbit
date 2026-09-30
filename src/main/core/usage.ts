import { getDb, now } from './db'

// Token usage per model call, so you can see where your subscription goes.

export type UsageSource = 'chat' | 'task' | 'workflow' | 'trigger'
export type Usage = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number }

const SCHEMA = `CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, source TEXT NOT NULL, label TEXT, model TEXT NOT NULL,
  input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_at ON usage(at);`

function db(): ReturnType<typeof getDb> {
  const d = getDb()
  d.exec(SCHEMA)
  return d
}

export function recordUsage(source: UsageSource, label: string, u: Usage): void {
  db()
    .prepare('INSERT INTO usage (at, source, label, model, input, output, cache_read, cache_write) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(now(), source, label.slice(0, 120), u.model, u.input, u.output, u.cacheRead, u.cacheWrite)
}

/** Tokens that count toward the background budget today (local day). */
export function backgroundTokensToday(): number {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const row = db()
    .prepare("SELECT COALESCE(SUM(input + cache_write + output), 0) n FROM usage WHERE source != 'chat' AND at >= ?")
    .get(start.toISOString()) as { n: number }
  return row.n
}

export type UsageSummary = {
  days: { day: string; source: UsageSource; input: number; output: number; cacheRead: number; cacheWrite: number; calls: number }[]
  top: { label: string; source: UsageSource; tokens: number; calls: number }[]
}

/**
 * Totals for the last `days` days. "Fresh" input (not read from cache) and output are what
 * mostly count against subscription limits; cache reads are cheap.
 */
export function usageSummary(days = 14): UsageSummary {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  return {
    days: db()
      .prepare(
        `SELECT substr(at, 1, 10) day, source, SUM(input) input, SUM(output) output, SUM(cache_read) cacheRead,
                SUM(cache_write) cacheWrite, COUNT(*) calls
         FROM usage WHERE at >= ? GROUP BY day, source ORDER BY day`
      )
      .all(since) as UsageSummary['days'],
    top: db()
      .prepare(
        `SELECT label, source, SUM(input + cache_write + output) tokens, COUNT(*) calls
         FROM usage WHERE at >= ? GROUP BY label, source ORDER BY tokens DESC LIMIT 12`
      )
      .all(since) as UsageSummary['top']
  }
}
