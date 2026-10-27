import { useEffect, useRef, type RefObject } from 'react'
import { getAnalyser } from './speech'

const S = 13 // sub-grid; every other point is the visible background grid (26px, as in the design)

const hash = (i: number, j: number) => { const h = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453; return h - Math.floor(h) }
const rgb = (v: string, d: number[]) => { const n = v.split(',').map(Number); return n.length === 3 && n.every((x) => !isNaN(x)) ? n : d }

/**
 * Full-screen dot field. A soft blob rises out of the dots behind `anchor`: inside it the grid densifies,
 * brightens and is sheared/bulged by the speech level. Neutral tones only.
 */
export default function Field({ anchor }: { anchor: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current!
    const g = cv.getContext('2d')!
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let W = 0, H = 0, raf = 0, mx = -9999, my = -9999
    let ink = [237, 236, 232], dim = [133, 132, 126]
    let level = 0, presence = 0
    const freq = new Uint8Array(256)

    const theme = () => {
      const cs = getComputedStyle(document.documentElement)
      ink = rgb(cs.getPropertyValue('--dot'), ink)
      dim = rgb(cs.getPropertyValue('--dot-2'), dim)
    }
    const size = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      W = innerWidth; H = innerHeight
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = (ms: number) => {
      const t = ms / 1000
      const an = getAnalyser()
      let target = 0, lo = 0, hi = 0
      if (an) {
        an.getByteFrequencyData(freq)
        for (let i = 2; i < 24; i++) lo += freq[i]
        for (let i = 24; i < 80; i++) hi += freq[i]
        lo /= 22 * 255; hi /= 56 * 255
        target = Math.min(1, lo * 0.7 + hi * 0.9)
      }
      level += (target - level) * (target > level ? 0.3 : 0.06)
      presence += (1 - presence) * 0.015

      const r = anchor.current?.getBoundingClientRect()
      const cx = r ? r.left + r.width / 2 : W / 2
      const cy = r ? r.top + r.height / 2 : H / 2
      const R0 = (r ? Math.max(90, Math.min(220, Math.min(r.width, r.height) * 0.36)) : 160) * (0.55 + 0.45 * presence)
      const shear = 0.05 * Math.sin(t * 0.45) + level * 0.5 * Math.sin(t * 2.3 + lo * 3)
      const squash = 0.03 * Math.sin(t * 0.7) + level * 0.16 * Math.sin(t * 3.1)
      const bulge = 0.06 + level * 0.22
      const sweep = ((t / 11) % 1 * 1.5 - 0.25) * (W + H * 0.6)

      g.clearRect(0, 0, W, H)
      const cols = Math.ceil(W / S) + 1, rows = Math.ceil(H / S) + 1
      const bx0 = Math.max(0, Math.floor((cx - R0 * 1.6) / S)), bx1 = Math.min(cols, Math.ceil((cx + R0 * 1.6) / S))
      const by0 = Math.max(0, Math.floor((cy - R0 * 1.6) / S)), by1 = Math.min(rows, Math.ceil((cy + R0 * 1.6) / S))

      for (let j = 0; j < rows; j++) {
        const inY = j >= by0 && j < by1
        for (let i = 0; i < cols; i++) {
          const base = !(i & 1) && !(j & 1)
          if (!base && !(inY && i >= bx0 && i < bx1)) continue
          const x = i * S + 6.5, y = j * S + 6.5
          const h = hash(i, j)
          const dx = x - cx, dy = y - cy
          const th = Math.atan2(dy, dx)
          const Rt = R0 * (1
            + 0.05 * Math.sin(3 * th + t * 0.6) + 0.035 * Math.sin(5 * th - t * 0.9)
            + level * (0.16 * Math.sin(2 * th + t * 4.1) + 0.1 * Math.sin(4 * th - t * 5.3) + 0.06 * Math.sin(7 * th + t * 7)))
          const d = Math.hypot(dx, dy) / Rt
          const w = d < 1 ? (1 - d * d) ** 2 * presence : 0

          let a: number
          if (base) {
            const edge = Math.min(1, x / 140, (W - x) / 140)
            a = (0.1 + h * 0.07) * (1 - Math.min(1, y / (H * 1.1)) * 0.5) * Math.max(0.25, edge)
            if (!still) {
              const s = x + y * 0.6 - sweep
              if (s > -60 && s < 60 && h > 0.35) a += 0.12 * (1 - Math.abs(s) / 60)
              a += Math.sin(t * 1.1 + h * 40) * 0.025
            }
          } else a = 0
          a += w * (0.22 + level * 0.45) * (base ? 1 : 0.8 * Math.sqrt(w))
          // a faint ring rippling out of the blob while it speaks
          if (d > 1 && d < 2.4) a += level * 0.12 * Math.max(0, Math.sin((d - 1) * 9 - t * 7)) * (1 - (d - 1) / 1.4)

          let px = x, py = y, sz = 1.6
          if (w > 0) {
            px += w * (shear * dy + bulge * dx)
            py += w * (squash * dy + bulge * dy - (3 + level * 9))
            sz += w * (0.5 + level * 1.6 * (0.4 + h))
          }
          const m = mx - px, n = my - py, md = Math.sqrt(m * m + n * n)
          if (md < 150) { const e = 1 - md / 150; a += 0.3 * e * e; sz += e }
          if (a <= 0.01) continue

          // dots drift between the two neutral tones; faster inside the blob
          const k = 0.5 + 0.5 * Math.sin(t * (0.4 + w * 1.2) + h * 30)
          const mix = w > 0 ? k : k * 0.35
          g.fillStyle = `rgba(${ink[0] + (dim[0] - ink[0]) * mix},${ink[1] + (dim[1] - ink[1]) * mix},${ink[2] + (dim[2] - ink[2]) * mix},${Math.min(a, 0.85)})`
          g.fillRect(px - sz / 2, py - sz / 2, sz, sz)
        }
      }
    }

    const loop = (ms: number) => { draw(ms); raf = requestAnimationFrame(loop) }
    const onMove = (e: PointerEvent) => { mx = e.clientX; my = e.clientY }
    const onLeave = () => { mx = my = -9999 }
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden && !still) raf = requestAnimationFrame(loop) }
    const onResize = () => { size(); draw(performance.now()) }
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onTheme = () => theme()

    theme(); size()
    if (still) { presence = 1; draw(0) } else raf = requestAnimationFrame(loop)
    addEventListener('resize', onResize)
    addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', onVis)
    mq.addEventListener('change', onTheme)
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('resize', onResize)
      removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVis)
      mq.removeEventListener('change', onTheme)
    }
  }, [anchor])

  return <div className="field" aria-hidden><canvas ref={ref} /></div>
}
