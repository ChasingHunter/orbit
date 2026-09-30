import { z } from 'zod'

// A workflow is either one agent prompt with tools ("agentic"), or a list of steps.
// Stored as YAML so people (and the model) can read and edit them.

const Duration = z
  .string()
  .regex(/^\d+(s|m|h|d)$/, 'Use a duration like 30m, 2h or 1d')
  .describe('e.g. 30m, 2h, 1d')

const Base = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]+$/i, 'Step ids use letters, numbers, - and _'),
  /** Skip this step unless the templated value is non-empty and not false/no/0. */
  when: z.string().optional()
})

export const ToolStep = Base.extend({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  /** Set when the user approved this exact step while saving the workflow; it then runs without asking. */
  approved: z.boolean().default(false),
  retries: z.number().int().min(0).max(5).default(0)
})

export const AgentStep = Base.extend({
  agent: z.string().describe('Instructions for the model'),
  input: z.string().optional().describe('Data for the model, usually {{steps.x.output}}'),
  tools: z.array(z.string()).default([]).describe('Tool names the model may use in this step'),
  model: z.string().optional(),
  retries: z.number().int().min(0).max(5).default(1)
})

export const ApprovalStep = Base.extend({
  approval: z.object({
    title: z.string().optional(),
    preview: z.string(),
    timeout: Duration.default('2h'),
    onTimeout: z.enum(['skip', 'continue', 'fail']).default('fail')
  })
})

/** A small JavaScript function body run in a sandbox; what it returns is the output. */
export const CodeStep = Base.extend({
  code: z.string().describe('JS function body; sees input, steps, item, index, trigger; must return a value'),
  input: z.string().optional()
})

type ToolStepT = z.infer<typeof ToolStep>
type CodeStepT = z.infer<typeof CodeStep>
type AgentStepT = z.infer<typeof AgentStep>
type ApprovalStepT = z.infer<typeof ApprovalStep>
type BaseT = z.infer<typeof Base>

/** Run `then` or `else`. The condition is a template value, or a yes/no question for the model. */
export type IfStepT = BaseT & { if: string | { ask: string; input?: string }; then: Step[]; else: Step[] }
/** Run the inner steps once per item; inside them, {{item}} and {{index}} are available. */
export type ForEachStepT = BaseT & {
  foreach: string
  split: 'auto' | 'lines' | 'json' | 'blocks'
  max: number
  concurrency: number
  steps: Step[]
}
/** Run the inner steps at the same time. */
export type ParallelStepT = BaseT & { parallel: Step[] }

export type Step = ToolStepT | AgentStepT | ApprovalStepT | CodeStepT | IfStepT | ForEachStepT | ParallelStepT

// Loosely typed on purpose: nested steps are recursive, which zod can't infer on its own.
const Steps = z.array(z.lazy((): z.ZodType<Step> => Step as z.ZodType<Step>))

export const IfStep = Base.extend({
  if: z.union([z.string(), z.strictObject({ ask: z.string(), input: z.string().optional() })]),
  then: Steps,
  else: Steps.default([])
})

export const ForEachStep = Base.extend({
  foreach: z.string().describe('Template that produces the list, e.g. {{steps.fetch.output}}'),
  split: z.enum(['auto', 'lines', 'json', 'blocks']).default('auto'),
  max: z.number().int().min(1).max(100).default(20),
  concurrency: z.number().int().min(1).max(5).default(1),
  steps: Steps
})

export const ParallelStep = Base.extend({ parallel: Steps })

export const Step: z.ZodType<Step> = z.union([ToolStep, AgentStep, ApprovalStep, CodeStep, IfStep, ForEachStep, ParallelStep]) as z.ZodType<Step>

const KINDS = { tool: ToolStep, agent: AgentStep, approval: ApprovalStep, code: CodeStep, if: IfStep, foreach: ForEachStep, parallel: ParallelStep }
type Kind = keyof typeof KINDS

/**
 * Checks each step (and nested ones) against the one schema its keys point to, so mistakes
 * come back as "steps.1.approved: unrecognized key" instead of zod's generic union error.
 */
export function stepProblems(rawSteps: unknown, path = 'steps'): string[] {
  if (!Array.isArray(rawSteps)) return []
  const problems: string[] = []
  rawSteps.forEach((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>
    const here = `${path}.${i}`
    const kinds = (Object.keys(KINDS) as Kind[]).filter((k) => k in s)
    if (kinds.length !== 1) {
      problems.push(`${here}: needs exactly one of ${Object.keys(KINDS).join(', ')} (found ${kinds.join(', ') || 'none'})`)
      return
    }
    const kind = kinds[0]
    // Check the step's own fields here; nested lists get their own, more precise messages below.
    const nested = kind === 'if' ? ['then', 'else'] : kind === 'foreach' ? ['steps'] : kind === 'parallel' ? ['parallel'] : []
    const shallow = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, nested.includes(k) ? [] : v]))
    const r = KINDS[kind].safeParse(shallow)
    if (!r.success) for (const issue of r.error.issues) problems.push(`${here}.${issue.path.join('.') || kind}: ${issue.message}`)
    for (const key of nested) problems.push(...stepProblems(s[key], `${here}.${key}`))
  })
  return problems
}

const Every = z
  .string()
  .regex(/^\d+(m|h|d)$/, 'Check interval like 15m, 2h or 1d')
  .refine((d) => durationMs(d) >= 60_000, 'Check at most once a minute')

/**
 * What starts a run. Event triggers check on an interval (or watch a folder, or listen for a
 * webhook) and pass what they found to the steps as {{trigger.*}}.
 */
export const Trigger = z.union([
  z.strictObject({ cron: z.string() }),
  z.strictObject({ manual: z.literal(true) }),
  /** New posts in an RSS/Atom feed. {{trigger.items}}, {{trigger.count}} */
  z.strictObject({ feed: z.strictObject({ url: z.string().url(), every: Every.default('30m') }) }),
  /** A web page (or one part of it) changed. {{trigger.changes}}, {{trigger.text}} */
  z.strictObject({ page: z.strictObject({ url: z.string().url(), selector: z.string().optional(), every: Every.default('1h') }) }),
  /** A read-only tool's result changed, e.g. a Gmail search. {{trigger.output}}, {{trigger.previous}} */
  z.strictObject({ poll: z.strictObject({ tool: z.string(), args: z.record(z.string(), z.unknown()).default({}), every: Every.default('15m') }) }),
  /** A new file appeared in a folder. {{trigger.file}}, {{trigger.name}} */
  z.strictObject({ folder: z.strictObject({ path: z.string(), pattern: z.string().default('*') }) }),
  /** Another app called Orbit's local webhook URL. {{trigger.body}}, {{trigger.query}} */
  z.strictObject({ webhook: z.literal(true) })
])
export type Trigger = z.infer<typeof Trigger>

export function triggerKind(t: Trigger): 'cron' | 'manual' | 'feed' | 'page' | 'poll' | 'folder' | 'webhook' {
  return Object.keys(t)[0] as ReturnType<typeof triggerKind>
}

export const Workflow = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Name: lowercase letters, numbers and dashes, e.g. daily-newsletter'),
    description: z.string().default(''),
    enabled: z.boolean().default(true),
    trigger: Trigger.default({ manual: true }),
    /** What to do when the PC was off at the scheduled time. */
    missed: z.enum(['ask', 'run', 'skip']).default('ask'),
    model: z.string().default('chat').describe('quick, chat, research, or provider:model'),
    /** What the run returns (and shows in notifications). Defaults to the last step's output. */
    output: z.string().optional(),
    /** Agentic workflows: one prompt, the model decides which tools to use. */
    prompt: z.string().optional(),
    tools: z.array(z.string()).default([]),
    steps: z.array(Step).default([])
  })
  .refine((w) => !!w.prompt !== w.steps.length > 0, 'Give either a prompt or a list of steps, not both')
  .refine((w) => new Set(w.steps.map((s) => s.id)).size === w.steps.length, 'Step ids must be unique')

export type Workflow = z.infer<typeof Workflow>

export function stepKind(s: Step): 'tool' | 'agent' | 'approval' | 'code' | 'if' | 'foreach' | 'parallel' {
  if ('tool' in s) return 'tool'
  if ('code' in s) return 'code'
  if ('agent' in s) return 'agent'
  if ('if' in s) return 'if'
  if ('foreach' in s) return 'foreach'
  if ('parallel' in s) return 'parallel'
  return 'approval'
}

export function durationMs(d: string): number {
  const n = parseInt(d, 10)
  const unit = d.slice(-1)
  return n * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 's' | 'm' | 'h' | 'd']
}
