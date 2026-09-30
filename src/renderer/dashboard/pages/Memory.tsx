import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, Lock, LockOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { MemoryItem, MemoryKind } from '@shared/dash'
import { Button, Card, dash, Empty, inputClass, PageHeader, selectClass, timeAgo } from '../ui'

const KINDS: { id: MemoryKind; label: string }[] = [
  { id: 'person', label: 'Person' },
  { id: 'preference', label: 'Preference' },
  { id: 'project', label: 'Project' },
  { id: 'profile', label: 'About me' },
  { id: 'note', label: 'Note' }
]
const kindLabel = (k: MemoryKind): string => KINDS.find((x) => x.id === k)?.label ?? k

export function MemoryPage(): React.JSX.Element {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const load = useCallback(() => void dash.memories().then(setItems), [])

  useEffect(() => {
    load()
    return dash.onChanged((w) => w === 'memory' && load())
  }, [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? items.filter((m) => m.text.toLowerCase().includes(q)) : items
  }, [items, query])

  return (
    <>
      <PageHeader
        title="Memory"
        subtitle="Things Orbit knows about you. The few that match what you ask get sent along with your message. Private ones only go to models running on this PC."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            Add
          </Button>
        }
      />
      {adding && <MemoryEditor onDone={() => setAdding(false)} />}
      {items.length > 0 && (
        <div className="relative mb-4">
          <Search size={15} className="absolute top-2.5 left-3 text-zinc-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memories" className={`${inputClass} pl-9`} />
        </div>
      )}
      {items.length === 0 && !adding ? (
        <Empty icon={Brain} title="No memories yet">
          Say "remember that…" in the bar, or add one here.
        </Empty>
      ) : (
        <div className="space-y-2">
          {shown.map((m) => (
            <MemoryRow key={m.id} item={m} />
          ))}
        </div>
      )}
    </>
  )
}

function MemoryRow({ item }: { item: MemoryItem }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  if (editing) return <MemoryEditor item={item} onDone={() => setEditing(false)} />
  return (
    <Card className="group flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 shrink-0 rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[11px] text-zinc-400">{kindLabel(item.kind)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-100">{item.text}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {item.private ? 'Private · ' : ''}updated {timeAgo(item.updated_at)}
        </p>
      </div>
      {item.private && <Lock size={14} className="mt-1 shrink-0 text-amber-300" aria-label="Private" />}
      <div className="flex shrink-0 opacity-60 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          icon={item.private ? LockOpen : Lock}
          title={item.private ? 'Share with all models' : 'Make private (local models only)'}
          onClick={() => void dash.updateMemory(item.id, { private: !item.private })}
        />
        <Button variant="ghost" icon={Pencil} title="Edit" onClick={() => setEditing(true)} />
        <Button variant="danger" icon={Trash2} title="Delete" onClick={() => void dash.deleteMemory(item.id)} />
      </div>
    </Card>
  )
}

function MemoryEditor({ item, onDone }: { item?: MemoryItem; onDone: () => void }): React.JSX.Element {
  const [text, setText] = useState(item?.text ?? '')
  const [kind, setKind] = useState<MemoryKind>(item?.kind ?? 'note')
  const [isPrivate, setPrivate] = useState(item?.private ?? false)
  const [error, setError] = useState('')

  const save = async (): Promise<void> => {
    try {
      if (item) await dash.updateMemory(item.id, { text, kind, private: isPrivate })
      else await dash.addMemory(text, kind, isPrivate)
      onDone()
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <Card className="mb-3 space-y-3 p-4">
      <textarea
        autoFocus
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Sam is my cofounder, email sam@example.com, prefers WhatsApp"
        className={`${inputClass} resize-none`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <select value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} className={selectClass}>
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} className="accent-sky-500" />
          Private (local models only)
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!text.trim()}>
            Save
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-rose-300">{error}</p>}
    </Card>
  )
}
