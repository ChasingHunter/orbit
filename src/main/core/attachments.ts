import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ContextItem } from '@shared/types'
import { paths } from '../paths'
import { canExtract, extractText, IMAGE_TYPES } from './extract'
import { logInfo } from '../log'
import { dirSize, ensureRoom } from './disk'

// Files attached in the bar. Each one is copied into %APPDATA%\Orbit\attachments\<day>\ (so
// follow-ups and read_file can reach it even if the original moves) and its text is pulled out
// once, here, instead of on every turn. Images never come here: the bar decodes and shrinks them.

const MAX_BYTES = 25 * 1024 * 1024
/** Text sent with the question. Longer files are cut here; the model can read on with read_file. */
export const INLINE_CHARS = 20_000
const KEEP_DAYS = 30

type Result = { items: ContextItem[]; errors: string[] }

export async function attachPaths(files: string[]): Promise<Result> {
  const out: Result = { items: [], errors: [] }
  for (const file of files) {
    try {
      out.items.push(await attachOne(file, basename(file)))
    } catch (err) {
      out.errors.push(`${basename(file)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return out
}

/** Pasted data with no file behind it. Written to the attachments folder first, then treated like any file. */
export async function attachData(name: string, data: Uint8Array): Promise<Result> {
  const safe = basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'pasted.txt'
  const tmp = join(dayDir(), `${randomUUID().slice(0, 8)}-${safe}`)
  ensureRoom(data.length, `attach ${safe}`)
  writeFileSync(tmp, data)
  try {
    return { items: [await attachOne(tmp, safe)], errors: [] }
  } catch (err) {
    rmSync(tmp, { force: true })
    return { items: [], errors: [`${safe}: ${err instanceof Error ? err.message : String(err)}`] }
  }
}

async function attachOne(file: string, name: string): Promise<ContextItem> {
  const st = statSync(file)
  if (st.isDirectory()) throw new Error("folders can't be attached; add it under Settings > Folders instead")
  if (st.size > MAX_BYTES) throw new Error(`${Math.round(st.size / 1e6)} MB is over the 25 MB limit`)
  if (IMAGE_TYPES.has(extname(file).toLowerCase())) throw new Error('images are attached by the bar, not here')
  if (!canExtract(file)) throw new Error(`can't read ${extname(file) || 'this kind of'} files. PDF, Word, Excel, PowerPoint, images and text work.`)
  if (!file.startsWith(paths.attachments)) ensureRoom(st.size, `attach ${name}`)
  const copy = file.startsWith(paths.attachments) ? file : join(dayDir(), `${randomUUID().slice(0, 8)}-${name}`)
  if (copy !== file) copyFileSync(file, copy)
  const text = (await extractText(copy)).trim()
  if (!text) throw new Error('no readable text in it')
  return { kind: 'file', id: randomUUID(), name, path: copy, size: st.size, text: text.slice(0, INLINE_CHARS), chars: text.length }
}

function dayDir(): string {
  const dir = join(paths.attachments, new Date().toISOString().slice(0, 10))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Deletes attachment days older than 30 days, then the oldest days until under maxMb. Returns bytes freed. */
export function pruneAttachments(maxMb = 1024): number {
  let freed = 0
  try {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
    const days = readdirSync(paths.attachments).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
    const drop = (d: string): number => {
      const size = dirSize(join(paths.attachments, d))
      rmSync(join(paths.attachments, d), { recursive: true, force: true })
      freed += size
      return size
    }
    const recent = days.filter((d) => (d < cutoff ? (drop(d), false) : true))
    let total = recent.reduce((t, d) => t + dirSize(join(paths.attachments, d)), 0)
    // Over the cap, oldest days go first. The newest day stays whatever its size: those files
    // may be in the chat right now.
    for (const d of recent.slice(0, -1)) {
      if (total <= maxMb * 1024 * 1024) break
      total -= drop(d)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logInfo('attachments: prune failed', err)
  }
  return freed
}
