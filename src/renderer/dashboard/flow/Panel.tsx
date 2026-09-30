import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { Button, dash, inputClass, selectClass } from '../ui'
import { getAt, insertAt, KINDS, kindOf, moveAt, newStep, removeAt, setAt, type Draft, type Json, type Kind, type Path, type StepDraft } from './model'

export type Selection = { type: 'settings' } | { type: 'trigger' } | { type: 'step'; path: Path } | { type: 'insert'; listPath: Path }

type Tool = { name: string; description: string; sideEffect: boolean }
let toolCache: Promise<Tool[]> | undefined

function useTools(): Tool[] {
  const [tools, setTools] = useState<Tool[]>([])
  useEffect(() => {
    toolCache ??= dash.tools()
    void toolCache.then(setTools)
  }, [])
  return tools
}

type Props = { draft: Draft; selection: Selection; onChange: (d: Draft) => void; onSelect: (s: Selection) => void }

export function Panel(props: Props): React.JSX.Element {
  const { selection } = props
  if (selection.type === 'trigger') return <TriggerForm {...props} />
  if (selection.type === 'insert') return <InsertForm {...props} listPath={selection.listPath} />
  if (selection.type === 'step') {
    const step = getAt(props.draft, selection.path) as StepDraft | undefined
    if (step) return <StepForm {...props} step={step} path={selection.path} />
  }
  return <SettingsForm {...props} />
}

// ---- small form helpers ----------------------------------------------------------------------

function Field(props: { label: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="mb-3 block text-xs text-zinc-400">
      <span className="mb-1 block">{props.label}</span>
      {props.children}
      {props.hint && <span className="mt-1 block text-[11px] text-zinc-600">{props.hint}</span>}
    </label>
  )
}

function Text(props: { value: unknown; onChange: (v: string) => void; placeholder?: string; mono?: boolean }): React.JSX.Element {
  return (
    <input
      value={String(props.value ?? '')}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      className={`${inputClass} ${props.mono ? 'font-mono text-xs' : ''}`}
      spellCheck={false}
    />
  )
}

function Area(props: { value: unknown; onChange: (v: string) => void; rows?: number; mono?: boolean; placeholder?: string }): React.JSX.Element {
  return (
    <textarea
      rows={props.rows ?? 4}
      value={String(props.value ?? '')}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      className={`${inputClass} resize-y ${props.mono ? 'font-mono text-xs' : ''}`}
      spellCheck={false}
    />
  )
}

function Heading(props: { children: React.ReactNode; sub?: string }): React.JSX.Element {
  return (
    <div className="mb-4">
      <div className="text-sm font-medium text-zinc-100">{props.children}</div>
      {props.sub && <div className="mt-0.5 text-xs text-zinc-500">{props.sub}</div>}
    </div>
  )
}

const TEMPLATE_HINT = 'Use {{steps.<id>.output}}, {{trigger.…}}, {{item}}, {{date}}'

// ---- settings --------------------------------------------------------------------------------

function SettingsForm({ draft, onChange }: Props): React.JSX.Element {
  const set = (k: string, v: unknown): void => onChange(setAt(draft, [k], v === '' ? undefined : v))
  return (
    <>
      <Heading sub="Applies to the whole workflow">Settings</Heading>
      <Field label="Name" hint="Lowercase letters, numbers and dashes">
        <Text value={draft.name} onChange={(v) => onChange(setAt(draft, ['name'], v))} mono />
      </Field>
      <Field label="Description">
        <Text value={draft.description} onChange={(v) => set('description', v)} />
      </Field>
      <Field label="Model for steps that ask a model">
        <select value={String(draft.model ?? 'chat')} onChange={(e) => set('model', e.target.value)} className={selectClass}>
          <option value="quick">Quick</option>
          <option value="chat">Chat (default)</option>
          <option value="research">Research</option>
        </select>
      </Field>
      <Field label="If the PC was off at the scheduled time">
        <select value={String(draft.missed ?? 'ask')} onChange={(e) => set('missed', e.target.value)} className={selectClass}>
          <option value="ask">Ask me</option>
          <option value="run">Run it when Orbit starts</option>
          <option value="skip">Skip it</option>
        </select>
      </Field>
      <Field label="Result" hint="What the run returns and shows in its notification. Empty: the last step's output">
        <Text value={draft.output} onChange={(v) => set('output', v)} mono placeholder="{{steps.write.output}}" />
      </Field>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={draft.enabled !== false} onChange={(e) => set('enabled', e.target.checked ? undefined : false)} className="accent-sky-500" />
        Turned on
      </label>
    </>
  )
}

// ---- trigger ---------------------------------------------------------------------------------

const TRIGGERS = [
  { key: 'manual', label: 'When I run it', make: () => ({ manual: true }) },
  { key: 'cron', label: 'On a schedule', make: () => ({ cron: '0 9 * * 1-5' }) },
  { key: 'feed', label: 'New posts in a feed', make: () => ({ feed: { url: 'https://news.ycombinator.com/rss', every: '30m' } }) },
  { key: 'page', label: 'A web page changes', make: () => ({ page: { url: 'https://', every: '1h' } }) },
  { key: 'poll', label: "A tool's result changes", make: () => ({ poll: { tool: '', args: {}, every: '15m' } }) },
  { key: 'folder', label: 'A file lands in a folder', make: () => ({ folder: { path: 'C:/Users/me/Downloads', pattern: '*.pdf' } }) },
  { key: 'webhook', label: 'A webhook is called', make: () => ({ webhook: true }) }
]

const SCHEDULES = [
  ['Every day at 8:00', '0 8 * * *'],
  ['Weekdays at 9:00', '0 9 * * 1-5'],
  ['Mondays at 9:00', '0 9 * * 1'],
  ['Every hour', '0 * * * *']
]

function TriggerForm({ draft, onChange }: Props): React.JSX.Element {
  const tools = useTools()
  const t = (draft.trigger as Json) ?? { manual: true }
  const kind = Object.keys(t)[0] ?? 'manual'
  const inner = (t[kind] ?? {}) as Json
  const setInner = (k: string, v: unknown): void => onChange(setAt(draft, ['trigger', kind, k], v))
  return (
    <>
      <Heading sub="What starts a run">Trigger</Heading>
      <Field label="Starts">
        <select value={kind} onChange={(e) => onChange(setAt(draft, ['trigger'], TRIGGERS.find((x) => x.key === e.target.value)!.make()))} className={selectClass}>
          {TRIGGERS.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
      </Field>
      {kind === 'cron' && (
        <>
          <Field label="Cron pattern (minute hour day month weekday)">
            <Text value={t.cron} onChange={(v) => onChange(setAt(draft, ['trigger', 'cron'], v))} mono />
          </Field>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {SCHEDULES.map(([label, cron]) => (
              <button key={cron} onClick={() => onChange(setAt(draft, ['trigger', 'cron'], cron))} className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/5">
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {(kind === 'feed' || kind === 'page') && (
        <Field label={kind === 'feed' ? 'Feed URL (RSS or Atom)' : 'Page URL'}>
          <Text value={inner.url} onChange={(v) => setInner('url', v)} mono />
        </Field>
      )}
      {kind === 'page' && (
        <Field label="Only watch this part (CSS selector, optional)" hint="e.g. .price or #jobs">
          <Text value={inner.selector} onChange={(v) => setInner('selector', v || undefined)} mono />
        </Field>
      )}
      {kind === 'poll' && (
        <>
          <Field label="Read-only tool">
            <select value={String(inner.tool ?? '')} onChange={(e) => setInner('tool', e.target.value)} className={`${selectClass} w-full`}>
              <option value="">Pick a tool…</option>
              {tools.filter((x) => !x.sideEffect).map((x) => (
                <option key={x.name} value={x.name}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <JsonField label="Arguments" value={inner.args ?? {}} onChange={(v) => setInner('args', v)} />
        </>
      )}
      {(kind === 'feed' || kind === 'page' || kind === 'poll') && (
        <Field label="Check every" hint="e.g. 15m, 2h, 1d">
          <Text value={inner.every} onChange={(v) => setInner('every', v)} mono />
        </Field>
      )}
      {kind === 'folder' && (
        <>
          <Field label="Folder">
            <Text value={inner.path} onChange={(v) => setInner('path', v)} mono />
          </Field>
          <Field label="Files matching" hint="e.g. *.pdf or invoice-*">
            <Text value={inner.pattern} onChange={(v) => setInner('pattern', v)} mono />
          </Field>
        </>
      )}
      {kind === 'webhook' && <p className="text-xs text-zinc-500">After saving, the workflow's page shows the URL to call.</p>}
    </>
  )
}

// ---- insert ----------------------------------------------------------------------------------

function InsertForm({ draft, onChange, onSelect, listPath }: Props & { listPath: Path }): React.JSX.Element {
  const add = (kind: Kind): void => {
    const list = (getAt(draft, listPath) as StepDraft[] | undefined) ?? []
    const step = newStep(kind, draft)
    onChange(insertAt(draft, listPath, list.length, step))
    onSelect({ type: 'step', path: [...listPath, list.length] })
  }
  return (
    <>
      <Heading sub="Pick what the new step does">Add a step</Heading>
      <KindPicker onPick={add} />
    </>
  )
}

function KindPicker({ onPick }: { onPick: (k: Kind) => void }): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      {KINDS.map((k) => (
        <button key={k.kind} onClick={() => onPick(k.kind)} className="rounded-lg border border-white/10 px-3 py-2 text-left hover:border-sky-400/40 hover:bg-white/[0.03]">
          <div className="text-sm text-zinc-100">{k.label}</div>
          <div className="text-[11px] text-zinc-500">{k.hint}</div>
        </button>
      ))}
    </div>
  )
}

// ---- step ------------------------------------------------------------------------------------

function JsonField(props: { label: string; value: unknown; onChange: (v: unknown) => void }): React.JSX.Element {
  const [text, setText] = useState(JSON.stringify(props.value ?? {}, null, 2))
  const [bad, setBad] = useState(false)
  useEffect(() => setText(JSON.stringify(props.value ?? {}, null, 2)), [props.value])
  return (
    <Field label={props.label} hint={bad ? 'Not valid JSON yet' : TEMPLATE_HINT}>
      <textarea
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          try {
            props.onChange(JSON.parse(e.target.value))
            setBad(false)
          } catch {
            setBad(true)
          }
        }}
        className={`${inputClass} resize-y font-mono text-xs ${bad ? 'border-amber-400/50' : ''}`}
        spellCheck={false}
      />
    </Field>
  )
}

function StepForm({ draft, onChange, onSelect, step, path }: Props & { step: StepDraft; path: Path }): React.JSX.Element {
  const tools = useTools()
  const [adding, setAdding] = useState(false)
  const kind = kindOf(step)
  const set = (k: string, v: unknown): void => onChange(setAt(draft, [...path, k], v === '' ? undefined : v))
  const setIn = (obj: string, k: string, v: unknown): void => onChange(setAt(draft, [...path, obj, k], v === '' ? undefined : v))
  const tool = tools.find((t) => t.name === step.tool)
  const label = KINDS.find((k) => k.kind === kind)?.label

  const addAfter = (k: Kind): void => {
    const listPath = path.slice(0, -1)
    const i = (path[path.length - 1] as number) + 1
    onChange(insertAt(draft, listPath, i, newStep(k, draft)))
    onSelect({ type: 'step', path: [...listPath, i] })
    setAdding(false)
  }

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-2">
        <Heading sub={label}>{step.id}</Heading>
        <div className="flex shrink-0">
          <Button variant="ghost" icon={ArrowUp} title="Move up" onClick={() => { const r = moveAt(draft, path, -1); onChange(r.draft); onSelect({ type: 'step', path: r.path }) }} />
          <Button variant="ghost" icon={ArrowDown} title="Move down" onClick={() => { const r = moveAt(draft, path, 1); onChange(r.draft); onSelect({ type: 'step', path: r.path }) }} />
          <Button variant="danger" icon={Trash2} title="Delete step" onClick={() => { onChange(removeAt(draft, path)); onSelect({ type: 'settings' }) }} />
        </div>
      </div>

      <Field label="Step id" hint="Other steps use its result as {{steps.<id>.output}}">
        <Text value={step.id} onChange={(v) => onChange(setAt(draft, [...path, 'id'], v))} mono />
      </Field>

      {kind === 'tool' && (
        <>
          <Field label="Tool" hint={tool?.description}>
            <select value={String(step.tool ?? '')} onChange={(e) => set('tool', e.target.value)} className={`${selectClass} w-full`}>
              {!tool && step.tool ? <option value={String(step.tool)}>{String(step.tool)} (not available)</option> : null}
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <JsonField label="Arguments" value={step.args ?? {}} onChange={(v) => set('args', v)} />
          {tool?.sideEffect && (
            <label className="mb-3 flex items-start gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={step.approved === true} onChange={(e) => set('approved', e.target.checked || undefined)} className="mt-1 accent-sky-500" />
              <span>
                Run without asking
                <span className="block text-[11px] text-zinc-500">This tool changes things. Leave off to approve it every run.</span>
              </span>
            </label>
          )}
        </>
      )}

      {kind === 'agent' && (
        <>
          <Field label="Instructions">
            <Area value={step.agent} onChange={(v) => set('agent', v)} rows={6} />
          </Field>
          <Field label="Data for it" hint={TEMPLATE_HINT}>
            <Area value={step.input} onChange={(v) => set('input', v)} rows={3} mono />
          </Field>
          <Field label="Tools it may use" hint="None means it only writes text">
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2">
              {tools.map((t) => {
                const list = (step.tools as string[] | undefined) ?? []
                return (
                  <label key={t.name} className="flex items-center gap-2 text-[12px] text-zinc-300">
                    <input
                      type="checkbox"
                      checked={list.includes(t.name)}
                      onChange={(e) => set('tools', e.target.checked ? [...list, t.name] : list.filter((x) => x !== t.name))}
                      className="accent-sky-500"
                    />
                    {t.name}
                  </label>
                )
              })}
            </div>
          </Field>
        </>
      )}

      {kind === 'approval' && (
        <>
          <Field label="Title">
            <Text value={(step.approval as Json)?.title} onChange={(v) => setIn('approval', 'title', v)} />
          </Field>
          <Field label="What to show you" hint={TEMPLATE_HINT}>
            <Area value={(step.approval as Json)?.preview} onChange={(v) => setIn('approval', 'preview', v)} mono />
          </Field>
          <Field label="Wait at most" hint="e.g. 30m, 2h">
            <Text value={(step.approval as Json)?.timeout ?? '2h'} onChange={(v) => setIn('approval', 'timeout', v)} mono />
          </Field>
        </>
      )}

      {kind === 'code' && (
        <>
          <Field label="JavaScript (function body)" hint="Sees input, steps, item, index, trigger. Must return something. No network or files.">
            <Area value={step.code} onChange={(v) => set('code', v)} rows={8} mono />
          </Field>
          <Field label="input" hint={TEMPLATE_HINT}>
            <Text value={step.input} onChange={(v) => set('input', v)} mono />
          </Field>
        </>
      )}

      {kind === 'if' && (
        <>
          <Field label="Decide by">
            <select
              value={typeof step.if === 'object' ? 'ask' : 'value'}
              onChange={(e) => set('if', e.target.value === 'ask' ? { ask: 'Is this important?', input: '' } : '')}
              className={selectClass}
            >
              <option value="value">A value is present</option>
              <option value="ask">Asking a model yes or no</option>
            </select>
          </Field>
          {typeof step.if === 'object' ? (
            <>
              <Field label="Question">
                <Text value={(step.if as Json).ask} onChange={(v) => setIn('if', 'ask', v)} />
              </Field>
              <Field label="About" hint={TEMPLATE_HINT}>
                <Text value={(step.if as Json).input} onChange={(v) => setIn('if', 'input', v)} mono />
              </Field>
            </>
          ) : (
            <Field label="Yes when this isn't empty (or false / no / 0)" hint={TEMPLATE_HINT}>
              <Text value={step.if} onChange={(v) => onChange(setAt(draft, [...path, 'if'], v))} mono />
            </Field>
          )}
        </>
      )}

      {kind === 'foreach' && (
        <>
          <Field label="List" hint="A JSON list, a numbered list, or one item per line">
            <Text value={step.foreach} onChange={(v) => onChange(setAt(draft, [...path, 'foreach'], v))} mono />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="At most">
              <Text value={step.max ?? 20} onChange={(v) => set('max', Number(v) || undefined)} />
            </Field>
            <Field label="At once">
              <Text value={step.concurrency ?? 1} onChange={(v) => set('concurrency', Number(v) || undefined)} />
            </Field>
          </div>
        </>
      )}

      {kind === 'parallel' && <p className="mb-3 text-xs text-zinc-500">Steps under this one run at the same time. Click "Add a step to run alongside" on the canvas.</p>}

      <Field label="Only run when (optional)" hint="Skipped when this is empty, false, no or 0">
        <Text value={step.when} onChange={(v) => set('when', v)} mono />
      </Field>

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        {adding ? <KindPicker onPick={addAfter} /> : <Button onClick={() => setAdding(true)}>Add a step after this</Button>}
      </div>
    </>
  )
}
