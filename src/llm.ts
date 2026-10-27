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

export async function loadModel(id: string, onProgress: (p: number, text: string) => void) {
  if (engine && loaded === id) return
  const cb = (r: { progress: number; text: string }) => onProgress(r.progress, r.text)
  if (!engine) {
    engine = await CreateWebWorkerMLCEngine(
      new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' }),
      id,
      { initProgressCallback: cb },
    )
  } else {
    engine.setInitProgressCallback(cb)
    await engine.reload(id)
  }
  loaded = id
}

export interface Msg { role: 'system' | 'user' | 'assistant'; content: string }

/** Streams content deltas. */
export async function* chat(messages: Msg[], signal?: AbortSignal): AsyncGenerator<string> {
  if (!engine) throw new Error('model not loaded')
  const stream = (await engine.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.2,
    max_tokens: 180,
    ...(loaded.startsWith('Qwen3') ? { extra_body: { enable_thinking: false } } : {}),
  } as any)) as unknown as AsyncIterable<any>
  for await (const chunk of stream) {
    if (signal?.aborted) { engine.interruptGenerate(); return }
    const d = chunk.choices[0]?.delta?.content
    if (d) yield d
  }
}
