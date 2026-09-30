import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  FileCode,
  Loader2,
  Play,
  Plus,
  Square,
  Trash2,
  TriangleAlert,
  Workflow as WorkflowIcon,
  X
} from 'lucide-react'
import type { TemplateInfo, WorkflowInfo, WorkflowRunItem, WorkflowStepItem } from '@shared/dash'
import { Markdown } from '../../bar/Markdown'
import { Button, Card, dash, Empty, PageHeader, timeAgo } from '../ui'

export function WorkflowsPage(): React.JSX.Element {
  const [items, setItems] = useState<WorkflowInfo[]>([])
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(() => {
    void dash.workflows().then((r) => {
      setItems(r.workflows)
      setTemplates(r.templates)
    })
  }, [])

  useEffect(() => {
    load()
    return dash.onChanged((w) => w === 'workflows' && load())
  }, [load])

  const current = items.find((w) => w.name === open)
  if (current) return <WorkflowDetail wf={current} onBack={() => setOpen(null)} />

  const available = templates.filter((t) => !t.installed)

  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle={'Things Orbit does on a schedule or when you ask. To make one, describe it in the bar, like "every Friday at 5, summarise my week into a note".'}
      />
      {items.length === 0 ? (
        <Empty icon={WorkflowIcon} title="No workflows yet">
          Describe one in the bar, or start from a template below.
        </Empty>
      ) : (
        <div className="space-y-2">
          {items.map((w) => (
            <Card key={w.file} className="flex items-center gap-4 px-5 py-4">
              <button className="min-w-0 flex-1 text-left" onClick={() => !w.error && setOpen(w.name)}>
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                  {w.name}
                  {w.lastRun && <RunBadge run={w.lastRun} />}
                </div>
                {w.error ? (
                  <div className="mt-1 text-xs text-rose-300">Can't load {w.file}: {w.error}</div>
                ) : (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Clock size={12} /> {w.schedule}
                    </span>
                    {w.nextRun && <span>next {new Date(w.nextRun).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                    {w.lastRun && <span>last run {timeAgo(w.lastRun.started_at)}</span>}
                    {w.description && <span className="truncate">{w.description}</span>}
                  </div>
                )}
              </button>
              {!w.error && (
                <>
                  <Button icon={Play} onClick={() => void dash.runWorkflow(w.name)} disabled={w.lastRun?.status === 'running'}>
                    Run now
                  </Button>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                    <input
                      type="checkbox"
                      checked={w.enabled}
                      onChange={(e) => void dash.setWorkflowEnabled(w.name, e.target.checked)}
                      className="accent-sky-500"
                    />
                    On
                  </label>
                </>
              )}
              <Button variant="ghost" icon={FileCode} title="Edit YAML" onClick={() => void dash.editWorkflow(w.name)} />
            </Card>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-sm font-medium text-zinc-300">Templates</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {available.map((t) => (
              <Card key={t.id} className="flex flex-col p-4">
                <div className="text-sm font-medium text-zinc-100">{t.title}</div>
                <p className="mt-1 flex-1 text-xs leading-relaxed text-zinc-400">{t.summary}</p>
                <div className="mt-3">
                  <Button variant="primary" icon={Plus} onClick={() => void dash.addTemplate(t.id)}>
                    Add
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function RunBadge({ run }: { run: WorkflowRunItem }): React.JSX.Element {
  const map = {
    running: { cls: 'text-sky-300 bg-sky-400/10', label: 'Running', icon: <Loader2 size={11} className="animate-spin" /> },
    done: { cls: 'text-emerald-300 bg-emerald-400/10', label: 'OK', icon: <Check size={11} /> },
    failed: { cls: 'text-rose-300 bg-rose-400/10', label: 'Failed', icon: <TriangleAlert size={11} /> },
    cancelled: { cls: 'text-zinc-400 bg-white/5', label: 'Stopped', icon: <X size={11} /> }
  }[run.status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-normal ${map.cls}`}>
      {map.icon} {map.label}
    </span>
  )
}

function WorkflowDetail({ wf, onBack }: { wf: WorkflowInfo; onBack: () => void }): React.JSX.Element {
  const [runs, setRuns] = useState<WorkflowRunItem[]>([])
  const [openRun, setOpenRun] = useState<string | null>(null)
  const load = useCallback(() => void dash.workflowRuns(wf.name).then(setRuns), [wf.name])

  useEffect(() => {
    load()
    return dash.onChanged((w) => w === 'workflows' && load())
  }, [load])

  useEffect(() => {
    if (!openRun && runs[0]) setOpenRun(runs[0].id)
  }, [runs, openRun])

  return (
    <>
      <div className="mb-4">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
          Workflows
        </Button>
      </div>
      <PageHeader
        title={wf.name}
        subtitle={`${wf.description ? wf.description + '. ' : ''}${wf.schedule}, ${wf.stepCount} step${wf.stepCount === 1 ? '' : 's'}.`}
        actions={
          <>
            <Button icon={FileCode} onClick={() => void dash.editWorkflow(wf.name)}>
              Edit YAML
            </Button>
            <Button variant="primary" icon={Play} onClick={() => void dash.runWorkflow(wf.name)} disabled={runs[0]?.status === 'running'}>
              Run now
            </Button>
          </>
        }
      />
      {wf.webhookUrl && (
        <Card className="mb-4 px-4 py-3 text-xs text-zinc-400">
          Webhook URL (works from this PC only):
          <code className="mt-1 block rounded bg-black/30 px-2 py-1 font-mono text-[11px] break-all text-zinc-300 select-all">{wf.webhookUrl}</code>
        </Card>
      )}
      {wf.triggerError && <p className="mb-4 text-sm text-amber-300">Trigger problem: {wf.triggerError}</p>}
      {runs.length === 0 ? (
        <Empty icon={Clock} title="Hasn't run yet">
          {wf.nextRun ? `First run ${new Date(wf.nextRun).toLocaleString()}.` : 'Click Run now to try it.'}
        </Empty>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <Card key={r.id}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpenRun(openRun === r.id ? null : r.id)}>
                <RunBadge run={r} />
                <span className="text-sm text-zinc-200">{new Date(r.started_at).toLocaleString()}</span>
                <span className="text-xs text-zinc-500">
                  {{ schedule: 'on schedule', missed: 'caught up after being missed', event: 'started by its trigger', manual: 'run by you' }[r.trigger]}
                  {r.finished_at && ` · took ${Math.max(1, Math.round((+new Date(r.finished_at) - +new Date(r.started_at)) / 1000))}s`}
                </span>
                <span className="flex-1" />
                {r.status === 'running' && (
                  <span onClick={(e) => e.stopPropagation()}>
                    <Button variant="danger" icon={Square} onClick={() => void dash.cancelWorkflowRun(r.id)}>
                      Stop
                    </Button>
                  </span>
                )}
                <ChevronDown size={16} className={`text-zinc-500 transition-transform ${openRun === r.id ? 'rotate-180' : ''}`} />
              </button>
              {openRun === r.id && <RunDetail run={r} />}
            </Card>
          ))}
        </div>
      )}
      <div className="mt-8">
        <Button variant="danger" icon={Trash2} onClick={() => void dash.deleteWorkflow(wf.name).then(onBack)}>
          Delete workflow
        </Button>
      </div>
    </>
  )
}

function RunDetail({ run }: { run: WorkflowRunItem }): React.JSX.Element {
  const [steps, setSteps] = useState<WorkflowStepItem[]>([])
  const [openStep, setOpenStep] = useState<string | null>(null)

  useEffect(() => {
    void dash.workflowSteps(run.id).then(setSteps)
    return dash.onChanged((w) => w === 'workflows' && void dash.workflowSteps(run.id).then(setSteps))
  }, [run.id])

  return (
    <div className="border-t border-white/[0.06] px-4 py-4">
      {run.error && <p className="mb-3 text-sm text-rose-300">{run.error}</p>}
      {steps.length > 0 && (
        <div className="mb-4 space-y-1">
          {steps.map((s) => (
            <div key={s.step_id}>
              <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/[0.03]" onClick={() => setOpenStep(openStep === s.step_id ? null : s.step_id)}>
                <StepIcon status={s.status} />
                <span className="text-zinc-200">{s.step_id}</span>
                <span className="text-zinc-600">{s.kind}</span>
                {s.attempts > 1 && <span className="text-amber-300/80">{s.attempts} tries</span>}
                {s.error && <span className="truncate text-rose-300/80">{s.error}</span>}
              </button>
              {openStep === s.step_id && (
                <div className="mt-1 mb-2 ml-6 grid gap-2 text-xs">
                  {s.input && <Block label="Input" text={s.input} />}
                  {s.output && <Block label="Output" text={s.output} />}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {run.output && (
        <div className="rounded-lg bg-black/20 p-4 text-sm">
          <Markdown text={run.output} />
        </div>
      )}
    </div>
  )
}

function Block({ label, text }: { label: string; text: string }): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 text-zinc-500">{label}</div>
      <pre className="max-h-56 overflow-auto rounded-md bg-black/30 p-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-400">{text}</pre>
    </div>
  )
}

function StepIcon({ status }: { status: WorkflowStepItem['status'] }): React.JSX.Element {
  if (status === 'running') return <Loader2 size={13} className="animate-spin text-sky-300" />
  if (status === 'done') return <Check size={13} className="text-emerald-400" />
  if (status === 'failed') return <X size={13} className="text-rose-400" />
  return <span className="w-[13px] text-center text-zinc-600">–</span>
}
