import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ListChecks, Loader2, Square, TriangleAlert, X } from 'lucide-react'
import type { TaskItem } from '@shared/dash'
import { Markdown } from '../../bar/Markdown'
import { Button, Card, dash, Empty, PageHeader, timeAgo } from '../ui'

export function TasksPage(): React.JSX.Element {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(() => void dash.tasks().then(setTasks), [])

  useEffect(() => {
    load()
    return dash.onChanged((w) => w === 'tasks' && load())
  }, [load])

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle='Jobs Orbit is doing in the background. Ask for one from the bar, like "research the best Postgres hosting in the background".'
        actions={<Button onClick={() => void dash.openPath('files')}>Open results folder</Button>}
      />
      {tasks.length === 0 ? (
        <Empty icon={ListChecks} title="Nothing running">
          Background jobs show up here while they run, and their results stay here afterwards.
        </Empty>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <Card key={t.id}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
                <StatusIcon status={t.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-100">{t.title}</div>
                  <div className="text-xs text-zinc-500">
                    {statusLabel(t)} · {timeAgo(t.created_at)} · {t.model}
                  </div>
                </div>
                {t.status === 'running' && (
                  <span onClick={(e) => e.stopPropagation()}>
                    <Button variant="danger" icon={Square} onClick={() => void dash.cancelTask(t.id)}>
                      Stop
                    </Button>
                  </span>
                )}
                <ChevronDown size={16} className={`text-zinc-500 transition-transform ${open === t.id ? 'rotate-180' : ''}`} />
              </button>
              {open === t.id && (
                <div className="border-t border-white/[0.06] px-4 py-4 text-sm">
                  <div className="mb-3 text-xs text-zinc-500">Instructions</div>
                  <p className="mb-4 whitespace-pre-wrap text-zinc-400">{t.prompt}</p>
                  {t.result && <Markdown text={t.result} />}
                  {t.error && <p className="text-rose-300">{t.error}</p>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function StatusIcon({ status }: { status: TaskItem['status'] }): React.JSX.Element {
  if (status === 'running') return <Loader2 size={18} className="shrink-0 animate-spin text-sky-300" />
  if (status === 'done') return <Check size={18} className="shrink-0 text-emerald-400" />
  if (status === 'failed') return <TriangleAlert size={18} className="shrink-0 text-rose-400" />
  return <X size={18} className="shrink-0 text-zinc-500" />
}

function statusLabel(t: TaskItem): string {
  if (t.status === 'running') return 'Running'
  if (t.status === 'done') return 'Done'
  if (t.status === 'failed') return 'Failed'
  return 'Stopped'
}
