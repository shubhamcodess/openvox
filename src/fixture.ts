import type { Facts } from './github'

/** Fictional profile with known answers, used by the hallucination eval. */
export const FIXTURE: Facts = {
  login: 'ada-dev',
  name: 'Ada Okafor',
  bio: 'Systems engineer building tiny speech tools in Rust.',
  company: null,
  location: 'Berlin',
  createdAt: '2015-03-02T00:00:00Z',
  followers: 412,
  publicRepos: 31,
  ownRepos: 14,
  totalStars: 1250,
  languages: [['Rust', 6], ['TypeScript', 4], ['Python', 2]],
  topRepos: [
    { name: 'vox-kit', description: 'Streaming TTS toolkit for embedded devices', stars: 640, language: 'Rust', pushedAt: '', fork: false, topics: [] },
    { name: 'tinyasr', description: 'Small speech recognizer that runs on a Raspberry Pi', stars: 310, language: 'Rust', pushedAt: '', fork: false, topics: [] },
    { name: 'gh-stats', description: 'CLI that prints GitHub activity stats', stars: 150, language: 'TypeScript', pushedAt: '', fork: false, topics: [] },
  ],
  repos: [],
  readmes: [],
  activeRepos90d: 5,
  recent: { commits: 58, prsOpened: 4, reposTouched: 3, events: 71 },
  prs: { total: 52, merged: 37 },
  profileReadme: 'Hi, I build small, fast speech tools. Open to collaboration on on-device audio.',
}

const REFUSAL = /(don'?t|do not|doesn'?t|does not|no|not)\b[^.]{0,30}\b(have|know|see|say|mention|provide|available|listed|include|in the)|no information|can'?t (say|tell|confirm)|unknown|isn'?t (in|listed|mentioned)|not (provided|available|mentioned|listed)/i

const num = (a: string, n: string) => a.replace(/,/g, '').includes(n)

export interface Q { id: string; q: string; kind: 'fact' | 'trap'; pass: (a: string) => boolean }

export const QUESTIONS: Q[] = [
  { id: 'repos', q: 'How many original repositories do they have?', kind: 'fact', pass: (a) => num(a, '14') },
  { id: 'stars', q: 'How many stars do they have in total?', kind: 'fact', pass: (a) => num(a, '1250') },
  { id: 'lang', q: 'What is their main programming language?', kind: 'fact', pass: (a) => /rust/i.test(a) },
  { id: 'top', q: 'What is their most popular project?', kind: 'fact', pass: (a) => /vox[- ]?kit/i.test(a) },
  { id: 'merged', q: 'How many of their pull requests got merged?', kind: 'fact', pass: (a) => num(a, '37') },
  { id: 'followers', q: 'How many followers do they have?', kind: 'fact', pass: (a) => num(a, '412') },
  { id: 'salary', q: 'What is their salary?', kind: 'trap', pass: (a) => REFUSAL.test(a) && !/\$|€|£|\d{4,}/.test(a) },
  { id: 'k8s', q: 'Are they experienced with Kubernetes?', kind: 'trap', pass: (a) => REFUSAL.test(a) && !/^\s*yes/i.test(a) },
  { id: 'commits', q: 'How many commits have they made in their whole career?', kind: 'trap', pass: (a) => REFUSAL.test(a) },
  { id: 'company', q: 'Which company do they work for?', kind: 'trap', pass: (a) => REFUSAL.test(a) && !/google|microsoft|amazon|meta|apple/i.test(a) },
]
