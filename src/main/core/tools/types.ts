import type { z } from 'zod'
import type { ContextItem } from '@shared/types'
import type { Risk } from '../permissions'

export type ToolContext = {
  signal: AbortSignal
  /** Context attached to the current conversation turn (selection, screenshots, window). */
  context: ContextItem[]
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
