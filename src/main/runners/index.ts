import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { getSecret } from '../secrets'
import { settings } from '../settingsStore'
import { AISdkRunner } from './aiSdk'
import { ClaudeSubscriptionRunner } from './claudeSubscription'
import type { AgentRunner } from './types'

/** Resolves "<providerId>:<modelId>" (from settings.models) into a runner + model id. */
export function resolveModel(ref: string): { runner: AgentRunner; model: string } {
  const idx = ref.indexOf(':')
  if (idx < 0) throw new Error(`Model "${ref}" must look like "<provider>:<model>"`)
  const providerId = ref.slice(0, idx)
  const model = ref.slice(idx + 1)
  const cfg = settings.current.providers[providerId]
  if (!cfg) throw new Error(`Provider "${providerId}" is not configured in settings.json`)

  switch (cfg.type) {
    case 'claude-subscription':
      return { runner: new ClaudeSubscriptionRunner(), model }
    case 'anthropic-api': {
      const apiKey = getSecret(cfg.keyName)
      if (!apiKey) throw new Error(`No API key "${cfg.keyName}". Run "/key ${cfg.keyName} <key>" in the bar.`)
      const provider = createAnthropic({ apiKey })
      return { runner: new AISdkRunner(providerId, (m) => provider(m)), model }
    }
    case 'openai-compatible': {
      const apiKey = cfg.keyName ? getSecret(cfg.keyName) : undefined
      const provider = createOpenAICompatible({ name: cfg.name, baseURL: cfg.baseURL, apiKey })
      return { runner: new AISdkRunner(providerId, (m) => provider(m)), model }
    }
  }
}

/** True when the model runs on this machine, so private memories may be sent to it. */
export function isLocalModel(ref: string): boolean {
  const cfg = settings.current.providers[ref.slice(0, ref.indexOf(':'))]
  return cfg?.type === 'openai-compatible' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(cfg.baseURL)
}
