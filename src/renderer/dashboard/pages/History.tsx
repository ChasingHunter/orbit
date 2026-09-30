import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, History as HistoryIcon, Trash2 } from 'lucide-react'
import type { ConversationItem, MessageItem } from '@shared/dash'
import { Markdown } from '../../bar/Markdown'
import { Button, Card, dash, Empty, PageHeader, timeAgo } from '../ui'

export function HistoryPage(): React.JSX.Element {
  const [items, setItems] = useState<ConversationItem[]>([])
  const [open, setOpen] = useState<ConversationItem | null>(null)
  const load = useCallback(() => void dash.conversations().then(setItems), [])

  useEffect(() => {
    load()
    return dash.onChanged((w) => w === 'history' && load())
  }, [load])

  if (open) return <Conversation item={open} onBack={() => setOpen(null)} />

  return (
    <>
      <PageHeader title="History" subtitle="Every conversation from the bar, newest first. Stored only on this PC." />
      {items.length === 0 ? (
        <Empty icon={HistoryIcon} title="No conversations yet">
          Press Ctrl+Alt+Space anywhere to start one.
        </Empty>
      ) : (
        <Card className="divide-y divide-white/[0.05]">
          {items.map((c) => (
            <div key={c.id} className="group flex items-center gap-3 px-4 py-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(c)}>
                <div className="truncate text-sm text-zinc-100">{c.title}</div>
                <div className="text-xs text-zinc-500">
                  {timeAgo(c.updated_at)} · {c.model}
                </div>
              </button>
              <span className="opacity-0 transition-opacity group-hover:opacity-100">
                <Button variant="danger" icon={Trash2} title="Delete" onClick={() => void dash.deleteConversation(c.id)} />
              </span>
            </div>
          ))}
        </Card>
      )}
    </>
  )
}

function Conversation({ item, onBack }: { item: ConversationItem; onBack: () => void }): React.JSX.Element {
  const [messages, setMessages] = useState<MessageItem[]>([])
  useEffect(() => void dash.messages(item.id).then(setMessages), [item.id])

  return (
    <>
      <div className="mb-4">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
          History
        </Button>
      </div>
      <PageHeader title={item.title} subtitle={`${new Date(item.created_at).toLocaleString()} · ${item.model}`} />
      <div className="space-y-5">
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md bg-white/[0.07] px-4 py-2 text-sm whitespace-pre-wrap text-zinc-200">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="text-sm">
              <Markdown text={m.text} />
            </div>
          )
        )}
      </div>
    </>
  )
}
