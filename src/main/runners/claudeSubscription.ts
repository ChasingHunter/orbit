import {
  createSdkMcpServer,
  query,
  tool,
  type Query,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '@shared/types'
import { paths } from '../paths'
import { AsyncQueue } from '../asyncQueue'
import type { AgentRunner, RunnerSession, SessionOptions, UserTurn } from './types'

const SERVER = 'orbit'

/**
 * Uses the user's own logged-in Claude Code (via the Agent SDK) purely as model access.
 * All Claude Code built-ins, settings files, skills, plugins and claude.ai connectors are off;
 * the model can only call Orbit tools through one in-process MCP server.
 * Orbit never reads or stores OAuth tokens — the user runs `claude /login` themselves.
 */
export class ClaudeSubscriptionRunner implements AgentRunner {
  readonly id = 'claude-subscription'

  createSession(opts: SessionOptions): RunnerSession {
    return new ClaudeSession(opts)
  }
}

class ClaudeSession implements RunnerSession {
  private input = new AsyncQueue<SDKUserMessage>()
  private q: Query | undefined
  private turn: AsyncQueue<AgentEvent> | undefined

  constructor(private opts: SessionOptions) {}

  private start(): Query {
    const server = createSdkMcpServer({
      name: SERVER,
      version: '0.1.0',
      tools: this.opts.tools.map((t) =>
        tool(t.name, t.description, t.input, async (args, _extra) => {
          const r = await t.call(args, AbortSignal.timeout(10 * 60_000))
          return { content: [{ type: 'text', text: r.output }], isError: r.isError }
        })
      )
    })
    const allowed = this.opts.tools.map((t) => `mcp__${SERVER}__${t.name}`)

    // Never let an inherited API key silently switch billing away from the subscription.
    const { ANTHROPIC_API_KEY: _k, ANTHROPIC_AUTH_TOKEN: _t, ...env } = process.env

    const q = query({
      prompt: this.input,
      options: {
        model: this.opts.model,
        systemPrompt: this.opts.system,
        tools: [], // no built-in tools
        // Single gate: Orbit tools pass (Orbit's own executor handles approvals), anything else is denied.
        canUseTool: async (name) =>
          allowed.includes(name)
            ? { behavior: 'allow' }
            : { behavior: 'deny', message: 'Only Orbit tools are available.' },
        mcpServers: { [SERVER]: server },
        strictMcpConfig: true,
        settingSources: [],
        skills: [],
        persistSession: false,
        includePartialMessages: true,
        cwd: paths.files,
        env: {
          ...env,
          ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
          CLAUDE_AGENT_SDK_CLIENT_APP: 'orbit/0.1.0'
        },
        stderr: (d) => console.error('[claude]', d.trimEnd())
      }
    })
    void this.pump(q)
    return q
  }

  /** Routes the long-lived SDK output stream into the currently active turn. */
  private async pump(q: Query): Promise<void> {
    try {
      for await (const msg of q) this.handle(msg)
    } catch (err) {
      this.turn?.push({ type: 'error', message: errorText(err) })
    } finally {
      this.endTurn()
      this.q = undefined
    }
  }

  private handle(msg: SDKMessage): void {
    const turn = this.turn
    if (!turn) return
    switch (msg.type) {
      case 'stream_event': {
        if (msg.parent_tool_use_id) return
        const ev = msg.event
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          turn.push({ type: 'text', delta: ev.delta.text })
        } else if (ev.type === 'content_block_start' && ev.content_block.type === 'text' && ev.index > 0) {
          // Separate text blocks that surround tool calls.
          turn.push({ type: 'text', delta: '\n\n' })
        }
        return
      }
      case 'assistant':
        if (msg.error) turn.push({ type: 'error', message: assistantError(msg.error) })
        return
      case 'rate_limit_event': {
        const info = msg.rate_limit_info
        if (info.status === 'rejected') {
          const when = info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleTimeString() : 'later'
          turn.push({ type: 'rate-limit', resetsAt: info.resetsAt, message: `Claude limit reached until ${when}.` })
        }
        return
      }
      case 'result':
        if (msg.subtype !== 'success') turn.push({ type: 'error', message: msg.errors.join('\n') || msg.subtype })
        this.endTurn()
        return
    }
  }

  private endTurn(): void {
    this.turn?.push({ type: 'done' })
    this.turn?.close()
    this.turn = undefined
  }

  async *send(turn: UserTurn, signal: AbortSignal): AsyncIterable<AgentEvent> {
    if (this.turn) throw new Error('A turn is already running')
    const events = new AsyncQueue<AgentEvent>()
    this.turn = events
    this.q ??= this.start()

    const onAbort = (): void => {
      void this.q?.interrupt().catch(() => {})
    }
    signal.addEventListener('abort', onAbort)

    this.input.push({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          ...turn.images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 }
          })),
          { type: 'text' as const, text: turn.text }
        ]
      }
    })

    try {
      for await (const ev of events) {
        yield ev
        if (ev.type === 'done') break
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  close(): void {
    this.input.close()
    this.q?.close()
    this.q = undefined
  }
}

function assistantError(code: string): string {
  switch (code) {
    case 'authentication_failed':
      return 'Claude Code is not logged in. Run `claude` in a terminal and use /login, then try again.'
    case 'rate_limit':
      return 'Claude usage limit reached. Switch provider or try later.'
    case 'billing_error':
      return 'Claude subscription billing issue.'
    default:
      return `Claude error: ${code}`
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
