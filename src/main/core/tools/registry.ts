import { z } from 'zod'
import type { ToolPolicy } from '@shared/settings'
import { settings } from '../../settingsStore'
import { requestDecision } from '../approvals'
import { allowForThisChat, honorsPreApproval, isAllowedThisChat, policyOf, type Risk } from '../permissions'
import { audit } from '../audit'
import type { OrbitTool, RunnableTool, ToolContext, ToolResult } from './types'
import { builtinTools } from './builtins'
import { integrations } from '../../integrations/manager'

const MAX_OUTPUT = 40_000

/** Claude sees Orbit tools as mcp__orbit__<name>; accept that spelling anywhere a name is given. */
export function normalizeToolName(name: string): string {
  return name.replace(/^mcp__orbit__/, '')
}

export function allTools(): OrbitTool[] {
  return [...builtinTools, ...integrations.tools()]
}

function policyFor(tool: OrbitTool): ToolPolicy {
  return policyOf(tool.name, tool.risk).policy
}

/** For tools that approve themselves: would this tool ask right now? */
export function needsApproval(name: string, risk: Risk): boolean {
  return policyOf(name, risk).policy === 'ask' && !isAllowedThisChat(name)
}

type CallOptions = {
  signal: AbortSignal
  context: ToolContext['context']
  /** The user already approved this exact call (e.g. a workflow step they approved when saving it). */
  preApproved?: boolean
  /** Prefix for the approval card title, e.g. the workflow name. */
  origin?: string
}

/** Validation, policy, approval and audit around a single tool call. */
async function invoke(tool: OrbitTool, rawInput: unknown, opts: CallOptions): Promise<ToolResult> {
  if (policyFor(tool) === 'never') return { output: `${tool.name} is turned off in settings.`, isError: true }
  const parsed = z.object(tool.input).safeParse(rawInput)
  if (!parsed.success) return { output: `Invalid input: ${parsed.error.message}`, isError: true }
  const input = parsed.data

  const preApproved = !!opts.preApproved && honorsPreApproval()
  let decision: 'allowed' | 'approved' = preApproved ? 'approved' : 'allowed'
  if (policyFor(tool) === 'ask' && !preApproved && !tool.selfApproves && !isAllowedThisChat(tool.name)) {
    const title = tool.describe?.(input) ?? tool.name
    // Workflows run without a chat to remember "allow for this chat" in, so they only get yes/no.
    const answer = await requestDecision(
      { tool: tool.name, title: opts.origin ? `${opts.origin}: ${title}` : title, input, allowChat: !opts.origin },
      opts.signal
    )
    if (answer === 'chat') allowForThisChat(tool.name)
    const ok = answer !== 'deny'
    if (!ok) {
      audit({ tool: tool.name, input, decision: 'denied' })
      return { output: 'The user declined this action. Do not retry it unless asked.', isError: true }
    }
    decision = 'approved'
  }

  try {
    let output = await tool.run(input, { signal: opts.signal, context: opts.context })
    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n…[truncated]'
    audit({ tool: tool.name, input, decision, ok: true, output })
    return { output, isError: false }
  } catch (err) {
    const output = err instanceof Error ? err.message : String(err)
    audit({ tool: tool.name, input, decision, ok: false, output })
    return { output, isError: true }
  }
}

/** Calls one tool by name outside a model conversation (used by workflows). */
export function callTool(name: string, input: unknown, opts: CallOptions): Promise<ToolResult> {
  const tool = allTools().find((t) => t.name === normalizeToolName(name))
  if (!tool) return Promise.resolve({ output: `Tool "${name}" isn't available. Is its integration connected?`, isError: true })
  return invoke(tool, input, opts)
}

export function riskOf(name: string): Risk | undefined {
  return allTools().find((t) => t.name === normalizeToolName(name))?.risk
}

/**
 * Wraps each enabled tool with validation, policy, approval and audit.
 * Tools with policy "never" are not exposed to the model at all.
 */
export function runnableTools(
  getContext: () => ToolContext['context'],
  exclude: string[] = [],
  only?: string[]
): RunnableTool[] {
  return allTools()
    .filter((t) => policyFor(t) !== 'never' && !exclude.includes(t.name) && (!only || only.map(normalizeToolName).includes(t.name)))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input: tool.input,
      call: (rawInput, signal) => invoke(tool, rawInput, { signal, context: getContext() })
    }))
}
