import { useCallback, useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { SkillInfo } from '@shared/dash'
import { Button, Card, dash, PageHeader } from '../ui'

export function SkillsPage(): React.JSX.Element {
  const [data, setData] = useState<{ skills: SkillInfo[]; orbitDir: string; claudeDir: string } | null>(null)
  const load = useCallback(() => void dash.skills().then(setData), [])
  useEffect(() => {
    load()
    return dash.onChanged((w) => w === 'settings' && load())
  }, [load])
  if (!data) return <></>

  const group = (source: SkillInfo['source']): SkillInfo[] => data.skills.filter((s) => s.source === source)
  const toggle = (s: SkillInfo, on: boolean): void => {
    setData({ ...data, skills: data.skills.map((x) => (x.key === s.key ? { ...x, enabled: on } : x)) })
    void dash.setSkillEnabled(s.key, on)
  }

  return (
    <>
      <PageHeader
        title="Skills"
        subtitle="Instructions Orbit can load when a task calls for them, in the same SKILL.md format Claude uses. Only the names and descriptions of skills that are on go with each message; the rest loads when it's used."
      />
      <Section
        title="Orbit's skills"
        hint="Put a folder with a SKILL.md here and it's on."
        skills={group('orbit')}
        empty="None yet."
        onOpen={() => void dash.openSkillsFolder('orbit')}
        onToggle={toggle}
      />
      <Section
        title="From Claude"
        hint={`Read from ${data.claudeDir} without copying. These start off, since most are written for Claude Code's own tools.`}
        skills={group('claude')}
        empty="No Claude skills found."
        onOpen={() => void dash.openSkillsFolder('claude')}
        onToggle={toggle}
      />
    </>
  )
}

function Section(props: {
  title: string
  hint: string
  skills: SkillInfo[]
  empty: string
  onOpen: () => void
  onToggle: (s: SkillInfo, on: boolean) => void
}): React.JSX.Element {
  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-100">{props.title}</div>
          <div className="text-xs text-zinc-500">{props.hint}</div>
        </div>
        <Button icon={FolderOpen} onClick={props.onOpen}>
          Open folder
        </Button>
      </div>
      {props.skills.length ? (
        <div className="divide-y divide-white/[0.05]">
          {props.skills.map((s) => (
            <label key={s.key} className="flex cursor-pointer items-start gap-3 py-2" data-skill={s.key}>
              <input type="checkbox" checked={s.enabled} onChange={(e) => props.onToggle(s, e.target.checked)} className="mt-1 accent-sky-500" aria-label={`Use ${s.name}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-zinc-200">{s.name}</span>
                <span className="line-clamp-2 block text-xs text-zinc-500">{s.description || 'No description.'}</span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">{props.empty}</p>
      )}
    </Card>
  )
}
