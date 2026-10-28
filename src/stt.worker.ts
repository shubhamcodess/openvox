import { env, pipeline } from '@huggingface/transformers'

env.allowLocalModels = false
// the ONNX runtime is served from our own origin (scripts/assets.mjs), never a CDN

let asr: any = null

self.onmessage = async (e: MessageEvent) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      env.backends.onnx.wasm!.wasmPaths = m.ortBase // absolute, resolved by the page: a worker would resolve a relative path against itself
      asr = await pipeline('automatic-speech-recognition', m.model, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: (p: any) => p.status === 'progress' && self.postMessage({ type: 'progress', file: p.file, progress: p.progress }),
      })
      self.postMessage({ type: 'ready' })
    } else if (m.type === 'run') {
      const t0 = performance.now()
      const out = await asr(m.audio)
      self.postMessage({ type: 'text', id: m.id, text: String(out.text ?? '').trim(), ms: Math.round(performance.now() - t0) })
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) })
  }
}
