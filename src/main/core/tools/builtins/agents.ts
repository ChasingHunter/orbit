import { z } from 'zod'
import { runAgent, tasks } from '../../tasks'
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
