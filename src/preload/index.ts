import { contextBridge, ipcRenderer } from 'electron'
import type { BarEvent, OrbitApi } from '@shared/types'
import type { DashApi, DashPage } from '@shared/dash'

const api: OrbitApi = {
  onEvent: (cb) => {
    const fn = (_e: unknown, ev: BarEvent): void => cb(ev)
    ipcRenderer.on('bar:event', fn)
    return () => ipcRenderer.off('bar:event', fn)
  },
  submit: (text, context) => ipcRenderer.invoke('bar:submit', text, context),
  cancel: () => ipcRenderer.send('bar:cancel'),
  newChat: () => ipcRenderer.send('bar:new'),
  approve: (id, approved) => ipcRenderer.send('bar:approve', id, approved),
  toggleVoice: () => ipcRenderer.send('bar:voice-toggle'),
  voiceEnded: () => ipcRenderer.send('bar:voice-ended'),
  transcribe: (samples) => ipcRenderer.invoke('stt:transcribe', samples),
  hide: () => ipcRenderer.send('bar:hide'),
  copy: (text) => ipcRenderer.send('bar:copy', text),
  replaceSelection: (text) => ipcRenderer.invoke('bar:replace', text),
  requestScreenshot: () => ipcRenderer.send('bar:screenshot'),
  resize: (height) => ipcRenderer.send('bar:resize', height),
  openDashboard: (page) => ipcRenderer.send('bar:dashboard', page),
  snipDone: (rect) => ipcRenderer.send('snip:done', rect),
  onSnipImage: (cb) => {
    ipcRenderer.on('snip:image', (_e, dataUrl: string) => cb(dataUrl))
  }
}

const dash: DashApi = {
  onChanged: (cb) => {
    const fn = (_e: unknown, what: Parameters<typeof cb>[0]): void => cb(what)
    ipcRenderer.on('dash:changed', fn)
    return () => ipcRenderer.off('dash:changed', fn)
  },
  onNavigate: (cb) => {
    const fn = (_e: unknown, page: DashPage): void => cb(page)
    ipcRenderer.on('dash:navigate', fn)
    return () => ipcRenderer.off('dash:navigate', fn)
  },
  integrations: () => ipcRenderer.invoke('dash:integrations'),
  connect: (presetId, secrets) => ipcRenderer.invoke('dash:connect', presetId, secrets),
  reconnect: (id) => ipcRenderer.invoke('dash:reconnect', id),
  setIntegrationEnabled: (id, enabled) => ipcRenderer.invoke('dash:integration-enabled', id, enabled),
  removeIntegration: (id) => ipcRenderer.invoke('dash:integration-remove', id),
  memories: () => ipcRenderer.invoke('dash:memories'),
  addMemory: (text, kind, isPrivate) => ipcRenderer.invoke('dash:memory-add', text, kind, isPrivate),
  updateMemory: (id, fields) => ipcRenderer.invoke('dash:memory-update', id, fields),
  deleteMemory: (id) => ipcRenderer.invoke('dash:memory-delete', id),
  conversations: () => ipcRenderer.invoke('dash:conversations'),
  messages: (id) => ipcRenderer.invoke('dash:messages', id),
  deleteConversation: (id) => ipcRenderer.invoke('dash:conversation-delete', id),
  tasks: () => ipcRenderer.invoke('dash:tasks'),
  cancelTask: (id) => ipcRenderer.invoke('dash:task-cancel', id),
  workflows: () => ipcRenderer.invoke('dash:workflows'),
  workflowRuns: (name) => ipcRenderer.invoke('dash:workflow-runs', name),
  workflowSteps: (runId) => ipcRenderer.invoke('dash:workflow-steps', runId),
  runWorkflow: (name) => ipcRenderer.invoke('dash:workflow-run', name),
  cancelWorkflowRun: (runId) => ipcRenderer.invoke('dash:workflow-cancel', runId),
  setWorkflowEnabled: (name, enabled) => ipcRenderer.invoke('dash:workflow-enabled', name, enabled),
  deleteWorkflow: (name) => ipcRenderer.invoke('dash:workflow-delete', name),
  editWorkflow: (name) => ipcRenderer.invoke('dash:workflow-edit', name),
  addTemplate: (id) => ipcRenderer.invoke('dash:template-add', id),
  workflowGet: (name) => ipcRenderer.invoke('dash:workflow-get', name),
  workflowSave: (previousName, data) => ipcRenderer.invoke('dash:workflow-save', previousName, data),
  tools: () => ipcRenderer.invoke('dash:tools'),
  settings: () => ipcRenderer.invoke('dash:settings'),
  updateSettings: (patch) => ipcRenderer.invoke('dash:settings-update', patch),
  pickFolder: () => ipcRenderer.invoke('dash:pick-folder'),
  openPath: (what) => ipcRenderer.invoke('dash:open', what)
}

contextBridge.exposeInMainWorld('orbit', { ...api, dash })
