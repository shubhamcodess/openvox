/**
 * Cleans one captured utterance (16 kHz mono floats) before it reaches the speech model:
 * removes DC offset and rumble, trims long silence at the edges, evens out the level, fades the ends.
 */
const RATE = 16000

/** One-pole high-pass: cuts desk thumps and mains hum below `hz`. */
function highPass(x: Float32Array, hz = 90): Float32Array {
  const rc = 1 / (2 * Math.PI * hz), dt = 1 / RATE, a = rc / (rc + dt)
  const y = new Float32Array(x.length)
  let px = 0, py = 0
  for (let i = 0; i < x.length; i++) {
    py = a * (py + x[i] - px)
    px = x[i]
    y[i] = py
  }
  return y
}

const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, to - from))
}

/** Keeps `padMs` of quiet around the speech so word edges are never clipped. */
function trim(x: Float32Array, padMs = 180): Float32Array {
  const win = RATE / 50 // 20 ms
  const n = Math.floor(x.length / win)
  if (n < 3) return x
  const e: number[] = []
  let peak = 0
  for (let i = 0; i < n; i++) { const v = rms(x, i * win, (i + 1) * win); e.push(v); peak = Math.max(peak, v) }
  const gate = Math.max(peak * 0.06, 1e-4)
  let a = e.findIndex((v) => v > gate)
  let b = e.length - 1
  while (b > a && e[b] <= gate) b--
  if (a < 0) return x
  const pad = Math.round((padMs / 1000) * RATE)
  return x.subarray(Math.max(0, a * win - pad), Math.min(x.length, (b + 1) * win + pad))
}

export interface Polished { audio: Float32Array; seconds: number; peak: number; gain: number }

export function polish(input: Float32Array): Polished {
  let mean = 0
  for (let i = 0; i < input.length; i++) mean += input[i]
  mean /= Math.max(1, input.length)
  const centered = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) centered[i] = input[i] - mean

  const x = Float32Array.from(trim(highPass(centered)))

  let peak = 0
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]))
  // aim for -3 dBFS, never boost more than 12x (that only lifts noise) and never attenuate
  const gain = peak > 1e-4 ? Math.min(12, Math.max(1, 0.7 / peak)) : 1
  for (let i = 0; i < x.length; i++) x[i] = Math.max(-1, Math.min(1, x[i] * gain))

  const fade = Math.min(Math.round(0.01 * RATE), x.length >> 1)
  for (let i = 0; i < fade; i++) { const k = i / fade; x[i] *= k; x[x.length - 1 - i] *= k }

  return { audio: x, seconds: x.length / RATE, peak: peak * gain, gain }
}

/** Joins utterance pieces with a short beat of silence so the model hears them as one sentence. */
export function join(parts: Float32Array[], gapMs = 120): Float32Array {
  const gap = Math.round((gapMs / 1000) * RATE)
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0) + gap * Math.max(0, parts.length - 1))
  let o = 0
  parts.forEach((p, i) => { out.set(p, o); o += p.length + (i < parts.length - 1 ? gap : 0) })
  return out
}
