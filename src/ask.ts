import type { Facts } from './github'
import { chat, type Msg } from './llm'

const fmt = (n: number) => n.toLocaleString('en-US')

/** Compact, number-exact context. Everything the model may state comes from here. */
export function factsSheet(f: Facts): string {
  const since = new Date(f.createdAt).getFullYear()
  const L = [
    `NAME: ${f.name} (@${f.login})`,
    `BIO: ${f.bio ?? 'not provided'}`,
    `COMPANY: ${f.company ?? 'not provided'}`,
    `LOCATION: ${f.location ?? 'not provided'}`,
    `ON GITHUB SINCE: ${since}`,
    `FOLLOWERS: ${fmt(f.followers)}`,
    `ORIGINAL REPOS (not forks): ${f.ownRepos}`,
    `FORKED OR OTHER PUBLIC REPOS: ${Math.max(0, f.publicRepos - f.ownRepos)}`,
    `TOTAL STARS ON ORIGINAL REPOS: ${fmt(f.totalStars)}`,
    ...(f.topRepos[0] ? [`MOST STARRED REPO: ${f.topRepos[0].name} (${fmt(f.topRepos[0].stars)} stars)`] : []),
    `MAIN LANGUAGE: ${f.languages[0]?.[0] ?? 'none'}`,
    `TOP LANGUAGES (by number of repos): ${f.languages.map(([l, n]) => `${l} ${n}`).join(', ') || 'none'}`,
    `PULL REQUESTS: ${f.prs.total} opened, ${f.prs.merged} merged (all time, public)`,
    `RECENT ACTIVITY (last ~90 days, public events): ${f.recent.commits} commits, ${f.recent.prsOpened} PRs opened, across ${f.recent.reposTouched} repos`,
    `REPOS PUSHED IN LAST 90 DAYS: ${f.activeRepos90d}`,
    `ALL TOP REPOS, MOST STARRED FIRST:`,
    ...f.topRepos.map((r) => `- ${r.name} (${r.stars} stars, ${r.language ?? 'n/a'}): ${r.description ?? 'no description'}`),
  ]
  L.push(`NOT AVAILABLE (say you don't have it): lifetime commit total, salary, employer unless COMPANY is given, skills or experience not listed above, private repos.`)
  if (f.profileReadme) L.push(`PROFILE README EXCERPT: ${f.profileReadme}`)
  return L.join('\n')
}

const RULES = `You are the voice of a GitHub profile, answering questions about one developer for a recruiter or fellow developer.
Rules:
- Use ONLY the FACTS below. Never use outside knowledge about this person.
- If the answer is not in the FACTS, say exactly that you don't have that information. Never guess or invent numbers, skills, employers or opinions.
- Copy numbers exactly as written in the FACTS.
- Answer in 1 to 3 short spoken sentences. Plain prose only: no lists, no markdown, no emojis.`

export function buildMessages(f: Facts, history: Msg[], question: string): Msg[] {
  return [
    { role: 'system', content: `${RULES}\n\nFACTS:\n${factsSheet(f)}` },
    ...history.slice(-6),
    { role: 'user', content: question },
  ]
}

/** Accumulates tokens and releases whole sentences for TTS. */
export class SentenceChunker {
  private buf = ''
  push(t: string): string[] {
    this.buf += t
    const out: string[] = []
    for (;;) {
      const re = /[.!?](?:["')\]]*)\s+/g
      let m: RegExpExecArray | null
      let cut = -1
      while ((m = re.exec(this.buf))) {
        if (m.index + m[0].length >= 24) { cut = m.index + m[0].length; break }
      }
      if (cut < 0) break
      out.push(clean(this.buf.slice(0, cut)))
      this.buf = this.buf.slice(cut)
    }
    return out.filter(Boolean)
  }
  flush(): string[] {
    const r = clean(this.buf)
    this.buf = ''
    return r ? [r] : []
  }
}

export const clean = (s: string) =>
  s.replace(/<\/?think>/g, '').replace(/[*_`#>]+/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim()

export async function* answer(f: Facts, history: Msg[], question: string, signal?: AbortSignal) {
  yield* chat(buildMessages(f, history, question), signal)
}
