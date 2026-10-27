import { useLayoutEffect, useRef } from 'react'

export interface Line { id: number; text: string }

const PER_WORD = 0.3 // seconds; rough Phonon pace, only used to stagger the reveal

/** Spoken sentences as lyrics: the live line condenses word by word, older lines drift up and fade. */
export default function Lyrics({ lines, live }: { lines: Line[]; live: number | null }) {
  const box = useRef<HTMLDivElement>(null)
  const shown = lines.slice(-3)
  const last = shown.at(-1)?.id

  useLayoutEffect(() => {
    const el = box.current
    const h = (el?.lastElementChild as HTMLElement | null)?.offsetHeight
    if (!el || !h || el.children.length < 2) return
    el.animate([{ transform: `translateY(${h}px)` }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.16,1,.3,1)' })
  }, [last])

  return (
    <div className="lyrics" ref={box} aria-live="polite">
      {shown.map((l, i) => {
        const age = shown.length - 1 - i
        return (
          <p key={l.id} className={`lyric age${age}${l.id === live ? ' live' : ''}`}>
            {l.text.split(/\s+/).map((w, j) => (
              <span key={j} className="w" style={{ animationDelay: `${j * PER_WORD}s` }}>{w} </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
