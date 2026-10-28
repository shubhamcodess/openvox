import type { Facts } from './github'
import { chat, type Msg } from './llm'
import type { RepoFacts } from './repo'
import { followupPrompt, parseFollowups, templateFollowups, trimHistory } from './convo'
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
    `REPOS, MOST STARRED FIRST (${Math.min(f.repos.length || f.topRepos.length, 12)} of ${f.ownRepos}):`,
    ...(f.repos.length ? f.repos : f.topRepos).slice(0, 12).map((r) => `- ${r.name} (${r.stars} stars, ${r.language ?? 'n/a'}${r.topics.length ? `, topics: ${r.topics.slice(0, 4).join('/')}` : ''}): ${r.description ?? 'no description'}`),
  ]
  const recent = [...f.repos].sort((a, b) => +new Date(b.pushedAt) - +new Date(a.pushedAt)).slice(0, 3)
  if (recent.length) L.push(`MOST RECENTLY PUSHED: ${recent.map((r) => r.name).join(', ')}`)
  L.push(`NOT AVAILABLE (say you don't have it): comments, issues or reviews they wrote, lifetime commit total (RECENT ACTIVITY covers only the last 90 days), salary, past employers (only COMPANY is known), skill levels, private repos, anything off GitHub.`)
  return L.join('\n')
}

// Shared by both modes. The output goes straight to a TTS voice, so it must be speech, not text.
const SPOKEN = `You are talking out loud on a voice call. Your words go straight to a text-to-speech voice, so say exactly what a friendly, knowledgeable person would say in conversation.
- Talk naturally: contractions, short sentences (under 20 words), 2 to 4 sentences in total. Start with the answer. No filler openers like "Sure" or "Great question".
- Never produce anything that is meant to be read on a screen: no lists, bullets, numbered or lettered steps, headings, markdown, emojis, parentheses, URLs, file paths, code or shell commands.
- If the answer is a procedure, walk through the real steps from the excerpts in plain speech, and say the exact commands are on screen below. If the docs have no setup steps, say the docs don't cover it. Never read a command or a link aloud.
- Say a project by its plain name with the dashes dropped, and a person by their name, never their @handle.
- Never mention "the facts", "the excerpts" or "the sources". Just say it, or say you don't know.`

const HOW = (subject: string) => `You are gitvox, a voice that knows one GitHub ${subject} well and talks about it with a recruiter or a fellow developer.
How to answer:
1. Understand what was asked and answer exactly that in your first sentence.
2. Ground everything in the CONTEXT below. Names, numbers and claims must come from it. Copy numbers exactly. Never use outside knowledge.
3. For list questions ("what repos do they have"), name up to four of the most relevant by plain name, say how many there are in total, and offer to go deeper on one.
4. If the context does not contain the answer, say so in one short sentence, then offer the closest thing you do know. Never invent.
5. For broad questions like "tell me about them" or "what do they do", give a quick portrait: what they build, what they are known for, what they are working on lately.
6. For questions about a skill or technology ("are they experienced with X", "do they know X"), look for X in their repos, languages and topics. If it is there, say where. If it is not, say you don't see X in their public work. Never rate skill levels or say someone is good at something.
7. This is a conversation. "It", "that one" and "them" refer to what was just discussed. Never repeat an earlier answer; if asked again, add a new detail or say what else you could cover.
8. Now and then, not every turn, end with a short offer of what you could tell them next.
9. Refer to people by name or as "they". Never guess anyone's gender.`

const RULES = `${HOW('profile')}

${SPOKEN}`

// Said last, because that is the part a small model remembers: excerpts full of lists make it answer with a list.
const REMINDER = `Answer in two to four short spoken sentences, as plain talk. No lists, no step labels, no colons, no code. Use only the context above.`

const withContext = (hits: Hit[], question: string) =>
  `${hits.length ? `EXCERPTS:\n${formatExcerpts(hits)}\n\n` : ''}QUESTION: ${question}\n\n${REMINDER}`

export function buildMessages(f: Facts, history: Msg[], question: string, hits: Hit[] = []): Msg[] {
  return [
    { role: 'system', content: `${RULES}\n\nCONTEXT (facts about the profile, then per-question excerpts):\n${factsSheet(f)}` },
    ...trimHistory(history),
    { role: 'user', content: withContext(hits, question) },
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
  s.replace(/<\/?think>/g, '').replace(/\s*\([^)]*\)/g, '').replace(/[*_`#>]+/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim()

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

const REPO_RULES = `${HOW('repository')}
10. For this repository the CONTEXT is REPO FACTS, OWNER FACTS and the EXCERPTS from its docs. If the excerpts do not cover something, say the docs don't cover it. Never invent commands, flags, options, APIs, versions or numbers.

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
    ...trimHistory(history),
    { role: 'user', content: withContext(hits, question) },
  ]
}

export async function* answerMsgs(msgs: Msg[], signal?: AbortSignal) {
  yield* chat(msgs, signal)
}

/** Silently asks the model what to ask next, then tops up to three with grounded templates. Never throws. */
export async function suggestFollowups(
  subject: string, question: string, answer: string, asked: string[], topics: string,
  fill: { headings?: string[]; repos?: string[] }, signal?: AbortSignal,
): Promise<string[]> {
  let fromModel: string[] = []
  try {
    let raw = ''
    for await (const d of chat(followupPrompt(subject, question, answer, asked, topics), signal)) raw += d
    fromModel = parseFollowups(raw, asked)
  } catch { /* fall through to templates */ }
  const have = [...asked, ...fromModel]
  return [...fromModel, ...templateFollowups({ ...fill, asked: have })].slice(0, 3)
}
