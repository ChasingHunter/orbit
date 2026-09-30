import { existsSync, readdirSync, statfsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../paths'

// Disk space checks. Orbit refuses to write backups, attachments or files it makes when that
// would leave less than 1 GB free, so its own safety copies can never fill the disk.

const RESERVE = 1024 ** 3

export function freeBytes(path = dataDir): number {
  try {
    const s = statfsSync(path)
    return s.bavail * s.bsize
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Throws if writing `bytes` would leave less than 1 GB free. */
export function ensureRoom(bytes: number, what: string): void {
  const free = freeBytes()
  if (free - bytes < RESERVE) {
    throw new Error(`Not enough disk space to ${what}: ${(free / 1024 ** 3).toFixed(1)} GB free, and Orbit keeps at least 1 GB free. Free up space and try again.`)
  }
}

export function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    try {
      const s = statSync(p)
      total += s.isDirectory() ? dirSize(p) : s.size
    } catch {
      // vanished while counting
    }
  }
  return total
}
