import { useCallback, useEffect, useState } from 'react'
import { Download, FileCog, FolderOpen, FolderPlus, X } from 'lucide-react'
import type { DashSettings } from '@shared/dash'
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
        subtitle="The common ones. Everything else, including hotkeys and tool permissions, is in settings.json and applies as soon as you save."
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
          {s.voiceEngine === 'local' && !s.voiceModelInstalled && (
            <span className="flex items-center gap-2 text-sm text-amber-300">
              <Download size={14} /> The speech model downloads the first time you talk (482 MB).
            </span>
          )}
        </div>
      </Section>

      <Section title="Folders Orbit can read" hint="Orbit can read files here (read-only), for example to summarise a PDF or react to one landing in a workflow. It can't read files anywhere else.">
        <div className="space-y-1.5">
          {s.allowedFolders.map((f) => (
            <div key={f} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/20 px-3 py-1.5 text-sm text-zinc-200">
              <FolderOpen size={14} className="shrink-0 text-zinc-500" />
              <span className="flex-1 truncate">{f.replace('%DOWNLOADS%', 'Downloads').replace('%DESKTOP%', 'Desktop').replace('%DOCUMENTS%', 'Documents')}</span>
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

      <Section title="Hotkeys" hint="Change these in settings.json.">
        <div className="grid gap-2 text-sm">
          <Row label="Open the bar and talk" value={s.hotkeys.bar} />
          <Row label="Snip and ask" value={s.hotkeys.screenshot} />
          <Row label="Stop everything" value={s.hotkeys.panic} />
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

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-400">{label}</span>
      <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-sans text-xs text-zinc-300">{value.replace('Control', 'Ctrl').replace('Escape', 'Esc').replace(/\+/g, ' + ')}</kbd>
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
