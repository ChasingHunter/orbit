import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { settings } from '../settingsStore'

// Spoken replies. Pocket TTS (Kyutai, runs on the CPU) through its local server, or Windows'
// built-in voice. Audio goes to the bar as raw 16-bit PCM chunks so playback starts right away.

export type PcmSink = (chunk: Uint8Array, sampleRate: number) => void

export const POCKET_VOICES = ['alba', 'marius', 'javert', 'jean', 'anna', 'vera', 'fantine', 'charles', 'paul', 'cosette', 'eponine', 'azelma']

let server: ChildProcess | undefined
let serverReady: Promise<string> | undefined

const base = (): string => `http://127.0.0.1:${settings.current.speech.port}`

async function responds(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/** Starts (or finds) the Pocket TTS server. Resolves with its base URL. */
function pocketServer(): Promise<string> {
  serverReady ??= (async () => {
    const url = base()
    if (await responds(url)) return url // already running (maybe the user's own)
    // One command string through the shell: uvx may be an .exe or a .cmd shim depending on how
    // uv was installed. The command comes from the user's own settings.
    const command = `${settings.current.speech.pocketCommand} serve --host 127.0.0.1 --port ${Number(settings.current.speech.port)}`
    // Started from the home folder: if Orbit is killed and this outlives it, it mustn't hold Orbit's
    // own folder open (that blocks updates and uninstalling).
    server = spawn(command, { windowsHide: true, stdio: 'ignore', shell: true, cwd: homedir() })
    server.on('exit', () => {
      server = undefined
      serverReady = undefined
    })
    for (let i = 0; i < 120; i++) {
      if (await responds(url)) return url
      if (!server) break
      await new Promise((r) => setTimeout(r, 1000))
    }
    serverReady = undefined
    throw new Error(`Pocket TTS didn't start. Check that "${settings.current.speech.pocketCommand} serve" works in a terminal.`)
  })()
  return serverReady
}

export function warmUpSpeech(): void {
  if (settings.current.speech.engine === 'pocket') void pocketServer().catch((err) => console.warn('[speech]', err.message))
}

/** Called on quit, so it waits: an async kill would be cut off when Orbit exits. */
export function stopSpeechServer(): void {
  if (server?.pid && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { windowsHide: true })
  else server?.kill()
  server = undefined
}

/** Reads a WAV header and returns [sampleRate, offset where PCM data starts]. */
function wavHeader(buf: Uint8Array): [number, number] | undefined {
  if (buf.length < 44 || String.fromCharCode(...buf.slice(0, 4)) !== 'RIFF') return undefined
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const rate = view.getUint32(24, true)
  // Walk chunks to find "data" (usually at 36).
  let p = 12
  while (p + 8 <= buf.length) {
    const id = String.fromCharCode(...buf.slice(p, p + 4))
    const size = view.getUint32(p + 4, true)
    if (id === 'data') return [rate, p + 8]
    p += 8 + size
  }
  return undefined
}

async function pocketSpeak(text: string, signal: AbortSignal, sink: PcmSink): Promise<void> {
  const url = await pocketServer()
  const form = new FormData()
  form.set('text', text)
  form.set('voice_url', settings.current.speech.voice)
  const res = await fetch(`${url}/tts`, { method: 'POST', body: form, signal })
  if (!res.ok || !res.body) throw new Error(`Pocket TTS failed: ${res.status}`)
  let head: Uint8Array = new Uint8Array(0)
  let rate = 0
  let carry: Uint8Array | undefined // odd byte left over between chunks
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    if (signal.aborted) return // stopped: drop what's still arriving
    let chunk = part
    if (!rate) {
      head = concat(head, chunk)
      const h = wavHeader(head)
      if (!h) continue
      rate = h[0]
      chunk = head.slice(h[1])
    }
    if (carry) chunk = concat(carry, chunk)
    carry = chunk.length % 2 ? chunk.slice(-1) : undefined
    const even = carry ? chunk.slice(0, -1) : chunk
    if (even.length) sink(even, rate)
  }
}

/** Windows' built-in voice via System.Speech. Robotic, but always there. */
function windowsSpeak(text: string, signal: AbortSignal, sink: PcmSink): Promise<void> {
  const script = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$ms = New-Object System.IO.MemoryStream
$s.SetOutputToAudioStream($ms, $fmt)
$s.Speak([Console]::In.ReadToEnd())
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))`
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    let out = ''
    ps.stdout.on('data', (d: Buffer) => (out += d.toString()))
    signal.addEventListener('abort', () => ps.kill())
    ps.on('exit', (code) => {
      if (signal.aborted) return resolve()
      if (code !== 0) return reject(new Error('Windows speech failed'))
      if (!signal.aborted) sink(new Uint8Array(Buffer.from(out, 'base64')), 22050)
      resolve()
    })
    ps.stdin.end(text)
  })
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** Turns markdown into something that sounds right read aloud. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Speaks sentences in order, one at a time; a new session cancels the old one. */
export class Speaker {
  private queue: string[] = []
  private abort: AbortController | undefined
  private running = false

  constructor(
    private sink: PcmSink,
    private onIdle: () => void,
    private onError: (message: string) => void
  ) {}

  say(text: string): void {
    const t = speakable(text)
    if (!t || settings.current.speech.engine === 'off') return
    this.abort ??= new AbortController()
    this.queue.push(t)
    void this.pump()
  }

  stop(): void {
    this.queue = []
    this.abort?.abort()
    this.abort = undefined
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length && this.abort) {
        const text = this.queue.shift()!
        const signal = this.abort.signal
        try {
          if (settings.current.speech.engine === 'windows') await windowsSpeak(text, signal, this.sink)
          else await pocketSpeak(text, signal, this.sink)
        } catch (err) {
          if (!signal.aborted) {
            this.onError((err as Error).message)
            this.stop()
          }
        }
      }
    } finally {
      this.running = false
      if (!this.queue.length) {
        this.abort = undefined
        this.onIdle()
      }
    }
  }
}
