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

export type DashPage = 'tasks' | 'integrations' | 'memory' | 'history' | 'settings'

export interface DashApi {
  onChanged(cb: (what: 'integrations' | 'tasks' | 'memory' | 'history' | 'settings') => void): () => void
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
  settings(): Promise<DashSettings>
  updateSettings(patch: { models?: Partial<DashSettings['models']>; voiceEngine?: DashSettings['voiceEngine'] }): Promise<void>
  openPath(what: 'settings' | 'data' | 'files' | 'integrations'): Promise<void>
}
