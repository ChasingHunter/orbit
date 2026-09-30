// Captures microphone audio as 16 kHz mono Float32 for the local speech model.
// Chromium resamples to the AudioContext's rate, so no manual resampling needed.

const SAMPLE_RATE = 16000

export class Recorder {
  private ctx: AudioContext | undefined
  private stream: MediaStream | undefined
  private node: ScriptProcessorNode | undefined
  private chunks: Float32Array[] = []
  /** 0..1 input level, for the listening indicator. */
  level = 0

  get active(): boolean {
    return !!this.ctx
  }

  async start(): Promise<void> {
    if (this.ctx) return
    this.chunks = []
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    const source = this.ctx.createMediaStreamSource(this.stream)
    // ScriptProcessor is deprecated but needs no extra module file (CSP-friendly) and is plenty for mono 16 kHz.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1)
    this.node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0)
      this.chunks.push(new Float32Array(data))
      let peak = 0
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
      this.level = Math.min(1, peak * 2)
    }
    source.connect(this.node)
    this.node.connect(this.ctx.destination)
  }

  /** Stops recording and returns everything captured. */
  async stop(): Promise<Float32Array> {
    const chunks = this.chunks
    this.chunks = []
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => {})
    this.ctx = undefined
    this.node = undefined
    this.stream = undefined
    this.level = 0
    const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
    let offset = 0
    for (const c of chunks) {
      out.set(c, offset)
      offset += c.length
    }
    return out
  }
}
