// Minimal typings for the sherpa-onnx-node APIs Orbit uses (package ships none).
declare module 'sherpa-onnx-node' {
  export interface OfflineStream {
    acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void
  }
  export class OfflineRecognizer {
    static createAsync(config: Record<string, unknown>): Promise<OfflineRecognizer>
    createStream(): OfflineStream
    decodeAsync(stream: OfflineStream): Promise<void>
    getResult(stream: OfflineStream): { text: string }
  }
  export function readWave(path: string): { sampleRate: number; samples: Float32Array }
}
