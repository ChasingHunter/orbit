import { useCallback, useEffect, useState } from 'react'
import { Download, FileCog, FolderOpen, FolderPlus, Volume2, X } from 'lucide-react'
import type { DashSettings, PhoneInfo } from '@shared/dash'
import { Button, Card, dash, inputClass, PageHeader, selectClass } from '../ui'

const PURPOSES: { id: keyof DashSettings['models']; label: string; hint: string }[] = [
  { id: 'chat', label: 'Chat', hint: 'The bar' },
  { id: 'quick', label: 'Quick', hint: 'Small, fast jobs' },
  { id: 'research', label: 'Research', hint: 'Background tasks' }
]

export function SettingsPage(): React.JSX.Element {
  const [s, setS] = useState<DashSettings | null>(null)
  const load = useCallback(() => void dash.settings().then(setS), [])

  useEffect(() => {
    load()
    return dash.onChanged((w) => w === 'settings' && load())
  }, [load])

  if (!s) return <></>

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="The common ones. Permissions have their own page; the rest, like quick actions, is in settings.json and applies as soon as you save."
        actions={
          <>
            <Button icon={FileCog} onClick={() => void dash.openPath('settings')}>
              settings.json
            </Button>
            <Button icon={FolderOpen} onClick={() => void dash.openPath('data')}>
              Data folder
            </Button>
          </>
        }
      />

      <Section title="Models" hint={`Written as provider:model. Providers you have: ${s.providers.join(', ')}.`}>
        <div className="grid gap-3 sm:grid-cols-3">
          {PURPOSES.map((p) => (
            <ModelField key={p.id} label={p.label} hint={p.hint} value={s.models[p.id]} onSave={(v) => void dash.updateSettings({ models: { [p.id]: v } })} />
          ))}
        </div>
      </Section>

      {s.installedClaude && (
        <Section title="Claude Code" hint={`You also have Claude Code ${s.installedClaudeVersion ?? ''} installed. Orbit can use it instead of its own copy (${s.bundledClaudeVersion}), so only one copy runs. The bundled one is the version Orbit was tested with; yours updates itself and could move to one that wasn't.`}>
          <select
            value={s.claudeExecutable}
            onChange={(e) => void dash.updateSettings({ claudeExecutable: e.target.value as 'bundled' | 'installed' })}
            className={selectClass}
            aria-label="Claude Code to use"
          >
            <option value="bundled">Orbit's own copy (tested version)</option>
            <option value="installed">My installed Claude Code</option>
          </select>
        </Section>
      )}

      <Section title="Voice" hint="Which speech-to-text Orbit uses when you talk to the bar.">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={s.voiceEngine}
            onChange={(e) => void dash.updateSettings({ voiceEngine: e.target.value as DashSettings['voiceEngine'] })}
            className={selectClass}
          >
            <option value="local">On this PC (Parakeet, free, offline)</option>
            <option value="wispr">Wispr Flow</option>
            <option value="off">Off</option>
          </select>
          <select
            value={s.voiceMode}
            onChange={(e) => void dash.updateSettings({ voiceMode: e.target.value as DashSettings['voiceMode'] })}
            className={selectClass}
            aria-label="How the hotkey records"
          >
            <option value="toggle">Press to start, press again to send</option>
            <option value="hold">Hold while talking, let go to send</option>
          </select>
          {s.voiceEngine === 'local' && !s.voiceModelInstalled && (
            <span className="flex items-center gap-2 text-sm text-amber-300">
              <Download size={14} /> The speech model downloads the first time you talk (482 MB).
            </span>
          )}
        </div>
      </Section>

      <Section title="Spoken replies" hint="Orbit can read its answers out loud. Pocket TTS runs on your PC (it needs uv and the pocket-tts package); the Windows voice needs nothing but sounds robotic.">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={s.speech.engine}
            onChange={(e) => void dash.updateSettings({ speech: { engine: e.target.value as DashSettings['speech']['engine'] } })}
            className={selectClass}
            aria-label="Speech engine"
          >
            <option value="off">Off</option>
            <option value="pocket">Pocket TTS (on this PC)</option>
            <option value="windows">Windows voice</option>
          </select>
          {s.speech.engine !== 'off' && (
            <>
              <select
                value={s.speech.when}
                onChange={(e) => void dash.updateSettings({ speech: { when: e.target.value as DashSettings['speech']['when'] } })}
                className={selectClass}
                aria-label="When to speak"
              >
                <option value="voice">When I asked by voice</option>
                <option value="always">Every answer</option>
              </select>
              {s.speech.engine === 'pocket' && (
                <select value={s.speech.voice} onChange={(e) => void dash.updateSettings({ speech: { voice: e.target.value } })} className={selectClass} aria-label="Voice">
                  {s.voices.map((v) => (
                    <option key={v} value={v}>
                      {v[0].toUpperCase() + v.slice(1)}
                    </option>
                  ))}
                </select>
              )}
              <Button icon={Volume2} onClick={() => void dash.testSpeech()}>
                Hear it
              </Button>
            </>
          )}
        </div>
      </Section>

      <Section
        title="Folders Orbit can use"
        hint={`Orbit can read files here, for example to summarise a PDF or react to one landing in a workflow, and nowhere else. It only changes files in folders where you turn that on. Before any change, the old file is backed up (kept ${s.snapshotDays} days, using ${s.snapshotMb} MB now) and the change can be undone from Logs.`}
      >
        <div className="space-y-1.5">
          {s.allowedFolders.map((f) => (
            <div key={f} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/20 px-3 py-1.5 text-sm text-zinc-200">
              <FolderOpen size={14} className="shrink-0 text-zinc-500" />
              <span className="flex-1 truncate">{f.replace('%DOWNLOADS%', 'Downloads').replace('%DESKTOP%', 'Desktop').replace('%DOCUMENTS%', 'Documents')}</span>
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={s.writableFolders.includes(f)}
                  onChange={(e) =>
                    void dash.updateSettings({ writableFolders: e.target.checked ? [...s.writableFolders, f] : s.writableFolders.filter((x) => x !== f) })
                  }
                  className="accent-sky-500"
                />
                Orbit can change files here
              </label>
              <Button variant="danger" icon={X} title="Remove" onClick={() => void dash.updateSettings({ allowedFolders: s.allowedFolders.filter((x) => x !== f) })} />
            </div>
          ))}
          {!s.allowedFolders.length && <p className="text-sm text-zinc-500">None. Orbit can't read any of your files.</p>}
        </div>
        <div className="mt-3">
          <Button
            icon={FolderPlus}
            onClick={() =>
              void dash.pickFolder().then((f) => {
                if (f && !s.allowedFolders.includes(f)) void dash.updateSettings({ allowedFolders: [...s.allowedFolders, f] })
              })
            }
          >
            Add a folder
          </Button>
        </div>
      </Section>

      <PhoneSection />

      <Section title="Hotkeys" hint="Click Change, then press the new combination. It needs Ctrl, Alt or Win so it doesn't clash with normal typing.">
        <div className="grid gap-2 text-sm">
          <HotkeyRow action="bar" label="Open the bar and talk" value={s.hotkeys.bar} />
          <HotkeyRow action="screenshot" label="Snip and ask" value={s.hotkeys.screenshot} />
          <HotkeyRow action="panic" label="Stop everything" value={s.hotkeys.panic} />
        </div>
      </Section>

      <Section title="Orbit" hint={`Version ${s.version}`}>
        <div className="grid gap-2 text-sm">
          <Toggle label="Start when Windows starts" checked={s.startWithWindows} onChange={(v) => void dash.updateSettings({ startWithWindows: v })} />
          <Toggle label="Update automatically (installs when you quit Orbit)" checked={s.autoUpdate} onChange={(v) => void dash.updateSettings({ autoUpdate: v })} />
        </div>
      </Section>
    </>
  )
}

function Section(props: { title: string; hint: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Card className="mb-4 p-5">
      <h2 className="text-sm font-medium text-zinc-100">{props.title}</h2>
      <p className="mt-0.5 mb-4 text-xs text-zinc-500">{props.hint}</p>
      {props.children}
    </Card>
  )
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  // Flip right away; the saved value arrives a moment later.
  const [on, setOn] = useState(props.checked)
  useEffect(() => setOn(props.checked), [props.checked])
  return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-zinc-300">{props.label}</span>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked)
          props.onChange(e.target.checked)
        }}
        className="h-4 w-4 accent-sky-500"
      />
    </label>
  )
}

/** Turns a keydown into an Electron accelerator, or undefined while only modifiers are held. */
function toAccelerator(e: React.KeyboardEvent): string | undefined {
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[]
  const k = e.key
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(k)) return undefined
  const key = k === ' ' ? 'Space' : k === 'Escape' ? 'Escape' : /^F\d{1,2}$/.test(k) ? k : k.length === 1 ? k.toUpperCase() : k
  return [...mods, key].join('+')
}

function HotkeyRow(props: { action: 'bar' | 'screenshot' | 'panic'; label: string; value: string }): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const pretty = (v: string): string => v.replace('Control', 'Ctrl').replace('Escape', 'Esc').replace('Super', 'Win').replace(/\+/g, ' + ')
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-400">{props.label}</span>
        <div className="flex items-center gap-2">
          {recording ? (
            <input
              autoFocus
              readOnly
              placeholder="Press keys…"
              onBlur={() => setRecording(false)}
              onKeyDown={(e) => {
                e.preventDefault()
                if (e.key === 'Escape' && !e.ctrlKey && !e.altKey) return setRecording(false)
                const accel = toAccelerator(e)
                if (!accel) return
                if (!e.ctrlKey && !e.altKey && !e.metaKey) return setError('Include Ctrl, Alt or Win.')
                setRecording(false)
                dash
                  .setHotkey(props.action, accel)
                  .then(() => setError(''))
                  .catch((err: Error) => setError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
              }}
              className="w-40 rounded-md border border-sky-400/60 bg-black/30 px-2 py-0.5 text-center text-xs text-zinc-100 outline-none"
            />
          ) : (
            <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-sans text-xs text-zinc-300">{pretty(props.value)}</kbd>
          )}
          <Button variant="ghost" onClick={() => (setError(''), setRecording(true))}>
            Change
          </Button>
        </div>
      </div>
      {error && <p className="mt-1 text-right text-xs text-amber-300">{error}</p>}
    </div>
  )
}

function ModelField(props: { label: string; hint: string; value: string; onSave: (v: string) => void }): React.JSX.Element {
  const [v, setV] = useState(props.value)
  useEffect(() => setV(props.value), [props.value])
  const dirty = v.trim() !== props.value
  return (
    <label className="block text-xs text-zinc-400">
      {props.label} <span className="text-zinc-600">· {props.hint}</span>
      <div className="mt-1 flex gap-1.5">
        <input value={v} onChange={(e) => setV(e.target.value)} className={inputClass} spellCheck={false} />
        {dirty && (
          <Button variant="primary" onClick={() => props.onSave(v.trim())} disabled={!/^[\w.-]+:.+$/.test(v.trim())}>
            Save
          </Button>
        )}
      </div>
    </label>
  )
}

function PhoneSection(): React.JSX.Element {
  const [p, setP] = useState<PhoneInfo | null>(null)
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const load = (): void => void dash.phone().then(setP)
  useEffect(() => {
    load()
    return dash.onChanged((w) => w === 'settings' && load())
  }, [])
  if (!p) return <></>
  const save = (): void => {
    setError('')
    dash.savePhoneToken(token).then(
      () => (setToken(''), load()),
      (err: Error) => setError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    )
  }
  return (
    <Section
      title="Phone (Telegram)"
      hint="Talk to Orbit from your phone through a Telegram bot of your own. It works while Orbit is running on this PC, answers only the chat you pair, and approvals show up as buttons in Telegram. Messages go through Telegram's servers."
    >
      {!p.hasToken ? (
        <div className="grid gap-2 text-sm text-zinc-300">
          <ol className="list-decimal space-y-1 pl-5">
            <li>In Telegram, message @BotFather, send /newbot and pick a name.</li>
            <li>Copy the token it gives you and paste it here.</li>
          </ol>
          <div className="flex gap-2">
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:ABC..." className={inputClass} aria-label="Bot token" />
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </div>
          {error && <p className="text-rose-300">{error}</p>}
        </div>
      ) : (
        <div className="grid gap-2 text-sm text-zinc-300" data-phone={p.paired ? 'paired' : 'waiting'}>
          {p.error ? (
            <p className="text-rose-300">Can't reach Telegram: {p.error}</p>
          ) : p.paired ? (
            <p>Paired{p.botName ? ` with @${p.botName}` : ''}. Message the bot from your phone.</p>
          ) : p.enabled ? (
            <p>
              Now send <code className="rounded bg-white/5 px-1">{p.code}</code> to {p.botName ? `@${p.botName}` : 'your bot'} in Telegram to pair your phone.
            </p>
          ) : (
            <p>Turned off.</p>
          )}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input type="checkbox" checked={p.enabled} onChange={(e) => void dash.setPhoneEnabled(e.target.checked)} className="accent-sky-500" />
              On
            </label>
            {p.paired && (
              <Button variant="ghost" onClick={() => void dash.unpairPhone()}>
                Unpair
              </Button>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}
