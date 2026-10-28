export const STT_MODEL = 'onnx-community/moonshine-base-ONNX'

let worker: Worker | null = null
let ready: Promise<void> | null = null
let seq = 0
const files = new Map<string, number>()
const pending = new Map<number, { ok: (r: { text: string; ms: number }) => void; fail: (e: Error) => void }>()

export function loadStt(onProgress?: (pct: number) => void): Promise<void> {
  if (ready) return ready
  ready = new Promise((ok, fail) => {
    worker = new Worker(new URL('./stt.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') {
        files.set(m.file, m.progress)
        onProgress?.([...files.values()].reduce((a, b) => a + b, 0) / files.size)
      }
      else if (m.type === 'ready') ok()
      else if (m.type === 'text') pending.get(m.id)?.ok({ text: m.text, ms: m.ms })
      else if (m.type === 'error') {
        if (m.id == null) { ready = null; fail(new Error(m.message)) } else pending.get(m.id)?.fail(new Error(m.message))
      }
      if (m.id != null) pending.delete(m.id)
    }
    worker.postMessage({ type: 'load', model: STT_MODEL, ortBase: new URL(import.meta.env.BASE_URL + 'ort/', document.baseURI).href })
  })
  return ready
}

export async function transcribe(audio: Float32Array): Promise<{ text: string; ms: number }> {
  await loadStt()
  const id = ++seq
  return new Promise((ok, fail) => {
    pending.set(id, { ok, fail })
    worker!.postMessage({ type: 'run', id, audio: audio.slice() })
  })
}
