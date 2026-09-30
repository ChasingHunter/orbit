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

export const Step = z.union([ToolStep, AgentStep, ApprovalStep])

/**
 * Checks each step against the one schema its keys point to, so mistakes come back as
 * "steps.1.approved: unrecognized key" instead of zod's generic union error.
 */
export function stepProblems(rawSteps: unknown): string[] {
  if (!Array.isArray(rawSteps)) return []
  const problems: string[] = []
  rawSteps.forEach((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>
    const kinds = ['tool', 'agent', 'approval'].filter((k) => k in s)
    if (kinds.length !== 1) {
      problems.push(`steps.${i}: needs exactly one of tool, agent or approval (found ${kinds.join(', ') || 'none'})`)
      return
    }
    const schema = { tool: ToolStep, agent: AgentStep, approval: ApprovalStep }[kinds[0] as 'tool' | 'agent' | 'approval']
    const r = schema.safeParse(s)
    if (!r.success) for (const issue of r.error.issues) problems.push(`steps.${i}.${issue.path.join('.') || kinds[0]}: ${issue.message}`)
  })
  return problems
}
export type Step = z.infer<typeof Step>

export const Workflow = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Name: lowercase letters, numbers and dashes, e.g. daily-newsletter'),
    description: z.string().default(''),
    enabled: z.boolean().default(true),
    trigger: z.union([z.object({ cron: z.string() }), z.object({ manual: z.literal(true) })]).default({ manual: true }),
    /** What to do when the PC was off at the scheduled time. */
    missed: z.enum(['ask', 'run', 'skip']).default('ask'),
    model: z.string().default('chat').describe('quick, chat, research, or provider:model'),
    /** Agentic workflows: one prompt, the model decides which tools to use. */
    prompt: z.string().optional(),
    tools: z.array(z.string()).default([]),
    steps: z.array(Step).default([])
  })
  .refine((w) => !!w.prompt !== w.steps.length > 0, 'Give either a prompt or a list of steps, not both')
  .refine((w) => new Set(w.steps.map((s) => s.id)).size === w.steps.length, 'Step ids must be unique')

export type Workflow = z.infer<typeof Workflow>

export function stepKind(s: Step): 'tool' | 'agent' | 'approval' {
  if ('tool' in s) return 'tool'
  if ('agent' in s) return 'agent'
  return 'approval'
}

export function durationMs(d: string): number {
  const n = parseInt(d, 10)
  const unit = d.slice(-1)
  return n * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 's' | 'm' | 'h' | 'd']
}
