import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-wasmfile-release-sync'

// Code steps run in QuickJS compiled to WebAssembly: no files, network, process or require,
// and hard limits on time and memory. Node's vm module isn't a sandbox, so it isn't used.

const TIME_LIMIT_MS = 2000
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024

let engine: Promise<QuickJSWASMModule> | undefined

/**
 * Runs `code` as a function body with the given variables in scope and returns what it returns.
 * Strings come back as they are; anything else as pretty JSON.
 */
export async function runCode(code: string, vars: Record<string, unknown>): Promise<string> {
  engine ??= newQuickJSWASMModuleFromVariant(variant)
  const qjs = await engine
  const prelude = Object.entries(vars)
    .map(([k, v]) => `const ${k} = ${JSON.stringify(v ?? null)};`)
    .join('\n')
  const program = `${prelude}\n(function () {\n${code}\n})()`
  let result: unknown
  try {
    result = qjs.evalCode(program, {
      shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + TIME_LIMIT_MS),
      memoryLimitBytes: MEMORY_LIMIT_BYTES
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
    if (/interrupted/i.test(msg)) throw new Error(`Code took longer than ${TIME_LIMIT_MS / 1000}s and was stopped`)
    if (/out of memory/i.test(msg)) throw new Error('Code used too much memory and was stopped')
    throw new Error(`Code failed: ${msg}`)
  }
  if (result === undefined) throw new Error('Code returned nothing. End it with a return statement.')
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
}
