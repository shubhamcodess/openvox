import { MicVAD } from '@ricky0123/vad-web'
import { join, polish } from './polish'
import { patience, sanitize } from './sanitize'
import { loadStt, transcribe } from './stt'

export type ListenState = 'loading' | 'waiting' | 'hearing' | 'finishing'

export interface ListenOptions {
  onState(s: ListenState, detail?: string): void
  /** Running transcript of what has been said so far (updates after each pause). */
  onText(text: string): void
  /** The finished, cleaned question. Called once, then listening ends. */
  onFinal(text: string): void
  /** The user started talking: silence whatever the app is saying. */
  onBargeIn(): void
  onError(message: string): void
  /** Test hook: supply a stream instead of the microphone. */
  stream?: MediaStream
}

/**
 * How patient to be. A speech segment ends after REDEMPTION_MS of quiet, but the question is only sent after a
 * further grace period with no new speech, so a thinking pause never cuts someone off. The transcript is started
 * at the first pause and then sets the grace: short if the sentence sounds finished, long if it trails off.
 */
const REDEMPTION_MS = 700
const GRACE_MS = 1400 // used until the first transcript says whether the sentence sounds finished; see patience()
const NO_SPEECH_MS = 9000

let analyser: AnalyserNode | null = null
/** Live mic analyser for the waveform; null when not listening. */
export const micAnalyser = () => analyser

export async function startListening(o: ListenOptions): Promise<{ stop(): void }> {
  o.onState('loading')
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let vad: MicVAD | null = null
  let done = false
  let epoch = 0 // bumps whenever new speech starts, so stale transcripts are ignored
  let timer: ReturnType<typeof setTimeout> | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  const pieces: Float32Array[] = []
  let draft: Promise<string> | null = null

  const teardown = () => {
    done = true
    clearTimeout(timer); clearTimeout(idle)
    analyser = null
    vad?.destroy().catch(() => {})
    stream?.getTracks().forEach((t) => t.stop())
    ctx?.close().catch(() => {})
  }
  const fail = (e: unknown) => {
    if (done) return
    teardown()
    const name = (e as any)?.name
    o.onError(name === 'NotAllowedError' ? 'Microphone access was blocked.' : name === 'NotFoundError' ? 'No microphone found.' : e instanceof Error ? e.message : String(e))
  }

  async function startDraft(): Promise<string> {
    const mine = epoch
    const { audio } = polish(join(pieces))
    const { text } = await transcribe(audio)
    const clean = sanitize(text)
    if (mine === epoch && !done) o.onText(clean)
    return clean
  }

  async function finalize() {
    if (done) return
    const mine = epoch
    const text = await (draft ?? startDraft()).catch(() => '')
    if (done || mine !== epoch) return
    teardown()
    if (text) o.onFinal(text)
    else o.onError("I didn't catch that. Try again.")
  }

  try {
    const sttReady = loadStt((p) => !done && o.onState('loading', `speech model ${Math.round(p)}%`))
    stream =
      o.stream ??
      (await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      }))
    ctx = new AudioContext()
    const mic = stream
    const src = ctx.createMediaStreamSource(mic)
    analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.2
    src.connect(analyser)

    vad = await MicVAD.new({
      model: 'v5',
      audioContext: ctx,
      baseAssetPath: '/vad/',
      onnxWASMBasePath: '/vad/',
      getStream: async () => mic,
      pauseStream: async () => {},
      resumeStream: async () => mic,
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionMs: REDEMPTION_MS,
      preSpeechPadMs: 400,
      minSpeechMs: 250,
      onSpeechRealStart: () => {
        epoch++
        draft = null
        clearTimeout(timer); clearTimeout(idle)
        o.onState('hearing')
        o.onBargeIn()
      },
      onSpeechEnd: (audio) => {
        if (done) return
        pieces.push(audio)
        o.onState('finishing')
        draft = startDraft()
        const draftEpoch = epoch
        draft.catch(fail)
        clearTimeout(timer)
        const endedAt = performance.now()
        timer = setTimeout(finalize, GRACE_MS)
        draft.then((text) => {
          if (done || draftEpoch !== epoch) return
          const { grace } = patience(text)
          clearTimeout(timer)
          timer = setTimeout(finalize, Math.max(0, grace - (performance.now() - endedAt)))
        }, () => {})
      },
    })
    await sttReady
    if (done) return { stop: () => {} }
    await vad.start()
    o.onState('waiting')
    idle = setTimeout(() => { if (!pieces.length && !done) { teardown(); o.onError("I didn't hear anything.") } }, NO_SPEECH_MS)
  } catch (e) {
    fail(e)
  }

  return {
    /** Stop now. If something was said, it is still sent. */
    stop() {
      if (done) return
      clearTimeout(timer)
      // pausing mid-sentence makes the VAD flush the speech heard so far
      const flush = vad ? vad.pause().catch(() => {}) : Promise.resolve()
      void flush.then(() => (pieces.length ? finalize() : teardown()))
    },
  }
}
