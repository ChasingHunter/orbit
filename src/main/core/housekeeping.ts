import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { Notification } from 'electron'
import { basename, dirname, join } from 'node:path'
import { settings } from '../settingsStore'
import { dataDir, paths } from '../paths'
import { getDb } from './db'
import { logInfo } from '../log'
import { dirSize, freeBytes } from './disk'
import { pruneAuditLogs, rotateAudit } from './audit'
import { pruneJournal } from './journal'
import { pruneSnapshots, snapshotBytes } from './userFiles'
import { pruneAttachments } from './attachments'
import { pythonCacheDir } from '../python/sandbox'
import { sweepTemporary, tempDir, TEMP_DAYS } from './madeFiles'

// Keeps Orbit's own records from growing forever. Runs a minute after start and then daily.
// It only removes Orbit's logs, backups and caches, by age and size. Your chats (unless you set a
// limit), memories and the files Orbit made for you are never deleted.

export type CleanupReport = { at: string; freed: number; details: Record<string, number> }
let last: CleanupReport | undefined

const days = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString()

function dbFreed(fn: () => void): number {
  const d = getDb()
  const pages = (): number => (d.prepare('PRAGMA page_count').get() as { page_count: number }).page_count
  const free = (): number => (d.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count
  const before = pages() - free()
  fn()
  const size = (d.prepare('PRAGMA page_size').get() as { page_size: number }).page_size
  return Math.max(0, (before - (pages() - free())) * size)
}

export async function runCleanup(): Promise<CleanupReport> {
  const s = settings.current
  const details: Record<string, number> = {}
  const step = (name: string, fn: () => number): void => {
    try {
      details[name] = fn()
    } catch (err) {
      logInfo(`cleanup: ${name} failed`, err)
    }
  }
  const d = getDb()

  step('logs', () => {
    rotateAudit()
    return pruneAuditLogs(s.storage.logDays)
  })
  step('workflow runs', () =>
    dbFreed(() => {
      // Older than the limit, except each workflow's latest 20 runs.
      d.prepare(
        `DELETE FROM workflow_runs WHERE started_at < ? AND id NOT IN (
           SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY workflow ORDER BY started_at DESC) rn FROM workflow_runs) WHERE rn <= 20)`
      ).run(days(s.storage.workflowRunDays))
      // And never more than 3,000 runs in all (about 300 MB even for big runs).
      d.prepare(
        `DELETE FROM workflow_runs WHERE id NOT IN (SELECT id FROM workflow_runs ORDER BY started_at DESC LIMIT 3000) AND id NOT IN (
           SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY workflow ORDER BY started_at DESC) rn FROM workflow_runs) WHERE rn <= 20)`
      ).run()
      d.prepare('DELETE FROM workflow_steps WHERE run_id NOT IN (SELECT id FROM workflow_runs)').run()
    })
  )
  // The undo window matches the backup window: an entry is useless once its backup is gone.
  step('undo history', () => dbFreed(() => pruneJournal(s.files.snapshotDays)))
  step('backups', () => pruneSnapshots(freeBytes()))
  step('attachments', () => pruneAttachments(s.storage.attachmentsMaxMb))
  try {
    details['temporary files'] = await sweepTemporary()
  } catch (err) {
    logInfo('cleanup: temporary files failed', err)
  }
  step('usage records', () => dbFreed(() => d.prepare('DELETE FROM usage WHERE at < ?').run(days(400))))
  if (s.storage.chatDays > 0) {
    step('old chats', () =>
      dbFreed(() => {
        d.prepare('DELETE FROM conversations WHERE updated_at < ?').run(days(s.storage.chatDays))
        d.prepare('DELETE FROM messages WHERE conversation_id NOT IN (SELECT id FROM conversations)').run()
      })
    )
  }
  step('old Python packages', () => {
    // Packages for Pyodide versions this Orbit no longer uses.
    const current = pythonCacheDir()
    const root = dirname(current)
    if (!existsSync(root)) return 0
    let freed = 0
    for (const v of readdirSync(root)) {
      if (v === basename(current)) continue
      freed += dirSize(join(root, v))
      rmSync(join(root, v), { recursive: true, force: true })
    }
    return freed
  })
  // Deleted rows leave free pages inside the file; give them back to the disk once it's worth it.
  step('compact database', () => {
    const size = (d.prepare('PRAGMA page_size').get() as { page_size: number }).page_size
    const free = (d.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count * size
    if (free < 20 * 1024 * 1024) return 0
    d.exec('VACUUM')
    // In WAL mode the rebuilt file sits in the log until a checkpoint writes it back.
    d.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    return free
  })

  // Compacting returns space the steps above already counted, so it isn't added again.
  const freed = Object.entries(details).reduce((t, [k, v]) => (k === 'compact database' ? t : t + v), 0)
  last = { at: new Date().toISOString(), freed, details }
  logInfo(`cleanup: freed ${Math.round(last.freed / 1024)} KB`, JSON.stringify(details))
  warnIfDiskLow()
  return last
}

/** Once a day at most: the files Orbit made are never deleted automatically, so say when space runs low. */
function warnIfDiskLow(): void {
  const free = freeBytes()
  if (free > 5 * 1024 ** 3 || !Notification.isSupported()) return
  const mine = dirSize(paths.files)
  new Notification({
    title: 'Disk space is getting low',
    body: `${(free / 1024 ** 3).toFixed(1)} GB free. Orbit's files folder holds ${(mine / 1024 ** 3).toFixed(1)} GB; Orbit stops saving new files and backups below 1 GB free.`
  }).show()
}

let timer: NodeJS.Timeout | undefined
export function startHousekeeping(): void {
  const run = (): void => void runCleanup()
  setTimeout(run, 60_000).unref()
  timer = setInterval(run, 24 * 3600_000)
  timer.unref()
}

function fileSize(p: string): number {
  try {
    return statSync(p).size
  } catch {
    return 0
  }
}

export type StorageItem = { id: string; label: string; bytes: number; limit: string }

export function storageReport(): { items: StorageItem[]; total: number; free: number; last?: CleanupReport } {
  const s = settings.current
  const logs = dirname(paths.audit)
  const db = ['orbit.db', 'orbit.db-wal', 'orbit.db-shm'].reduce((t, n) => t + fileSize(join(dataDir, n)), 0)
  const items: StorageItem[] = [
    { id: 'db', label: 'Chats, memories, run history', bytes: db, limit: s.storage.chatDays ? `chats kept ${s.storage.chatDays} days, runs ${s.storage.workflowRunDays} days` : `chats kept forever, runs ${s.storage.workflowRunDays} days` },
    { id: 'logs', label: 'Logs', bytes: dirSize(logs), limit: `about 70 MB at most, ${s.storage.logDays} days` },
    { id: 'backups', label: 'Backups of changed files', bytes: snapshotBytes(), limit: `${s.files.snapshotDays} days, ${(s.files.snapshotMaxMb / 1024).toFixed(1)} GB at most` },
    { id: 'attachments', label: 'Attachment copies', bytes: dirSize(paths.attachments), limit: `30 days, ${(s.storage.attachmentsMaxMb / 1024).toFixed(1)} GB at most` },
    { id: 'temporary', label: 'Temporary files from chats', bytes: dirSize(tempDir()), limit: `to the Recycle Bin after ${TEMP_DAYS} days unused, 2 GB at most` },
    { id: 'files', label: 'Files you kept, and workflow files', bytes: dirSize(paths.files) - dirSize(tempDir()), limit: 'yours, never deleted' },
    { id: 'models', label: 'Speech model and Python packages', bytes: dirSize(paths.models), limit: 'fixed size' }
  ]
  return { items, total: items.reduce((t, i) => t + i.bytes, 0), free: freeBytes(), last }
}
