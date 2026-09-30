import { z } from 'zod'
import type { ToolPolicy } from '@shared/settings'
import { settings } from '../../settingsStore'
import { requestApproval } from '../approvals'
import { audit } from '../audit'
import type { OrbitTool, RunnableTool, ToolContext } from './types'
import { builtinTools } from './builtins'

const MAX_OUTPUT = 40_000

export function allTools(): OrbitTool[] {
  return builtinTools
}

function policyFor(tool: OrbitTool): ToolPolicy {
  return settings.current.tools.policy[tool.name] ?? (tool.sideEffect ? 'ask' : 'always')
}

/**
 * Wraps each enabled tool with validation, policy, approval and audit.
 * Tools with policy "never" are not exposed to the model at all.
 */
export function runnableTools(getContext: () => ToolContext['context']): RunnableTool[] {
  return allTools()
    .filter((t) => policyFor(t) !== 'never')
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input: tool.input,
      call: async (rawInput, signal) => {
        const parsed = z.object(tool.input).safeParse(rawInput)
        if (!parsed.success) return { output: `Invalid input: ${parsed.error.message}`, isError: true }
        const input = parsed.data

        let decision: 'allowed' | 'approved' = 'allowed'
        if (policyFor(tool) === 'ask') {
          const ok = await requestApproval(
            { tool: tool.name, title: tool.describe?.(input) ?? tool.name, input },
            signal
          )
          if (!ok) {
            audit({ tool: tool.name, input, decision: 'denied' })
            return { output: 'The user declined this action. Do not retry it unless asked.', isError: true }
          }
          decision = 'approved'
        }

        try {
          let output = await tool.run(input, { signal, context: getContext() })
          if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n…[truncated]'
          audit({ tool: tool.name, input, decision, ok: true, output })
          return { output, isError: false }
        } catch (err) {
          const output = err instanceof Error ? err.message : String(err)
          audit({ tool: tool.name, input, decision, ok: false, output })
          return { output, isError: true }
        }
      }
    }))
}
