import { settings } from '../settingsStore'
import { ollamaModels } from './fallback'

// What the bar's model picker offers: the Claude models, whatever settings already point at,
// and the models pulled in Ollama. Picking one only affects the current chat.

const CLAUDE = ['claude:haiku', 'claude:sonnet', 'claude:opus']

export function modelLabel(ref: string): string {
  const [provider, ...rest] = ref.split(':')
  const model = rest.join(':')
  if (provider === 'claude') return `Claude ${model.charAt(0).toUpperCase()}${model.slice(1)}`
  if (provider === 'ollama') return `${model} (on this PC)`
  return `${model} (${provider})`
}

export async function modelChoices(current: string): Promise<{ current: string; options: { ref: string; label: string }[] }> {
  const m = settings.current.models
  const configured = [m.chat, m.quick, m.research].filter((r): r is string => typeof r === 'string')
  const local = settings.current.providers.ollama ? (await ollamaModels()).map((n) => `ollama:${n}`) : []
  const refs = [...new Set([...CLAUDE, ...configured, current, ...local])]
  return { current, options: refs.map((ref) => ({ ref, label: modelLabel(ref) })) }
}
