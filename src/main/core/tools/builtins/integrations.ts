import { integrations } from '../../../integrations/manager'
import { defineTool } from '../types'

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
  sideEffect: false,
  run: async () => {
    const states = integrations.states()
    if (!states.length) return 'No services are connected yet. The user can add them in the Orbit dashboard under Integrations.'
    return states
      .map((s) => `${s.name}: ${LABEL[s.status] ?? s.status}${s.status === 'connected' ? ` (${s.toolCount} tools)` : ''}${s.error ? `, ${s.error}` : ''}`)
      .join('\n')
  }
})
