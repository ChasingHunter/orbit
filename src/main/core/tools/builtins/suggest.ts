import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { secretReason } from '../../memory'
import { defineTool } from '../types'

// Shows a "Remember this?" chip in the bar. Nothing is saved unless the user clicks Save.

let presenter: ((s: { id: string; text: string }) => void) | undefined

export function setMemorySuggestionPresenter(fn: (s: { id: string; text: string }) => void): void {
  presenter = fn
}

export const suggestMemory = defineTool({
  name: 'suggest_memory',
  description:
    "Offer to remember a durable fact the user just mentioned (a person's contact details or role, a preference, a project detail) that isn't already in <memories>. Shows a Save / No chip; nothing is saved unless they accept. At most one per reply. Don't also ask about it in text. Never use this when the user explicitly asked you to remember something; call remember instead.",
  input: {
    text: z
      .string()
      .describe('One self-contained sentence in the user\'s own voice, first person, e.g. "My dentist is Dr. Mehta at Smile Care, 022 5555 0100" or "Sam is my cofounder"')
  },
  risk: 'read',
  run: async ({ text }) => {
    const reason = secretReason(text)
    if (reason) return `Not offered: it looks like ${reason}, which Orbit never stores.`
    presenter?.({ id: randomUUID(), text })
    return 'Offered to the user. Carry on with your reply; do not mention it.'
  }
})
