import type { ToolPolicy } from '@shared/settings'
import { settings } from '../settingsStore'

// Who decides whether a tool runs: the autonomy level sets a default per risk class, per-tool
// overrides beat it, and "allow for this chat" beats both until the chat ends.

/**
 * read: only looks at things. local: changes Orbit's own data (memories, its files folder,
 * reminders), which can be undone. external: acts in another service (sends, posts, creates).
 * destructive: deletes or overwrites something outside Orbit.
 */
export type Risk = 'read' | 'local' | 'external' | 'destructive'
export type Autonomy = 'strict' | 'careful' | 'trusted' | 'full'

const LEVELS: Record<Autonomy, Record<Risk, ToolPolicy>> = {
  strict: { read: 'ask', local: 'ask', external: 'ask', destructive: 'ask' },
  careful: { read: 'always', local: 'always', external: 'ask', destructive: 'ask' },
  trusted: { read: 'always', local: 'always', external: 'always', destructive: 'ask' },
  full: { read: 'always', local: 'always', external: 'always', destructive: 'always' }
}

export function levelDefault(risk: Risk, level: Autonomy = settings.current.permissions.level): ToolPolicy {
  return LEVELS[level][risk]
}

/** The policy that applies to a tool right now, and where it came from. */
export function policyOf(name: string, risk: Risk): { policy: ToolPolicy; from: 'override' | 'level' } {
  const override = settings.current.tools.policy[name]
  return override ? { policy: override, from: 'override' } : { policy: levelDefault(risk), from: 'level' }
}

const allowedThisChat = new Set<string>()

export function allowForThisChat(name: string): void {
  allowedThisChat.add(name)
}

export function isAllowedThisChat(name: string): boolean {
  return allowedThisChat.has(name)
}

/** Called when a new chat starts, the bar resets, or the stop hotkey is pressed. */
export function clearChatAllows(): void {
  allowedThisChat.clear()
}

/** In "ask for everything", steps pre-approved when a workflow was saved still ask each run. */
export function honorsPreApproval(): boolean {
  return settings.current.permissions.level !== 'strict'
}
