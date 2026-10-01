import { hostname } from 'node:os'
import { randomInt } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { AgentEvent, ApprovalRequest } from '@shared/types'
import { settings } from '../settingsStore'
import { getSecret } from '../secrets'
import { Conversation } from '../core/conversation'
import { resolveApproval, watchApprovals } from '../core/approvals'
import { logInfo } from '../log'

// Orbit from your phone, through a Telegram bot you create yourself. Orbit long-polls Telegram's
// API, so nothing listens on your PC and no server is involved; it works while Orbit is running.
// The bot answers one chat only: the one that sent the pairing code shown on the dashboard.
// Messages go through Telegram's servers, like any Telegram chat.

type Update = {
  update_id: number
  message?: { chat: { id: number }; text?: string }
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number; text?: string } }
}

const api = (): string => process.env.ORBIT_TELEGRAM_API ?? 'https://api.telegram.org'
const MAX = 4000

class TelegramBridge extends EventEmitter {
  private abort: AbortController | undefined
  private offset = 0
  private conversation: Conversation
  private turns = new Map<string, { text: string; files: string[]; done: () => void }>()
  private busy = false
  private stopWatching: (() => void) | undefined
  /** Single-use code you send the bot to pair this chat. */
  code = String(randomInt(100000, 1000000))
  botName = ''
  lastError = ''

  constructor() {
    super()
    this.conversation = new Conversation(
      (turnId, ev) => this.onEvent(turnId, ev),
      (text) => void this.send(text)
    )
  }

  get running(): boolean {
    return !!this.abort
  }

  private async call<T>(method: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const token = getSecret('telegram')
    if (!token) throw new Error('No bot token saved')
    const res = await fetch(`${api()}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal
    })
    const data = (await res.json()) as { ok: boolean; result: T; description?: string }
    if (!data.ok) throw new Error(data.description ?? `${method} failed`)
    return data.result
  }

  /** Starts polling if it's turned on and a token is saved. Safe to call again after changes. */
  restart(): void {
    this.stop()
    if (!settings.current.phone.enabled || !getSecret('telegram')) return
    this.abort = new AbortController()
    this.stopWatching = watchApprovals((req) => this.forwardApproval(req))
    void this.loop(this.abort.signal)
  }

  stop(): void {
    this.abort?.abort()
    this.abort = undefined
    this.stopWatching?.()
    this.stopWatching = undefined
  }

  private async loop(signal: AbortSignal): Promise<void> {
    try {
      this.botName = (await this.call<{ username: string }>('getMe', {}, signal)).username
      this.lastError = ''
      this.emit('change')
    } catch (err) {
      if (signal.aborted) return
      this.lastError = (err as Error).message
      this.emit('change')
    }
    while (!signal.aborted) {
      try {
        const updates = await this.call<Update[]>('getUpdates', { offset: this.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, signal)
        for (const u of updates) {
          this.offset = u.update_id + 1
          void this.handle(u).catch((err) => logInfo('telegram: handling an update failed', err))
        }
        if (this.lastError) {
          this.lastError = ''
          this.emit('change')
        }
      } catch (err) {
        if (signal.aborted) return
        this.lastError = (err as Error).message
        this.emit('change')
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
  }

  private paired(): number {
    return settings.current.phone.chatId
  }

  private async handle(u: Update): Promise<void> {
    if (u.callback_query) return this.onButton(u.callback_query)
    const msg = u.message
    if (!msg?.text) return
    const chat = msg.chat.id
    const text = msg.text.trim()
    if (!this.paired()) {
      if (text === this.code || text === `/start ${this.code}`) {
        settings.update((d) => {
          d.phone.chatId = chat
        })
        this.code = String(randomInt(100000, 1000000))
        this.emit('change')
        await this.send(`Paired with Orbit on ${hostname()}. Ask me anything; /new starts a new chat.`, chat)
      }
      return
    }
    // Everyone else is ignored, without a reply.
    if (chat !== this.paired()) return
    if (text === '/new' || text === '/start') {
      this.conversation.reset()
      return void this.send('New chat.')
    }
    if (text === '/stop') {
      this.conversation.cancel()
      return void this.send('Stopped.')
    }
    if (this.busy) return void this.send('Still working on your last message. Send /stop to cancel it.')
    await this.ask(text)
  }

  private async ask(text: string): Promise<void> {
    this.busy = true
    const typing = setInterval(() => void this.call('sendChatAction', { chat_id: this.paired(), action: 'typing' }).catch(() => {}), 4500)
    void this.call('sendChatAction', { chat_id: this.paired(), action: 'typing' }).catch(() => {})
    try {
      const turn = { text: '', files: [] as string[], done: () => {} }
      const finished = new Promise<void>((r) => (turn.done = r))
      const id = this.conversation.submit(text, [])
      this.turns.set(id, turn)
      await finished
      this.turns.delete(id)
      const files = turn.files.length ? `\n\nFiles on your PC:\n${turn.files.join('\n')}` : ''
      await this.send((turn.text.trim() || '(no answer)') + files)
    } catch (err) {
      await this.send(`That didn't work: ${(err as Error).message}`)
    } finally {
      clearInterval(typing)
      this.busy = false
    }
  }

  private onEvent(turnId: string, ev: AgentEvent): void {
    // submit() returns before the model starts, so the turn is always registered by now.
    const turn = this.turns.get(turnId)
    if (!turn) return
    if (ev.type === 'text') turn.text += ev.delta
    if (ev.type === 'tool-result' && !ev.isError) for (const m of ev.output.matchAll(/^Saved (.+)$/gm)) turn.files.push(m[1])
    if (ev.type === 'error') turn.text += `\n\n(${ev.message})`
    if (ev.type === 'done') turn.done()
  }

  /** Approvals asked while answering a phone message show up as buttons there too. */
  private forwardApproval(req: ApprovalRequest): void {
    if (!this.busy || !this.paired()) return
    const preview = req.preview ? `\n\n${req.preview.slice(0, 1500)}` : ''
    void this.call('sendMessage', {
      chat_id: this.paired(),
      text: `Approve? ${req.title}${preview}`,
      reply_markup: { inline_keyboard: [[{ text: 'Approve', callback_data: `ap:${req.id}:once` }, { text: 'Deny', callback_data: `ap:${req.id}:deny` }]] }
    }).catch((err) => logInfo('telegram: approval message failed', err))
  }

  private async onButton(q: NonNullable<Update['callback_query']>): Promise<void> {
    const chat = q.message?.chat.id
    if (!chat || chat !== this.paired()) return
    const m = q.data?.match(/^ap:([\w-]+):(once|deny)$/)
    if (!m) return
    resolveApproval(m[1], m[2] as 'once' | 'deny')
    await this.call('answerCallbackQuery', { callback_query_id: q.id, text: m[2] === 'once' ? 'Approved' : 'Denied' }).catch(() => {})
    if (q.message)
      await this.call('editMessageText', { chat_id: chat, message_id: q.message.message_id, text: `${q.message.text ?? ''}\n\n${m[2] === 'once' ? 'Approved' : 'Denied'}` }).catch(() => {})
  }

  async send(text: string, chat = this.paired()): Promise<void> {
    if (!chat) return
    for (let i = 0; i < text.length; i += MAX) await this.call('sendMessage', { chat_id: chat, text: text.slice(i, i + MAX) })
  }

  unpair(): void {
    settings.update((d) => {
      d.phone.chatId = 0
    })
    this.conversation.reset()
    this.code = String(randomInt(100000, 1000000))
    this.emit('change')
  }
}

export const telegram = new TelegramBridge()
