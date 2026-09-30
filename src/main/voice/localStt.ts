import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cpus } from 'node:os'
import type { OfflineRecognizer } from 'sherpa-onnx-node'
import { paths } from '../paths'
import { logInfo } from '../log'

// Offline speech-to-text: NVIDIA Parakeet TDT 0.6B v2 (int8) via sherpa-onnx.
// English, punctuation + casing built in, faster than real time on a laptop CPU.

export const MODEL = {
  name: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2',
  sizeMb: 482
}

const modelsDir = paths.models
const modelDir = join(modelsDir, MODEL.name)
const file = (n: string): string => join(modelDir, n)

const MODEL_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']
// Written only after a complete extraction, so a half-unpacked model never counts as installed.
const MARKER = '.installed'

export function isModelInstalled(): boolean {
  return existsSync(file(MARKER))
}

let installing: Promise<void> | undefined

/** Downloads and unpacks the model. `onProgress` gets 0..1 while downloading, then the unpack phase. */
export function installModel(onProgress: (fraction: number, phase: 'download' | 'unpack') => void): Promise<void> {
  installing ??= (async () => {
    mkdirSync(modelsDir, { recursive: true })
    const archive = join(modelsDir, `${MODEL.name}.tar.bz2`)
    const res = await fetch(MODEL.url)
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`)
    const total = Number(res.headers.get('content-length')) || MODEL.sizeMb * 1e6
    let received = 0
    const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
    body.on('data', (chunk: Buffer) => {
      received += chunk.length
      onProgress(Math.min(1, received / total), 'download')
    })
    await pipeline(body, createWriteStream(archive))
    onProgress(1, 'unpack')
    // Windows 10+ ships bsdtar, which handles .tar.bz2.
    await promisify(execFile)('tar', ['-xjf', archive, '-C', modelsDir])
    rmSync(archive, { force: true })
    if (!MODEL_FILES.every((n) => existsSync(file(n)))) throw new Error('Model files missing after extraction')
    writeFileSync(file(MARKER), new Date().toISOString())
  })().finally(() => {
    installing = undefined
  })
  return installing
}

let recognizer: Promise<OfflineRecognizer> | undefined

function getRecognizer(): Promise<OfflineRecognizer> {
  // Loaded on first use: if the native addon is broken, only voice fails, not the whole app.
  const t0 = Date.now()
  recognizer ??= import('sherpa-onnx-node').then((mod) => {
    // CommonJS package: under dynamic import() its exports sit on `default`.
    const { OfflineRecognizer } = mod.default ?? mod
    return OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: file('encoder.int8.onnx'),
        decoder: file('decoder.int8.onnx'),
        joiner: file('joiner.int8.onnx')
      },
      tokens: file('tokens.txt'),
      modelType: 'nemo_transducer',
      numThreads: Math.max(1, Math.min(4, cpus().length - 1)),
      provider: 'cpu',
      debug: 0
    }
    })
  }).then((rec) => {
    logInfo(`stt: model loaded in ${Date.now() - t0} ms`)
    return rec
  }).catch((err) => {
    recognizer = undefined
    throw err
  })
  return recognizer
}

/** Loads the model ahead of time so the first dictation isn't slow. */
export function warmUp(): void {
  if (isModelInstalled()) void getRecognizer().catch((err) => console.error('[stt] warm-up failed', err))
}

/** Transcribes 16 kHz mono float samples. */
export async function transcribe(samples: Float32Array): Promise<string> {
  if (samples.length < 16000 * 0.3) return '' // under 300 ms: nothing said
  const rec = await getRecognizer()
  const stream = rec.createStream()
  stream.acceptWaveform({ sampleRate: 16000, samples })
  await rec.decodeAsync(stream)
  return rec.getResult(stream).text.trim()
}
