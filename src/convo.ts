import type { Facts } from './github'
import type { Msg } from './llm'
import { tokenize } from './retrieval.ts'

export const REFUSAL_RE = /\b(?:don'?t|do not|doesn'?t|does not|can'?t|cannot|isn'?t|aren'?t|not)\b[^.]{0,40}\b(?:have|know|see|find|cover|mention|listed|available|information|say)\b/i

/**
 * Chat history the model gets to see. Small models copy their own earlier answers, so refusals (and the
 * question that caused them) are dropped, and only the last few exchanges are kept.
 */
export function trimHistory(history: Msg[], keep = 3): Msg[] {
  const pairs: Msg[][] = []
  for (let i = 0; i + 1 < history.length; i += 2) {
    const [u, a] = [history[i], history[i + 1]]
    if (!a.content.trim() || REFUSAL_RE.test(a.content.slice(0, 120))) continue
    pairs.push([u, { ...a, content: a.content.slice(0, 420) }])
  }
  return pairs.slice(-keep).flat()
}

/** Short follow-ups ("what about the second one?") carry no search terms; borrow the previous question's. */
export function retrievalQuery(question: string, history: Msg[], hints: string[] = []): string {
  if (tokenize(question).length >= 4) return question
  const prev = [...history].reverse().find((m) => m.role === 'user')
  return [question, prev?.content, ...hints].filter(Boolean).join(' ')
}

const norm0 = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Names from `names` that appear in `text`, in the order they were said. */
export function orderedMentions(text: string, names: string[]): string[] {
  const t = norm0(text)
  return names
    .map((n) => [n, norm0(n).length >= 3 ? t.indexOf(norm0(n)) : -1] as const)
    .filter(([, i]) => i >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([n]) => n)
}

const ORDINALS: Record<string, number> = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4, '5th': 4, last: -1 }

/** "tell me about the second one" -> "tell me about <name>", using the repos named in the previous answer. */
export function resolveRefs(question: string, last: string[]): string {
  if (!last.length) return question
  const re = /\b(?:the |that |this )?(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)(?: (?:one|repo|repository|project))?\b|\b(?:that|this) (?:one|repo|repository|project)\b/i
  const m = re.exec(question)
  if (!m) return question
  const ord = m[1] ? ORDINALS[m[1].toLowerCase()] : 0
  const name = last.at(ord) ?? last[0]
  return question.replace(m[0], name)
}

export type Intent = 'person' | 'repos' | 'broad' | 'content'

/**
 * What kind of question is it? Questions about the person or their repo list are answered from the facts sheet;
 * feeding README excerpts to them only gives a small model something irrelevant to latch onto.
 */
export function intentOf(question: string, namesARepo: boolean): Intent {
  const q = question.toLowerCase()
  if (namesARepo) return 'content'
  if (/\b(known for|tell me about (them|him|her|this person|themselves)|who (is|are)|what do(es)? (they|he|she) do|summar\w+|overview|introduce)\b/.test(q)) return 'broad'
  if (/\b(work(ed|s|ing)?|employ\w*|company|employer|job|hire[d]?|lives?|located|location|based|salary|bio|followers?|follow|stars?|starred|stats?|how (long|many|old)|since|joined|active|lately|recent\w*|favou?rite|main language|languages?|prs?|pull requests?|merged|commits?)\b/.test(q)) return 'person'
  if (/\b(repos?|repositories|projects?|portfolio|open[- ]source|built|made|created|shipped)\b/.test(q)) return 'repos'
  return 'content'
}

const GAPS: [RegExp, string][] = [
  [/\b(comments?|commented|reviews?|reviewed|discussions?)\b/i, "Comments and reviews aren't part of the public data I can see"],
  [/\b(issues?) (they|he|she)\b.*\b(wrote|opened|filed|raised)\b/i, "I can't see the issues they've opened"],
  [/\b(salary|paid|pay|earn\w*|compensation)\b/i, "Pay isn't something GitHub shows"],
  [/\b(lifetime|total|all[- ]time|career|overall)\b.*\bcommits?\b|\bhow many commits\b/i, "I don't have an all-time commit count, only recent activity"],
  [/\bprivate (repos?|repositories|work|projects?)\b/i, "I can only see public repositories"],
  [/\b(past|previous|former|earlier) (employers?|jobs?|compan\w+|roles?)\b|\bwork history\b|\bresume\b|\bcv\b/i, "I only know the company on their profile, not their work history"],
  [/\b(age|how old|married|family|religion|nationality)\b/i, "That's not something I'd know from GitHub"],
]

/**
 * Questions GitHub's public data cannot answer. Answered directly, with an offer of what can be covered, because a
 * small model asked to refuse tends to either invent something or repeat itself.
 */
export function gapReply(question: string, offers: string[]): string | null {
  const hit = GAPS.find(([re]) => re.test(question))
  if (!hit) return null
  const list = offers.length > 1 ? `${offers.slice(0, -1).join(', ')}, or ${offers[offers.length - 1]}` : offers[0]
  return `${hit[1]}. ${list ? `I can tell you about ${list} instead.` : ''}`.trim()
}

/** Employer and location questions have exactly one source of truth, so skip the model and say it plainly. */
export function factReply(question: string, f: Pick<Facts, 'name' | 'company' | 'location'>): string | null {
  const q = question.toLowerCase()
  const first = f.name.split(/\s+/)[0]
  if (/\b(work(s|ed|ing)?|employer|employed|company|job)\b/.test(q) && /\b(where|which|what|who|company|employer)\b/.test(q)) {
    return f.company
      ? `Their profile lists ${f.company.replace(/^@/, '')} as their company. That's the only work detail GitHub shows.`
      : `${first} hasn't listed a company on their profile.`
  }
  if (/\b(where)\b.*\b(live|based|located|from)\b|\blocation\b|\bcountry\b|\bcity\b/.test(q)) {
    return f.location ? `They're based in ${f.location}.` : `${first} hasn't listed a location on their profile.`
  }
  return null
}

/** Asked inside the ongoing conversation, so the model reuses what it already read and the cache stays warm. */
export function followupRequest(subject: string, asked: string[]): string {
  return `Now suggest three different questions I could ask next about ${subject}, based on what we have covered and what you can answer from the context. Each under nine words, written as a plain question, one per line, no numbering. Nothing else. They must be new: not the same as any question already asked or suggested earlier in this conversation.${asked.length ? ` Already used: ${asked.slice(-10).join(' | ')}` : ''}`
}

/** Clean model output into at most three distinct questions, none already asked. */
export function parseFollowups(raw: string, asked: string[]): string[] {
  const seen = new Set(asked.map((q) => q.toLowerCase().replace(/[^a-z0-9]/g, '')))
  const out: string[] = []
  for (const line of raw.replace(/<\/?think>/g, '').split(/\n|(?<=\?)\s+/)) {
    const q = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["']|["']$/g, '').trim()
    const key = q.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (q.length < 8 || q.length > 70 || !q.endsWith('?') || seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length === 3) break
  }
  return out
}

const NEXT_RE = /\s*\bNEXT\s*:/i

/** Splits a streamed reply into what is spoken and the trailing "NEXT: q | q | q" suggestions. */
export function splitNext(full: string, done: boolean): { say: string; next: string } {
  const m = NEXT_RE.exec(full)
  if (m) return { say: full.slice(0, m.index), next: full.slice(m.index + m[0].length) }
  const hold = done ? 0 : Math.min(full.length, 7) // might be the start of "NEXT:"
  return { say: full.slice(0, full.length - hold), next: '' }
}

export const nextRule = (asked: string[]) =>
  `Then on a new line write NEXT: followed by three short new questions I could ask about this, each under nine words, separated by " | ".${asked.length ? ` Already asked: ${asked.slice(-8).join(' | ')}.` : ''}`

/** Turns the text after "NEXT:" into up to three distinct questions. */
export function parseNext(tail: string, asked: string[]): string[] {
  const lines = tail.split(/\||\n/).map((x) => x.trim().replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')).filter((x) => x.length > 6).map((x) => (x.endsWith('?') ? x : `${x.replace(/[.!]+$/, '')}?`))
  return parseFollowups(lines.join('\n'), asked)
}
