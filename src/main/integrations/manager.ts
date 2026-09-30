import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'
import { getSecret } from '../secrets'
import type { OrbitTool } from '../core/tools/types'
import { loadServers, saveServers, type ServerConfig } from './config'
import { forgetOAuth, OrbitOAuthProvider } from './oauth'

export type IntegrationStatus = 'disabled' | 'connecting' | 'connected' | 'needs-auth' | 'missing-secret' | 'error'

export type IntegrationState = {
  id: string
  name: string
  type: ServerConfig['type']
  status: IntegrationStatus
  error?: string
  toolCount: number
}

type McpTool = Awaited<ReturnType<Client['listTools']>>['tools'][number]

type Live = {
  config: ServerConfig
  status: IntegrationStatus
  error?: string
  client?: Client
  tools: McpTool[]
}

const CALL_TIMEOUT_MS = 2 * 60_000

/** Claude's tool names are capped at 64 chars and Orbit's bridge adds "mcp__orbit__". */
function toolName(serverId: string, name: string): string {
  const full = `${serverId}__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (full.length <= 52) return full
  const hash = createHash('sha1').update(full).digest('hex').slice(0, 6)
  return `${full.slice(0, 45)}_${hash}`
}

function toShape(schema: McpTool['inputSchema']): z.ZodRawShape {
  try {
    const converted = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0])
    if (converted instanceof z.ZodObject) return converted.shape
  } catch (err) {
    console.warn('[integrations] could not convert tool schema, passing input through as-is', err)
  }
  return {}
}

/** Keeps one MCP client per configured server and exposes their tools to Orbit. */
class IntegrationManager extends EventEmitter {
  private live = new Map<string, Live>()

  states(): IntegrationState[] {
    return [...this.live.entries()].map(([id, l]) => ({
      id,
      name: l.config.name,
      type: l.config.type,
      status: l.status,
      error: l.error,
      toolCount: l.tools.length
    }))
  }

  private set(id: string, patch: Partial<Live>): void {
    const cur = this.live.get(id)
    if (!cur) return
    Object.assign(cur, patch)
    this.emit('change')
  }

  /** Connects every enabled server without opening any browser windows. */
  async startAll(): Promise<void> {
    const servers = loadServers()
    for (const [id, config] of Object.entries(servers)) {
      this.live.set(id, { config, status: config.enabled ? 'connecting' : 'disabled', tools: [] })
    }
    this.emit('change')
    await Promise.all(Object.keys(servers).filter((id) => servers[id].enabled).map((id) => this.connect(id, false)))
  }

  /**
   * Adds or replaces a server config and connects it. Only pass interactive = true
   * for a user's Connect click: it may open the browser for sign-in.
   */
  async upsert(id: string, config: ServerConfig, interactive: boolean): Promise<void> {
    const servers = loadServers()
    servers[id] = config
    saveServers(servers)
    await this.disconnect(id)
    this.live.set(id, { config, status: config.enabled ? 'connecting' : 'disabled', tools: [] })
    this.emit('change')
    if (config.enabled) await this.connect(id, interactive)
  }

  async remove(id: string): Promise<void> {
    await this.disconnect(id)
    this.live.delete(id)
    const servers = loadServers()
    delete servers[id]
    saveServers(servers)
    forgetOAuth(id)
    this.emit('change')
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const l = this.live.get(id)
    if (!l) return
    await this.upsert(id, { ...l.config, enabled }, false)
  }

  private async disconnect(id: string): Promise<void> {
    const l = this.live.get(id)
    await l?.client?.close().catch(() => {})
    if (l) {
      l.client = undefined
      l.tools = []
    }
  }

  private transport(id: string, config: ServerConfig, auth?: OrbitOAuthProvider): Transport | { missing: string } {
    if (config.type === 'http') {
      const headers: Record<string, string> = {}
      for (const [h, template] of Object.entries(config.secretHeaders)) {
        const m = template.match(/\{secret:([^}]+)\}/)
        const value = m ? getSecret(m[1]) : undefined
        if (m && !value) return { missing: m[1] }
        headers[h] = m ? template.replace(m[0], value!) : template
      }
      return new StreamableHTTPClientTransport(new URL(config.url), {
        authProvider: Object.keys(headers).length ? undefined : auth,
        requestInit: { headers }
      })
    }
    const env: Record<string, string> = { ...getDefaultEnvironment(), ...config.env }
    for (const [envVar, secretName] of Object.entries(config.secretEnv)) {
      const value = getSecret(secretName)
      if (!value) return { missing: secretName }
      env[envVar] = value
    }
    return new StdioClientTransport({ command: config.command, args: config.args, env, stderr: 'pipe' })
  }

  async connect(id: string, interactive: boolean): Promise<void> {
    const l = this.live.get(id)
    if (!l) return
    this.set(id, { status: 'connecting', error: undefined })
    const auth = l.config.type === 'http' ? new OrbitOAuthProvider(id, interactive) : undefined

    const attempt = async (): Promise<Client> => {
      const t = this.transport(id, l.config, auth)
      if ('missing' in t) throw new MissingSecret(t.missing)
      const client = new Client({ name: 'orbit', version: '0.1.0' })
      await client.connect(t)
      return client
    }

    try {
      let client: Client
      try {
        client = await attempt()
      } catch (err) {
        if (!(err instanceof UnauthorizedError) || !auth) throw err
        if (!interactive || !auth.codePromise) {
          this.set(id, { status: 'needs-auth' })
          return
        }
        const code = await auth.codePromise
        const t = this.transport(id, l.config, auth)
        if (t instanceof StreamableHTTPClientTransport) await t.finishAuth(code)
        client = await attempt()
      }
      const { tools } = await client.listTools()
      client.onclose = () => this.set(id, { status: 'error', error: 'Connection closed', client: undefined, tools: [] })
      this.set(id, { client, tools, status: 'connected' })
    } catch (err) {
      if (err instanceof MissingSecret) this.set(id, { status: 'missing-secret', error: `Needs the "${err.secret}" key` })
      else this.set(id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  /** All connected servers' tools, as Orbit tools. Read-only tools run freely; the rest ask first. */
  tools(): OrbitTool[] {
    const out: OrbitTool[] = []
    for (const [id, l] of this.live) {
      if (l.status !== 'connected' || !l.client) continue
      const client = l.client
      for (const t of l.tools) {
        const readOnly = t.annotations?.readOnlyHint === true
        out.push({
          name: toolName(id, t.name),
          description: `[${l.config.name}] ${t.description ?? t.title ?? t.name}`.slice(0, 1024),
          input: toShape(t.inputSchema),
          // The server's own labels decide the risk: read-only, destructive, or acting in the service.
          risk: readOnly ? 'read' : t.annotations?.destructiveHint === true ? 'destructive' : 'external',
          describe: () => `${l.config.name}: ${t.annotations?.title ?? t.title ?? t.name}`,
          run: async (input, { signal }) => {
            const res = await client.callTool({ name: t.name, arguments: input as Record<string, unknown> }, undefined, {
              signal,
              timeout: CALL_TIMEOUT_MS
            })
            const text = (res.content as { type: string; text?: string }[] | undefined)
              ?.map((c) => (c.type === 'text' ? c.text : `[${c.type} content]`))
              .join('\n')
            const body = text || JSON.stringify(res.structuredContent ?? res)
            if (res.isError) throw new Error(body)
            // Data from other services is untrusted, same as web pages.
            return `<untrusted_tool_output source="${l.config.name}">\n${body}\n</untrusted_tool_output>`
          }
        })
      }
    }
    return out
  }
}

class MissingSecret extends Error {
  constructor(readonly secret: string) {
    super(`Missing secret ${secret}`)
  }
}

export const integrations = new IntegrationManager()
