// Data shapes the dashboard exchanges with the main process.

export type IntegrationStatus = 'disabled' | 'connecting' | 'connected' | 'needs-auth' | 'missing-secret' | 'error'

export type IntegrationState = {
  id: string
  name: string
  type: 'http' | 'stdio'
  status: IntegrationStatus
  error?: string
  toolCount: number
  /** Roughly what its tools add to every message. */
  tokens: number
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

export type ConversationItem = { id: string; title: string; model: string; created_at: string; updated_at: string; project?: string }
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
  /** What a running task is doing now. */
  progress?: string | null
}

export type DashSettings = {
  models: { chat: string; quick: string; research: string }
  providers: string[]
  voiceEngine: 'local' | 'wispr' | 'off'
  voiceModelInstalled: boolean
  hotkeys: { bar: string; screenshot: string; panic: string }
  /** As written in settings (may use %DOWNLOADS% etc.). */
  allowedFolders: string[]
  /** Of allowedFolders, the ones Orbit may change files in. */
  writableFolders: string[]
  /** Space the backups of changed files take. */
  snapshotMb: number
  snapshotDays: number
  voiceMode: 'toggle' | 'hold'
  startWithWindows: boolean
  autoUpdate: boolean
  version: string
  claudeExecutable: 'bundled' | 'installed'
  /** Path of a Claude Code you installed yourself, if there is one. */
  installedClaude: string | null
  installedClaudeVersion: string | null
  bundledClaudeVersion: string | null
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

export type ProjectInfo = { id: string; name: string; instructions: string; paths: string[]; files: number; chunks: number }

export type SkillInfo = { key: string; name: string; description: string; source: 'orbit' | 'claude'; enabled: boolean }

export type StorageInfo = {
  items: { id: string; label: string; bytes: number; limit: string }[]
  total: number
  /** Free space on the drive Orbit's data is on. */
  free: number
  last?: { at: string; freed: number }
}

export type SetupCheck = {
  id: string
  name: string
  status: 'ok' | 'missing' | 'optional'
  detail: string
  why: string
  action?: { label: string; kind: 'sign-in' | 'install-voice' | 'url' | 'key'; target?: string }
}

export type ChangeItem = { id: number; at: string; source: string; summary: string; undone_at: string | null }

export type UsageInfo = {
  days: { day: string; source: 'chat' | 'task' | 'workflow' | 'trigger'; input: number; output: number; cacheRead: number; cacheWrite: number; calls: number }[]
  top: { label: string; source: string; tokens: number; calls: number }[]
  backgroundToday: number
  backgroundLimit: number
}

export type PermissionsInfo = {
  level: 'strict' | 'careful' | 'trusted' | 'full'
  /** run_command is available at all. */
  commandsEnabled: boolean
  tools: {
    name: string
    description: string
    risk: 'read' | 'local' | 'external' | 'destructive'
    policy: 'ask' | 'always' | 'never'
    from: 'override' | 'level'
    /** What the level alone would do. */
    levelPolicy: 'ask' | 'always' | 'never'
  }[]
}

export type DashPage = 'tasks' | 'workflows' | 'integrations' | 'memory' | 'projects' | 'history' | 'usage' | 'logs' | 'permissions' | 'skills' | 'setup' | 'settings'

export interface DashApi {
  onChanged(cb: (what: 'integrations' | 'tasks' | 'memory' | 'history' | 'settings' | 'workflows' | 'logs' | 'projects') => void): () => void
  onNavigate(cb: (page: DashPage) => void): () => void
  integrations(): Promise<{ states: IntegrationState[]; presets: PresetInfo[] }>
  connect(presetId: string, secrets: Record<string, string>): Promise<void>
  /** Adds a server that isn't in the list: a URL, or a command for a local one. */
  addCustomIntegration(spec: { name: string; url?: string; command?: string; token?: string }): Promise<void>
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
  storage(): Promise<StorageInfo>
  skills(): Promise<{ skills: SkillInfo[]; orbitDir: string; claudeDir: string }>
  projects(): Promise<ProjectInfo[]>
  saveProject(p: { id?: string; name: string; instructions: string }): Promise<string>
  deleteProject(id: string): Promise<void>
  /** Opens a picker and pins what's chosen (a folder, or files). */
  addProjectPaths(id: string, kind: 'folder' | 'files'): Promise<void>
  removeProjectPath(id: string, path: string): Promise<void>
  setSkillEnabled(key: string, on: boolean): Promise<void>
  openSkillsFolder(which: 'orbit' | 'claude'): Promise<void>
  cleanup(): Promise<StorageInfo>
  checks(): Promise<SetupCheck[]>
  fixCheck(id: string): Promise<void>
  saveSearchKey(key: string): Promise<void>
  changes(): Promise<ChangeItem[]>
  /** Undoes a change. conflict: the file changed since; call again with force to go ahead. Throws if it can't be done. */
  undo(id: number, force?: boolean): Promise<{ done: string } | { conflict: string }>
  permissions(): Promise<PermissionsInfo>
  setPermissionLevel(level: PermissionsInfo['level']): Promise<void>
  setCommandsEnabled(on: boolean): Promise<void>
  /** 'level' removes the override so the tool follows the level again. */
  setToolPolicy(name: string, policy: 'level' | 'ask' | 'always' | 'never'): Promise<void>
  setBudget(tokensPerDay: number): Promise<void>
  settings(): Promise<DashSettings>
  updateSettings(patch: { models?: Partial<DashSettings['models']>; voiceEngine?: DashSettings['voiceEngine']; allowedFolders?: string[]; writableFolders?: string[]; voiceMode?: DashSettings['voiceMode']; startWithWindows?: boolean; autoUpdate?: boolean; speech?: Partial<DashSettings['speech']>; claudeExecutable?: 'bundled' | 'installed' }): Promise<void>
  /** Says a short sample with the current speech settings. */
  testSpeech(): Promise<void>
  /** Throws if another app already owns the combination. */
  setHotkey(action: 'bar' | 'screenshot' | 'panic', accelerator: string): Promise<void>
  pickFolder(): Promise<string | null>
  openPath(what: 'settings' | 'data' | 'files' | 'integrations'): Promise<void>
}
