import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plug, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { IntegrationState, PresetInfo } from '@shared/dash'
import { Button, Card, dash, inputClass, PageHeader } from '../ui'

const STATUS: Record<IntegrationState['status'], { label: string; dot: string }> = {
  connected: { label: 'Connected', dot: 'bg-emerald-400' },
  connecting: { label: 'Connecting…', dot: 'bg-sky-400 animate-pulse' },
  'needs-auth': { label: 'Needs sign-in', dot: 'bg-amber-400' },
  'missing-secret': { label: 'Missing its key', dot: 'bg-amber-400' },
  error: { label: 'Error', dot: 'bg-rose-400' },
  disabled: { label: 'Turned off', dot: 'bg-zinc-600' }
}

export function IntegrationsPage(): React.JSX.Element {
  const [states, setStates] = useState<IntegrationState[]>([])
  const [presets, setPresets] = useState<PresetInfo[]>([])
  const load = useCallback(() => {
    void dash.integrations().then((r) => {
      setStates(r.states)
      setPresets(r.presets)
    })
  }, [])

  useEffect(() => {
    load()
    return dash.onChanged((w) => w === 'integrations' && load())
  }, [load])

  const [query, setQuery] = useState('')
  const custom = states.filter((s) => !presets.some((p) => p.id === s.id))
  const added = presets.filter((p) => states.some((s) => s.id === p.id))
  const q = query.trim().toLowerCase()
  const available = presets.filter((p) => !states.some((s) => s.id === p.id) && (!q || `${p.name} ${p.description}`.toLowerCase().includes(q)))

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Services Orbit can read from and act in. Anything that changes something, like sending a message or creating a page, asks you first."
      />
      {(added.length > 0 || custom.length > 0) && (
        <div className="mb-6 space-y-3">
          {added.map((p) => (
            <PresetCard key={p.id} preset={p} state={states.find((s) => s.id === p.id)} />
          ))}
          {custom.map((s) => (
            <Card key={s.id} className="flex items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-zinc-100">{s.name}</div>
                <StatusLine state={s} />
              </div>
              <Actions state={s} />
            </Card>
          ))}
          <p className="text-xs text-zinc-500">
            Each connected service's tools go along with every message you send, which costs tokens. Turn off the ones you aren't using.
          </p>
        </div>
      )}

      <div className="mb-3 flex items-center gap-3">
        <div className="text-sm font-medium text-zinc-200">Add a service</div>
        <div className="relative ml-auto w-64">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-zinc-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search services" className={`${inputClass} pl-8`} />
        </div>
      </div>
      <div className="space-y-2">
        {available.map((p) => (
          <PresetCard key={p.id} preset={p} />
        ))}
        {!available.length && <p className="text-sm text-zinc-500">Nothing matches. You can still add it yourself below.</p>}
      </div>
      <CustomCard />
    </>
  )
}

function CustomCard(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'url' | 'command'>('url')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const add = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await dash.addCustomIntegration({ name, token, ...(kind === 'url' ? { url: target } : { command: target }) })
      setOpen(false)
      setName('')
      setTarget('')
      setToken('')
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="mt-4">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-100">Something else</div>
          <div className="mt-0.5 text-xs text-zinc-500">Any MCP server: an address it's hosted at, or a command that runs one on this PC.</div>
        </div>
        <Button icon={Plus} onClick={() => setOpen(!open)}>
          Add your own
        </Button>
      </div>
      {open && (
        <div className="grid gap-3 border-t border-white/[0.06] px-5 py-4">
          <label className="block text-xs text-zinc-400">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My CRM" className={`${inputClass} mt-1`} />
          </label>
          <div className="flex gap-4 text-xs text-zinc-300">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={kind === 'url'} onChange={() => setKind('url')} className="accent-sky-500" /> Address (URL)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={kind === 'command'} onChange={() => setKind('command')} className="accent-sky-500" /> Command
            </label>
          </div>
          <label className="block text-xs text-zinc-400">
            {kind === 'url' ? 'Address' : 'Command'}
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={kind === 'url' ? 'https://example.com/mcp' : 'npx -y some-mcp-server'}
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className="block text-xs text-zinc-400">
            {kind === 'url' ? 'Token (optional; leave empty to sign in through the browser)' : 'API key (optional; passed to it as API_KEY)'}
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void add()} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              Add and connect
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-zinc-500">Tokens are stored encrypted on this PC and never sent to a model.</p>
        </div>
      )}
    </Card>
  )
}

function StatusLine({ state }: { state: IntegrationState }): React.JSX.Element {
  const s = STATUS[state.status]
  return (
    <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
      {state.status === 'connected' && (
        <span className="text-zinc-500">
          · {state.toolCount} tools, about {state.tokens >= 1000 ? `${(state.tokens / 1000).toFixed(1)}k` : state.tokens} tokens per message
        </span>
      )}
      {state.error && <span className="truncate text-zinc-500">· {state.error}</span>}
    </div>
  )
}

function Actions({ state }: { state: IntegrationState }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      {state.status !== 'connected' && state.status !== 'connecting' && (
        <Button icon={RefreshCw} onClick={() => void dash.reconnect(state.id)}>
          {state.status === 'needs-auth' ? 'Sign in' : 'Retry'}
        </Button>
      )}
      <label className="flex cursor-pointer items-center gap-2 px-2 text-xs text-zinc-400">
        <input
          type="checkbox"
          checked={state.status !== 'disabled'}
          onChange={(e) => void dash.setIntegrationEnabled(state.id, e.target.checked)}
          className="accent-sky-500"
        />
        On
      </label>
      <Button variant="danger" icon={Trash2} title="Remove" onClick={() => void dash.removeIntegration(state.id)} />
    </div>
  )
}

function PresetCard({ preset, state }: { preset: PresetInfo; state?: IntegrationState }): React.JSX.Element {
  const [setup, setSetup] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await dash.connect(preset.id, values)
      setSetup(false)
      setValues({})
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-sm font-semibold text-zinc-200">
          {preset.name[0]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-100">{preset.name}</div>
          {state ? <StatusLine state={state} /> : <div className="mt-0.5 text-xs text-zinc-500">{preset.description}</div>}
        </div>
        {state ? (
          <Actions state={state} />
        ) : (
          <Button variant="primary" icon={Plug} onClick={() => setSetup(!setup)}>
            Connect
          </Button>
        )}
      </div>
      {setup && !state && (
        <div className="border-t border-white/[0.06] px-5 py-4">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-300">
            {preset.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {preset.fields.length > 0 && (
            <div className="mt-4 grid gap-3">
              {preset.fields.map((f) => (
                <label key={f.secret} className="block text-xs text-zinc-400">
                  {f.label}
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={f.placeholder}
                    value={values[f.secret] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.secret]: e.target.value })}
                    className={`${inputClass} mt-1`}
                  />
                </label>
              ))}
              <p className="text-xs text-zinc-500">Stored encrypted on this PC. Never sent to a model.</p>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => void connect()} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              {preset.fields.length ? 'Save and connect' : 'Continue in browser'}
            </Button>
            <Button variant="ghost" onClick={() => setSetup(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
