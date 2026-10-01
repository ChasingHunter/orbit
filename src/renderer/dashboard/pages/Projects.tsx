import { useCallback, useEffect, useState } from 'react'
import { FileText, FolderOpen, FolderPlus, Plus, Trash2, X } from 'lucide-react'
import type { ProjectInfo } from '@shared/dash'
import { Button, Card, dash, inputClass, PageHeader } from '../ui'

export function ProjectsPage(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [creating, setCreating] = useState(false)
  const load = useCallback(() => void dash.projects().then(setProjects), [])
  useEffect(() => {
    load()
    return dash.onChanged((w) => w === 'projects' && load())
  }, [load])

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Give Orbit instructions and files for one area of your work, then pick the project in the bar. Only the parts of the files that match each question go along with it, and memories saved while a project is active stay with that project."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />
      {creating && <Editor onDone={() => setCreating(false)} />}
      <div className="space-y-3">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
        {!projects.length && !creating && <p className="text-sm text-zinc-500">No projects yet.</p>}
      </div>
    </>
  )
}

function Editor(props: { project?: ProjectInfo; onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState(props.project?.name ?? '')
  const [instructions, setInstructions] = useState(props.project?.instructions ?? '')
  const [error, setError] = useState('')
  const save = async (): Promise<void> => {
    try {
      await dash.saveProject({ id: props.project?.id, name, instructions })
      props.onDone()
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  return (
    <Card className="mb-4 grid gap-3 p-4">
      <label className="block text-xs text-zinc-400">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kitchen renovation" className={`${inputClass} mt-1`} aria-label="Project name" />
      </label>
      <label className="block text-xs text-zinc-400">
        Instructions
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          placeholder="What Orbit should know or keep in mind for this project"
          className={`${inputClass} mt-1 resize-y`}
          aria-label="Project instructions"
        />
      </label>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void save()}>
          Save
        </Button>
        <Button variant="ghost" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  )
}

function ProjectCard({ project: p }: { project: ProjectInfo }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  if (editing) return <Editor project={p} onDone={() => setEditing(false)} />
  return (
    <Card className="p-4">
      <div data-project={p.name}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-100">{p.name}</div>
          <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{p.instructions || 'No instructions.'}</div>
        </div>
        <Button variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button variant="danger" icon={Trash2} title="Delete project" onClick={() => void dash.deleteProject(p.id)} />
      </div>
      <div className="mt-3 space-y-1">
        {p.paths.map((path) => (
          <div key={path} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/20 px-3 py-1.5 text-sm text-zinc-300">
            {/\.[a-z0-9]{1,5}$/i.test(path) ? <FileText size={14} className="shrink-0 text-zinc-500" /> : <FolderOpen size={14} className="shrink-0 text-zinc-500" />}
            <span className="flex-1 truncate">{path}</span>
            <Button variant="danger" icon={X} title="Unpin" onClick={() => void dash.removeProjectPath(p.id, path)} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button icon={FolderPlus} onClick={() => void dash.addProjectPaths(p.id, 'folder')}>
          Pin a folder
        </Button>
        <Button icon={FileText} onClick={() => void dash.addProjectPaths(p.id, 'files')}>
          Pin files
        </Button>
        <span className="ml-auto text-xs text-zinc-500">
          {p.files} file{p.files === 1 ? '' : 's'} indexed
        </span>
      </div>
      </div>
    </Card>
  )
}
