import { useCallback, useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { PermissionsInfo } from '@shared/dash'
import { Card, dash, PageHeader, selectClass } from '../ui'

const LEVELS: { id: PermissionsInfo['level']; title: string; body: string }[] = [
  { id: 'strict', title: 'Ask for everything', body: 'Every tool waits for your OK, even reading a web page or your memories.' },
  { id: 'careful', title: 'Ask before changes', body: "Looking things up and Orbit's own notes, reminders and files just happen. Anything that acts in another app or deletes something asks first." },
  { id: 'trusted', title: 'Ask only for risky things', body: 'Sending, posting and creating in your apps just happens. Only deleting or overwriting outside Orbit asks first.' },
  { id: 'full', title: 'Full autonomy', body: 'Nothing asks. Orbit acts on its own, including in your connected apps.' }
]

const RISKS: { id: PermissionsInfo['tools'][number]['risk']; title: string; hint: string }[] = [
  { id: 'destructive', title: 'Deletes or overwrites outside Orbit', hint: 'Marked destructive by the service' },
  { id: 'external', title: 'Acts in other apps', hint: 'Sends, posts, creates, or sets up automation' },
  { id: 'local', title: "Changes Orbit's own things", hint: 'Memories, reminders, its files folder, background jobs. Can be undone from Logs.' },
  { id: 'read', title: 'Only looks', hint: 'Search, read, list' }
]

const WORD = { ask: 'Asks', always: 'Runs', never: 'Off' } as const

export function PermissionsPage(): React.JSX.Element {
  const [p, setP] = useState<PermissionsInfo | null>(null)
  const load = useCallback(() => void dash.permissions().then(setP), [])
  useEffect(() => {
    load()
    return dash.onChanged((w) => (w === 'settings' || w === 'integrations') && load())
  }, [load])
  if (!p) return <></>

  return (
    <>
      <PageHeader title="Permissions" subtitle="How much Orbit may do on its own. Pick a level, then adjust single tools if you want. Every tool call is logged either way." />

      <div className="mb-6 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Autonomy level">
        {LEVELS.map((l) => {
          const on = p.level === l.id
          return (
            <button
              key={l.id}
              role="radio"
              aria-checked={on}
              onClick={() => void dash.setPermissionLevel(l.id)}
              className={`rounded-xl border p-4 text-left transition-colors ${on ? 'border-sky-400/60 bg-sky-400/[0.07]' : 'border-white/[0.07] bg-zinc-900/70 hover:border-white/20'}`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <span className={`h-3 w-3 rounded-full border ${on ? 'border-sky-400 bg-sky-400' : 'border-zinc-500'}`} />
                {l.title}
                {l.id === 'careful' && <span className="text-[11px] font-normal text-zinc-500">default</span>}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{l.body}</p>
            </button>
          )
        })}
      </div>
      {p.level === 'full' && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-sm text-amber-200">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          Orbit can now send, post and delete in your connected apps without asking. A web page or message could try to trick it into doing something; with this level nothing stops it but your per-tool settings below.
        </div>
      )}
      {p.level === 'strict' && (
        <p className="mb-6 text-xs text-zinc-500">Workflow steps you approved when saving a workflow also ask again each run at this level.</p>
      )}

      <Card className="mb-6 p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={p.commandsEnabled}
            onChange={(e) => void dash.setCommandsEnabled(e.target.checked)}
            className="mt-1 accent-sky-500"
            aria-label="Let Orbit run commands"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-100">Let Orbit run commands</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">
              Real PowerShell commands, with your full permissions, for things nothing else can do (system info, installs, git). Orbit can't undo what a command changes. Each one
              comes with a plain description of what it does, and asks first unless your level is Full. Python is different: it always runs in a sandbox with no internet and no
              access to your files, so it's on.
            </span>
          </span>
        </label>
      </Card>

      {RISKS.map((r) => {
        const tools = p.tools.filter((t) => t.risk === r.id)
        if (!tools.length) return null
        return (
          <Card key={r.id} className="mb-3 p-4">
            <div className="text-sm font-medium text-zinc-100">{r.title}</div>
            <div className="mb-3 text-xs text-zinc-500">{r.hint}</div>
            <div className="divide-y divide-white/[0.05]">
              {tools.map((t) => (
                <div key={t.name} className="flex items-center gap-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-zinc-200">{t.name}</div>
                    <div className="truncate text-xs text-zinc-500">{t.description}</div>
                  </div>
                  <select
                    value={t.from === 'override' ? t.policy : 'level'}
                    onChange={(e) => void dash.setToolPolicy(t.name, e.target.value as 'level' | 'ask' | 'always' | 'never')}
                    className={`${selectClass} text-xs`}
                    aria-label={`Policy for ${t.name}`}
                  >
                    <option value="level">Level: {WORD[t.levelPolicy]}</option>
                    <option value="ask">Always ask</option>
                    <option value="always">Always run</option>
                    <option value="never">Never</option>
                  </select>
                </div>
              ))}
            </div>
          </Card>
        )
      })}
    </>
  )
}
