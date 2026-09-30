import { useEffect, useMemo, useState } from 'react'
import { Check, RefreshCw, RotateCcw, ScrollText, ShieldCheck, X } from 'lucide-react'
import type { AuditItem, ChangeItem } from '@shared/dash'
import { Button, Card, dash, Empty, inputClass, PageHeader, selectClass } from '../ui'

export function LogsPage(): React.JSX.Element {
  const [items, setItems] = useState<AuditItem[]>([])
  const [tool, setTool] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [changes, setChanges] = useState<ChangeItem[]>([])
  const [undoError, setUndoError] = useState('')
  const [conflict, setConflict] = useState<{ id: number; message: string } | null>(null)
  const load = (): void => {
    void dash.audit(500).then(setItems)
    void dash.changes().then(setChanges)
  }

  useEffect(() => {
    load()
    return dash.onChanged((w) => w === 'logs' && load())
  }, [])

  const undo = (id: number, force = false): void => {
    setUndoError('')
    setConflict(null)
    dash.undo(id, force).then(
      (r) => {
        if ('conflict' in r) setConflict({ id, message: r.conflict })
        load()
      },
      (err: Error) => setUndoError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    )
  }

  const tools = useMemo(() => [...new Set(items.map((i) => i.tool))].sort(), [items])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((i) => (!tool || i.tool === tool) && (!q || JSON.stringify(i).toLowerCase().includes(q)))
  }, [items, tool, query])

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle="Every tool Orbit used, newest first: what it was asked, whether you approved it, and what came back."
        actions={
          <Button icon={RefreshCw} onClick={load}>
            Refresh
          </Button>
        }
      />
      {changes.length > 0 && (
        <Card className="mb-5 p-4">
          <div className="text-sm font-medium text-zinc-100">Recent changes</div>
          <div className="mb-3 text-xs text-zinc-500">Changes to Orbit's own files, memories, reminders and workflows, and to files in folders you let it change. Each can be undone.</div>
          {undoError && <p className="mb-2 text-xs text-rose-300">{undoError}</p>}
          {conflict && (
            <div className="mb-2 flex items-center gap-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2 text-xs text-amber-200">
              <span className="flex-1">{conflict.message}</span>
              <Button variant="ghost" onClick={() => undo(conflict.id, true)}>
                Undo anyway
              </Button>
              <Button variant="ghost" onClick={() => setConflict(null)}>
                Keep it
              </Button>
            </div>
          )}
          <div className="divide-y divide-white/[0.05]">
            {changes.slice(0, 12).map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-1.5 text-sm">
                <span className={`min-w-0 flex-1 truncate ${c.undone_at ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>{c.summary}</span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {c.source === 'you' ? 'you' : 'Orbit'} · {new Date(c.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                {c.undone_at ? (
                  <span className="w-16 shrink-0 text-right text-xs text-zinc-500">undone</span>
                ) : (
                  <span className="shrink-0">
                    <Button variant="ghost" icon={RotateCcw} onClick={() => undo(c.id)}>
                      Undo
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      {items.length === 0 ? (
        <Empty icon={ScrollText} title="Nothing yet">
          Tool calls show up here as soon as Orbit uses one.
        </Empty>
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <select value={tool} onChange={(e) => setTool(e.target.value)} className={selectClass}>
              <option value="">All tools</option>
              {tools.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search inputs and results" className={inputClass} />
          </div>
          <Card className="divide-y divide-white/[0.05]">
            {shown.map((i, n) => (
              <div key={`${i.at}-${n}`}>
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/[0.02]" onClick={() => setOpen(open === n ? null : n)}>
                  {i.decision === 'denied' ? (
                    <X size={14} className="shrink-0 text-zinc-500" />
                  ) : i.ok === false ? (
                    <X size={14} className="shrink-0 text-rose-400" />
                  ) : (
                    <Check size={14} className="shrink-0 text-emerald-400" />
                  )}
                  <span className="w-44 shrink-0 truncate text-zinc-200">{i.tool}</span>
                  {i.decision === 'approved' && (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-300">
                      <ShieldCheck size={12} /> approved
                    </span>
                  )}
                  {i.decision === 'denied' && <span className="shrink-0 text-[11px] text-zinc-500">declined</span>}
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{JSON.stringify(i.input)}</span>
                  <span className="shrink-0 text-xs text-zinc-600 tabular-nums">{new Date(i.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </button>
                {open === n && (
                  <div className="grid gap-2 px-4 pb-3 text-xs">
                    <pre className="max-h-48 overflow-auto rounded-md bg-black/30 p-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-400">{JSON.stringify(i.input, null, 2)}</pre>
                    {i.output && <pre className="max-h-64 overflow-auto rounded-md bg-black/30 p-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-400">{i.output}</pre>}
                  </div>
                )}
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  )
}
