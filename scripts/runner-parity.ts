// Runner parity smoke test: same prompt + mock tool on each configured runner.
// Run: npm run test:runners  (uses a little Claude subscription quota)
import { app } from 'electron'
import { z } from 'zod'
import { ClaudeSubscriptionRunner } from '../src/main/runners/claudeSubscription'
import { AISdkRunner } from '../src/main/runners/aiSdk'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { AgentRunner } from '../src/main/runners/types'
import type { RunnableTool } from '../src/main/core/tools/types'
import { ensureDataDirs } from '../src/main/paths'

const calls: string[] = []
const tools: RunnableTool[] = [
  {
    name: 'get_secret_number',
    description: 'Returns the secret number.',
    input: { reason: z.string().describe('Why you need it') },
    call: async (input) => {
      calls.push(JSON.stringify(input))
      return { output: '4217', isError: false }
    }
  }
]
const system = 'You are a test assistant. Use tools when needed. Be brief.'
const prompt =
  'Call get_secret_number, then reply with the number. Then, on a new line, list the exact names of ALL tools available to you, comma-separated.'

async function run(label: string, runner: AgentRunner, model: string): Promise<void> {
  calls.length = 0
  const session = runner.createSession({ system, model, tools })
  let text = ''
  const t0 = Date.now()
  for await (const ev of session.send({ text: prompt, images: [] }, new AbortController().signal)) {
    if (ev.type === 'text') text += ev.delta
    else if (ev.type !== 'done') console.log(`  [${label}] event`, JSON.stringify(ev))
  }
  session.close()
  console.log(`\n=== ${label} (${model}) ${Date.now() - t0}ms`)
  console.log('tool calls:', calls)
  console.log('text:', text.trim())
  console.log('PASS:', calls.length > 0 && text.includes('4217'))
}

app.whenReady().then(async () => {
  ensureDataDirs()
  const which = process.argv.slice(2).find((a) => !a.startsWith('-') && !a.endsWith('.cjs')) ?? 'claude'
  try {
    if (which === 'claude' || which === 'all') await run('claude-subscription', new ClaudeSubscriptionRunner(), 'haiku')
    if (which === 'ollama' || which === 'all') {
      const p = createOpenAICompatible({ name: 'ollama', baseURL: 'http://localhost:11434/v1' })
      await run('ollama', new AISdkRunner('ollama', (m) => p(m)), process.env.OLLAMA_MODEL ?? 'qwen3:4b')
    }
  } catch (err) {
    console.error('FAILED:', err)
  }
  app.quit()
})
