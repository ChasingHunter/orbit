import { net } from 'electron'
import { settings } from '../settingsStore'
import { isLocalModel } from './index'

// Picks a model that still works when the usual one can't: no internet, or a Claude usage limit.

let ollamaCache: { at: number; models: string[] } | undefined

async function ollamaModels(): Promise<string[]> {
  if (ollamaCache && Date.now() - ollamaCache.at < 60_000) return ollamaCache.models
  const cfg = settings.current.providers.ollama
  const base = cfg?.type === 'openai-compatible' ? cfg.baseURL.replace(/\/v1\/?$/, '') : 'http://localhost:11434'
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) })
    const data = (await res.json()) as { models?: { name: string }[] }
    ollamaCache = { at: Date.now(), models: (data.models ?? []).map((m) => m.name) }
  } catch {
    ollamaCache = { at: Date.now(), models: [] }
  }
  return ollamaCache.models
}

/** "provider:model" to use instead, or undefined if nothing local is set up. */
export async function fallbackModel(): Promise<string | undefined> {
  const configured = settings.current.models.fallback
  if (configured && configured !== 'auto') return configured
  if (!settings.current.providers.ollama) return undefined
  const models = await ollamaModels()
  // Prefer models that are decent at tool use.
  const pick = ['qwen3', 'qwen2.5', 'llama3.1', 'llama3.2', 'mistral', 'gemma3'].map((p) => models.find((m) => m.startsWith(p))).find(Boolean) ?? models[0]
  return pick ? `ollama:${pick}` : undefined
}

export function isOnline(): boolean {
  if (process.env.ORBIT_E2E_OFFLINE) return false
  return net.isOnline()
}

/** True when this model needs the internet. */
export function isCloudModel(ref: string): boolean {
  return !isLocalModel(ref)
}
