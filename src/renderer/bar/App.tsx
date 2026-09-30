import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AppWindow,
  ArrowUp,
  Bell,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  Globe,
  Loader2,
  Mic,
  Plus,
  ScanText,
  ShieldAlert,
  Square,
  TextQuote,
  TriangleAlert,
  Wrench,
  X,
  type LucideIcon
} from 'lucide-react'
import type { ApprovalRequest, BarEvent, ContextItem } from '@shared/types'
import { Markdown } from './Markdown'
import { Recorder } from './recorder'

const api = window.orbit
const recorder = new Recorder()

type ToolRow = { id: string; name: string; input: unknown; output?: string; isError?: boolean }
type Assistant = { kind: 'assistant'; id: string; text: string; tools: ToolRow[]; error?: string; done: boolean; canPaste: boolean }
type Entry =
  | { kind: 'user'; id: string; text: string; context: ContextItem[] }
  | Assistant
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string; action?: { label: string; command: string } }
  | { kind: 'progress'; id: string; label: string; value: number; done?: boolean }

export function App(): React.JSX.Element {
  const [context, setContext] = useState<ContextItem[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoSubmitMs = useRef<number | null>(null)
  const awaitingTranscript = useRef(false)
  const submitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const state = useRef({ input, context, busy })
  state.current = { input, context, busy }

  const updateAssistant = useCallback((id: string, fn: (e: Assistant) => Assistant) => {
    setEntries((all) => all.map((e) => (e.kind === 'assistant' && e.id === id ? fn(e) : e)))
  }, [])

  const newChat = (): void => {
    api.newChat()
    setEntries([])
    setApprovals([])
    inputRef.current?.focus()
  }

  const close = (): void => {
    clearTimeout(submitTimer.current)
    awaitingTranscript.current = false
    api.hide()
  }

  const submit = useCallback(async () => {
    clearTimeout(submitTimer.current)
    awaitingTranscript.current = false
    const { input: text, context: ctx, busy: isBusy } = state.current
    if (!text.trim() || isBusy) return
    setInput('')
    const { turnId } = await api.submit(text, ctx)
    if (!turnId) return // handled locally (slash command)
    const canPaste = ctx.some((c) => c.kind === 'selection')
    setEntries((all) => [
      ...all,
      { kind: 'user', id: `u-${turnId}`, text, context: ctx },
      { kind: 'assistant', id: turnId, text: '', tools: [], done: false, canPaste }
    ])
    setContext([])
    setBusy(true)
  }, [])

  useEffect(() => {
    return api.onEvent((ev: BarEvent) => {
      switch (ev.type) {
        case 'open':
          setContext(ev.context)
          autoSubmitMs.current = ev.autoSubmitMs
          setTimeout(() => inputRef.current?.focus(), 0)
          break
        case 'context-add':
          setContext((c) => [...c, ev.item])
          break
        case 'listening':
          setListening(ev.value)
          if (ev.value) awaitingTranscript.current = true
          break
        case 'approval':
          setApprovals((a) => [...a, ev.request])
          break
        case 'notice':
          setEntries((all) => [
            ...all,
            { kind: 'notice', id: crypto.randomUUID(), level: ev.level, text: ev.text, action: ev.action }
          ])
          break
        case 'progress':
          setEntries((all) =>
            all.some((e) => e.id === ev.id)
              ? all.map((e) => (e.id === ev.id ? { ...ev, kind: 'progress' } : e))
              : [...all, { ...ev, kind: 'progress' }]
          )
          break
        case 'record':
          awaitingTranscript.current = false
          if (ev.value) {
            recorder.start().catch((err: Error) => {
              api.voiceEnded()
              setEntries((all) => [
                ...all,
                { kind: 'notice', id: crypto.randomUUID(), level: 'error', text: `Microphone unavailable: ${err.message}` }
              ])
            })
          } else void finishRecording(ev.discard === true)
          break
        case 'reset':
          setEntries([])
          setApprovals([])
          setContext([])
          setBusy(false)
          break
        case 'agent': {
          const e = ev.event
          if (e.type === 'text') updateAssistant(ev.turnId, (a) => ({ ...a, text: a.text + e.delta }))
          else if (e.type === 'tool-call')
            updateAssistant(ev.turnId, (a) => ({ ...a, tools: [...a.tools, { id: e.id, name: e.name, input: e.input }] }))
          else if (e.type === 'tool-result')
            updateAssistant(ev.turnId, (a) => ({
              ...a,
              tools: a.tools.map((t) => (t.id === e.id ? { ...t, output: e.output, isError: e.isError } : t))
            }))
          else if (e.type === 'error' || e.type === 'rate-limit')
            updateAssistant(ev.turnId, (a) => ({ ...a, error: [a.error, e.message].filter(Boolean).join('\n') }))
          else if (e.type === 'done') {
            updateAssistant(ev.turnId, (a) => ({ ...a, done: true }))
            setBusy(false)
          }
          break
        }
      }
    })
  }, [updateAssistant])

  // Grow/shrink the window to fit content.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => api.resize(el.scrollHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries, approvals])

  /** Local engine: stop the mic, transcribe on-device, drop the text into the input. */
  const finishRecording = async (discard: boolean): Promise<void> => {
    const samples = await recorder.stop()
    if (discard || samples.length === 0) return
    setTranscribing(true)
    try {
      const text = await api.transcribe(samples)
      if (!text) return
      const next = state.current.input.trim() ? `${state.current.input.trimEnd()} ${text}` : text
      setInput(next)
      state.current.input = next
      inputRef.current?.focus()
      if (autoSubmitMs.current !== null) submitTimer.current = setTimeout(() => void submit(), autoSubmitMs.current)
    } catch (err) {
      setEntries((all) => [
        ...all,
        { kind: 'notice', id: crypto.randomUUID(), level: 'error', text: `Transcription failed: ${(err as Error).message}` }
      ])
    } finally {
      setTranscribing(false)
    }
  }

  const onInputChange = (value: string): void => {
    setInput(value)
    // Dictation engines type/paste the transcript into the focused input.
    if (awaitingTranscript.current && value.trim()) {
      if (listening) api.voiceEnded()
      clearTimeout(submitTimer.current)
      if (autoSubmitMs.current !== null) submitTimer.current = setTimeout(() => void submit(), autoSubmitMs.current)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape') {
      close()
    } else if (e.key.toLowerCase() === 'n' && e.ctrlKey) {
      e.preventDefault()
      newChat()
    } else {
      // Manual typing cancels a pending voice auto-submit.
      clearTimeout(submitTimer.current)
      awaitingTranscript.current = false
    }
  }

  const decide = (id: string, ok: boolean): void => {
    api.approve(id, ok)
    setApprovals((a) => a.filter((r) => r.id !== id))
  }

  const hasThread = entries.length > 0 || approvals.length > 0

  return (
    <div ref={rootRef} className="p-2">
      <div className="bar-surface overflow-hidden rounded-2xl text-zinc-100">
        {hasThread && (
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
            <span className="text-[11px] font-medium tracking-wide text-zinc-500">ORBIT</span>
            <div className="flex items-center gap-0.5">
              <IconButton icon={Plus} label="New chat (Ctrl+N)" onClick={newChat} />
              <IconButton icon={X} label="Close (Esc)" onClick={close} />
            </div>
          </div>
        )}

        {hasThread && (
          <div ref={scrollRef} className="max-h-[440px] space-y-4 overflow-y-auto px-4 py-3 text-[13.5px] leading-relaxed">
            {entries.map((e) => (
              <EntryView key={e.id} entry={e} />
            ))}
            {approvals.map((r) => (
              <ApprovalCard key={r.id} req={r} onDecide={decide} />
            ))}
          </div>
        )}

        <div className={hasThread ? 'border-t border-white/[0.06]' : ''}>
          {context.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
              {context.map((c) => (
                <Chip key={c.id} item={c} onRemove={() => setContext((all) => all.filter((x) => x.id !== c.id))} />
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 px-2.5 py-2">
            <button
              title={listening ? 'Stop dictation' : 'Dictate'}
              aria-label={listening ? 'Stop dictation' : 'Dictate'}
              onClick={() => api.toggleVoice()}
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${
                listening ? 'listening bg-rose-500 text-white' : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-100'
              }`}
            >
              {transcribing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                listening
                  ? 'Listening… press the hotkey again to stop'
                  : transcribing
                    ? 'Transcribing…'
                    : hasThread
                      ? 'Ask a follow-up…'
                      : 'Ask anything…'
              }
              className="max-h-40 flex-1 resize-none bg-transparent py-1 text-[15px] outline-none placeholder:text-zinc-500"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            <IconButton icon={ScanText} label="Screenshot & ask" onClick={() => api.requestScreenshot()} />
            {busy ? (
              <button
                title="Stop"
                aria-label="Stop"
                onClick={() => api.cancel()}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-900 hover:bg-white"
              >
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                title="Send (Enter)"
                aria-label="Send"
                onClick={() => void submit()}
                disabled={!input.trim()}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-500 text-white transition-opacity hover:bg-sky-400 disabled:opacity-30"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
            {!hasThread && <IconButton icon={X} label="Close (Esc)" onClick={close} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function IconButton(props: { icon: LucideIcon; label: string; onClick: () => void }): React.JSX.Element {
  const Icon = props.icon
  return (
    <button
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
    >
      <Icon size={16} />
    </button>
  )
}

function Chip({ item, onRemove }: { item: ContextItem; onRemove: () => void }): React.JSX.Element {
  let icon: React.ReactNode
  let label: string
  if (item.kind === 'window') {
    icon = <AppWindow size={13} className="shrink-0 text-sky-300" />
    label = `${item.app.replace(/\.exe$/i, '')} · ${item.title}`
  } else if (item.kind === 'selection') {
    icon = <TextQuote size={13} className="shrink-0 text-amber-300" />
    label = item.text.replace(/\s+/g, ' ')
  } else {
    icon = <img src={`data:${item.mediaType};base64,${item.base64}`} className="h-4 w-6 shrink-0 rounded-sm object-cover" alt="" />
    label = `Screenshot ${item.width}×${item.height}`
  }
  return (
    <span className="group flex max-w-[320px] items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] py-1 pr-1 pl-2 text-xs text-zinc-300">
      {icon}
      <span className="truncate">{label}</span>
      <button onClick={onRemove} title="Remove" aria-label="Remove context" className="rounded p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-200">
        <X size={12} />
      </button>
    </span>
  )
}

const TOOL_ICONS: Record<string, LucideIcon> = { web_search: Globe, web_fetch: Globe, notify: Bell }

function EntryView({ entry }: { entry: Entry }): React.JSX.Element {
  if (entry.kind === 'notice') {
    const error = entry.level === 'error'
    const action = entry.action
    return (
      <div className={`flex items-center gap-2 text-xs ${error ? 'text-rose-300' : 'text-zinc-300'}`}>
        {error ? <TriangleAlert size={14} className="shrink-0" /> : <Check size={14} className="shrink-0 text-emerald-400" />}
        <span className="flex-1">{entry.text}</span>
        {action && (
          <ActionButton icon={Download} onClick={() => void window.orbit.submit(action.command, [])}>
            {action.label}
          </ActionButton>
        )}
      </div>
    )
  }
  if (entry.kind === 'progress') {
    return (
      <div className="space-y-1.5 text-xs text-zinc-300">
        <div className="flex justify-between">
          <span className="flex items-center gap-2">
            {entry.done ? <Check size={14} className="text-emerald-400" /> : <Loader2 size={14} className="animate-spin text-sky-300" />}
            {entry.label}
          </span>
          {!entry.done && <span className="text-zinc-500 tabular-nums">{Math.round(entry.value * 100)}%</span>}
        </div>
        {!entry.done && (
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-sky-400 transition-[width]" style={{ width: `${entry.value * 100}%` }} />
          </div>
        )}
      </div>
    )
  }
  if (entry.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.07] px-3 py-1.5 whitespace-pre-wrap text-zinc-200">
          {entry.text}
        </div>
      </div>
    )
  }

  const a = entry
  return (
    <div className="space-y-2" data-state={a.done ? 'done' : 'running'}>
      {a.tools.length > 0 && (
        <div className="space-y-1">
          {a.tools.map((t) => {
            const Icon = TOOL_ICONS[t.name] ?? Wrench
            return (
              <div key={t.id} className="flex items-center gap-2 text-xs text-zinc-400">
                {t.output === undefined ? (
                  <Loader2 size={13} className="shrink-0 animate-spin text-sky-300" />
                ) : t.isError ? (
                  <X size={13} className="shrink-0 text-rose-400" />
                ) : (
                  <Check size={13} className="shrink-0 text-emerald-400" />
                )}
                <Icon size={13} className="shrink-0 text-zinc-500" />
                <span className="text-zinc-300">{t.name}</span>
                <span className="truncate text-zinc-500">{toolSummary(t.input)}</span>
              </div>
            )
          })}
        </div>
      )}
      {a.text ? (
        <Markdown text={a.text} />
      ) : (
        !a.done &&
        !a.error && (
          <div className="flex items-center gap-2 text-zinc-500">
            <Loader2 size={14} className="animate-spin" /> Thinking…
          </div>
        )
      )}
      {a.error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-2.5 py-1.5 text-xs whitespace-pre-wrap text-rose-300">
          <TriangleAlert size={14} className="mt-px shrink-0" />
          {a.error}
        </div>
      )}
      {a.done && a.text && (
        <div className="flex gap-1.5">
          <CopyButton text={a.text} />
          {a.canPaste && (
            <ActionButton icon={ClipboardPaste} onClick={() => void window.orbit.replaceSelection(a.text)}>
              Paste back
            </ActionButton>
          )}
        </div>
      )}
    </div>
  )
}

function toolSummary(input: unknown): string {
  if (input && typeof input === 'object') {
    const first = Object.values(input as Record<string, unknown>).find((v) => typeof v === 'string')
    if (typeof first === 'string') return first
  }
  return ''
}

function ActionButton(props: { icon: LucideIcon; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  const Icon = props.icon
  return (
    <button
      onClick={props.onClick}
      className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/10 hover:text-zinc-100"
    >
      <Icon size={13} />
      {props.children}
    </button>
  )
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <ActionButton
      icon={copied ? Check : Copy}
      onClick={() => {
        window.orbit.copy(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </ActionButton>
  )
}

function ApprovalCard(props: { req: ApprovalRequest; onDecide: (id: string, ok: boolean) => void }): React.JSX.Element {
  const { req, onDecide } = props
  return (
    <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3">
      <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-amber-300">
        <ShieldAlert size={14} /> APPROVAL NEEDED · {req.tool}
      </div>
      <div className="mt-1.5 text-sm text-zinc-100">{req.title}</div>
      <dl className="mt-2 max-h-48 space-y-1.5 overflow-auto rounded-lg bg-black/30 p-2.5 text-xs">
        {Object.entries((req.input ?? {}) as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[72px_1fr] gap-2">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="whitespace-pre-wrap break-words text-zinc-200">
              {typeof v === 'string' ? v : JSON.stringify(v, null, 2)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={() => onDecide(req.id, true)}
          className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1 text-xs font-medium text-zinc-950 hover:bg-amber-300"
        >
          <Check size={13} /> Approve
        </button>
        <button
          onClick={() => onDecide(req.id, false)}
          className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10"
        >
          <X size={13} /> Deny
        </button>
      </div>
    </div>
  )
}
