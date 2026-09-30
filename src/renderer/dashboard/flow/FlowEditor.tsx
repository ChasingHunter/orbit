import { useCallback, useEffect, useMemo, useState } from 'react'
import { Background, Controls, Handle, Position, ReactFlow, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Bot,
  Braces,
  GitBranch,
  Layers,
  Plus,
  Repeat,
  Save,
  Settings2,
  ShieldCheck,
  Wrench,
  X,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { Button, dash } from '../ui'
import { describeTriggerShort, layout, NODE_W, type Draft, type NodeData, type Path } from './model'
import { Panel, type Selection } from './Panel'

const ICONS: Record<NodeData['kind'], LucideIcon> = {
  trigger: Zap,
  tool: Wrench,
  agent: Bot,
  approval: ShieldCheck,
  code: Braces,
  if: GitBranch,
  foreach: Repeat,
  parallel: Layers,
  empty: Plus,
  group: Repeat
}
const LABELS: Record<NodeData['kind'], string> = {
  trigger: 'Trigger',
  tool: 'Tool',
  agent: 'Ask a model',
  approval: 'Review',
  code: 'Code',
  if: 'If / else',
  foreach: 'For each',
  parallel: 'At the same time',
  empty: '',
  group: ''
}

function OrbitNode({ data, selected }: NodeProps): React.JSX.Element {
  const d = data as NodeData
  if (d.kind === 'group') return <div className="h-full w-full rounded-xl border border-dashed border-sky-400/20 bg-sky-400/[0.03]" />
  const Icon = ICONS[d.kind]
  const empty = d.kind === 'empty'
  return (
    <div
      style={{ width: NODE_W }}
      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
        empty
          ? 'border-dashed border-white/15 bg-transparent text-zinc-500 hover:border-sky-400/50 hover:text-zinc-300'
          : selected
            ? 'border-sky-400/70 bg-zinc-900 shadow-[0_0_0_3px_rgba(56,189,248,0.15)]'
            : 'border-white/10 bg-zinc-900 hover:border-white/25'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-zinc-600" />
      <div className="flex items-center gap-2">
        <Icon size={14} className={empty ? '' : d.kind === 'trigger' ? 'text-amber-300' : 'text-sky-300'} />
        <span className="truncate text-[13px] font-medium text-zinc-100">{empty ? d.title : d.title}</span>
        {!empty && <span className="ml-auto text-[10px] text-zinc-500">{LABELS[d.kind]}</span>}
      </div>
      <div className="mt-1 truncate text-[11px] text-zinc-500">{d.subtitle}</div>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-zinc-600" />
    </div>
  )
}

const nodeTypes = { orbit: OrbitNode }

const BLANK: Draft = {
  name: 'my-workflow',
  trigger: { manual: true },
  steps: [{ id: 'write', agent: 'Write a two-line summary of today for me.' }]
}

export function FlowEditor(props: { name: string | null; onSaved: (name: string) => void; onCancel: () => void }): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(props.name ? null : BLANK)
  const [selection, setSelection] = useState<Selection>({ type: 'settings' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(!props.name)

  useEffect(() => {
    if (props.name) void dash.workflowGet(props.name).then((d) => setDraft(d as Draft))
  }, [props.name])

  const update = useCallback((next: Draft) => {
    setDraft(next)
    setDirty(true)
    setError('')
  }, [])

  const { nodes, edges } = useMemo(() => {
    if (!draft) return { nodes: [], edges: [] }
    const laid = layout(draft, describeTriggerShort(draft.trigger as Record<string, unknown>))
    const selKey = selection.type === 'step' ? `step:${selection.path.join('.')}` : selection.type === 'trigger' ? 'trigger' : ''
    return { nodes: laid.nodes.map((n) => ({ ...n, selected: n.id === selKey, draggable: false })), edges: laid.edges }
  }, [draft, selection])

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const name = await dash.workflowSave(props.name, draft)
      setDirty(false)
      props.onSaved(name)
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setSaving(false)
    }
  }

  if (!draft) return <div className="p-8 text-sm text-zinc-500">Loading…</div>

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold text-zinc-50">{draft.name || 'Untitled'}</div>
          <div className="text-xs text-zinc-500">{dirty ? 'Unsaved changes' : 'Saved'} · click a step to edit it</div>
        </div>
        <Button variant="ghost" icon={Settings2} onClick={() => setSelection({ type: 'settings' })}>
          Settings
        </Button>
        <Button variant="ghost" icon={X} onClick={props.onCancel}>
          Close
        </Button>
        <Button variant="primary" icon={Save} onClick={() => void save()} disabled={saving || !dirty}>
          Save
        </Button>
      </div>
      {error && <div className="mb-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-sm text-rose-300">{error}</div>}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-white/[0.07] bg-zinc-950" data-testid="flow-canvas">
          <ReactFlow
            // Re-fit the view when steps are added or removed.
            key={nodes.length}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            colorMode="dark"
            fitView
            minZoom={0.2}
            fitViewOptions={{ padding: 0.15, maxZoom: 1, minZoom: 0.2 }}
            nodesConnectable={false}
            nodesDraggable={false}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_e, node) => {
              const d = node.data as NodeData
              if (d.kind === 'trigger') setSelection({ type: 'trigger' })
              else if (d.kind === 'empty') setSelection({ type: 'insert', listPath: d.listPath! })
              else if (d.kind !== 'group') setSelection({ type: 'step', path: d.path as Path })
            }}
            onPaneClick={() => setSelection({ type: 'settings' })}
          >
            <Background color="#27272a" gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="w-[340px] shrink-0 overflow-y-auto rounded-xl border border-white/[0.07] bg-zinc-900/70 p-4">
          <Panel draft={draft} selection={selection} onChange={update} onSelect={setSelection} />
        </div>
      </div>
    </div>
  )
}
