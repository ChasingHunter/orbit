import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Circle, ExternalLink, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import type { SetupCheck } from '@shared/dash'
import { Button, Card, dash, inputClass, PageHeader } from '../ui'

export function SetupPage(): React.JSX.Element {
  const [checks, setChecks] = useState<SetupCheck[] | null>(null)
  const [key, setKey] = useState('')
  const load = useCallback(() => {
    setChecks(null)
    void dash.checks().then(setChecks)
  }, [])
  useEffect(() => {
    load()
    // Signing in happens in another window; look again when Orbit gets focus back.
    const onFocus = (): void => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  return (
    <>
      <PageHeader
        title="Setup"
        subtitle="Everything Orbit needs comes in the installer. These are the accounts and optional extras, and whether this PC has them."
        actions={
          <Button icon={RefreshCw} onClick={load}>
            Check again
          </Button>
        }
      />
      {!checks ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={15} className="animate-spin" /> Checking this PC…
        </div>
      ) : (
        <div className="space-y-2">
          {checks.map((c) => (
            <Card key={c.id} className="flex items-start gap-3 p-4">
              {c.status === 'ok' ? (
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
              ) : c.status === 'missing' ? (
                <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-300" />
              ) : (
                <Circle size={18} className="mt-0.5 shrink-0 text-zinc-600" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                  {c.name}
                  {c.status === 'optional' && <span className="text-[11px] font-normal text-zinc-500">optional</span>}
                  {c.status === 'missing' && <span className="text-[11px] font-normal text-amber-300">needed for a feature you use</span>}
                </div>
                <div className="mt-0.5 text-sm text-zinc-300">{c.detail}</div>
                <div className="mt-0.5 text-xs text-zinc-500">{c.why}</div>
                {c.id === 'search' && c.status !== 'ok' && (
                  <div className="mt-2 flex gap-2">
                    <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your Tavily key" type="password" className={inputClass} />
                    <Button onClick={() => void dash.saveSearchKey(key.trim()).then(load)} disabled={!key.trim()}>
                      Save
                    </Button>
                  </div>
                )}
              </div>
              {c.action && (
                <div className="shrink-0">
                  <Button
                    variant={c.status === 'missing' ? 'primary' : 'outline'}
                    icon={c.action.kind === 'url' ? ExternalLink : undefined}
                    onClick={() => void dash.fixCheck(c.id)}
                  >
                    {c.action.label}
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
