import { createHash, randomBytes } from 'node:crypto'
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import { basename, join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { powerMonitor } from 'electron'
import { getDb, now } from '../core/db'
import { callTool, riskOf } from '../core/tools/registry'
import { parseFeed } from '../core/tools/builtins/feeds'
import { fetchPageText } from '../core/tools/builtins/web'
import { durationMs, triggerKind, type Trigger, type Workflow } from './schema'

// Event triggers. Each enabled workflow with one gets a watcher. State is saved so a restart
// doesn't re-fire on things already seen, and the first check only records a baseline.

export type TriggerData = Record<string, string>
type Fire = (workflow: string, data: TriggerData) => void

const WEBHOOK_PORT = 47814
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Orbit/0.4'
const MAX_SEEN = 1000

const SCHEMA = `CREATE TABLE IF NOT EXISTS trigger_state (
  workflow TEXT PRIMARY KEY, config TEXT NOT NULL, state TEXT NOT NULL, last_checked TEXT, last_error TEXT
);`

type Watcher = { config: string; stop: () => void; check?: () => Promise<void> }

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

/** Lines in `next` that weren't in `prev`: good enough to show what changed on a page. */
function addedLines(prev: string, next: string): string {
  const before = new Set(prev.split('\n').map((l) => l.trim()))
  return next
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !before.has(l))
    .join('\n')
}

class TriggerManager {
  private watchers = new Map<string, Watcher>()
  private server: Server | undefined
  private fire: Fire = () => {}

  private db(): ReturnType<typeof getDb> {
    const db = getDb()
    db.exec(SCHEMA)
    return db
  }

  private load<T>(workflow: string, config: string): T | undefined {
    const row = this.db().prepare('SELECT config, state FROM trigger_state WHERE workflow = ?').get(workflow) as { config: string; state: string } | undefined
    return row && row.config === config ? (JSON.parse(row.state) as T) : undefined
  }

  private save(workflow: string, config: string, state: unknown, error: string | null = null): void {
    this.db()
      .prepare('INSERT OR REPLACE INTO trigger_state (workflow, config, state, last_checked, last_error) VALUES (?, ?, ?, ?, ?)')
      .run(workflow, config, JSON.stringify(state), now(), error)
  }

  status(workflow: string): { lastChecked: string | null; lastError: string | null } | undefined {
    const row = this.db().prepare('SELECT last_checked, last_error FROM trigger_state WHERE workflow = ?').get(workflow) as
      | { last_checked: string | null; last_error: string | null }
      | undefined
    return row && { lastChecked: row.last_checked, lastError: row.last_error }
  }

  init(fire: Fire): void {
    this.fire = fire
    powerMonitor.on('resume', () => void this.checkAll())
  }

  /** Starts, restarts or stops watchers to match the current workflows. */
  sync(workflows: Workflow[]): void {
    const wanted = new Map<string, Workflow>()
    for (const wf of workflows) {
      const kind = triggerKind(wf.trigger)
      if (wf.enabled && kind !== 'cron' && kind !== 'manual') wanted.set(wf.name, wf)
    }
    for (const [name, w] of this.watchers) {
      const wf = wanted.get(name)
      if (!wf || JSON.stringify(wf.trigger) !== w.config) {
        w.stop()
        this.watchers.delete(name)
      }
    }
    for (const [name, wf] of wanted) {
      if (this.watchers.has(name)) continue
      try {
        this.watchers.set(name, this.start(name, wf.trigger))
      } catch (err) {
        this.save(name, JSON.stringify(wf.trigger), {}, (err as Error).message)
        console.error(`[triggers] ${name}:`, err)
      }
    }
    if (![...wanted.values()].some((w) => triggerKind(w.trigger) === 'webhook')) this.stopServer()
  }

  /** Runs every interval-based check now (used on wake and by tests). */
  async checkAll(): Promise<void> {
    await Promise.all([...this.watchers.values()].map((w) => w.check?.()))
  }

  async checkNow(workflow: string): Promise<void> {
    await this.watchers.get(workflow)?.check?.()
  }

  private start(name: string, trigger: Trigger): Watcher {
    const config = JSON.stringify(trigger)
    if ('feed' in trigger || 'page' in trigger || 'poll' in trigger) {
      const every = durationMs('feed' in trigger ? trigger.feed.every : 'page' in trigger ? trigger.page.every : trigger.poll.every)
      if ('poll' in trigger && riskOf(trigger.poll.tool) !== 'read') {
        throw new Error(`"${trigger.poll.tool}" isn't a read-only tool that's connected, so it can't be polled`)
      }
      let busy = false
      const check = async (): Promise<void> => {
        if (busy) return
        busy = true
        try {
          await this.checkPolling(name, config, trigger)
        } catch (err) {
          const prev = this.load<unknown>(name, config) ?? {}
          this.save(name, config, prev, (err as Error).message)
        } finally {
          busy = false
        }
      }
      // First check shortly after start, not during it.
      const first = setTimeout(() => void check(), 15_000)
      const timer = setInterval(() => void check(), every)
      return { config, check, stop: () => (clearTimeout(first), clearInterval(timer)) }
    }
    if ('folder' in trigger) return this.startFolder(name, config, trigger.folder.path, trigger.folder.pattern)
    if ('webhook' in trigger) {
      this.webhookKey(name)
      this.startServer()
      return { config, stop: () => {} }
    }
    throw new Error('Not an event trigger')
  }

  private async checkPolling(name: string, config: string, trigger: Trigger): Promise<void> {
    const signal = AbortSignal.timeout(60_000)
    if ('feed' in trigger) {
      const res = await fetch(trigger.feed.url, { signal, headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`Feed request failed: ${res.status}`)
      const { items } = parseFeed(await res.text())
      const state = this.load<{ seen: string[] }>(name, config)
      const ids = items.map((i) => i.link || i.title)
      if (!state) return this.save(name, config, { seen: ids.slice(0, MAX_SEEN) }) // baseline
      const seen = new Set(state.seen)
      const fresh = items.filter((i) => !seen.has(i.link || i.title))
      this.save(name, config, { seen: [...fresh.map((i) => i.link || i.title), ...state.seen].slice(0, MAX_SEEN) })
      if (fresh.length) {
        const list = fresh.map((i, n) => `${n + 1}. ${i.title}\n   ${i.link}${i.summary && i.summary !== i.title ? `\n   ${i.summary}` : ''}`).join('\n')
        this.fire(name, { items: list, count: String(fresh.length), url: trigger.feed.url })
      }
      return
    }
    if ('page' in trigger) {
      const { text } = await fetchPageText(trigger.page.url, signal, trigger.page.selector)
      const state = this.load<{ hash: string; text: string }>(name, config)
      const next = { hash: hash(text), text: text.slice(0, 50_000) }
      this.save(name, config, next)
      if (state && state.hash !== next.hash) {
        this.fire(name, { changes: addedLines(state.text, next.text) || '(something was removed)', text: next.text, previous: state.text, url: trigger.page.url })
      }
      return
    }
    if ('poll' in trigger) {
      const r = await callTool(trigger.poll.tool, trigger.poll.args, { signal, context: [] })
      if (r.isError) throw new Error(r.output)
      const state = this.load<{ hash: string; output: string }>(name, config)
      const next = { hash: hash(r.output), output: r.output.slice(0, 50_000) }
      this.save(name, config, next)
      if (state && state.hash !== next.hash) this.fire(name, { output: next.output, previous: state.output })
    }
  }

  private startFolder(name: string, config: string, path: string, pattern: string): Watcher {
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Folder not found: ${path}`)
    const match = globToRegex(pattern)
    const pending = new Map<string, NodeJS.Timeout>()
    const known = new Set(this.load<{ seen: string[] }>(name, config)?.seen ?? [])
    let watcher: FSWatcher | undefined = watch(path, (_event, file) => {
      if (!file || !match.test(basename(file.toString()))) return
      const full = join(path, file.toString())
      // Wait until the file stops changing (downloads and copies take a moment).
      clearTimeout(pending.get(full))
      pending.set(
        full,
        setTimeout(() => {
          pending.delete(full)
          if (known.has(full) || !existsSync(full) || !statSync(full).isFile()) return
          known.add(full)
          this.save(name, config, { seen: [...known].slice(-MAX_SEEN) })
          this.fire(name, { file: full, name: basename(full), folder: path })
        }, 2000)
      )
    })
    watcher.on('error', (err) => this.save(name, config, { seen: [...known] }, err.message))
    return {
      config,
      stop: () => {
        watcher?.close()
        watcher = undefined
        for (const t of pending.values()) clearTimeout(t)
      }
    }
  }

  /** Secret part of a workflow's webhook URL. Created once and kept. */
  webhookKey(name: string): string {
    const row = this.db().prepare("SELECT state FROM trigger_state WHERE workflow = ? AND config = '\"webhook\"'").get(name) as { state: string } | undefined
    if (row) return JSON.parse(row.state).key as string
    const key = randomBytes(16).toString('hex')
    this.save(name, '"webhook"', { key })
    return key
  }

  webhookUrl(name: string): string {
    return `http://127.0.0.1:${WEBHOOK_PORT}/hook/${name}?key=${this.webhookKey(name)}`
  }

  private startServer(): void {
    if (this.server) return
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${WEBHOOK_PORT}`)
      const m = url.pathname.match(/^\/hook\/([a-z0-9-]+)$/)
      const name = m?.[1]
      const w = name ? this.watchers.get(name) : undefined
      if (!name || !w || JSON.parse(w.config).webhook !== true || url.searchParams.get('key') !== this.webhookKey(name)) {
        res.writeHead(404).end()
        return
      }
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8')
        if (body.length > 1_000_000) req.destroy()
      })
      req.on('end', () => {
        const query = Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'key'))
        this.fire(name, { body, query: JSON.stringify(query), method: req.method ?? 'GET' })
        res.writeHead(202, { 'Content-Type': 'application/json' }).end('{"ok":true}')
      })
    })
    this.server.on('error', (err) => console.error('[triggers] webhook server:', err))
    this.server.listen(WEBHOOK_PORT, '127.0.0.1')
  }

  private stopServer(): void {
    this.server?.close()
    this.server = undefined
  }
}

export const triggers = new TriggerManager()
