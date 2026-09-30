import { z } from 'zod'
import { getMemory, MEMORY_KINDS, searchMemories } from '../../memory'
import { addMemoryTracked, deleteMemoryTracked } from '../../changes'
import { defineTool } from '../types'

export const remember = defineTool({
  name: 'remember',
  description:
    'Save a durable fact about the user for future conversations: who people are, preferences, projects, how they like things done. Use it right away whenever the user asks you to remember, note or save something ("remember that..."). Never passwords, keys or card numbers.',
  input: {
    text: z.string().describe('One self-contained fact, e.g. "Sam is my cofounder; email sam@example.com; prefers WhatsApp"'),
    kind: z.enum(MEMORY_KINDS).optional().describe('Default: note')
  },
  risk: 'local',
  run: async ({ text, kind }) => {
    const m = addMemoryTracked(text, kind)
    return `Saved as memory #${m.id}.`
  }
})

export const recall = defineTool({
  name: 'recall',
  description: "Search the user's saved memories (people, preferences, projects, notes).",
  input: { query: z.string().describe('Words to search for, e.g. "Sam email"') },
  risk: 'read',
  run: async ({ query }) => {
    const found = searchMemories(query, 10)
    if (!found.length) return 'No matching memories.'
    return found.map((m) => `#${m.id} [${m.kind}] ${m.text}`).join('\n')
  }
})

export const forget = defineTool({
  name: 'forget',
  description: 'Delete a saved memory by its id (find it with recall first).',
  input: { id: z.number().int() },
  risk: 'local',
  describe: ({ id }) => {
    const m = getMemory(id)
    return m ? `Forget: "${m.text}"` : `Forget memory #${id}`
  },
  run: async ({ id }) => (deleteMemoryTracked(id) ? `Memory #${id} deleted. It can be undone from Logs.` : `No memory #${id}.`)
})
