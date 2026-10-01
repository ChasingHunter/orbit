import { z } from 'zod'
import { defineTool } from '../types'
import { activeProject, getProject, indexProject, listProjects, searchProject } from '../../projects'

export const searchProjectTool = defineTool({
  name: 'search_project',
  description:
    "Search a project's pinned files for passages that match. Without project, searches the active project (each message already includes its best few matches). Name another project to search that one.",
  input: {
    query: z.string(),
    project: z.string().optional().describe('Project name, when it is not the active one')
  },
  risk: 'read',
  available: () => listProjects().some((p) => p.paths.length > 0),
  run: async ({ query, project }) => {
    const wanted = project?.trim().toLowerCase()
    const p = wanted ? listProjects().find((x) => x.name.toLowerCase() === wanted) ?? listProjects().find((x) => x.name.toLowerCase().includes(wanted)) : activeProject() ? getProject(activeProject()!) : undefined
    if (!p) return wanted ? `No project called "${project}". Projects: ${listProjects().map((x) => x.name).join(', ') || 'none'}` : 'No project is active; name one.'
    if (!p.chunks) await indexProject(p.id)
    const hits = searchProject(p.id, query, 8)
    if (!hits.length) return `Nothing in ${p.name}'s files matches.`
    return hits.map((h) => `<untrusted_file path="${h.path}">\n${h.text}\n</untrusted_file>`).join('\n')
  }
})
