import type { ReactNode } from 'react'

/** Words become spans so each one condenses out of the mist as it arrives. Keys are positional, so old words stay put. */
const words = (s: string, k: string) =>
  s.split(/(\s+)/).map((w, i) => (/^\s+$/.test(w) || !w ? w : <span className="w" key={`${k}.${i}`}>{w}</span>))

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\))/

function inline(s: string, k: string): ReactNode[] {
  return s.split(INLINE).map((p, i) => {
    const key = `${k}-${i}`
    if (!p) return null
    if (p.startsWith('`')) return <code key={key}>{p.slice(1, -1)}</code>
    if (p.startsWith('**')) return <strong key={key}>{words(p.slice(2, -2), key)}</strong>
    if (/^[*_]/.test(p) && p.length > 2) return <em key={key}>{words(p.slice(1, -1), key)}</em>
    const a = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p)
    if (a) return <a key={key} href={a[2]} target="_blank" rel="noreferrer">{words(a[1], key)}</a>
    return <span key={key}>{words(p, key)}</span>
  })
}

/** Minimal markdown: paragraphs, headings, lists, quotes, fenced code, inline code/bold/italic/links. */
export default function Md({ text }: { text: string }) {
  const out: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flushPara = () => { if (para.length) out.push(<p key={out.length}>{inline(para.join(' '), `p${out.length}`)}</p>); para = [] }
  const flushList = () => {
    if (!list) return
    const k = out.length
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${k}.${i}`)}</li>)
    out.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>)
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^```/.test(l)) {
      flushPara(); flushList()
      const body: string[] = []
      while (++i < lines.length && !/^```/.test(lines[i])) body.push(lines[i])
      out.push(<pre key={out.length}><code>{body.join('\n')}</code></pre>)
      continue
    }
    const h = /^(#{1,4})\s+(.*)/.exec(l)
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)/.exec(l)
    if (h) { flushPara(); flushList(); out.push(<h4 key={out.length}>{inline(h[2], `h${out.length}`)}</h4>) }
    else if (li) {
      flushPara()
      const ordered = /\d/.test(li[1])
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push(li[2])
    } else if (/^>\s?/.test(l)) { flushPara(); flushList(); out.push(<blockquote key={out.length}>{inline(l.replace(/^>\s?/, ''), `q${out.length}`)}</blockquote>) }
    else if (!l.trim()) { flushPara(); flushList() }
    else { flushList(); para.push(l.trim()) }
  }
  flushPara(); flushList()
  return <div className="md">{out}</div>
}
