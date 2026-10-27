import type { Facts } from './github'
import { chat, type Msg } from './llm'
import type { RepoFacts } from './repo'
import type { Hit } from './retrieval'

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

// Shared by both modes. The output goes straight to a TTS voice, so it must be speech, not text.
const SPOKEN = `You are talking out loud on a voice call. Your words go straight to a text-to-speech voice, so say exactly what a friendly, knowledgeable person would say in conversation.
- Talk naturally: contractions, short sentences (under 20 words), 2 to 4 sentences in total. Start with the answer. No filler openers like "Sure" or "Great question".
- Never produce anything that is meant to be read on a screen: no lists, bullets, numbered or lettered steps, headings, markdown, emojis, parentheses, URLs, file paths, code or shell commands.
- If the answer is a procedure, walk through it in plain speech ("First you clone the repo, then you install the dependencies and build it."), and say the exact commands are on screen below. Never read a command or a link aloud.
- Say a project by its plain name with the dashes dropped, and a person by their name, never their @handle.
- Never mention "the facts", "the excerpts" or "the sources". Just say it, or say you don't know.
Tone example only (different project, never reuse its wording or details), for "How do I set it up?": "It's a quick setup. You grab the code, install what it needs, and start it with one command. The exact commands are on your screen below."`

const RULES = `You are the voice of a GitHub profile, answering questions about one developer for a recruiter or fellow developer.
Rules:
- Use ONLY the FACTS below. Never use outside knowledge about this person.
- If the answer is not in the FACTS, say exactly that you don't have that information. Never guess or invent numbers, skills, employers or opinions.
- Copy numbers exactly as written in the FACTS.
- Refer to the person by name or as "they". Never guess anyone's gender.

${SPOKEN}`

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
      const re = /[.!?](?:["')\]]*)\s+|\n+/g
      let m: RegExpExecArray | null
      let cut = -1
      while ((m = re.exec(this.buf))) {
        const before = this.buf.slice(0, m.index + 1)
        if (/(?:\b(?:e\.g|i\.e|etc|vs|approx|Mr|Mrs|Dr|No)|(?:^|\s)(?:\d{1,2}|[A-Z]))\.$/i.test(before)) continue // abbreviation or list number, not a sentence end
        if (m.index + m[0].length >= 24) { cut = m.index + m[0].length; break }
      }
      // Long run with no sentence end (lists, run-ons): cut at the last clause break so audio keeps flowing.
      if (cut < 0 && this.buf.length > 150) {
        const soft = [...this.buf.matchAll(/[,;:]\s/g)].map((x) => x.index! + 2).filter((i) => i >= 40).pop()
        if (soft) cut = soft
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

// ---- repo mode -------------------------------------------------------------

export function repoSheet(r: RepoFacts): string {
  const ago = (iso: string) => {
    const d = Math.round((Date.now() - +new Date(iso)) / 864e5)
    return d <= 1 ? 'today or yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`
  }
  return [
    `REPO: ${r.owner}/${r.name}`,
    `DESCRIPTION: ${r.description ?? 'not provided'}`,
    `STARS: ${fmt(r.stars)}`,
    `FORKS: ${fmt(r.forks)}`,
    `OPEN ISSUES AND PRS: ${r.openIssues}`,
    `LICENSE: ${r.license ?? 'none declared'}`,
    `MAIN LANGUAGE: ${r.languages[0]?.[0] ?? 'unknown'}`,
    `LANGUAGE SHARE: ${r.languages.map(([l, p]) => `${l} ${p}%`).join(', ') || 'unknown'}`,
    `TOPICS: ${r.topics.join(', ') || 'none'}`,
    `CONTRIBUTORS: ${r.contributors.count}${r.contributors.capped ? ' or more' : ''}${r.contributors.top.length ? `; top: ${r.contributors.top.map(([l, n]) => `${l} (${n} commits)`).join(', ')}` : ''}`,
    `PULL REQUESTS: ${r.prs.total} opened, ${r.prs.merged} merged (all time)`,
    `COMMITS IN LAST 30 DAYS: ${r.commits30d}${r.commits30d >= 100 ? ' or more' : ''}`,
    `CREATED: ${new Date(r.createdAt).getFullYear()}`,
    `LAST PUSH: ${ago(r.pushedAt)}${r.archived ? ' (repo is archived)' : ''}`,
    `HOMEPAGE: ${r.homepage ?? 'none'}`,
    `DOC FILES INDEXED: ${r.docs.join(', ')}`,
    `NOT AVAILABLE (say you don't have it): lifetime commit total, source code contents, anything not in the excerpts.`,
  ].join('\n')
}

const REPO_RULES = `You are the voice of one GitHub repository, answering questions for a developer who is evaluating it.
Rules:
- Use ONLY the REPO FACTS, OWNER FACTS and the EXCERPTS in the user's message. Never use outside knowledge about this project.
- If the excerpts do not contain the answer, say the docs don't cover it. Never invent commands, flags, options, APIs, versions or numbers.
- Copy names and numbers exactly as written.
- Refer to the person by name or as "they". Never guess anyone's gender.

${SPOKEN}`

export function formatExcerpts(hits: Hit[]): string {
  return hits.map((h, i) => `[${i + 1}] ${h.chunk.source}${h.chunk.heading ? ` › ${h.chunk.heading}` : ''}\n${h.chunk.text.slice(0, 1100)}`).join('\n\n')
}

export const sourceLabel = (h: Hit) => `${h.chunk.source}${h.chunk.heading ? ` › ${h.chunk.heading.split(' › ').slice(-1)[0]}` : ''}`

/** Stable system prefix (repo + owner facts); per-question excerpts ride in the user turn. */
export function buildRepoMessages(repo: RepoFacts, owner: Facts | null, history: Msg[], question: string, hits: Hit[]): Msg[] {
  const system = `${REPO_RULES}\n\nREPO FACTS:\n${repoSheet(repo)}${owner ? `\n\nOWNER FACTS (the person behind this repo):\n${factsSheet(owner)}` : ''}`
  return [
    { role: 'system', content: system },
    ...history.slice(-6),
    { role: 'user', content: `EXCERPTS:\n${formatExcerpts(hits)}\n\nQUESTION: ${question}` },
  ]
}

export async function* answerRepo(msgs: Msg[], signal?: AbortSignal) {
  yield* chat(msgs, signal)
}
