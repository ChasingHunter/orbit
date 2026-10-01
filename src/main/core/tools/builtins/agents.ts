import { z } from 'zod'
import { runAgent, tasks } from '../../tasks'
import { settings } from '../../../settingsStore'
import { budgetLeft, estimate, runResearch, type Depth } from '../../research'
import { defineTool } from '../types'

const purpose = z.enum(['quick', 'chat', 'research']).optional().describe('Model tier: quick (fast), chat (default), research (strongest)')

export const startBackgroundTask = defineTool({
  name: 'start_background_task',
  description:
    'Hand a long job (research, comparisons, multi-step lookups) to a background agent so the user can keep working. Returns immediately; the user gets a notification and the result is saved as a markdown file. Give complete, self-contained instructions: the agent cannot see this conversation.',
  input: {
    title: z.string().describe('Short label, e.g. "Postgres hosting comparison"'),
    instructions: z.string().describe('Everything the agent needs to know and what to deliver'),
    model: purpose
  },
  risk: 'local',
  run: async ({ title, instructions, model }) => {
    const id = tasks.start(title, instructions, model ?? 'research')
    return `Started background task "${title}" (id ${id.slice(0, 8)}). The user will get a notification when it's done.`
  }
})

export const spawnAgents = defineTool({
  name: 'spawn_agents',
  description:
    'Run up to 4 independent sub-tasks in parallel with separate agents and wait for all results. Use when work splits cleanly (e.g. research 3 options at once). Each instruction must be self-contained.',
  input: {
    agents: z
      .array(z.object({ title: z.string(), instructions: z.string() }))
      .min(1)
      .max(4),
    model: purpose
  },
  risk: 'local',
  run: async ({ agents, model }, { signal }) => {
    const results = await Promise.allSettled(agents.map((a) => runAgent(a.instructions, model ?? 'chat', signal)))
    return results
      .map((r, i) => `## ${agents[i].title}\n${r.status === 'fulfilled' ? r.value : `Failed: ${(r.reason as Error).message}`}`)
      .join('\n\n')
  }
})

const k = (n: number): string => `${Math.round(n / 1000)}k`

export const deepResearch = defineTool({
  name: 'deep_research',
  description:
    'Research a question thoroughly in the background: several agents search in parallel and a report with numbered sources is saved. Uses a lot of tokens, so only when the user asks for research, not for quick lookups.',
  input: {
    question: z.string().describe('The full question, self-contained'),
    depth: z.enum(['quick', 'standard', 'thorough']).optional().describe('Default standard')
  },
  risk: 'local',
  // It spends a big chunk of the plan, so it asks first unless the user chose Full autonomy.
  alwaysAsk: () => settings.current.permissions.level !== 'full',
  describe: ({ question }) => `Deep research: ${question.slice(0, 80)}`,
  preview: ({ depth = 'standard' }) => {
    const e = estimate(depth as Depth)
    const left = budgetLeft()
    return [
      `${depth[0].toUpperCase()}${depth.slice(1)} depth: about ${k(e.tokens)} tokens, usually ${e.minutes} minutes, in the background.`,
      left === undefined ? '' : `Your background budget has ${k(left)} left today; it stops early rather than go over ${k(Math.round(e.tokens * 1.5))}.`
    ]
      .filter(Boolean)
      .join('\n')
  },
  run: async ({ question, depth = 'standard' }) => {
    const e = estimate(depth as Depth)
    const left = budgetLeft()
    if (left !== undefined && left < e.tokens / 2) {
      return `Not started: this needs about ${k(e.tokens)} tokens and today's background budget has ${k(left)} left. Offer the quick depth, or the user can raise the budget on the Usage page.`
    }
    const title = question.length > 70 ? `${question.slice(0, 67)}...` : question
    const id = tasks.start(`Research: ${title}`, question, 'research', (signal, progress) => runResearch(question, depth as Depth, signal, progress))
    return `Started deep research (id ${id.slice(0, 8)}, about ${k(e.tokens)} tokens, ${e.minutes} minutes). The user gets a notification when the report is ready, and can follow it on the Tasks page.`
  }
})
