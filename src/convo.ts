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
export function retrievalQuery(question: string, history: Msg[]): string {
  if (tokenize(question).length >= 4) return question
  const prev = [...history].reverse().find((m) => m.role === 'user')
  return prev ? `${question} ${prev.content}` : question
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

/** Prompt for silently proposing what to ask next. `topics` keeps the suggestions inside what we can answer. */
export function followupPrompt(subject: string, question: string, answer: string, asked: string[], topics: string): Msg[] {
  return [
    {
      role: 'system',
      content: `You suggest what a listener could ask next in a voice conversation about ${subject}. Write three different short questions, each under nine words and specific to ${subject}, each on its own line. Output only the three lines, nothing else. They must be answerable from these topics: ${topics}. Do not repeat anything already asked.`,
    },
    { role: 'user', content: `Already asked: ${asked.slice(-6).join(' | ')}\nLast question: ${question}\nLast answer: ${answer.slice(0, 400)}\n\nWrite the three questions now, one per line:` },
  ]
}

/** Clean model output into at most three distinct questions, none already asked. */
export function parseFollowups(raw: string, asked: string[]): string[] {
  const seen = new Set(asked.map((q) => q.toLowerCase().replace(/[^a-z0-9]/g, '')))
  const out: string[] = []
  for (const line of raw.replace(/<\/?think>/g, '').split('\n')) {
    const q = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["']|["']$/g, '').trim()
    const key = q.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (q.length < 8 || q.length > 70 || !q.endsWith('?') || seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length === 3) break
  }
  return out
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const GENERIC = /^(readme|documentation|docs?|overview|introduction|table of contents|contents|license|licence|contributing|why|what this is)$/i

/**
 * Grounded fallbacks that need no model: sections the answer drew on, repos not discussed yet, or stock questions.
 * `headings` are excerpt section titles (repo mode); `repos` are repo names, most relevant first (profile mode).
 */
export function templateFollowups(opts: { headings?: string[]; repos?: string[]; asked: string[] }): string[] {
  const asked = opts.asked.map(norm)
  const out: string[] = []
  const add = (q: string) => { if (!out.some((x) => norm(x) === norm(q)) && !asked.some((a) => a === norm(q) || a.includes(norm(q)))) out.push(q) }
  for (const h of opts.headings ?? []) {
    const t = h.replace(/^[\d.\s]+/, '').replace(/[^\w\s'-]/g, '').trim()
    if (t.length > 3 && t.length < 40 && !GENERIC.test(t) && !asked.some((a) => a.includes(norm(t)))) add(`Tell me about ${t.toLowerCase()}`)
  }
  for (const r of opts.repos ?? []) if (!asked.some((a) => a.includes(norm(r)))) add(`What is ${r.replace(/[-_]/g, ' ')} about?`)
  if (opts.headings) ['How active is it?', 'How can I contribute?', 'What license does it use?'].forEach(add)
  else ['What are they working on lately?', 'What languages do they use?'].forEach(add)
  return out
}
