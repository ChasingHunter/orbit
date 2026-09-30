// Contracts shared by main, preload and renderer.

export type ContextItem =
  | { kind: 'selection'; id: string; text: string; app: string }
  | { kind: 'screenshot'; id: string; mediaType: 'image/png' | 'image/jpeg'; base64: string; width: number; height: number; /** Set when the image was attached as a file. */ name?: string }
  /** A file attached in the bar: copied into Orbit's attachments folder, text pulled out up front. */
  | { kind: 'file'; id: string; name: string; path: string; size: number; text: string; chars: number }
  | { kind: 'window'; id: string; app: string; title: string }
  | { kind: 'url'; id: string; url: string }

export type ImageInput = { mediaType: 'image/png' | 'image/jpeg'; base64: string }

/** Provider-neutral stream events emitted by every AgentRunner. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; name: string; output: string; isError: boolean }
  | { type: 'rate-limit'; resetsAt?: number; message: string }
  /** Tokens used by the turn that just finished. input excludes cached tokens. */
  | { type: 'usage'; model: string; input: number; output: number; cacheRead: number; cacheWrite: number }
  | { type: 'error'; message: string }
  | { type: 'done' }

export type ApprovalRequest = {
  id: string
  tool: string
  title: string
  input: unknown
  /** Readable detail shown instead of the raw input. */
  preview?: string
  /** Offer "Allow for this chat" (not for workflow reviews). */
  allowChat?: boolean
}

/** State pushed from main to the bar window. */
export type BarEvent =
  | { type: 'open'; context: ContextItem[]; autoSubmitMs: number | null; speak?: 'off' | 'voice' | 'always'; quickActions: { label: string; prompt: string; output: 'popup' | 'replace' | 'copy' }[] }
  | { type: 'context-add'; item: ContextItem }
  | { type: 'listening'; value: boolean }
  | { type: 'agent'; turnId: string; event: AgentEvent }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'notice'; level: 'info' | 'error'; text: string; action?: { label: string; command: string } }
  /** Local engine: start/stop mic capture in the bar. discard = drop audio (bar closed). */
  | { type: 'record'; value: boolean; discard?: boolean }
  | { type: 'progress'; id: string; label: string; value: number; done?: boolean }
  | { type: 'memory-suggestion'; id: string; text: string }
  | { type: 'audio'; pcm: Uint8Array; rate: number }
  | { type: 'audio-stop' }
  | { type: 'question'; question: { id: string; question: string; options: string[]; from: string } }
  /** Shows an earlier conversation so the user can carry on with it. */
  | { type: 'restore'; title: string; messages: { role: 'user' | 'assistant'; text: string }[] }
  | { type: 'reset' }

export interface OrbitApi {
  onEvent(cb: (e: BarEvent) => void): () => void
  submit(text: string, context: ContextItem[], opts?: { quick?: boolean }): Promise<{ turnId: string }>
  cancel(): void
  /** Retry or edit: replaces the last exchange with this message. */
  rewind(text: string, context: ContextItem[]): Promise<{ turnId: string }>
  /** Models the picker offers, and the one this chat uses. */
  models(): Promise<{ current: string; options: { ref: string; label: string }[] }>
  /** Model for this chat only ('' goes back to the default). */
  setModel(ref: string): void
  newChat(): void
  approve(id: string, decision: 'once' | 'chat' | 'deny'): void
  answer(id: string, text: string): void
  saveMemory(text: string): Promise<void>
  speak(text: string): void
  stopSpeaking(): void
  toggleVoice(): void
  /** Local engine: 16 kHz mono samples -> text. */
  transcribe(samples: Float32Array): Promise<string>
  /** Transcript arrived in the input (e.g. Wispr stopped from its own UI). */
  voiceEnded(): void
  hide(): void
  copy(text: string): void
  replaceSelection(text: string): Promise<void>
  requestScreenshot(): void
  /** Attach files by path (drag and drop). Unreadable ones come back in errors. */
  attachPaths(paths: string[]): Promise<{ items: ContextItem[]; errors: string[] }>
  /** Attach pasted data that has no path on disk (e.g. an image copied from a browser). */
  attachData(name: string, data: Uint8Array): Promise<{ items: ContextItem[]; errors: string[] }>
  /** Keeps the bar open while a file picker is up (it would hide on blur otherwise). */
  keepOpen(on: boolean): void
  /** Path of a dropped File (Electron removed File.path). */
  pathForFile(file: File): string
  resize(height: number): void
  openDashboard(page?: 'tasks' | 'workflows' | 'integrations' | 'memory' | 'history' | 'settings'): void
  // snip overlay
  snipDone(rect: { x: number; y: number; width: number; height: number } | null): void
  onSnipImage(cb: (dataUrl: string) => void): void
}
