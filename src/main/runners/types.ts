import type { AgentEvent, ImageInput } from '@shared/types'
import type { RunnableTool } from '../core/tools/types'

export type UserTurn = { text: string; images: ImageInput[] }

export type SessionOptions = {
  system: string
  model: string
  tools: RunnableTool[]
}

/** One conversation. The runner owns provider-specific history. */
export interface RunnerSession {
  send(turn: UserTurn, signal: AbortSignal): AsyncIterable<AgentEvent>
  close(): void
}

/** LLM adapter. Everything else (tools, memory, approvals) lives in Orbit core. */
export interface AgentRunner {
  readonly id: string
  createSession(opts: SessionOptions): RunnerSession
}
