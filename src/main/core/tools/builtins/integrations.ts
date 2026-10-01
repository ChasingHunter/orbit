import { integrations } from '../../../integrations/manager'
import { z } from 'zod'
import { defineTool, type OrbitTool } from '../types'
import { settings } from '../../../settingsStore'
import { allTools, callTool } from '../registry'
import { policyOf } from '../../permissions'

const LABEL: Record<string, string> = {
  connected: 'connected',
  'needs-auth': 'needs sign-in',
  'missing-secret': 'missing its key',
  error: 'error',
  connecting: 'connecting',
  disabled: 'turned off'
}

export const listIntegrations = defineTool({
  name: 'list_integrations',
  description:
    "List the user's connected services (Notion, Slack, Gmail, etc.) and their status. Call this before saying you can't do something that needs an outside service, and tell the user to connect it in Orbit's dashboard if it's missing.",
  input: {},
  risk: 'read',
  run: async () => {
    const states = integrations.states()
    if (!states.length) return 'No services are connected yet. The user can add them in the Orbit dashboard under Integrations.'
    return states
      .map((s) => `${s.name}: ${LABEL[s.status] ?? s.status}${s.status === 'connected' ? ` (${s.toolCount} tools)` : ''}${s.error ? `, ${s.error}` : ''}`)
      .join('\n')
  }
})

/** Connected services whose tools are looked up on demand. */
function onDemand(): { id: string; name: string; tools: OrbitTool[] }[] {
  if (!settings.current.tools.connectorsOnDemand) return []
  const by = new Map<string, { id: string; name: string; tools: OrbitTool[] }>()
  for (const t of allTools()) {
    if (!t.service || policyOf(t.name, t.risk).policy === 'never') continue
    const entry = by.get(t.service.id) ?? { id: t.service.id, name: t.service.name, tools: [] }
    entry.tools.push(t)
    by.set(t.service.id, entry)
  }
  return [...by.values()]
}

function find(service: string): { id: string; name: string; tools: OrbitTool[] } {
  const s = service.toLowerCase()
  const hit = onDemand().find((x) => x.id.toLowerCase() === s || x.name.toLowerCase() === s)
  if (!hit) throw new Error(`No connected service called "${service}". Connected: ${onDemand().map((x) => x.name).join(', ') || 'none'}`)
  return hit
}

/** A tool's parameters, compactly: name, type, required, description. */
function params(schema: unknown): string {
  const s = schema as { properties?: Record<string, { type?: unknown; description?: string; enum?: unknown[] }>; required?: string[] } | undefined
  const props = Object.entries(s?.properties ?? {})
  if (!props.length) return '  (no arguments)'
  return props
    .map(([k, p]) => {
      const type = p.enum ? `one of ${p.enum.map((e) => JSON.stringify(e)).join('|')}` : Array.isArray(p.type) ? p.type.join('|') : (p.type ?? 'any')
      return `  ${k}${s?.required?.includes(k) ? '' : '?'}: ${type}${p.description ? ` - ${p.description.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`
    })
    .join('\n')
}

const serviceTools = defineTool({
  name: 'service_tools',
  description: '',
  input: { service: z.string().describe('Service name or id from the list') },
  risk: 'read',
  available: () => onDemand().length > 0,
  describe: ({ service }) => `Look up ${service}'s tools`,
  run: async ({ service }) => {
    const s = find(service)
    return `Tools for ${s.name} (run one with service_call):\n\n${s.tools
      .map((t) => `${t.service!.tool}: ${t.description.replace(/^\[[^\]]+\]\s*/, '').replace(/\s+/g, ' ').slice(0, 300)}\n${params(t.service!.inputSchema)}`)
      .join('\n\n')}`
  }
})

// Lists the connected services, so the model knows what's there without loading every tool.
Object.defineProperty(serviceTools, 'description', {
  enumerable: true,
  get: () =>
    `Look up the tools of one of the user's connected services before using it, then run them with service_call. Connected:\n${onDemand()
      .map((s) => `- ${s.name} (${s.id}): ${s.tools.length} tools`)
      .join('\n')}`
})
export { serviceTools }

export const serviceCall = defineTool({
  name: 'service_call',
  description: 'Run a tool of a connected service, as listed by service_tools. Same approvals as calling it directly.',
  input: {
    service: z.string(),
    tool: z.string().describe('Tool name from service_tools'),
    args: z.record(z.string(), z.unknown()).optional()
  },
  risk: 'read',
  // The real tool's own permission and approval apply (inside callTool), so this wrapper doesn't ask too.
  selfApproves: true,
  available: () => onDemand().length > 0,
  describe: ({ service, tool }) => `${service}: ${tool}`,
  run: async ({ service, tool, args }, { signal, context, source }) => {
    const s = find(service)
    const t = s.tools.find((x) => x.service!.tool === tool || x.name === tool)
    if (!t) throw new Error(`${s.name} has no tool "${tool}". Use service_tools to see them.`)
    const r = await callTool(t.name, args ?? {}, { signal, context, source })
    if (r.isError) throw new Error(r.output)
    return r.output
  }
})
