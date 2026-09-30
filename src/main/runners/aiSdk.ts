import { stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai'
import { z } from 'zod'
import type { AgentEvent } from '@shared/types'
import type { AgentRunner, RunnerSession, SessionOptions, UserTurn } from './types'

const MAX_STEPS = 20

/**
 * Any provider the Vercel AI SDK supports (Anthropic API key, OpenAI-compatible:
 * OpenAI, OpenRouter, Ollama, LM Studio…). Orbit owns the message history here.
 */
export class AISdkRunner implements AgentRunner {
  constructor(
    readonly id: string,
    private makeModel: (modelId: string) => LanguageModel
  ) {}

  createSession(opts: SessionOptions): RunnerSession {
    return new AISdkSession(this.makeModel(opts.model), opts)
  }
}

class AISdkSession implements RunnerSession {
  private history: ModelMessage[] = []
  private tools: ToolSet

  constructor(
    private model: LanguageModel,
    private opts: SessionOptions
  ) {
    this.tools = Object.fromEntries(
      opts.tools.map((t) => [
        t.name,
        tool({
          description: t.description,
          inputSchema: z.object(t.input),
          execute: async (input, { abortSignal }) => {
            const r = await t.call(input, abortSignal ?? AbortSignal.timeout(10 * 60_000))
            // Surfacing errors as text lets the model recover instead of aborting the run.
            return r.isError ? `ERROR: ${r.output}` : r.output
          }
        })
      ])
    )
  }

  async *send(turn: UserTurn, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const userMsg: ModelMessage = {
      role: 'user',
      content: [
        ...turn.images.map((img) => ({ type: 'image' as const, image: img.base64, mediaType: img.mediaType })),
        { type: 'text' as const, text: turn.text }
      ]
    }
    const messages = [...this.history, userMsg]

    try {
      const result = streamText({
        model: this.model,
        system: this.opts.system,
        messages,
        tools: this.tools,
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal: signal
      })
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') yield { type: 'text', delta: part.text }
        else if (part.type === 'error') yield { type: 'error', message: errorText(part.error) }
      }
      const response = await result.response
      this.history = [...messages, ...response.messages]
    } catch (err) {
      if (!signal.aborted) yield { type: 'error', message: errorText(err) }
    }
    yield { type: 'done' }
  }

  close(): void {
    this.history = []
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
