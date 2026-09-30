import { z } from 'zod'
import { askUser } from '../../questions'
import { defineTool } from '../types'

export const askUserTool = defineTool({
  name: 'ask_user',
  description:
    "Ask the user a question and wait for the answer (up to 30 minutes). Only use this when you're running in the background (a task or workflow) and can't continue without their input. In a normal chat, just ask in your reply instead.",
  input: {
    question: z.string().describe('One clear question'),
    options: z.array(z.string()).max(5).optional().describe('Suggested answers shown as buttons; the user can also type their own')
  },
  risk: 'read',
  run: async ({ question, options }, { signal }) => {
    const answer = await askUser({ question, options: options ?? [], from: 'Background job' }, signal)
    return answer === null ? 'No answer (the user did not reply in time). Continue with your best judgement or stop and explain.' : `The user answered: ${answer}`
  }
})
