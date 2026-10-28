import { useEffect, useRef } from 'react'
import { micAnalyser, type ListenState } from './listen'

/** Scrolling waveform of the microphone: one bar per frame, newest on the right. */
export default function Wave({ state }: { state: ListenState }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef(state)
  st.current = state

  useEffect(() => {
    const cv = ref.current!
    const g = cv.getContext('2d')!
    const buf = new Uint8Array(1024)
    const bars: number[] = []
    let raf = 0, W = 0, H = 0
    const size = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      W = cv.clientWidth; H = cv.clientHeight
      cv.width = W * dpr; cv.height = H * dpr
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(cv)

    const draw = () => {
      const an = micAnalyser()
      let peak = 0
      if (an) {
        an.getByteTimeDomainData(buf)
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128)
      }
      bars.push(Math.min(1, peak * 2.2))
      const step = 4
      const max = Math.ceil(W / step)
      while (bars.length > max) bars.shift()

      const cs = getComputedStyle(cv)
      const ink = cs.getPropertyValue('--ink').trim() || '#edece8'
      const dim = cs.getPropertyValue('--ink-3').trim() || '#85847e'
      g.clearRect(0, 0, W, H)
      const live = st.current === 'hearing'
      bars.forEach((v, i) => {
        const x = W - (bars.length - i) * step
        const h = Math.max(2, v * (H - 6))
        g.globalAlpha = (live ? 0.95 : 0.5) * (0.25 + 0.75 * (i / bars.length))
        g.fillStyle = live ? ink : dim
        g.beginPath()
        g.roundRect(x, (H - h) / 2, 2, h, 1)
        g.fill()
      })
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return <canvas ref={ref} className="wave" aria-hidden />
}
