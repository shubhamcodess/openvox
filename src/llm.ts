import { CreateWebWorkerMLCEngine, type WebWorkerMLCEngine } from '@mlc-ai/web-llm'

export const CANDIDATES = [
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
  'Qwen3-1.7B-q4f16_1-MLC',
  'Llama-3.2-3B-Instruct-q4f16_1-MLC',
]
export const DEFAULT_MODEL = 'Qwen3-1.7B-q4f16_1-MLC'


let engine: WebWorkerMLCEngine | null = null
let loaded = ''

const isQuota = (e: unknown) => (e as Error)?.name === 'QuotaExceededError' || /quota/i.test(String((e as Error)?.message ?? e))

/** Phones get a smaller model (less memory, less to download); everyone gets the f32 build when the GPU lacks f16. */
export const isMobile = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || ((navigator as any).deviceMemory ?? 8) <= 4

let picked: Promise<string> | null = null
export function pickModel(): Promise<string> {
  return (picked ??= (async () => {
    const gpu = (navigator as any).gpu
    if (!gpu) throw new Error('This browser has no WebGPU, so the on-device model cannot run. Try Chrome, Edge, or Safari 26.')
    const adapter = await gpu.requestAdapter()
    if (!adapter) throw new Error('No GPU available to the browser (WebGPU adapter not found).')
    const f16 = adapter.features.has('shader-f16')
    const base = isMobile() ? 'Llama-3.2-1B-Instruct' : 'Qwen3-1.7B'
    return `${base}-${f16 ? 'q4f16_1' : 'q4f32_1'}-MLC`
  })())
}

/** Browser storage full: drop every cached model except the one we need, then try again. */
async function freeSpace(keep: string) {
  const { prebuiltAppConfig, hasModelInCache, deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm')
  for (const m of prebuiltAppConfig.model_list) {
    if (m.model_id !== keep && (await hasModelInCache(m.model_id).catch(() => false))) await deleteModelAllInfoInCache(m.model_id).catch(() => {})
  }
}

let loading: Promise<void> | null = null

/** One load at a time: a second caller (the first question arriving mid-boot) waits instead of starting another download. */
export function loadModel(id: string, onProgress: (p: number, text: string) => void): Promise<void> {
  if (engine && loaded === id) return Promise.resolve()
  return (loading ??= (async () => {
    const cb = (r: { progress: number; text: string }) => onProgress(r.progress, r.text)
    const init = async () => {
      if (!engine) {
        engine = await CreateWebWorkerMLCEngine(new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' }), id, { initProgressCallback: cb })
      } else {
        engine.setInitProgressCallback(cb)
        await engine.reload(id)
      }
      loaded = id
    }
    try {
      try { await init() } catch (e) {
        if (!isQuota(e)) throw e
        await freeSpace(id)
        await init()
      }
    } catch (e) {
      if (isQuota(e)) throw new Error('Browser storage is full, so the model cannot be saved. Free some space, or use a normal (non-private) window, then reload.')
      throw e
    } finally { loading = null }
  })())
}

/** Forget the conversation inside the model (KV cache), so nothing about the last profile lingers. */
export async function resetModel() { try { await engine?.resetChat() } catch { /* nothing loaded */ } }

export interface Msg { role: 'system' | 'user' | 'assistant'; content: string }

/** Streams content deltas. */
export async function* chat(messages: Msg[], signal?: AbortSignal): AsyncGenerator<string> {
  if (!engine) throw new Error('model not loaded')
  const stream = (await engine.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.2,
    max_tokens: 180,
    stream_options: { include_usage: true },
    ...(loaded.startsWith('Qwen3') ? { extra_body: { enable_thinking: false } } : {}),
  } as any)) as unknown as AsyncIterable<any>
  const t0 = performance.now()
  let first = 0
  for await (const chunk of stream) {
    if (signal?.aborted) { engine.interruptGenerate(); return }
    if (chunk.usage) console.debug(`[llm] prefilled ${chunk.usage.prompt_tokens} tokens, first token ${first} ms`)
    const d = chunk.choices[0]?.delta?.content
    if (d) { if (!first) first = Math.round(performance.now() - t0); yield d }
  }
}
