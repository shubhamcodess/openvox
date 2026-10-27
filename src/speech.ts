import { PhononTTS } from 'phonon-tts'
import { toSpeech } from './speakable'

let tts: PhononTTS | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let sources: AudioBufferSourceNode[] = []
let controller: AbortController | null = null

export async function loadVoice(onProgress: (pct: number) => void) {
  if (tts) return
  tts = await PhononTTS.load({
    lang: 'en',
    device: 'auto',
    onProgress: ({ loaded, total }) => total && onProgress(Math.round((loaded / total) * 100)),
  })
}

export const getAnalyser = () => analyser

export function stop() {
  controller?.abort()
  sources.forEach((s) => { try { s.stop() } catch { /* already stopped */ } })
  sources = []
}

export interface Speaker {
  push: (sentence: string) => void
  end: () => void
  done: Promise<void>
}

/** Incremental speaker: push sentences while they are still being produced (e.g. by an LLM). */
export function startSpeaker(
  onSentence: (i: number) => void = () => {},
  onFirstAudio?: (ms: number) => void,
): Speaker {
  if (!tts) throw new Error('voice not loaded')
  stop()
  const engine = tts
  controller = new AbortController()
  const { signal } = controller
  const queue: string[] = []
  let ended = false
  let wake: (() => void) | null = null
  const poke = () => { wake?.(); wake = null }
  signal.addEventListener('abort', poke)
  const t0 = performance.now()

  const done = (async () => {
    ctx ??= new AudioContext({ sampleRate: engine.sampleRate })
    await ctx.resume()
    if (!analyser) {
      analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.7
      analyser.connect(ctx.destination)
    }
    let cursor = ctx.currentTime + 0.05
    let first = true
    let i = 0
    while (!signal.aborted) {
      const sentence = queue.shift()
      if (sentence === undefined) {
        if (ended) break
        await new Promise<void>((r) => (wake = r))
        continue
      }
      const idx = i++
      const spoken = toSpeech(sentence)
      if (!/[a-z0-9]/i.test(spoken)) continue
      if (import.meta.env.DEV) ((window as any).__tts ??= []).push(spoken)
      let started = false
      for await (const pcm of engine.stream(spoken, { signal })) {
        const buf = ctx.createBuffer(1, pcm.length, engine.sampleRate)
        buf.getChannelData(0).set(pcm)
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(analyser)
        cursor = Math.max(cursor, ctx.currentTime)
        if (!started) {
          started = true
          setTimeout(() => !signal.aborted && onSentence(idx), Math.max(0, (cursor - ctx!.currentTime) * 1000))
        }
        if (first) { first = false; onFirstAudio?.(Math.round(performance.now() - t0)) }
        src.start(cursor)
        sources.push(src)
        cursor += buf.duration
      }
    }
    await new Promise<void>((r) => setTimeout(r, Math.max(0, (cursor - ctx!.currentTime) * 1000)))
    if (!signal.aborted) onSentence(-1)
  })()

  return {
    push: (s) => { queue.push(s); poke() },
    end: () => { ended = true; poke() },
    done,
  }
}

export async function speak(
  sentences: string[],
  onSentence: (i: number) => void,
  onFirstAudio?: (ms: number) => void,
) {
  const sp = startSpeaker(onSentence, onFirstAudio)
  sentences.forEach(sp.push)
  sp.end()
  await sp.done
}
