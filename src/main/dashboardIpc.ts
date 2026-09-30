import { ipcMain, shell } from 'electron'
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

type SettingsPatch = { models?: Partial<DashSettings['models']>; voiceEngine?: DashSettings['voiceEngine'] }

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

  ipcMain.handle('dash:tasks', () => tasks.list())
  ipcMain.handle('dash:task-cancel', (_e, id: string) => tasks.cancel(id))

  ipcMain.handle(
    'dash:settings',
    (): DashSettings => ({
      models: settings.current.models,
      providers: Object.keys(settings.current.providers),
      voiceEngine: settings.current.voice.engine,
      voiceModelInstalled: isModelInstalled(),
      hotkeys: settings.current.hotkeys
    })
  )
  ipcMain.handle('dash:settings-update', (_e, patch: SettingsPatch) => {
    settings.update((d) => {
      if (patch.models) Object.assign(d.models, patch.models)
      if (patch.voiceEngine) d.voice.engine = patch.voiceEngine
    })
  })
  ipcMain.handle('dash:open', (_e, what: 'settings' | 'data' | 'files' | 'integrations') => {
    const target = { settings: paths.settings, data: dataDir, files: paths.files, integrations: integrationsFile }[what]
    return shell.openPath(target)
  })
}
