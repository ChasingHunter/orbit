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

export const QuickAction = z.object({
  label: z.string(),
  prompt: z.string(),
  /** popup: show the answer; replace: paste it over your selection; copy: put it on the clipboard. */
  output: z.enum(['popup', 'replace', 'copy']).default('popup')
})
export type QuickAction = z.infer<typeof QuickAction>

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
      autoSubmitDelayMs: z.number().int().min(0).default(700),
      /** toggle: press to start, press again to send. hold: hold while talking, let go to send (a quick tap still toggles). */
      mode: z.enum(['toggle', 'hold']).default('toggle')
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
      // Sonnet, not Opus: Opus uses up weekly subscription limits much faster.
      research: z.string().default('claude:sonnet'),
      /** How hard Claude thinks. Lower uses fewer tokens; 'auto' leaves it to Claude. */
      effort: z.enum(['auto', 'low', 'medium', 'high']).default('auto'),
      /** Used when offline or when the usual model hits a limit. 'auto' picks a local Ollama model. */
      fallback: z.string().default('auto')
    })
    .prefault({}),

  claude: z
    .object({
      /**
       * bundled: the Claude Code copy that ships with Orbit, pinned to a tested version.
       * installed: the claude you installed yourself (on PATH), so only one copy exists.
       */
      executable: z.enum(['bundled', 'installed']).default('bundled')
    })
    .prefault({}),

  permissions: z
    .object({
      /**
       * strict: ask before every tool, even reads. careful: ask before anything that acts outside
       * Orbit. trusted: ask only before destructive actions. full: never ask.
       */
      level: z.enum(['strict', 'careful', 'trusted', 'full']).default('careful')
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
        .prefault({}),
      /** Sandboxed Python: limits per run. */
      python: z
        .object({
          timeoutSec: z.number().int().min(5).max(900).default(60),
          memoryMb: z.number().int().min(256).max(4096).default(1024)
        })
        .prefault({}),
      /** Real PowerShell commands. Off until you turn it on in Permissions. */
      commands: z
        .object({
          enabled: z.boolean().default(false),
          timeoutSec: z.number().int().min(5).max(3600).default(120)
        })
        .prefault({})
    })
    .prefault({}),

  budget: z
    .object({
      /**
       * Most tokens background work (workflows, triggers, tasks) may use per day before it pauses.
       * Counts fresh input, cache writes and output; cheap cache reads are left out. 0 = no limit.
       */
      backgroundDailyTokens: z.number().int().min(0).default(300_000)
    })
    .prefault({}),

  speech: z
    .object({
      /** pocket: Kyutai Pocket TTS on this PC; windows: the built-in Windows voice. */
      engine: z.enum(['off', 'pocket', 'windows']).default('off'),
      /** voice: only answers to questions you asked by voice; always: every answer. */
      when: z.enum(['voice', 'always']).default('voice'),
      voice: z.string().default('alba'),
      pocketCommand: z.string().default('uvx pocket-tts'),
      port: z.number().int().default(8123)
    })
    .prefault({}),

  /** One-click actions shown in the bar when text is selected. */
  quickActions: z.array(QuickAction).default([
    { label: 'Explain', prompt: 'Explain this simply. If it is jargon-heavy, define the key terms.', output: 'popup' },
    { label: 'Summarise', prompt: 'Summarise this in 3 short bullets.', output: 'popup' },
    { label: 'Fix grammar', prompt: 'Fix spelling and grammar. Keep my wording, tone and formatting. Reply with only the corrected text.', output: 'replace' },
    { label: 'Translate to English', prompt: 'Translate this to natural English. Reply with only the translation.', output: 'popup' },
    { label: 'Reply', prompt: 'Draft a short, friendly reply to this message in my voice. Reply with only the draft.', output: 'copy' }
  ]),

  files: z
    .object({
      /** Folders read_file and list_folder may read. %DOWNLOADS%, %DESKTOP%, %DOCUMENTS% and ~ work. */
      allowedFolders: z.array(z.string()).default(['%DOWNLOADS%', '%DESKTOP%']),
      /** Of those, the ones Orbit may also change files in. Off for all by default. */
      writableFolders: z.array(z.string()).default([]),
      /** Backups taken before a change are kept this long, and within this much space. */
      snapshotDays: z.number().int().min(1).max(365).default(30),
      snapshotMaxMb: z.number().int().min(100).default(2048)
    })
    .prefault({}),

  /** Which skills are on: Orbit's own unless listed in off; Claude's only if listed in onFromClaude. Keys are "source:name". */
  skills: z
    .object({
      off: z.array(z.string()).default([]),
      onFromClaude: z.array(z.string()).default([])
    })
    .prefault({}),

  /** How long Orbit keeps its own logs and records. Your chats, memories and files aren't touched. */
  storage: z
    .object({
      /** Tool-call logs (rotated files). */
      logDays: z.number().int().min(7).default(90),
      /** Workflow run history. The latest 20 runs of each workflow are always kept. */
      workflowRunDays: z.number().int().min(1).default(30),
      /** Attachment copies, beyond the 30-day limit. */
      attachmentsMaxMb: z.number().int().min(100).default(1024),
      /** 0 keeps chats forever. */
      chatDays: z.number().int().min(0).default(0)
    })
    .prefault({}),

  ui: z
    .object({
      barPosition: z.enum(['cursor', 'center']).default('center'),
      hideOnBlur: z.boolean().default(true),
      startWithWindows: z.boolean().default(true),
      autoUpdate: z.boolean().default(true)
    })
    .prefault({}),

  persona: z
    .object({
      name: z.string().default('Orbit')
    })
    .prefault({})
})
export type Settings = z.infer<typeof Settings>
