import { z } from 'zod'
import type { ToolPolicy } from '@shared/settings'
import { settings } from '../../settingsStore'
import { requestDecision } from '../approvals'
import { allowForThisChat, honorsPreApproval, isAllowedThisChat, policyOf, type Risk } from '../permissions'
import { audit } from '../audit'
import type { OrbitTool, RunnableTool, ToolContext, ToolResult } from './types'
import { builtinTools } from './builtins'
import { integrations } from '../../integrations/manager'

/** About 6k tokens: tool results stay in the chat and are re-read with every later message. */
const MAX_OUTPUT = 24_000

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
  /** Who's asking; defaults to workflow (files it makes are kept). */
  source?: ToolContext['source']
}

/** Validation, policy, approval and audit around a single tool call. */
async function invoke(tool: OrbitTool, rawInput: unknown, opts: CallOptions): Promise<ToolResult> {
  if (policyFor(tool) === 'never') return { output: `${tool.name} is turned off in settings.`, isError: true }
  const parsed = parseArgs(tool, rawInput)
  if (!parsed.success) return { output: `Invalid input: ${parsed.error.message}`, isError: true }
  const input = parsed.data

  const logged = tool.auditInput ? tool.auditInput(input) : input
  const mustAsk = !!tool.alwaysAsk?.(input)
  const preApproved = !!opts.preApproved && honorsPreApproval() && !mustAsk
  let decision: 'allowed' | 'approved' = preApproved ? 'approved' : 'allowed'
  if (mustAsk || (policyFor(tool) === 'ask' && !preApproved && !tool.selfApproves && !isAllowedThisChat(tool.name))) {
    const title = tool.describe?.(input) ?? tool.name
    let preview: string | undefined
    try {
      preview = tool.preview?.(input)
    } catch (err) {
      // A preview that can't be built (file missing, path refused) means the call would fail too.
      const output = err instanceof Error ? err.message : String(err)
      audit({ tool: tool.name, input: logged, decision: 'allowed', ok: false, output })
      return { output, isError: true }
    }
    // Workflows run without a chat to remember "allow for this chat" in, so they only get yes/no.
    const answer = await requestDecision(
      { tool: tool.name, title: opts.origin ? `${opts.origin}: ${title}` : title, input, preview, previewKind: tool.previewKind, allowChat: !opts.origin && !mustAsk },
      opts.signal
    )
    if (answer === 'chat' && !mustAsk) allowForThisChat(tool.name)
    const ok = answer !== 'deny'
    if (!ok) {
      audit({ tool: tool.name, input: logged, decision: 'denied' })
      return { output: 'The user declined this action. Do not retry it unless asked.', isError: true }
    }
    decision = 'approved'
  }

  try {
    let output = await tool.run(input, { signal: opts.signal, context: opts.context, source: opts.source ?? 'workflow' })
    if (output.length > MAX_OUTPUT) output = `${output.slice(0, MAX_OUTPUT)}\n…[cut at ${MAX_OUTPUT} of ${output.length} characters; ask for less, e.g. with a filter or a smaller page size]`
    audit({ tool: tool.name, input: logged, decision, ok: true, output })
    return { output, isError: false }
  } catch (err) {
    const output = err instanceof Error ? err.message : String(err)
    audit({ tool: tool.name, input: logged, decision, ok: false, output })
    return { output, isError: true }
  }
}

/**
 * Permission check for a tool that runs inside the model provider rather than through Orbit
 * (Claude's own web search). Same policy and approval card as Orbit's tool of that name; the
 * caller audits the result. Returns how it was allowed, or null if denied (already audited).
 */
export async function gateProviderTool(name: string, input: unknown, signal: AbortSignal): Promise<'allowed' | 'approved' | null> {
  const tool = allTools().find((t) => t.name === name)
  if (!tool || policyFor(tool) === 'never') {
    audit({ tool: name, input, decision: 'blocked' })
    return null
  }
  if (policyFor(tool) !== 'ask' || isAllowedThisChat(name)) return 'allowed'
  const answer = await requestDecision({ tool: name, title: tool.describe?.(input as never) ?? name, input, allowChat: true }, signal)
  if (answer === 'chat') allowForThisChat(name)
  if (answer === 'deny') {
    audit({ tool: name, input, decision: 'denied' })
    return null
  }
  return 'approved'
}

/**
 * Parses a tool's input, fixing the obvious slips first (as n8n does): a number or true/false
 * written as text, like limit: "15", becomes 15. Anything else that doesn't fit is still an error.
 */
export function parseArgs(tool: OrbitTool, raw: unknown): ReturnType<ReturnType<typeof z.object>['safeParse']> {
  const schema = z.object(tool.input)
  const first = schema.safeParse(raw)
  if (first.success || !raw || typeof raw !== 'object') return first
  const fixed: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  let changed = false
  for (const issue of first.error.issues) {
    if (issue.code !== 'invalid_type' || issue.path.length !== 1) continue
    const key = String(issue.path[0])
    const v = fixed[key]
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (issue.expected === 'number' && t !== '' && Number.isFinite(Number(t))) (fixed[key] = Number(t), (changed = true))
    else if (issue.expected === 'boolean' && /^(true|false)$/i.test(t)) (fixed[key] = t.toLowerCase() === 'true', (changed = true))
  }
  return changed ? schema.safeParse(fixed) : first
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
  only?: string[],
  source: ToolContext['source'] = 'chat'
): RunnableTool[] {
  return allTools()
    .filter((t) => {
      if (policyFor(t) === 'never' || !(t.available?.() ?? true) || exclude.includes(t.name)) return false
      if (only) return only.map(normalizeToolName).includes(t.name)
      // A connected service's tools are reached through service_tools/service_call, so their
      // descriptions don't ride along with every message. Naming them explicitly (above) still works.
      return !(t.service && settings.current.tools.connectorsOnDemand)
    })
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input: tool.input,
      call: (rawInput, signal) => invoke(tool, rawInput, { signal, context: getContext(), source })
    }))
}
