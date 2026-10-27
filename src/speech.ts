import { PhononTTS } from 'phonon-tts'

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

/** Streams each sentence to the speakers as it is generated; reports the sentence being spoken. */
export async function speak(
  sentences: string[],
  onSentence: (i: number) => void,
  onFirstAudio?: (ms: number) => void,
) {
  if (!tts) throw new Error('voice not loaded')
  stop()
  controller = new AbortController()
  const { signal } = controller
  ctx ??= new AudioContext({ sampleRate: tts.sampleRate })
  await ctx.resume()
  if (!analyser) {
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.7
    analyser.connect(ctx.destination)
  }
  const t0 = performance.now()
  let cursor = ctx.currentTime + 0.05
  let first = true

  for (let i = 0; i < sentences.length && !signal.aborted; i++) {
    let started = false
    for await (const pcm of tts.stream(sentences[i], { signal })) {
      const buf = ctx.createBuffer(1, pcm.length, tts.sampleRate)
      buf.getChannelData(0).set(pcm)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(analyser)
      cursor = Math.max(cursor, ctx.currentTime)
      if (!started) {
        started = true
        const idx = i
        setTimeout(() => !signal.aborted && onSentence(idx), Math.max(0, (cursor - ctx.currentTime) * 1000))
      }
      if (first) { first = false; onFirstAudio?.(Math.round(performance.now() - t0)) }
      src.start(cursor)
      sources.push(src)
      cursor += buf.duration
    }
  }
  // resolve when playback ends
  await new Promise<void>((r) => setTimeout(r, Math.max(0, (cursor - ctx!.currentTime) * 1000)))
  if (!signal.aborted) onSentence(-1)
}
