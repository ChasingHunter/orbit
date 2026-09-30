import { z } from 'zod'

// Single source of truth for every user-configurable value.
// settings.json is validated against this; missing fields fall back to defaults.

export const ToolPolicy = z.enum(['ask', 'always', 'never'])
export type ToolPolicy = z.infer<typeof ToolPolicy>

export const ProviderConfig = z.discriminatedUnion('type', [
  z.object({ type: z.literal('claude-subscription') }),
  z.object({ type: z.literal('anthropic-api'), keyName: z.string().default('anthropic') }),
  z.object({
    type: z.literal('openai-compatible'),
    // Covers OpenAI, OpenRouter, Ollama, LM Studio, etc.
    name: z.string(),
    baseURL: z.string().url(),
    keyName: z.string().optional()
  })
])
export type ProviderConfig = z.infer<typeof ProviderConfig>

export const Settings = z.object({
  hotkeys: z
    .object({
      bar: z.string().default('Control+Alt+Space'),
      screenshot: z.string().default('Control+Alt+S'),
      panic: z.string().default('Control+Alt+Escape')
    })
    .prefault({}),

  voice: z
    .object({
      // local = offline Parakeet model (free, unlimited); wispr = trigger Wispr Flow.
      engine: z.enum(['local', 'wispr', 'off']).default('local'),
      // Wispr combo as VK codes. Empty = read from Wispr's own config.json.
      wisprCombo: z.array(z.number().int()).default([]),
      // Start dictation automatically when the bar opens via hotkey.
      startOnBarOpen: z.boolean().default(true),
      autoSubmit: z.boolean().default(true),
      autoSubmitDelayMs: z.number().int().min(0).default(700)
    })
    .prefault({}),

  providers: z
    .record(z.string(), ProviderConfig)
    .default({
      claude: { type: 'claude-subscription' },
      ollama: { type: 'openai-compatible', name: 'ollama', baseURL: 'http://localhost:11434/v1' }
    }),

  // Model per purpose, as "<providerId>:<modelId>".
  models: z
    .object({
      chat: z.string().default('claude:sonnet'),
      quick: z.string().default('claude:haiku'),
      research: z.string().default('claude:opus')
    })
    .prefault({}),

  tools: z
    .object({
      // Per-tool override; tools not listed use their own default policy.
      policy: z.record(z.string(), ToolPolicy).default({}),
      webSearch: z
        .object({
          provider: z.enum(['brave', 'tavily']).default('brave')
        })
        .prefault({})
    })
    .prefault({}),

  ui: z
    .object({
      barPosition: z.enum(['cursor', 'center']).default('center'),
      hideOnBlur: z.boolean().default(true)
    })
    .prefault({}),

  persona: z
    .object({
      name: z.string().default('Orbit')
    })
    .prefault({})
})
export type Settings = z.infer<typeof Settings>
