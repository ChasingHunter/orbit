// Plays 16-bit mono PCM chunks back to back as they arrive, so speech starts right away.

export class PcmPlayer {
  private ctx: AudioContext | undefined
  private rate = 0
  private nextTime = 0
  private sources = new Set<AudioBufferSourceNode>()
  onEnded: () => void = () => {}

  get playing(): boolean {
    return this.sources.size > 0
  }

  push(pcm: Uint8Array, sampleRate: number): void {
    if (!this.ctx || this.rate !== sampleRate) {
      void this.ctx?.close()
      this.ctx = new AudioContext({ sampleRate })
      this.rate = sampleRate
      this.nextTime = 0
    }
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2))
    if (!samples.length) return
    const buf = this.ctx.createBuffer(1, samples.length, sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.ctx.destination)
    // A little lead time on the first chunk avoids a click; later chunks follow seamlessly.
    const start = Math.max(this.nextTime, this.ctx.currentTime + 0.05)
    src.start(start)
    this.nextTime = start + buf.duration
    this.sources.add(src)
    src.onended = () => {
      this.sources.delete(src)
      if (!this.sources.size) this.onEnded()
    }
  }

  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    this.sources.clear()
    this.nextTime = 0
  }
}

/**
 * Collects streamed answer text and hands back whole sentences as soon as they're complete,
 * so speaking can start before the answer is finished.
 */
export class SentenceSplitter {
  private buffer = ''
  private inCode = false

  push(delta: string): string[] {
    this.buffer += delta
    const out: string[] = []
    // Break on sentence ends, or on line breaks (lists, headings), keeping code blocks out.
    const re = /([\s\S]*?(?:[.!?](?=\s)|\n))/y
    let m: RegExpExecArray | null
    let last = 0
    re.lastIndex = 0
    while ((m = re.exec(this.buffer))) {
      const piece = m[1]
      last = re.lastIndex
      if (/```/.test(piece)) this.inCode = !this.inCode
      if (!this.inCode && piece.trim().length > 1) out.push(piece.trim())
    }
    this.buffer = this.buffer.slice(last)
    return out
  }

  flush(): string[] {
    const rest = this.buffer.trim()
    this.buffer = ''
    this.inCode = false
    return rest ? [rest] : []
  }
}
