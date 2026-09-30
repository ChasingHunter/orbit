// Offline STT check: transcribe WAVs with the installed Parakeet model, report accuracy inputs + speed.
// Run: node scripts/stt-bench.mjs out/stt/*.wav
import sherpa from 'sherpa-onnx-node'
import { cpus } from 'node:os'
import { join } from 'node:path'

const dir = join(process.env.ORBIT_DATA_DIR ?? join(process.env.APPDATA, 'Orbit'), 'models', 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8')
const f = (n) => join(dir, n)
const threads = Math.max(1, Math.min(4, cpus().length - 1))

let t = performance.now()
const rec = await sherpa.OfflineRecognizer.createAsync({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: { encoder: f('encoder.int8.onnx'), decoder: f('decoder.int8.onnx'), joiner: f('joiner.int8.onnx') },
    tokens: f('tokens.txt'),
    modelType: 'nemo_transducer',
    numThreads: threads,
    provider: 'cpu',
    debug: 0
  }
})
console.log(`model load: ${(performance.now() - t).toFixed(0)} ms (${threads} threads)`)

for (const path of process.argv.slice(2)) {
  const wave = sherpa.readWave(path)
  const secs = wave.samples.length / wave.sampleRate
  t = performance.now()
  const stream = rec.createStream()
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples })
  await rec.decodeAsync(stream)
  const ms = performance.now() - t
  console.log(`\n${path}  audio ${secs.toFixed(1)}s  decode ${ms.toFixed(0)} ms  RTF ${(ms / 1000 / secs).toFixed(3)}`)
  console.log('  →', rec.getResult(stream).text)
}
