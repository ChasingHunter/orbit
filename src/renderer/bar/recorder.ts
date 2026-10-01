// Captures microphone audio as 16 kHz mono Float32 for the local speech model and hands it over
// in small chunks while recording, so the main process can transcribe as you talk. Taken from
// Utter, where the start/stop guard fixed recordings that never stopped.
// Chromium resamples to the AudioContext's rate, so no manual resampling needed.

const SAMPLE_RATE = 16000
/** 64 ms per chunk: small enough that little audio sits waiting when you stop. */
const CHUNK = 1024

export class Recorder {
  private ctx: AudioContext | undefined
  private stream: MediaStream | undefined
  private node: ScriptProcessorNode | undefined
  private starting: Promise<void> | undefined

  constructor(private onChunk: (samples: Float32Array) => void) {}

  get active(): boolean {
    return !!this.ctx
  }

  /**
   * Opens and closes the mic once. The first open in a process spins up Chromium's audio
   * service (about 2 s), which would otherwise swallow the first words of the first dictation.
   */
  async warm(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    await new AudioContext({ sampleRate: SAMPLE_RATE }).close()
  }

  /** Starts recording. A second call while the first is still opening the mic joins it. */
  start(): Promise<void> {
    this.starting ??= this.open().finally(() => (this.starting = undefined))
    return this.starting
  }

  private async open(): Promise<void> {
    if (this.ctx) return
    const stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the microphone didn't open within 5 seconds")), 5000))
    ])
    this.stream = stream
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    const source = this.ctx.createMediaStreamSource(stream)
    // ScriptProcessor is deprecated but needs no extra module file (CSP-friendly) and is plenty for mono 16 kHz.
    this.node = this.ctx.createScriptProcessor(CHUNK, 1, 1)
    this.node.onaudioprocess = (e) => this.onChunk(new Float32Array(e.inputBuffer.getChannelData(0)))
    source.connect(this.node)
    this.node.connect(this.ctx.destination)
  }

  /** Stops recording. Waits for a start still in progress, so the mic never stays open. */
  async stop(): Promise<void> {
    await this.starting?.catch(() => {})
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => {})
    this.ctx = undefined
    this.node = undefined
    this.stream = undefined
  }
}
