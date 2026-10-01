import type { BarEvent } from '@shared/types'
import { settings } from '../settingsStore'
import { toggleWispr } from '../os/wispr'
import { installModel, isModelInstalled, MODEL, warmUp } from './localStt'
import { LiveTranscriber } from './live'
import { logInfo } from '../log'

/** A recording stops by itself after this long. */
const MAX_SECONDS = 300

type Send = (e: BarEvent) => void

/**
 * One toggle for every dictation engine.
 * - local: the bar records the mic; main transcribes with the offline model.
 * - wispr: Orbit injects Wispr Flow's hands-free hotkey; Wispr pastes the transcript.
 */
export class VoiceController {
  listening = false
  private live: LiveTranscriber | undefined
  private started = 0
  private maxTimer: NodeJS.Timeout | undefined
  /** Resolves when the bar has sent its last audio after being told to stop. */
  private recorderDone: (() => void) | undefined

  constructor(private send: Send) {}

  private set(value: boolean, discard = false): void {
    const engine = settings.current.voice.engine
    this.listening = value
    this.send({ type: 'listening', value })
    if (engine === 'local') this.send({ type: 'record', value, discard })
  }

  /** Audio from the bar while recording; transcribed piece by piece as you pause. */
  chunk(samples: Float32Array): void {
    this.live?.push(samples)
  }

  /** The bar stopped its recorder and sent everything. */
  recorderEnded(): void {
    this.recorderDone?.()
  }

  /** The bar couldn't open the mic: stop showing "listening". */
  micFailed(): void {
    this.live?.cancel()
    this.live = undefined
    clearTimeout(this.maxTimer)
    this.listening = false
    this.send({ type: 'listening', value: false })
  }

  /** Stops the recorder in the bar, waits (up to 5 s) for its last audio, then finishes the text. */
  private async finishLocal(discard: boolean): Promise<void> {
    clearTimeout(this.maxTimer)
    const live = this.live
    this.live = undefined
    const done = new Promise<void>((r) => {
      this.recorderDone = r
      setTimeout(r, 5000)
    })
    this.set(false, discard)
    if (!live) return
    if (discard) {
      live.cancel()
      return
    }
    this.send({ type: 'transcribing', value: true })
    try {
      await done
      const t0 = Date.now()
      const text = await live.finish()
      logInfo(`stt: ${(live.samples / 16000).toFixed(1)}s audio, ${live.piecesDone} pieces done while talking, last bit in ${Date.now() - t0} ms -> ${text.length} chars`)
      this.send({ type: 'transcript', text })
    } catch (err) {
      this.send({ type: 'notice', level: 'error', text: `Transcription failed: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      this.recorderDone = undefined
      this.send({ type: 'transcribing', value: false })
    }
  }

  async start(): Promise<void> {
    if (this.listening) return
    const engine = settings.current.voice.engine
    if (engine === 'off') return
    if (engine === 'local') {
      if (!isModelInstalled()) {
        this.send({
          type: 'notice',
          level: 'info',
          text: `Voice needs the offline speech model (${MODEL.sizeMb} MB, one-time download, runs fully on this PC).`,
          action: { label: 'Download', command: '/install-voice' }
        })
        return
      }
      this.live = new LiveTranscriber()
      this.started = Date.now()
      this.maxTimer = setTimeout(() => void this.stop(), MAX_SECONDS * 1000)
      this.set(true)
      return
    }
    if (await toggleWispr()) this.set(true)
    else this.send({ type: 'notice', level: 'error', text: 'Wispr Flow hotkey not found. Set voice.wisprCombo in settings.json.' })
  }

  /** Stop and transcribe (local) or let Wispr paste. */
  async stop(): Promise<void> {
    if (!this.listening) return
    if (settings.current.voice.engine === 'local') return this.finishLocal(false)
    if (settings.current.voice.engine === 'wispr') await toggleWispr()
    this.set(false)
  }

  /** Stop without producing text (bar closed / clicked away). */
  async cancel(): Promise<void> {
    if (!this.listening) return
    if (settings.current.voice.engine === 'local') return this.finishLocal(true)
    if (settings.current.voice.engine === 'wispr') await toggleWispr()
    this.set(false, true)
  }

  toggle(): Promise<void> {
    return this.listening ? this.stop() : this.start()
  }

  /** Wispr stopped from its own UI and pasted; sync our state. */
  ended(): void {
    if (this.listening && settings.current.voice.engine === 'wispr') {
      this.listening = false
      this.send({ type: 'listening', value: false })
    }
  }

  async install(): Promise<void> {
    if (isModelInstalled()) {
      this.send({ type: 'notice', level: 'info', text: 'Speech model already installed.' })
      return
    }
    let lastPct = -1
    this.send({ type: 'progress', id: 'voice-model', label: 'Downloading speech model', value: 0 })
    try {
      await installModel((f, phase) => {
        const pct = Math.floor(f * 100)
        if (phase === 'unpack') {
          this.send({ type: 'progress', id: 'voice-model', label: 'Unpacking speech model…', value: 1 })
        } else if (pct !== lastPct) {
          lastPct = pct
          this.send({ type: 'progress', id: 'voice-model', label: 'Downloading speech model', value: f })
        }
      })
      this.send({ type: 'progress', id: 'voice-model', label: 'Speech model ready', value: 1, done: true })
      warmUp()
    } catch (err) {
      this.send({ type: 'progress', id: 'voice-model', label: 'Download failed', value: 0, done: true })
      this.send({ type: 'notice', level: 'error', text: `Speech model install failed: ${err instanceof Error ? err.message : err}` })
    }
  }
}
