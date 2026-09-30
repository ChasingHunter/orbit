import { dialog, ipcMain, shell } from 'electron'
import { version } from '../../package.json'
import { existsSync, readFileSync } from 'node:fs'
import type { DashSettings, MemoryKind } from '@shared/dash'
import { dataDir, paths } from './paths'
import { settings } from './settingsStore'
import { setSecret } from './secrets'
import { integrations } from './integrations/manager'
import { integrationsFile } from './integrations/config'
import { PRESETS } from './integrations/presets'
import { addMemory, deleteMemory, listMemories, updateMemory } from './core/memory'
import { deleteConversation, getMessages, listConversations } from './core/history'
import { tasks } from './core/tasks'
import { isModelInstalled } from './voice/localStt'
import { notifyDashboard } from './windows/dashboard'
import { workflowStore } from './workflows/store'
import { workflows } from './workflows/engine'
import { TEMPLATES } from './workflows/templates'
import { describeTrigger } from './workflows/describe'
import { triggers } from './workflows/triggers'
import { scheduler } from './core/scheduler'
import type { WorkflowInfo } from '@shared/dash'
import { toValidYaml } from './workflows/validate'
import { allTools } from './core/tools/registry'

type SettingsPatch = {
  models?: Partial<DashSettings['models']>
  voiceEngine?: DashSettings['voiceEngine']
  allowedFolders?: string[]
  voiceMode?: DashSettings['voiceMode']
  startWithWindows?: boolean
  autoUpdate?: boolean
}

export function registerDashboardIpc(): void {
  integrations.on('change', () => notifyDashboard('integrations'))
  tasks.on('change', () => notifyDashboard('tasks'))
  settings.on('change', () => notifyDashboard('settings'))

  ipcMain.handle('dash:integrations', () => ({
    states: integrations.states(),
    presets: PRESETS.map(({ id, name, description, steps, fields }) => ({ id, name, description, steps, fields }))
  }))
  ipcMain.handle('dash:connect', async (_e, presetId: string, secrets: Record<string, string>) => {
    const preset = PRESETS.find((p) => p.id === presetId)
    if (!preset) throw new Error(`Unknown integration ${presetId}`)
    for (const f of preset.fields) {
      const value = secrets[f.secret]?.trim()
      if (!value) throw new Error(`${f.label} is required`)
      setSecret(f.secret, value)
    }
    await integrations.upsert(preset.id, preset.config, true)
  })
  ipcMain.handle('dash:reconnect', (_e, id: string) => integrations.connect(id, true))
  ipcMain.handle('dash:integration-enabled', (_e, id: string, enabled: boolean) => integrations.setEnabled(id, enabled))
  ipcMain.handle('dash:integration-remove', (_e, id: string) => integrations.remove(id))

  ipcMain.handle('dash:memories', () => listMemories())
  ipcMain.handle('dash:memory-add', (_e, text: string, kind: MemoryKind, isPrivate: boolean) => {
    addMemory(text, kind, isPrivate)
    notifyDashboard('memory')
  })
  ipcMain.handle('dash:memory-update', (_e, id: number, fields: Parameters<typeof updateMemory>[1]) => {
    updateMemory(id, fields)
    notifyDashboard('memory')
  })
  ipcMain.handle('dash:memory-delete', (_e, id: number) => {
    deleteMemory(id)
    notifyDashboard('memory')
  })

  ipcMain.handle('dash:conversations', () => listConversations())
  ipcMain.handle('dash:messages', (_e, id: string) => getMessages(id))
  ipcMain.handle('dash:conversation-delete', (_e, id: string) => {
    deleteConversation(id)
    notifyDashboard('history')
  })

  workflows.on('change', () => notifyDashboard('workflows'))
  ipcMain.handle('dash:workflows', () => {
    const list: WorkflowInfo[] = workflowStore.list().map((l) => {
      const wf = l.workflow
      if (!wf) return { file: l.file, name: l.file.replace(/\.ya?ml$/i, ''), description: '', enabled: false, schedule: 'Invalid', nextRun: null, stepCount: 0, error: l.error }
      const s = scheduler.get(`wf:${wf.name}`)
      const next = s ? scheduler.nextRunOf(s) : null
      return {
        file: l.file,
        name: wf.name,
        description: wf.description,
        enabled: wf.enabled,
        schedule: describeTrigger(wf.trigger),
        webhookUrl: 'webhook' in wf.trigger ? triggers.webhookUrl(wf.name) : undefined,
        triggerError: triggers.status(wf.name)?.lastError ?? undefined,
        nextRun: wf.enabled && next ? next.toISOString() : null,
        stepCount: wf.prompt ? 1 : wf.steps.length,
        lastRun: workflows.runs(wf.name, 1)[0]
      }
    })
    const names = new Set(list.map((w) => w.name))
    return { workflows: list, templates: TEMPLATES.map((t) => ({ id: t.id, title: t.title, summary: t.summary, installed: names.has(t.id) })) }
  })
  ipcMain.handle('dash:workflow-runs', (_e, name: string) => workflows.runs(name, 30))
  ipcMain.handle('dash:workflow-steps', (_e, runId: string) => workflows.steps(runId))
  ipcMain.handle('dash:workflow-run', (_e, name: string) => void workflows.run(name, 'manual').catch(() => {}))
  ipcMain.handle('dash:workflow-cancel', (_e, runId: string) => workflows.cancel(runId))
  ipcMain.handle('dash:workflow-enabled', (_e, name: string, enabled: boolean) => workflowStore.setEnabled(name, enabled))
  ipcMain.handle('dash:workflow-delete', (_e, name: string) => workflowStore.remove(name))
  ipcMain.handle('dash:workflow-edit', (_e, name: string) => shell.openPath(workflowStore.fileOf(name)))
  ipcMain.handle('dash:workflow-get', (_e, name: string) => workflowStore.rawOf(name))
  ipcMain.handle('dash:workflow-save', (_e, previousName: string | null, data: unknown) => {
    const { yaml, workflow } = toValidYaml(data)
    if (!previousName && workflowStore.get(workflow.name)) throw new Error(`A workflow named "${workflow.name}" already exists`)
    workflowStore.save(yaml)
    if (previousName && previousName !== workflow.name) workflowStore.remove(previousName)
    return workflow.name
  })
  ipcMain.handle('dash:tools', () =>
    allTools().map((t) => ({ name: t.name, description: t.description.slice(0, 200), sideEffect: t.sideEffect }))
  )
  ipcMain.handle('dash:template-add', (_e, id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)
    if (!t) throw new Error(`Unknown template ${id}`)
    workflowStore.save(t.yaml)
  })

  ipcMain.handle('dash:audit', (_e, limit = 500) => {
    if (!existsSync(paths.audit)) return []
    const lines = readFileSync(paths.audit, 'utf8').trimEnd().split('\n')
    return lines
      .slice(-limit)
      .reverse()
      .flatMap((l) => {
        try {
          return [JSON.parse(l)]
        } catch {
          return []
        }
      })
  })

  ipcMain.handle('dash:tasks', () => tasks.list())
  ipcMain.handle('dash:task-cancel', (_e, id: string) => tasks.cancel(id))

  ipcMain.handle(
    'dash:settings',
    (): DashSettings => ({
      models: settings.current.models,
      providers: Object.keys(settings.current.providers),
      voiceEngine: settings.current.voice.engine,
      voiceModelInstalled: isModelInstalled(),
      hotkeys: settings.current.hotkeys,
      allowedFolders: settings.current.files.allowedFolders,
      voiceMode: settings.current.voice.mode,
      startWithWindows: settings.current.ui.startWithWindows,
      autoUpdate: settings.current.ui.autoUpdate,
      // From package.json so dev runs don't report Electron's own version.
      version
    })
  )
  ipcMain.handle('dash:settings-update', (_e, patch: SettingsPatch) => {
    settings.update((d) => {
      if (patch.models) Object.assign(d.models, patch.models)
      if (patch.voiceEngine) d.voice.engine = patch.voiceEngine
      if (patch.allowedFolders) d.files.allowedFolders = patch.allowedFolders
      if (patch.voiceMode) d.voice.mode = patch.voiceMode
      if (patch.startWithWindows !== undefined) d.ui.startWithWindows = patch.startWithWindows
      if (patch.autoUpdate !== undefined) d.ui.autoUpdate = patch.autoUpdate
    })
  })
  ipcMain.handle('dash:pick-folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dash:open', (_e, what: 'settings' | 'data' | 'files' | 'integrations') => {
    const target = { settings: paths.settings, data: dataDir, files: paths.files, integrations: integrationsFile }[what]
    return shell.openPath(target)
  })
}
