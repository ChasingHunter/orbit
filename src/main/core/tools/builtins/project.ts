import { z } from 'zod'
import { defineTool } from '../types'
import { activeProject, getProject, searchProject } from '../../projects'

export const searchProjectTool = defineTool({
  name: 'search_project',
  description: "Search the active project's pinned files for passages that match. Each message already includes the best few matches; use this to look for something else.",
  input: { query: z.string() },
  risk: 'read',
  available: () => !!activeProject() && (getProject(activeProject()!)?.paths.length ?? 0) > 0,
  run: async ({ query }) => {
    const id = activeProject()
    if (!id) return 'No project is active.'
    const hits = searchProject(id, query, 8)
    if (!hits.length) return 'Nothing in the project files matches.'
    return hits.map((h) => `<untrusted_file path="${h.path}">\n${h.text}\n</untrusted_file>`).join('\n')
  }
})
