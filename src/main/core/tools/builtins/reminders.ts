import { z } from 'zod'
import { scheduler } from '../../scheduler'
import { defineTool } from '../types'

export const setReminder = defineTool({
  name: 'set_reminder',
  description:
    'Show the user a desktop notification at a given time, once or on a repeating schedule. Works offline. Use the <now> time in the message to work out relative times like "in 20 minutes". For calendar events, use the calendar integration instead (or as well, if asked).',
  input: {
    text: z.string().describe('What to remind them about, written as the notification text'),
    at: z.string().optional().describe('Local date-time for a one-off reminder, ISO 8601 with offset, e.g. 2026-10-01T09:45:00+05:30'),
    repeat: z.string().optional().describe('Cron pattern for repeating reminders in local time, e.g. "0 9 * * 1-5" for weekdays at 9:00')
  },
  sideEffect: false,
  run: async ({ text, at, repeat }) => {
    if (!at && !repeat) throw new Error('Give either "at" or "repeat"')
    const s = scheduler.add({
      kind: 'reminder',
      title: text.slice(0, 120),
      payload: { text },
      at: at ? new Date(at) : undefined,
      cron: repeat
    })
    const next = scheduler.nextRunOf(s)
    return `Reminder set (id ${s.id.slice(0, 8)}). Next: ${next ? next.toLocaleString() : at}.`
  }
})

export const listReminders = defineTool({
  name: 'list_reminders',
  description: 'List upcoming reminders with their ids.',
  input: {},
  sideEffect: false,
  run: async () => {
    const items = scheduler.list(true, 'reminder')
    if (!items.length) return 'No reminders set.'
    return items
      .map((s) => {
        const next = scheduler.nextRunOf(s)
        return `${s.id.slice(0, 8)}: "${s.title}" ${s.cron ? `repeats (${s.cron})` : ''} next ${next ? next.toLocaleString() : 'n/a'}`
      })
      .join('\n')
  }
})

export const cancelReminder = defineTool({
  name: 'cancel_reminder',
  description: 'Cancel a reminder by the id from list_reminders (the first 8 characters are enough).',
  input: { id: z.string() },
  sideEffect: false,
  run: async ({ id }) => {
    const match = scheduler.list(false, 'reminder').find((s) => s.id.startsWith(id))
    if (!match) return `No reminder with id ${id}.`
    scheduler.remove(match.id)
    return `Cancelled "${match.title}".`
  }
})
