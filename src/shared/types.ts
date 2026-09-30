// Contracts shared by main, preload and renderer.

export type ContextItem =
  | { kind: 'selection'; id: string; text: string; app: string }
  | { kind: 'screenshot'; id: string; mediaType: 'image/png'; base64: string; width: number; height: number }
  | { kind: 'window'; id: string; app: string; title: string }

export type ImageInput = { mediaType: 'image/png' | 'image/jpeg'; base64: string }

/** Provider-neutral stream events emitted by every AgentRunner. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; name: string; output: string; isError: boolean }
  | { type: 'rate-limit'; resetsAt?: number; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export type ApprovalRequest = {
  id: string
  tool: string
  title: string
  input: unknown
}

/** State pushed from main to the bar window. */
export type BarEvent =
  | { type: 'open'; context: ContextItem[]; autoSubmitMs: number | null }
  | { type: 'context-add'; item: ContextItem }
  | { type: 'listening'; value: boolean }
  | { type: 'agent'; turnId: string; event: AgentEvent }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'notice'; level: 'info' | 'error'; text: string; action?: { label: string; command: string } }
  /** Local engine: start/stop mic capture in the bar. discard = drop audio (bar closed). */
  | { type: 'record'; value: boolean; discard?: boolean }
  | { type: 'progress'; id: string; label: string; value: number; done?: boolean }
  | { type: 'reset' }

export interface OrbitApi {
  onEvent(cb: (e: BarEvent) => void): () => void
  submit(text: string, context: ContextItem[]): Promise<{ turnId: string }>
  cancel(): void
  newChat(): void
  approve(id: string, approved: boolean): void
  toggleVoice(): void
  /** Local engine: 16 kHz mono samples -> text. */
  transcribe(samples: Float32Array): Promise<string>
  /** Transcript arrived in the input (e.g. Wispr stopped from its own UI). */
  voiceEnded(): void
  hide(): void
  copy(text: string): void
  replaceSelection(text: string): Promise<void>
  requestScreenshot(): void
  resize(height: number): void
  openDashboard(page?: 'tasks' | 'integrations' | 'memory' | 'history' | 'settings'): void
  // snip overlay
  snipDone(rect: { x: number; y: number; width: number; height: number } | null): void
  onSnipImage(cb: (dataUrl: string) => void): void
}
