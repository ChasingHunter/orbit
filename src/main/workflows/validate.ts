import YAML from 'yaml'
import { allTools } from '../core/tools/registry'
import { stepProblems, Workflow, type Step } from './schema'

/** Every tool name a workflow refers to: steps (nested too), agent tool lists, poll triggers. */
export function toolNames(wf: Workflow): string[] {
  const names: string[] = [...wf.tools]
  if ('poll' in wf.trigger) names.push(wf.trigger.poll.tool)
  const walk = (steps: Step[]): void => {
    for (const s of steps) {
      if ('tool' in s) names.push(s.tool)
      if ('agent' in s) names.push(...s.tools)
      if ('if' in s) walk([...s.then, ...s.else])
      if ('foreach' in s) walk(s.steps)
      if ('parallel' in s) walk(s.parallel)
    }
  }
  walk(wf.steps)
  return names
}

/** Tool names in the workflow that aren't available right now. */
export function unknownTools(wf: Workflow): string[] {
  const known = new Set(allTools().map((t) => t.name))
  return [...new Set(toolNames(wf))].filter((n) => !known.has(n))
}

/**
 * Validates a workflow given as plain data (from the visual editor) and returns it as YAML,
 * or throws with every problem listed.
 */
export function toValidYaml(data: unknown): { yaml: string; workflow: Workflow } {
  const raw = JSON.parse(JSON.stringify(data ?? {})) as Record<string, unknown>
  const problems = stepProblems(raw.steps)
  if (problems.length) throw new Error(problems.join('; '))
  const parsed = Workflow.safeParse(raw)
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.') || 'workflow'}: ${i.message}`).join('; '))
  const unknown = unknownTools(parsed.data)
  if (unknown.length) throw new Error(`Unknown tool${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`)
  // Write back what the user gave (not the parsed copy full of defaults), so the YAML stays short.
  return { yaml: YAML.stringify(raw, { lineWidth: 0 }), workflow: parsed.data }
}
