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
  /** As written in settings (may use %DOWNLOADS% etc.). */
  allowedFolders: string[]
  voiceMode: 'toggle' | 'hold'
  startWithWindows: boolean
  autoUpdate: boolean
  version: string
  speech: { engine: 'off' | 'pocket' | 'windows'; when: 'voice' | 'always'; voice: string }
  voices: string[]
}

export type WorkflowRunItem = {
  id: string
  workflow: string
  trigger: 'schedule' | 'manual' | 'missed' | 'event'
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
  webhookUrl?: string
  /** Last problem an event trigger hit, e.g. a feed that didn't load. */
  triggerError?: string
  lastRun?: WorkflowRunItem
  /** Set when the YAML file doesn't load. */
  error?: string
}

export type TemplateInfo = { id: string; title: string; summary: string; installed: boolean }

export type AuditItem = { at: string; tool: string; decision: 'allowed' | 'approved' | 'denied' | 'blocked'; ok?: boolean; input: unknown; output?: string }

export type UsageInfo = {
  days: { day: string; source: 'chat' | 'task' | 'workflow' | 'trigger'; input: number; output: number; cacheRead: number; cacheWrite: number; calls: number }[]
  top: { label: string; source: string; tokens: number; calls: number }[]
  backgroundToday: number
  backgroundLimit: number
}

export type DashPage = 'tasks' | 'workflows' | 'integrations' | 'memory' | 'history' | 'usage' | 'logs' | 'settings'

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
  /** Reopens the conversation in the bar. */
  continueConversation(id: string): void
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
  /** The workflow as plain data (parsed YAML) for the visual editor. */
  workflowGet(name: string): Promise<Record<string, unknown>>
  /** Validates and saves; returns the saved name. Throws with the problems if invalid. */
  workflowSave(previousName: string | null, data: unknown): Promise<string>
  tools(): Promise<{ name: string; description: string; sideEffect: boolean }[]>
  audit(limit?: number): Promise<AuditItem[]>
  usage(): Promise<UsageInfo>
  setBudget(tokensPerDay: number): Promise<void>
  settings(): Promise<DashSettings>
  updateSettings(patch: { models?: Partial<DashSettings['models']>; voiceEngine?: DashSettings['voiceEngine']; allowedFolders?: string[]; voiceMode?: DashSettings['voiceMode']; startWithWindows?: boolean; autoUpdate?: boolean; speech?: Partial<DashSettings['speech']> }): Promise<void>
  /** Says a short sample with the current speech settings. */
  testSpeech(): Promise<void>
  /** Throws if another app already owns the combination. */
  setHotkey(action: 'bar' | 'screenshot' | 'panic', accelerator: string): Promise<void>
  pickFolder(): Promise<string | null>
  openPath(what: 'settings' | 'data' | 'files' | 'integrations'): Promise<void>
}
