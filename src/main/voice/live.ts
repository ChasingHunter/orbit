import { transcribe } from './localStt'

// Transcribes while you talk. Taken from Utter (Orbit's dictation spin-off), where it was tuned.
// Parakeet only works on whole clips, so the audio is cut at natural
// pauses and each finished piece is transcribed in the background. When you let go, only the
// piece since your last pause is left, so the wait no longer grows with how long you spoke.

const RATE = 16000
/** This much quiet after speech ends a piece. Short enough to catch pauses between phrases. */
const PAUSE_MS = 450
/** Once a piece is this long, a shorter gap (about a comma's worth) is enough to end it... */
const LONG_PIECE_MS = 7_000
/** ...so one long sentence without real pauses still gets transcribed as you go. */
const WORD_GAP_MS = 300
/** Quiet kept before speech starts, so the first syllable isn't clipped. */
const LEAD_MS = 300
/** A piece this long gets cut at the next quiet moment even without a real pause... */
const SOFT_MAX_MS = 15_000
/** ...and at this length no matter what. */
const HARD_MAX_MS = 25_000

const ms = (samples: number): number => (samples / RATE) * 1000

function rms(chunk: Float32Array): number {
  let sum = 0
  for (const v of chunk) sum += v * v
  return Math.sqrt(sum / chunk.length)
}

export class LiveTranscriber {
  private piece: Float32Array[] = []
  private pieceLength = 0
  private heardSpeech = false
  private quiet = 0 // samples of quiet since the last speech
  private noiseFloor = 0.01
  private texts: string[] = []
  private queue: Promise<void> = Promise.resolve()
  private cancelled = false
  /** Total audio received, for the log. */
  samples = 0
  /** Pieces transcribed while you were still talking, for the log. */
  piecesDone = 0

  push(chunk: Float32Array): void {
    if (this.cancelled) return
    this.samples += chunk.length
    const level = rms(chunk)
    // Follow the background noise: drop quickly to quieter levels, rise only slowly.
    this.noiseFloor = level < this.noiseFloor ? this.noiseFloor * 0.7 + level * 0.3 : this.noiseFloor * 0.998 + level * 0.002
    const speech = level > Math.max(0.012, this.noiseFloor * 3)

    this.piece.push(chunk)
    this.pieceLength += chunk.length

    if (!this.heardSpeech) {
      if (speech) this.heardSpeech = true
      else this.trimLead()
      return
    }
    this.quiet = speech ? 0 : this.quiet + chunk.length
    const length = ms(this.pieceLength)
    const quiet = ms(this.quiet)
    if (quiet >= PAUSE_MS || (length >= LONG_PIECE_MS && quiet >= WORD_GAP_MS) || (length >= SOFT_MAX_MS && !speech) || length >= HARD_MAX_MS) {
      this.cut()
    }
  }

  /** Before any speech, keep only the last LEAD_MS of quiet. */
  private trimLead(): void {
    while (this.piece.length > 1 && ms(this.pieceLength - this.piece[0].length) >= LEAD_MS) {
      this.pieceLength -= this.piece.shift()!.length
    }
  }

  private take(): Float32Array {
    const out = new Float32Array(this.pieceLength)
    let offset = 0
    for (const c of this.piece) {
      out.set(c, offset)
      offset += c.length
    }
    this.piece = []
    this.pieceLength = 0
    this.heardSpeech = false
    this.quiet = 0
    return out
  }

  /** Hands the finished piece to the model; pieces are transcribed one at a time, in order. */
  private cut(final = false): void {
    if (!this.heardSpeech) {
      this.take()
      return
    }
    const audio = this.take()
    const index = this.texts.length
    this.texts.push('')
    this.queue = this.queue.then(async () => {
      if (this.cancelled) return
      this.texts[index] = await transcribe(audio)
      if (!final) this.piecesDone++
    })
  }

  /** Transcribes whatever is left and returns the whole text. */
  async finish(): Promise<string> {
    this.cut(true)
    await this.queue
    return join(this.texts)
  }

  cancel(): void {
    this.cancelled = true
    this.piece = []
  }
}

/**
 * Glues pieces together. The model ends every piece like a sentence, so when a piece stops
 * mid-thought (no punctuation of its own) the next one shouldn't start with a capital letter.
 */
function join(texts: string[]): string {
  let out = ''
  for (const t of texts.map((s) => s.trim()).filter(Boolean)) {
    if (!out) out = t
    else if (/[.!?]$/.test(out)) out += ' ' + t
    // ...but leave "I", "I'm" and acronyms like "PDF" alone.
    else if (/^(I\b|[A-Z]{2,})/.test(t)) out += ' ' + t
    else out += ' ' + t.charAt(0).toLowerCase() + t.slice(1)
  }
  return out
}
