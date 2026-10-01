import { z } from 'zod'
import { defineTool } from '../types'
import { enabledSkills, loadSkill } from '../../skills'

// One tool whose description lists the skills that are turned on. The list is read each time a
// session starts, so turning a skill on or off applies to the next chat.

const tool = defineTool({
  name: 'use_skill',
  description: '',
  input: { name: z.string().describe('Skill name from the list') },
  risk: 'read',
  available: () => enabledSkills().length > 0,
  describe: ({ name }) => `Use the ${name} skill`,
  run: async ({ name }) => loadSkill(name)
})

Object.defineProperty(tool, 'description', {
  enumerable: true,
  get: () =>
    `Load a skill's instructions before doing a task it covers, then follow them. Skills:\n${enabledSkills()
      .map((s) => `- ${s.name}: ${s.description.slice(0, 200)}`)
      .join('\n')}`
})

export const useSkill = tool
