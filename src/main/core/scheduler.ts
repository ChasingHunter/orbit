import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { powerMonitor } from 'electron'
import { Cron } from 'croner'
import { getDb, now } from './db'

// Local scheduler for reminders and workflows. Runs only while Orbit is running;
// anything missed while the PC was off or asleep is handled on the next start or wake.

export type ScheduleKind = 'reminder' | 'workflow'
export type MissedPolicy = 'ask' | 'run' | 'skip'

export type Schedule = {
  id: string
  kind: ScheduleKind
  title: string
  /** JSON, meaning depends on kind (reminder text, workflow name). */
  payload: string
  cron: string | null
  run_at: string | null
  enabled: number
  missed: MissedPolicy
  last_run_at: string | null
  created_at: string
}

type Handler = (s: Schedule, info: { missedAt?: Date }) => Promise<void> | void

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  cron TEXT,
  run_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  missed TEXT NOT NULL DEFAULT 'ask',
  last_run_at TEXT,
  created_at TEXT NOT NULL
);`

class Scheduler extends EventEmitter {
  private jobs = new Map<string, Cron>()
  private handlers = new Map<ScheduleKind, { fire: Handler; missed: Handler }>()
  private started = false

  constructor() {
    super()
  }

  private db(): ReturnType<typeof getDb> {
    const db = getDb()
    db.exec(SCHEMA)
    return db
  }

  /** `fire` runs on time; `missed` runs when the time passed while Orbit wasn't running. */
  register(kind: ScheduleKind, fire: Handler, missed: Handler): void {
    this.handlers.set(kind, { fire, missed })
  }

  start(): void {
    if (this.started) return
    this.started = true
    for (const s of this.list(true)) this.arm(s)
    this.catchUp()
    // Timers don't run during sleep; check what was missed when the PC wakes up.
    powerMonitor.on('resume', () => this.catchUp())
  }

  list(enabledOnly = false, kind?: ScheduleKind): Schedule[] {
    const where = [enabledOnly ? 'enabled = 1' : '', kind ? 'kind = ?' : ''].filter(Boolean).join(' AND ')
    const sql = `SELECT * FROM schedules ${where ? `WHERE ${where}` : ''} ORDER BY created_at DESC`
    const stmt = this.db().prepare(sql)
    return (kind ? stmt.all(kind) : stmt.all()) as Schedule[]
  }

  get(id: string): Schedule | undefined {
    return this.db().prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Schedule | undefined
  }

  /** Validates the timing and returns the next run, or throws with a readable reason. */
  static nextRun(when: { cron?: string; at?: Date }): Date {
    if (when.cron) {
      const next = new Cron(when.cron, { paused: true }).nextRun()
      if (!next) throw new Error(`"${when.cron}" never runs`)
      return next
    }
    if (!when.at || isNaN(when.at.getTime())) throw new Error('Missing or invalid time')
    if (when.at.getTime() <= Date.now()) throw new Error(`${when.at.toLocaleString()} is in the past`)
    return when.at
  }

  add(input: { kind: ScheduleKind; title: string; payload: unknown; cron?: string; at?: Date; missed?: MissedPolicy; id?: string }): Schedule {
    Scheduler.nextRun(input)
    const id = input.id ?? randomUUID()
    const prev = input.id ? this.get(id) : undefined
    const run_at = input.at ? input.at.toISOString() : null
    // Same timing as before: keep its history so missed-run detection still works after re-saving.
    const sameTiming = prev && prev.cron === (input.cron ?? null) && prev.run_at === run_at
    const s: Schedule = {
      id,
      kind: input.kind,
      title: input.title,
      payload: JSON.stringify(input.payload ?? null),
      cron: input.cron ?? null,
      run_at,
      enabled: 1,
      missed: input.missed ?? 'ask',
      last_run_at: sameTiming ? prev.last_run_at : null,
      created_at: sameTiming ? prev.created_at : now()
    }
    this.db()
      .prepare(
        `INSERT OR REPLACE INTO schedules (id, kind, title, payload, cron, run_at, enabled, missed, last_run_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(s.id, s.kind, s.title, s.payload, s.cron, s.run_at, s.enabled, s.missed, s.last_run_at, s.created_at)
    this.unarm(s.id)
    if (this.started) this.arm(s)
    this.emit('change')
    return s
  }

  remove(id: string): boolean {
    this.unarm(id)
    const changed = Number(this.db().prepare('DELETE FROM schedules WHERE id = ?').run(id).changes) > 0
    if (changed) this.emit('change')
    return changed
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db().prepare('UPDATE schedules SET enabled = ?, last_run_at = COALESCE(last_run_at, ?) WHERE id = ?').run(enabled ? 1 : 0, now(), id)
    this.unarm(id)
    const s = this.get(id)
    if (enabled && s && this.started) this.arm(s)
    this.emit('change')
  }

  nextRunOf(s: Schedule): Date | null {
    return this.jobs.get(s.id)?.nextRun() ?? null
  }

  /** Marks a run as handled without running it (e.g. the user skipped a missed run). */
  markRan(id: string): void {
    this.db().prepare('UPDATE schedules SET last_run_at = ? WHERE id = ?').run(now(), id)
    const s = this.get(id)
    if (s?.run_at) this.setEnabled(id, false)
    this.emit('change')
  }

  private arm(s: Schedule): void {
    if (!s.enabled) return
    const target = s.cron ?? new Date(s.run_at!)
    if (!s.cron && (target as Date).getTime() <= Date.now()) return // one-off already due: catchUp handles it
    const job = new Cron(target, { protect: true, catch: (err) => console.error(`[scheduler] ${s.title} failed`, err) }, () => this.fire(s.id))
    this.jobs.set(s.id, job)
  }

  private unarm(id: string): void {
    this.jobs.get(id)?.stop()
    this.jobs.delete(id)
  }

  private async fire(id: string, missedAt?: Date): Promise<void> {
    const s = this.get(id)
    if (!s || !s.enabled) return
    this.markRan(id)
    const h = this.handlers.get(s.kind)
    try {
      await (missedAt ? h?.missed(s, { missedAt }) : h?.fire(s, {}))
    } catch (err) {
      console.error(`[scheduler] ${s.title} handler failed`, err)
    }
  }

  /** Finds runs that should have happened while Orbit wasn't running. */
  catchUp(): void {
    const t = Date.now()
    for (const s of this.list(true)) {
      const since = new Date(s.last_run_at ?? s.created_at)
      const due = s.cron ? new Cron(s.cron, { paused: true }).nextRun(since) : new Date(s.run_at!)
      if (due && due.getTime() <= t - 1000) void this.fire(s.id, due)
    }
  }
}

export const scheduler = new Scheduler()
export const nextRunFor = Scheduler.nextRun
