export interface Chunk { id: number; source: string; heading: string; text: string; weight?: number }

const MAX = 900

/** Strip things that read badly or carry no meaning once spoken: HTML, badges, images, link URLs. */
function cleanMd(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\r/g, '')
}

/** Split markdown by heading, then paragraphs, into ~900 char chunks that remember their heading path. */
export function chunkMarkdown(source: string, md: string, startId = 0): Chunk[] {
  const out: Chunk[] = []
  const stack: string[] = []
  let buf = ''
  let inFence = false
  const flush = () => {
    const text = buf.replace(/\n{3,}/g, '\n\n').trim()
    buf = ''
    if (text.length < (stack.some(Boolean) ? 12 : 30)) return
    out.push({ id: startId + out.length, source, heading: stack.filter(Boolean).join(' › '), text })
  }
  for (const line of cleanMd(md).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue }
    const h = !inFence && /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      stack.length = h[1].length - 1
      stack[h[1].length - 1] = h[2].replace(/[#*`]/g, '').trim()
      continue
    }
    if (line.trim() === '' && buf.length >= MAX && !inFence) flush()
    else buf += line + '\n'
    if (buf.length > MAX * 1.6) flush()
  }
  flush()
  return out
}

const STOP = new Set(('a an the is are was were be been do does did of in on at to for from with by and or not it its this that these those ' +
  'what which who whom how why when where can could should would will about tell me them they their there here have has had you your i we ' +
  'repo repository project please give explain').split(' '))

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => !STOP.has(t))
    .map((t) => (t.length > 4 ? t.replace(/(ation|ing|ed|es|s|ion)$/, '').replace(/(?<=.{4})e$/, '') : t))
}

export interface Hit { chunk: Chunk; score: number }

/** Okapi BM25 over chunks; the heading path is indexed with the text so section titles count. */
export class Bm25 {
  private tf: Map<string, number>[] = []
  private len: number[] = []
  private df = new Map<string, number>()
  private avg = 0
  readonly chunks: Chunk[]
  private k1 = 1.5
  private b = 0.75
  constructor(chunks: Chunk[]) {
    this.chunks = chunks
    for (const c of chunks) {
      const toks = tokenize(`${c.heading} ${c.heading} ${c.text}`)
      const m = new Map<string, number>()
      toks.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1))
      m.forEach((_, t) => this.df.set(t, (this.df.get(t) ?? 0) + 1))
      this.tf.push(m)
      this.len.push(toks.length)
    }
    this.avg = this.len.reduce((s, n) => s + n, 0) / Math.max(1, this.len.length)
  }

  search(query: string, k = 4): Hit[] {
    const N = this.chunks.length
    const q = [...new Set(tokenize(query))]
    const hits: Hit[] = []
    this.chunks.forEach((chunk, i) => {
      let score = 0
      for (const t of q) {
        const f = this.tf[i].get(t)
        if (!f) continue
        const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5))
        score += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.len[i]) / this.avg))
      }
      if (score > 0) hits.push({ chunk, score: score * (chunk.weight ?? 1) })
    })
    hits.sort((a, b) => b.score - a.score)
    const top = hits.slice(0, k)
    // Always keep the opening chunk (the overview) in view: "what is this / what problem does it solve"
    // questions share almost no words with the text that answers them.
    const first = this.chunks[0]
    if (first && !top.some((h) => h.chunk.id === first.id)) {
      if (top.length >= k) top.pop()
      top.unshift({ chunk: first, score: 0 })
    }
    return top
  }
}
