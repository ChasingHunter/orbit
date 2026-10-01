import YAML from 'yaml'
import { allTools, parseArgs } from '../core/tools/registry'
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
 * Problems with tool steps' arguments, checked against each tool's real inputs: names that don't
 * exist, required ones that are missing, and fixed values of the wrong type (values with
 * {{...}} are only known at run time, so only their presence is checked).
 */
export function argProblems(wf: Workflow): string[] {
  const tools = new Map(allTools().map((t) => [t.name, t]))
  const out: string[] = []
  const walk = (steps: Step[]): void => {
    for (const s of steps) {
      if ('tool' in s) {
        const tool = tools.get(s.tool)
        if (tool) {
          const args = (s.args ?? {}) as Record<string, unknown>
          const known = Object.keys(tool.input)
          for (const k of Object.keys(args)) if (!known.includes(k)) out.push(`step ${s.id}: ${s.tool} has no argument "${k}" (it takes: ${known.join(', ') || 'none'})`)
          const templated = (v: unknown): boolean => JSON.stringify(v ?? '').includes('{{')
          const fixed = Object.fromEntries(Object.entries(args).filter(([, v]) => !templated(v)))
          const r = parseArgs(tool, fixed)
          if (!r.success) {
            for (const i of r.error.issues) {
              const key = String(i.path[0] ?? '')
              if (key && key in args && templated(args[key])) continue
              out.push(`step ${s.id}: ${s.tool} ${key ? `argument "${key}"` : 'arguments'}: ${i.message}`)
            }
          }
        }
      }
      if ('if' in s) walk([...s.then, ...s.else])
      if ('foreach' in s) walk(s.steps)
      if ('parallel' in s) walk(s.parallel)
    }
  }
  walk(wf.steps)
  return out
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
  const args = argProblems(parsed.data)
  if (args.length) throw new Error(args.join('; '))
  // Write back what the user gave (not the parsed copy full of defaults), so the YAML stays short.
  return { yaml: YAML.stringify(raw, { lineWidth: 0 }), workflow: parsed.data }
}
