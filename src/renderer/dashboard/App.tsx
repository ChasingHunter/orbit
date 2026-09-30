import { useEffect, useState } from 'react'
import type { DashSettings } from '@shared/dash'
import { BarChart3, Brain, History, ListChecks, Plug, ScrollText, Settings as SettingsIcon, ShieldCheck, Wrench, Workflow, type LucideIcon } from 'lucide-react'
import type { DashPage } from '@shared/dash'
import { dash } from './ui'
import { TasksPage } from './pages/Tasks'
import { WorkflowsPage } from './pages/Workflows'
import { IntegrationsPage } from './pages/Integrations'
import { MemoryPage } from './pages/Memory'
import { HistoryPage } from './pages/History'
import { SettingsPage } from './pages/Settings'
import { LogsPage } from './pages/Logs'
import { UsagePage } from './pages/Usage'
import { PermissionsPage } from './pages/Permissions'
import { SetupPage } from './pages/Setup'

const NAV: { id: DashPage; label: string; icon: LucideIcon }[] = [
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'history', label: 'History', icon: History },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'setup', label: 'Setup', icon: Wrench },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

function initialPage(): DashPage {
  const h = location.hash.slice(1)
  return NAV.some((n) => n.id === h) ? (h as DashPage) : 'tasks'
}

export function App(): React.JSX.Element {
  const [page, setPage] = useState<DashPage>(initialPage)

  const [hotkeys, setHotkeys] = useState<DashSettings['hotkeys'] | null>(null)

  useEffect(() => dash.onNavigate(setPage), [])
  useEffect(() => {
    const load = (): void => void dash.settings().then((s) => setHotkeys(s.hotkeys))
    load()
    return dash.onChanged((w) => w === 'settings' && load())
  }, [])

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-white/[0.06] bg-zinc-950/60 px-3 py-4">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight text-zinc-100">Orbit</span>
        </div>
        <nav className="space-y-0.5">
          {NAV.map((n) => {
            const Icon = n.icon
            const active = page === n.id
            return (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  active ? 'bg-white/[0.08] text-zinc-50' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                }`}
              >
                <Icon size={16} className={active ? 'text-sky-300' : ''} />
                {n.label}
              </button>
            )
          })}
        </nav>
        <div className="mt-auto space-y-1.5 px-2 text-xs text-zinc-500">
          {hotkeys && (
            <>
              <Hint keys={hotkeys.bar} label="Ask" />
              <Hint keys={hotkeys.screenshot} label="Snip" />
              <Hint keys={hotkeys.panic} label="Stop" />
            </>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto px-10 py-8" data-page={page}>
        <div className="mx-auto max-w-4xl">
          {page === 'tasks' && <TasksPage />}
          {page === 'workflows' && <WorkflowsPage />}
          {page === 'integrations' && <IntegrationsPage />}
          {page === 'memory' && <MemoryPage />}
          {page === 'history' && <HistoryPage />}
          {page === 'usage' && <UsagePage />}
          {page === 'logs' && <LogsPage />}
          {page === 'permissions' && <PermissionsPage />}
          {page === 'setup' && <SetupPage />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  )
}

function Hint({ keys, label }: { keys: string; label: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="flex gap-0.5">
        {keys
          .replace('Control', 'Ctrl')
          .replace('Escape', 'Esc')
          .replace('Super', 'Win')
          .split('+')
          .map((k) => (
          <kbd key={k} className="rounded border border-white/10 bg-white/[0.04] px-1 font-sans text-[10px] text-zinc-400">
            {k}
          </kbd>
        ))}
      </span>
    </div>
  )
}

function Logo(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="8" fill="none" stroke="#5aa0fa" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill="#fff" />
      <circle cx="18.1" cy="6.9" r="2" fill="#faa05a" />
    </svg>
  )
}
