import { z } from 'zod'
import { recentChanges, undoChange } from '../../journal'
import { defineTool } from '../types'

export const listChanges = defineTool({
  name: 'recent_changes',
  description:
    "List recent changes Orbit or the user made to Orbit's own things (saved files, memories, reminders, workflows) and to files in the user's writable folders, newest first, with ids for undo_change. Actions in other apps aren't here and can't be undone.",
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
  description:
    'Undo a change. Leave out id to undo the most recent one (what "undo that" means); pass an id from recent_changes only for an older one. If it reports the file changed since, tell the user and only pass force after they agree.',
  input: { id: z.number().int().optional(), force: z.boolean().optional() },
  risk: 'local',
  run: async ({ id, force }) => {
    const target = id ?? recentChanges(50).find((c) => !c.undone_at)?.id
    if (target === undefined) return 'Nothing to undo.'
    return undoChange(target, force)
  }
})
