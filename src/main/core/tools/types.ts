import type { z } from 'zod'
import type { ContextItem } from '@shared/types'
import type { Risk } from '../permissions'

export type ToolContext = {
  signal: AbortSignal
  /** Context attached to the current conversation turn (selection, screenshots, window). */
  context: ContextItem[]
  /** chat: someone asked just now (files made are temporary). workflow: files are kept. */
  source: 'chat' | 'workflow'
}

/**
 * An Orbit tool: defined once, exposed identically to every runner.
 * `input` is a zod raw shape (what both the Agent SDK and AI SDK accept).
 */
export interface OrbitTool<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string
  description: string
  input: S
  /** What it can change; the autonomy level decides from this whether it asks first. */
  risk: Risk
  /** Asks for approval itself (after validating its input) instead of the registry asking. */
  selfApproves?: boolean
  /** One-line summary shown on the approval card. */
  describe?: (input: z.infer<z.ZodObject<S>>) => string
  /** Readable detail for the approval card (a list of renames, the text being replaced), shown instead of the raw input. */
  preview?: (input: z.infer<z.ZodObject<S>>) => string
  /** Asks before this call whatever the level or earlier "allow for this chat" (e.g. a password field). Only "never" still wins. */
  alwaysAsk?: (input: z.infer<z.ZodObject<S>>) => boolean
  /** Set on a connected service's tools. Those reach the model through service_tools/service_call unless loaded up front. */
  service?: { id: string; name: string; tool: string; inputSchema: unknown }
  /** Hidden from the model when this returns false, so unused tools cost no tokens. */
  available?: () => boolean
  run: (input: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<string>
}

export function defineTool<S extends z.ZodRawShape>(t: OrbitTool<S>): OrbitTool<S> {
  return t
}

export type ToolResult = { output: string; isError: boolean }

/** Tool as handed to a runner: policy/approval/audit already wrapped in. */
export type RunnableTool = {
  name: string
  description: string
  input: z.ZodRawShape
  call: (input: unknown, signal: AbortSignal) => Promise<ToolResult>
}
