// Data shapes the dashboard exchanges with the main process.

export type IntegrationStatus = 'disabled' | 'connecting' | 'connected' | 'needs-auth' | 'missing-secret' | 'error'

export type IntegrationState = {
  id: string
  name: string
  type: 'http' | 'stdio'
  status: IntegrationStatus
  error?: string
  toolCount: number
}

export type PresetInfo = {
  id: string
  name: string
  description: string
  steps: string[]
  fields: { secret: string; label: string; placeholder?: string }[]
}

export type MemoryKind = 'profile' | 'person' | 'preference' | 'project' | 'note'
export type MemoryItem = { id: number; kind: MemoryKind; text: string; private: boolean; created_at: string; updated_at: string }

export type ConversationItem = { id: string; title: string; model: string; created_at: string; updated_at: string }
export type MessageItem = { id: number; role: 'user' | 'assistant'; text: string; created_at: string }

export type TaskItem = {
  id: string
  title: string
  prompt: string
  model: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  result: string | null
  error: string | null
  created_at: string
  finished_at: string | null
}

export type DashSettings = {
  models: { chat: string; quick: string; research: string }
  providers: string[]
  voiceEngine: 'local' | 'wispr' | 'off'
  voiceModelInstalled: boolean
  hotkeys: { bar: string; screenshot: string; panic: string }
}

export type WorkflowRunItem = {
  id: string
  workflow: string
  trigger: 'schedule' | 'manual' | 'missed'
  status: 'running' | 'done' | 'failed' | 'cancelled'
  output: string | null
  error: string | null
  started_at: string
  finished_at: string | null
}

export type WorkflowStepItem = {
  step_id: string
  kind: string
  status: 'running' | 'done' | 'skipped' | 'failed'
  input: string | null
  output: string | null
  error: string | null
  attempts: number
  started_at: string
  finished_at: string | null
}

export type WorkflowInfo = {
  file: string
  name: string
  description: string
  enabled: boolean
  schedule: string
  nextRun: string | null
  stepCount: number
  lastRun?: WorkflowRunItem
  /** Set when the YAML file doesn't load. */
  error?: string
}

export type TemplateInfo = { id: string; title: string; summary: string; installed: boolean }

export type DashPage = 'tasks' | 'workflows' | 'integrations' | 'memory' | 'history' | 'settings'

export interface DashApi {
  onChanged(cb: (what: 'integrations' | 'tasks' | 'memory' | 'history' | 'settings' | 'workflows') => void): () => void
  onNavigate(cb: (page: DashPage) => void): () => void
  integrations(): Promise<{ states: IntegrationState[]; presets: PresetInfo[] }>
  connect(presetId: string, secrets: Record<string, string>): Promise<void>
  reconnect(id: string): Promise<void>
  setIntegrationEnabled(id: string, enabled: boolean): Promise<void>
  removeIntegration(id: string): Promise<void>
  memories(): Promise<MemoryItem[]>
  addMemory(text: string, kind: MemoryKind, isPrivate: boolean): Promise<void>
  updateMemory(id: number, fields: { text?: string; kind?: MemoryKind; private?: boolean }): Promise<void>
  deleteMemory(id: number): Promise<void>
  conversations(): Promise<ConversationItem[]>
  messages(conversationId: string): Promise<MessageItem[]>
  deleteConversation(id: string): Promise<void>
  tasks(): Promise<TaskItem[]>
  cancelTask(id: string): Promise<void>
  workflows(): Promise<{ workflows: WorkflowInfo[]; templates: TemplateInfo[] }>
  workflowRuns(name: string): Promise<WorkflowRunItem[]>
  workflowSteps(runId: string): Promise<WorkflowStepItem[]>
  runWorkflow(name: string): Promise<void>
  cancelWorkflowRun(runId: string): Promise<void>
  setWorkflowEnabled(name: string, enabled: boolean): Promise<void>
  deleteWorkflow(name: string): Promise<void>
  editWorkflow(name: string): Promise<void>
  addTemplate(id: string): Promise<void>
  settings(): Promise<DashSettings>
  updateSettings(patch: { models?: Partial<DashSettings['models']>; voiceEngine?: DashSettings['voiceEngine'] }): Promise<void>
  openPath(what: 'settings' | 'data' | 'files' | 'integrations'): Promise<void>
}
