import type { Facts, Repo } from './github'
import { Bm25, chunkMarkdown, type Chunk, type Hit } from './retrieval.ts'

const ago = (iso: string) => {
  const d = Math.round((Date.now() - +new Date(iso)) / 864e5)
  return d <= 1 ? 'pushed today or yesterday' : d < 60 ? `last pushed ${d} days ago` : d < 700 ? `last pushed ${Math.round(d / 30)} months ago` : `last pushed ${Math.round(d / 365)} years ago`
}

/** One short card per repo, so "do they have anything with X" and "what repos do they have" have something to match. */
export function repoCard(r: Repo): string {
  return [
    `Repository ${r.name.replace(/[-_]/g, ' ')} (${r.name})${r.description ? `: ${r.description}` : ''}.`,
    r.language ? `Written in ${r.language}.` : '',
    r.topics.length ? `Topics: ${r.topics.join(', ')}.` : '',
    `${r.stars} stars, ${ago(r.pushedAt)}.`,
  ].filter(Boolean).join(' ')
}

/** Index over everything we know about a person that does not fit in the facts sheet. */
export function buildProfileIndex(f: Facts): Bm25 {
  const chunks: Chunk[] = []
  const add = (more: Chunk[]) => more.forEach((c) => chunks.push({ ...c, id: chunks.length }))
  if (f.profileReadme) add(chunkMarkdown('profile README', f.profileReadme).map((c) => ({ ...c, weight: 1.2 })))
  for (const r of f.readmes) add(chunkMarkdown(`${r.repo} README`, r.text).map((c) => ({ ...c, tag: r.repo.toLowerCase(), heading: [r.repo, c.heading].filter(Boolean).join(' › ') })))
  for (const r of f.repos) add([{ id: 0, source: 'repositories', heading: r.name, text: repoCard(r), weight: 0.8, tag: r.name.toLowerCase() }])
  return new Bm25(chunks)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Repos the question names ("tell me about spoon knife"), so their chunks can be favoured. */
export function mentionedRepos(question: string, repos: Repo[]): Set<string> {
  const q = norm(question)
  const out = new Set<string>()
  for (const r of repos) {
    const n = norm(r.name)
    if (n.length >= 4 && q.includes(n)) out.add(r.name.toLowerCase())
  }
  return out
}

/** For "tell me about them": the opening of the profile README and of the top repos' READMEs. */
export function portraitHits(index: Bm25, max = 4): Hit[] {
  const seen = new Set<string>()
  const out: Hit[] = []
  for (const chunk of index.chunks) {
    const key = chunk.tag ?? chunk.source
    if (chunk.source === 'repositories' || seen.has(key)) continue
    seen.add(key)
    out.push({ chunk, score: 0 })
    if (out.length === max) break
  }
  return out
}
