import { z } from 'zod'
import { recentChanges, undoChange } from '../../journal'
import { defineTool } from '../types'

export const listChanges = defineTool({
  name: 'recent_changes',
  description:
    "List recent changes Orbit or the user made to Orbit's own things (saved files, memories, reminders, workflows), newest first, with ids for undo_change. Actions in other apps aren't here and can't be undone.",
  input: {},
  risk: 'read',
  run: async () => {
    const rows = recentChanges(15)
    if (!rows.length) return 'No changes recorded yet.'
    return rows.map((r) => `#${r.id} ${r.at.slice(0, 16).replace('T', ' ')} ${r.source}: ${r.summary}${r.undone_at ? ' (undone)' : ''}`).join('\n')
  }
})

export const undoChangeTool = defineTool({
  name: 'undo_change',
  description: 'Undo one change from recent_changes by its id. When the user says "undo that", undo the most recent change that fits.',
  input: { id: z.number().int() },
  risk: 'local',
  run: async ({ id }) => undoChange(id)
})
