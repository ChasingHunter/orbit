import { useEffect, useMemo, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import type { StorageInfo, UsageInfo } from '@shared/dash'
import { Button, Card, dash, Empty, inputClass, PageHeader } from '../ui'

// "Counted" tokens: fresh input + cache writes + output. Cache reads are shown separately because
// they cost roughly a tenth as much and would otherwise dwarf everything else.

const fmt = (n: number): string => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const COLORS: Record<string, string> = { chat: 'bg-sky-400', task: 'bg-violet-400', workflow: 'bg-amber-400', trigger: 'bg-emerald-400' }
const LABELS: Record<string, string> = { chat: 'Chat', task: 'Background tasks', workflow: 'Workflows', trigger: 'Triggers' }

export function UsagePage(): React.JSX.Element {
  const [u, setU] = useState<UsageInfo | null>(null)
  const [budget, setBudget] = useState('')
  const load = (): void =>
    void dash.usage().then((x) => {
      setU(x)
      setBudget(String(x.backgroundLimit))
    })
  useEffect(load, [])

  const days = useMemo(() => {
    if (!u) return []
    const byDay = new Map<string, Record<string, number>>()
    for (const r of u.days) {
      const d = byDay.get(r.day) ?? {}
      d[r.source] = (d[r.source] ?? 0) + r.input + r.cacheWrite + r.output
      d.cacheRead = (d.cacheRead ?? 0) + r.cacheRead
      byDay.set(r.day, d)
    }
    return [...byDay.entries()].map(([day, v]) => ({ day, v, total: ['chat', 'task', 'workflow', 'trigger'].reduce((s, k) => s + (v[k] ?? 0), 0) }))
  }, [u])
  const max = Math.max(1, ...days.map((d) => d.total))

  if (!u) return <></>
  const pct = u.backgroundLimit ? Math.min(100, (u.backgroundToday / u.backgroundLimit) * 100) : 0

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle="Tokens Orbit used over the last two weeks. Counted means new input, cache writes and output, which is what mostly draws down your plan; cache reads are much cheaper and shown separately."
      />

      <Card className="mb-4 p-5">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-medium text-zinc-100">Background budget today</div>
          <div className="text-xs text-zinc-400 tabular-nums">
            {fmt(u.backgroundToday)} of {u.backgroundLimit ? fmt(u.backgroundLimit) : 'no limit'}
          </div>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-rose-400' : pct > 75 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Workflows, triggers and background tasks pause for the rest of the day once they reach this. Chat is never blocked.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/\D/g, ''))} className={`${inputClass} w-40`} aria-label="Daily budget" />
          <span className="text-xs text-zinc-500">tokens per day (0 means no limit)</span>
          <Button onClick={() => void dash.setBudget(Number(budget)).then(load)} disabled={Number(budget) === u.backgroundLimit}>
            Save
          </Button>
        </div>
      </Card>

      {days.length === 0 ? (
        <Empty icon={BarChart3} title="Nothing yet">
          Usage shows up here after your first question.
        </Empty>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="mb-3 flex flex-wrap gap-3 text-xs text-zinc-400">
              {Object.entries(LABELS).map(([k, label]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-sm ${COLORS[k]}`} /> {label}
                </span>
              ))}
            </div>
            <div className="space-y-1.5">
              {days.map((d) => (
                <div key={d.day} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 text-zinc-500 tabular-nums">{d.day.slice(5)}</span>
                  <div className="flex h-3 flex-1 overflow-hidden rounded bg-white/[0.04]">
                    {['chat', 'task', 'workflow', 'trigger'].map((k) =>
                      d.v[k] ? <div key={k} className={COLORS[k]} style={{ width: `${(d.v[k] / max) * 100}%` }} title={`${LABELS[k]}: ${d.v[k].toLocaleString()}`} /> : null
                    )}
                  </div>
                  <span className="w-28 shrink-0 text-right text-zinc-400 tabular-nums">
                    {fmt(d.total)} <span className="text-zinc-600">+{fmt(d.v.cacheRead ?? 0)} cached</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 text-sm font-medium text-zinc-100">Biggest users</div>
            <div className="space-y-1.5 text-sm">
              {u.top.map((t) => (
                <div key={`${t.source}-${t.label}`} className="flex items-center gap-3">
                  <span className={`h-2 w-2 shrink-0 rounded-sm ${COLORS[t.source] ?? 'bg-zinc-500'}`} />
                  <span className="min-w-0 flex-1 truncate text-zinc-300">{t.label || '(untitled)'}</span>
                  <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
                    {fmt(t.tokens)} · {t.calls} call{t.calls === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
      <StorageCard />
    </>
  )
}

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function StorageCard(): React.JSX.Element {
  const [s, setS] = useState<StorageInfo | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => void dash.storage().then(setS), [])
  if (!s) return <></>
  return (
    <Card className="mt-4 p-5">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-medium text-zinc-100">Storage</div>
        <Button
          onClick={() => {
            setBusy(true)
            void dash.cleanup().then((r) => (setS(r), setBusy(false)))
          }}
        >
          {busy ? 'Cleaning up…' : 'Clean up now'}
        </Button>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        {size(s.total)} in all, {size(s.free)} free on this drive. Old logs, backups and attachment copies are removed automatically every day; your chats, memories and files
        aren't.
        {s.last && ` Last cleanup ${new Date(s.last.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} freed ${size(s.last.freed)}.`}
      </p>
      <div className="divide-y divide-white/[0.05] text-sm">
        {s.items.map((i) => (
          <div key={i.id} className="flex items-center gap-3 py-1.5" data-storage={i.id}>
            <span className="min-w-0 flex-1 truncate text-zinc-300">{i.label}</span>
            <span className="hidden shrink-0 text-xs text-zinc-500 sm:inline">{i.limit}</span>
            <span className="w-20 shrink-0 text-right text-zinc-200 tabular-nums">{size(i.bytes)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
