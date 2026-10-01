import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AppWindow,
  ArrowUp,
  Bell,
  ArrowRight,
  Brain,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  FileText,
  Globe,
  LayoutDashboard,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  Mic,
  Paperclip,
  Plus,
  RotateCcw,
  ScanText,
  ShieldAlert,
  Square,
  Volume2,
  VolumeX,
  TextQuote,
  TriangleAlert,
  Wrench,
  X,
  type LucideIcon
} from 'lucide-react'
import type { ApprovalRequest, BarEvent, ContextItem, MadeFileState } from '@shared/types'

type QuickAction = Extract<BarEvent, { type: 'open' }>['quickActions'][number]
type Question = Extract<BarEvent, { type: 'question' }>['question']
import { Markdown } from './Markdown'
import { attachFiles } from './attach'
import { Recorder } from './recorder'
import { PcmPlayer, SentenceSplitter } from './player'

const api = window.orbit
const recorder = new Recorder()
const player = new PcmPlayer()
/** Whether spoken replies are on; answers show a Read aloud button when they are. */
let speechOn = false

type ToolRow = { id: string; name: string; input: unknown; output?: string; isError?: boolean }
type Assistant = { kind: 'assistant'; id: string; text: string; tools: ToolRow[]; error?: string; done: boolean; canPaste: boolean; note?: string }
type Entry =
  | { kind: 'user'; id: string; text: string; context: ContextItem[] }
  | Assistant
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string; action?: { label: string; command: string } }
  | { kind: 'progress'; id: string; label: string; value: number; done?: boolean }
  | { kind: 'suggestion'; id: string; text: string; state: 'open' | 'saved' | 'dismissed' }

export function App(): React.JSX.Element {
  const [context, setContext] = useState<ContextItem[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [quickActions, setQuickActions] = useState<QuickAction[]>([])
  const [speaking, setSpeaking] = useState(false)
  const speakMode = useRef<'off' | 'voice' | 'always'>('off')
  /** The turn currently being read aloud as it streams, with its sentence splitter. */
  const reading = useRef<{ turnId: string; splitter: SentenceSplitter } | null>(null)
  /** Set when a question came from voice, so its answer is spoken. */
  const spokenQuestion = useRef(false)
  /** Turns whose finished answer should be pasted over the selection or copied. */
  const pendingOutput = useRef(new Map<string, 'replace' | 'copy'>())
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  /** Set while the input holds an edit of the last message. */
  const [editing, setEditing] = useState(false)
  const [models, setModels] = useState<{ current: string; options: { ref: string; label: string }[] }>({ current: '', options: [] })
  const loadModels = (): void => void api.models().then(setModels)
  const [projects, setProjects] = useState<{ current: string; options: { id: string; name: string }[] }>({ current: '', options: [] })
  const loadProjects = (): void => void api.projects().then(setProjects)
  useEffect(() => {
    // The picker's Cancel button fires a native "cancel" event that React doesn't expose.
    const el = fileRef.current
    const onCancel = (): void => {
      api.keepOpen(false)
      inputRef.current?.focus()
    }
    el?.addEventListener('cancel', onCancel)
    return () => el?.removeEventListener('cancel', onCancel)
  }, [])
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoSubmitMs = useRef<number | null>(null)
  const awaitingTranscript = useRef(false)
  const submitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const state = useRef({ input, context, busy, editing, entries })
  state.current = { input, context, busy, editing, entries }

  const updateAssistant = useCallback((id: string, fn: (e: Assistant) => Assistant) => {
    setEntries((all) => all.map((e) => (e.kind === 'assistant' && e.id === id ? fn(e) : e)))
  }, [])

  const newChat = (): void => {
    api.stopSpeaking()
    api.newChat()
    setEntries([])
    setApprovals([])
    setEditing(false)
    setTimeout(loadModels, 0)
    inputRef.current?.focus()
  }

  const close = (): void => {
    clearTimeout(submitTimer.current)
    awaitingTranscript.current = false
    api.hide()
  }

  const submit = useCallback(async (override?: { text: string; output: QuickAction['output'] }) => {
    clearTimeout(submitTimer.current)
    awaitingTranscript.current = false
    const { input: typed, context: ctx, busy: isBusy } = state.current
    const text = override?.text ?? typed
    if (!text.trim() || isBusy) return
    if (state.current.editing && !override) {
      setInput('')
      setEditing(false)
      void redo(text)
      return
    }
    if (!override) setInput('')
    api.stopSpeaking()
    const { turnId } = await api.submit(text, ctx, override ? { quick: true } : undefined)
    if (turnId && override && override.output !== 'popup') pendingOutput.current.set(turnId, override.output)
    const readThis = speakMode.current === 'always' || (speakMode.current === 'voice' && spokenQuestion.current)
    spokenQuestion.current = false
    if (turnId && readThis && !override) reading.current = { turnId, splitter: new SentenceSplitter() }
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
          speakMode.current = ev.speak ?? 'off'
          speechOn = speakMode.current !== 'off'
          setContext(ev.context)
          setQuickActions(ev.quickActions ?? [])
          loadModels()
          loadProjects()
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
        case 'question':
          setQuestions((q) => [...q, ev.question])
          break
        case 'audio':
          player.push(ev.pcm, ev.rate)
          setSpeaking(true)
          break
        case 'audio-stop':
          player.stop()
          reading.current = null
          setSpeaking(false)
          break
        case 'memory-suggestion':
          setEntries((all) => [...all, { kind: 'suggestion', id: ev.id, text: ev.text, state: 'open' }])
          break
        case 'restore':
          setEntries([
            { kind: 'notice', id: 'restored', level: 'info', text: `Continuing "${ev.title}"` },
            ...ev.messages.map((m, i): Entry =>
              m.role === 'user'
                ? { kind: 'user', id: `r-u-${i}`, text: m.text, context: [] }
                : { kind: 'assistant', id: `r-a-${i}`, text: m.text, tools: [], done: true, canPaste: false }
            )
          ])
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
          if (e.type === 'text') {
            updateAssistant(ev.turnId, (a) => ({ ...a, text: a.text + e.delta }))
            if (reading.current?.turnId === ev.turnId) for (const s of reading.current.splitter.push(e.delta)) api.speak(s)
          }
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
            if (reading.current?.turnId === ev.turnId) {
              for (const s of reading.current.splitter.flush()) api.speak(s)
              reading.current = null
            }
            updateAssistant(ev.turnId, (a) => {
              // Quick actions set to replace or copy act on the finished answer by themselves.
              const mode = pendingOutput.current.get(ev.turnId)
              pendingOutput.current.delete(ev.turnId)
              if (mode && a.text.trim() && !a.error) {
                if (mode === 'replace') void api.replaceSelection(a.text.trim())
                else api.copy(a.text.trim())
              }
              return { ...a, done: true, note: mode === 'copy' && a.text.trim() ? 'Copied to your clipboard' : undefined }
            })
            setBusy(false)
          }
          break
        }
      }
    })
  }, [updateAssistant])

  useEffect(() => {
    player.onEnded = () => setSpeaking(false)
  }, [])

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
      spokenQuestion.current = true
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
      spokenQuestion.current = true
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
      if (state.current.editing) {
        setEditing(false)
        setInput('')
      } else close()
    } else if (e.key.toLowerCase() === 'n' && e.ctrlKey) {
      e.preventDefault()
      newChat()
    } else {
      // Manual typing cancels a pending voice auto-submit.
      clearTimeout(submitTimer.current)
      awaitingTranscript.current = false
      spokenQuestion.current = false
    }
  }

  const decide = (id: string, decision: 'once' | 'chat' | 'deny'): void => {
    api.approve(id, decision)
    setApprovals((a) => a.filter((r) => r.id !== id))
  }

  /** Replaces the last exchange: Retry sends the same text again, Edit sends the new text. */
  const redo = async (text: string): Promise<void> => {
    const all = state.current.entries
    const at = all.findLastIndex((e) => e.kind === 'user')
    if (at < 0 || state.current.busy) return
    const last = all[at] as Extract<Entry, { kind: 'user' }>
    api.stopSpeaking()
    setEntries(all.slice(0, at))
    const { turnId } = await api.rewind(text, last.context)
    setEntries((now) => [
      ...now,
      { kind: 'user', id: `u-${turnId}`, text, context: last.context },
      { kind: 'assistant', id: turnId, text: '', tools: [], done: false, canPaste: last.context.some((c) => c.kind === 'selection') }
    ])
    setBusy(true)
  }

  const startEdit = (text: string): void => {
    setEditing(true)
    setInput(text)
    setTimeout(() => {
      const el = inputRef.current
      el?.focus()
      el?.setSelectionRange(text.length, text.length)
    }, 0)
  }

  const addFiles = async (files: File[]): Promise<void> => {
    if (!files.length) return
    const { items, errors } = await attachFiles(files)
    if (items.length) setContext((c) => [...c, ...items])
    if (errors.length) {
      setEntries((all) => [...all, ...errors.map((text) => ({ kind: 'notice' as const, id: crypto.randomUUID(), level: 'error' as const, text: `Couldn't attach ${text}` }))])
    }
    inputRef.current?.focus()
  }

  const onPaste = (e: React.ClipboardEvent): void => {
    const files = [...e.clipboardData.files]
    if (!files.length) return
    e.preventDefault()
    void addFiles(files)
  }

  const pickFiles = (): void => {
    api.keepOpen(true)
    fileRef.current?.click()
  }

  const hasThread = entries.length > 0 || approvals.length > 0 || questions.length > 0
  const lastUser = entries.findLast((e) => e.kind === 'user')
  const lastUserId = lastUser?.id
  const lastUserText = lastUser?.kind === 'user' ? lastUser.text : ''
  const lastAssistantId = entries.findLast((e) => e.kind === 'assistant')?.id

  return (
    <div
      ref={rootRef}
      className="p-2"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void addFiles([...e.dataTransfer.files])
      }}
    >
      <div className={`bar-surface relative overflow-hidden rounded-2xl text-zinc-100 ${dragging ? 'ring-2 ring-sky-400/60' : ''}`}>
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-zinc-950/70 text-sm text-sky-200">Drop to attach</div>
        )}
        {hasThread && (
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
            <span className="text-[11px] font-medium tracking-wide text-zinc-500">ORBIT</span>
            <div className="flex items-center gap-0.5">
              <IconButton icon={LayoutDashboard} label="Dashboard" onClick={() => api.openDashboard()} />
              <IconButton icon={Plus} label="New chat (Ctrl+N)" onClick={newChat} />
              <IconButton icon={X} label="Close (Esc)" onClick={close} />
            </div>
          </div>
        )}

        {hasThread && (
          <div ref={scrollRef} className="max-h-[440px] space-y-4 overflow-y-auto px-4 py-3 text-[13.5px] leading-relaxed">
            {entries.map((e) =>
              e.kind === 'suggestion' ? (
                <SuggestionChip
                  key={e.id}
                  entry={e}
                  onDecide={(save) => {
                    if (save) void api.saveMemory(e.text)
                    setEntries((all) => all.map((x) => (x.id === e.id ? { ...e, state: save ? 'saved' : 'dismissed' } : x)))
                  }}
                />
              ) : (
                <EntryView
                  key={e.id}
                  entry={e}
                  onRetry={!busy && e.id === lastAssistantId ? () => void redo(lastUserText) : undefined}
                  onEdit={!busy && !editing && e.kind === 'user' && e.id === lastUserId ? () => startEdit(e.text) : undefined}
                />
              )
            )}
            {approvals.map((r) => (
              <ApprovalCard key={r.id} req={r} onDecide={decide} />
            ))}
            {questions.map((q) => (
              <QuestionCard
                key={q.id}
                q={q}
                onAnswer={(text) => {
                  api.answer(q.id, text)
                  setQuestions((all) => all.filter((x) => x.id !== q.id))
                }}
              />
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
          {!busy && context.some((c) => c.kind === 'selection') && quickActions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2" data-testid="quick-actions">
              {quickActions.map((q) => (
                <button
                  key={q.label}
                  onClick={() => void submit({ text: q.prompt, output: q.output })}
                  title={q.output === 'replace' ? 'Replaces your selection' : q.output === 'copy' ? 'Copies the result' : undefined}
                  className="rounded-full border border-sky-400/20 bg-sky-400/[0.06] px-2.5 py-1 text-xs text-sky-200 transition-colors hover:border-sky-400/50 hover:bg-sky-400/[0.12]"
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}

          {editing && (
            <div className="flex items-center gap-2 px-3 pt-2 text-xs text-sky-300">
              <Pencil size={12} />
              <span className="flex-1">Editing your last message. Enter sends it in place of the old one.</span>
              <button
                className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                onClick={() => {
                  setEditing(false)
                  setInput('')
                }}
              >
                Cancel
              </button>
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
              onPaste={onPaste}
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
            {speaking && <IconButton icon={VolumeX} label="Stop speaking" onClick={() => api.stopSpeaking()} />}
            {projects.options.length > 0 && (
              <select
                value={projects.current}
                disabled={busy}
                onChange={(e) => {
                  api.setProject(e.target.value)
                  setProjects((p) => ({ ...p, current: e.target.value }))
                  // A different project is a different conversation.
                  setEntries([])
                  setApprovals([])
                  setTimeout(loadModels, 0)
                  inputRef.current?.focus()
                }}
                title="Project"
                aria-label="Project"
                className="max-w-[130px] shrink-0 cursor-pointer truncate rounded-lg bg-transparent px-1.5 py-1 text-xs text-zinc-400 outline-none hover:bg-white/10 hover:text-zinc-100 disabled:opacity-50"
              >
                <option value="" className="bg-zinc-900 text-zinc-200">
                  No project
                </option>
                {projects.options.map((o) => (
                  <option key={o.id} value={o.id} className="bg-zinc-900 text-zinc-200">
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            {models.options.length > 1 && (
              <select
                value={models.current}
                disabled={busy}
                onChange={(e) => {
                  api.setModel(e.target.value)
                  setModels((m) => ({ ...m, current: e.target.value }))
                  inputRef.current?.focus()
                }}
                title="Model for this chat"
                aria-label="Model for this chat"
                className="max-w-[140px] shrink-0 cursor-pointer truncate rounded-lg bg-transparent px-1.5 py-1 text-xs text-zinc-400 outline-none hover:bg-white/10 hover:text-zinc-100 disabled:opacity-50"
              >
                {models.options.map((o) => (
                  <option key={o.ref} value={o.ref} className="bg-zinc-900 text-zinc-200">
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            <IconButton icon={Paperclip} label="Attach files" onClick={pickFiles} />
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              aria-label="Attach files"
              onChange={(e) => {
                api.keepOpen(false)
                void addFiles([...(e.target.files ?? [])])
                e.target.value = ''
              }}
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
  if (item.kind === 'url') {
    icon = <Globe size={13} className="shrink-0 text-emerald-300" />
    label = item.url.replace(/^https?:\/\/(www\.)?/, '')
  } else if (item.kind === 'window') {
    icon = <AppWindow size={13} className="shrink-0 text-sky-300" />
    label = `${item.app.replace(/\.exe$/i, '')} · ${item.title}`
  } else if (item.kind === 'selection') {
    icon = <TextQuote size={13} className="shrink-0 text-amber-300" />
    label = item.text.replace(/\s+/g, ' ')
  } else if (item.kind === 'file') {
    icon = <FileText size={13} className="shrink-0 text-violet-300" />
    label = `${item.name} · ${formatSize(item.size)}`
  } else {
    icon = <img src={`data:${item.mediaType};base64,${item.base64}`} className="h-4 w-6 shrink-0 rounded-sm object-cover" alt="" />
    label = item.name ?? `Screenshot ${item.width}×${item.height}`
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

const MAKES_FILES = new Set(['make_file', 'run_python', 'make_page'])

function MadeFile({ path: initial }: { path: string }): React.JSX.Element {
  const [path, setPath] = useState(initial)
  const [info, setInfo] = useState<MadeFileState | null>(null)
  useEffect(() => void window.orbit.fileState(initial).then(setInfo), [initial])
  const name = path.split(/[\\/]/).pop() ?? path
  const act = (action: 'open' | 'reveal' | 'save' | 'keep'): void =>
    void window.orbit.fileAction(path, action).then((r) => {
      setPath(r.path)
      setInfo(r.state)
    })
  const gone = info?.state === 'gone'
  const note = !info
    ? ''
    : gone
      ? 'cleaned up'
      : info.state === 'kept'
        ? 'kept'
        : info.savedTo
          ? `saved to ${info.savedTo.split(/[\\/]/).slice(-2, -1)[0] ?? 'your PC'}`
          : `temporary, ${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'} left`
  const btn = 'rounded px-1.5 py-0.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-100'
  return (
    <span className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] py-1 pr-1 pl-2 text-xs text-zinc-200" data-made-file={info?.state}>
      <FileText size={13} className={`shrink-0 ${gone ? 'text-zinc-600' : 'text-violet-300'}`} />
      <span className={`max-w-[220px] truncate ${gone ? 'text-zinc-500 line-through' : ''}`}>{name}</span>
      {note && <span className="text-zinc-500">{note}</span>}
      {!gone && (
        <>
          <button onClick={() => act('open')} className={btn}>
            Open
          </button>
          <button onClick={() => act('save')} className={btn} title="Save a copy somewhere on your PC">
            Save as…
          </button>
          {info?.state === 'temporary' && (
            <button onClick={() => act('keep')} className={btn} title="Move it to Orbit's files folder so it's never cleaned up">
              Keep
            </button>
          )}
          <button onClick={() => act('reveal')} className={btn}>
            Show in folder
          </button>
        </>
      )}
    </span>
  )
}

/** A unified diff, git style: removed lines red, added lines green, hunk headers dim. */
function DiffView({ text, className = '' }: { text: string; className?: string }): React.JSX.Element {
  return (
    <div className={`overflow-auto rounded-lg bg-black/40 py-1.5 font-mono text-[11px] leading-[1.45] ${className}`} data-diff>
      {text.split('\n').map((line, i) => {
        const cls = line.startsWith('+')
          ? 'bg-emerald-500/15 text-emerald-200'
          : line.startsWith('-')
            ? 'bg-rose-500/15 text-rose-200'
            : line.startsWith('@@')
              ? 'text-sky-300/70'
              : line.startsWith('Careful:')
                ? 'text-amber-300'
                : 'text-zinc-400'
        return (
          <div key={i} className={`px-2.5 whitespace-pre-wrap break-words ${cls}`}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const TOOL_ICONS: Record<string, LucideIcon> = { web_search: Globe, web_fetch: Globe, notify: Bell }

function EntryView({ entry, onRetry, onEdit }: { entry: Entry; onRetry?: () => void; onEdit?: () => void }): React.JSX.Element {
  if (entry.kind === 'notice') {
    const error = entry.level === 'error'
    const action = entry.action
    return (
      <div className={`flex items-center gap-2 text-xs ${error ? 'text-rose-300' : 'text-zinc-300'}`}>
        {error ? <TriangleAlert size={14} className="shrink-0" /> : <Check size={14} className="shrink-0 text-emerald-400" />}
        <span className="flex-1">{entry.text}</span>
        {action && (
          <ActionButton icon={action.command.startsWith('/install') ? Download : ArrowRight} onClick={() => void window.orbit.submit(action.command, [])}>
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
      <div className="group flex items-center justify-end gap-1">
        {onEdit && (
          <button
            onClick={onEdit}
            title="Edit"
            aria-label="Edit message"
            className="rounded p-1 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-zinc-200 focus:opacity-100"
          >
            <Pencil size={12} />
          </button>
        )}
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.07] px-3 py-1.5 whitespace-pre-wrap text-zinc-200">
          {entry.text}
        </div>
      </div>
    )
  }

  if (entry.kind === 'suggestion') return <></> // rendered by SuggestionChip
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
      {a.tools.some((t) => MAKES_FILES.has(t.name) && t.output && !t.isError) && (
        <div className="flex flex-wrap gap-1.5">
          {a.tools
            .filter((t) => MAKES_FILES.has(t.name) && !t.isError)
            .flatMap((t) => [...(t.output ?? '').matchAll(/^Saved (.+)$/gm)].map((m) => m[1]))
            .map((p) => (
              <MadeFile key={p} path={p} />
            ))}
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
      {a.note && <div className="flex items-center gap-1.5 text-xs text-emerald-300"><Check size={13} />{a.note}</div>}
      {a.done && !a.text && onRetry && (
        <ActionButton icon={RotateCcw} onClick={onRetry}>
          Retry
        </ActionButton>
      )}
      {a.done && a.text && (
        <div className="flex gap-1.5">
          <CopyButton text={a.text} />
          {onRetry && (
            <ActionButton icon={RotateCcw} onClick={onRetry}>
              Retry
            </ActionButton>
          )}
          {speechOn && (
            <ActionButton icon={Volume2} onClick={() => (window.orbit.stopSpeaking(), window.orbit.speak(a.text))}>
              Read aloud
            </ActionButton>
          )}
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

function SuggestionChip(props: { entry: Extract<Entry, { kind: 'suggestion' }>; onDecide: (save: boolean) => void }): React.JSX.Element {
  const { entry } = props
  if (entry.state === 'dismissed') return <></>
  return (
    <div className="flex items-center gap-2 rounded-lg border border-violet-400/20 bg-violet-400/[0.05] px-2.5 py-1.5 text-xs" data-testid="memory-suggestion">
      <Brain size={13} className="shrink-0 text-violet-300" />
      <span className="flex-1 text-zinc-200">
        {entry.state === 'saved' ? 'Saved: ' : 'Remember this? '}
        <span className="text-zinc-400">{entry.text}</span>
      </span>
      {entry.state === 'open' && (
        <>
          <button onClick={() => props.onDecide(true)} className="rounded-md bg-violet-500/80 px-2 py-0.5 text-white hover:bg-violet-500">
            Save
          </button>
          <button onClick={() => props.onDecide(false)} className="rounded-md px-2 py-0.5 text-zinc-400 hover:bg-white/10">
            No
          </button>
        </>
      )}
    </div>
  )
}

function QuestionCard(props: { q: Question; onAnswer: (text: string) => void }): React.JSX.Element {
  const [text, setText] = useState('')
  return (
    <div className="rounded-xl border border-sky-400/25 bg-sky-400/[0.05] p-3" data-testid="question">
      <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-sky-300">
        <MessageCircleQuestion size={14} /> QUESTION · {props.q.from}
      </div>
      <div className="mt-1.5 text-sm text-zinc-100">{props.q.question}</div>
      {props.q.options.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {props.q.options.map((o) => (
            <button key={o} onClick={() => props.onAnswer(o)} className="rounded-lg border border-sky-400/30 px-2.5 py-1 text-xs text-sky-100 hover:bg-sky-400/15">
              {o}
            </button>
          ))}
        </div>
      )}
      <form
        className="mt-2.5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) props.onAnswer(text.trim())
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Or type an answer"
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1 text-xs text-zinc-100 outline-none focus:border-sky-400/60"
        />
        <button type="submit" className="rounded-lg bg-sky-500 px-3 py-1 text-xs text-white hover:bg-sky-400">
          Send
        </button>
      </form>
    </div>
  )
}

function ApprovalCard(props: { req: ApprovalRequest; onDecide: (id: string, decision: 'once' | 'chat' | 'deny') => void }): React.JSX.Element {
  const { req, onDecide } = props
  return (
    <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3">
      <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-amber-300">
        <ShieldAlert size={14} /> APPROVAL NEEDED · {req.tool}
      </div>
      <div className="mt-1.5 text-sm text-zinc-100">{req.title}</div>
      {req.preview && req.previewKind === 'diff' ? (
        <DiffView text={req.preview} className="mt-2 max-h-72" />
      ) : req.preview ? (
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-black/30 p-2.5 font-sans text-xs break-words whitespace-pre-wrap text-zinc-200">{req.preview}</pre>
      ) : (
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
      )}
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={() => onDecide(req.id, 'once')}
          className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1 text-xs font-medium text-zinc-950 hover:bg-amber-300"
        >
          <Check size={13} /> Approve
        </button>
        {req.allowChat && (
          <button
            onClick={() => onDecide(req.id, 'chat')}
            title={`Don't ask again for ${req.tool} until this chat ends`}
            className="flex items-center gap-1.5 rounded-lg border border-amber-400/40 px-3 py-1 text-xs text-amber-200 hover:bg-amber-400/10"
          >
            Allow for this chat
          </button>
        )}
        <button
          onClick={() => onDecide(req.id, 'deny')}
          className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10"
        >
          <X size={13} /> Deny
        </button>
      </div>
    </div>
  )
}
