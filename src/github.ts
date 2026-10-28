const API = 'https://api.github.com'

export interface Repo {
  name: string
  description: string | null
  stars: number
  language: string | null
  pushedAt: string
  fork: boolean
  topics: string[]
}

export interface Facts {
  login: string
  name: string
  bio: string | null
  company: string | null
  location: string | null
  createdAt: string
  followers: number
  publicRepos: number
  ownRepos: number
  totalStars: number
  languages: [string, number][]
  topRepos: Repo[]
  /** Every original repo (up to 100), most starred first; feeds the repo picker and the retrieval index. */
  repos: Repo[]
  /** READMEs of the most relevant repos, so questions about a project have something to quote. */
  readmes: { repo: string; text: string }[]
  activeRepos90d: number
  recent: { commits: number; prsOpened: number; reposTouched: number; events: number }
  prs: { total: number; merged: number }
  profileReadme: string | null
}

let limited = false
/** True once if any call hit GitHub's anonymous rate limit since the last check. */
export function takeRateLimited() { const v = limited; limited = false; return v }

export async function gh<T>(path: string): Promise<T> {
  const res = await fetch(API + path, { headers: { Accept: 'application/vnd.github+json' } })
  if (res.status === 404) throw new Error('Not found on GitHub')
  if (res.status === 403 || res.status === 429) {
    limited = true
    throw new Error('GitHub rate limit hit (60/hr). Try again later.')
  }
  if (!res.ok) throw new Error(`GitHub error ${res.status}`)
  return res.json()
}

async function rawReadme(login: string, repo: string, max: number): Promise<string | null> {
  for (const file of ['README.md', 'readme.md', 'Readme.md']) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${login}/${repo}/HEAD/${file}`)
      if (res.ok) return (await res.text()).slice(0, max)
    } catch { /* try the next name */ }
  }
  return null
}

/** Top starred repos plus the most recently pushed one: what they are known for and what they do now. */
function readmeTargets(own: Repo[], n = 5): Repo[] {
  const picks = own.slice(0, n)
  const recent = [...own].sort((a, b) => +new Date(b.pushedAt) - +new Date(a.pushedAt))[0]
  if (recent && !picks.includes(recent)) picks[n - 1] = recent
  return picks
}

export async function loadFacts(login: string): Promise<Facts> {
  const key = `gitvox:v2:${login.toLowerCase()}`
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (hit) return hit
  } catch { /* ignore */ }

  const [user, repos, events, prAll, prMerged, readme] = await Promise.all([
    gh<any>(`/users/${login}`),
    gh<any[]>(`/users/${login}/repos?per_page=100&sort=pushed`),
    gh<any[]>(`/users/${login}/events/public?per_page=100`).catch(() => []),
    gh<any>(`/search/issues?q=author:${login}+type:pr&per_page=1`).catch(() => ({ total_count: 0 })),
    gh<any>(`/search/issues?q=author:${login}+type:pr+is:merged&per_page=1`).catch(() => ({ total_count: 0 })),
    rawReadme(login, login, 6000),
  ])

  const own: Repo[] = repos.map((r) => ({
    name: r.name,
    description: r.description,
    stars: r.stargazers_count,
    language: r.language,
    pushedAt: r.pushed_at,
    fork: r.fork,
    topics: r.topics ?? [],
  })).filter((r) => !r.fork)

  own.sort((a, b) => b.stars - a.stars || +new Date(b.pushedAt) - +new Date(a.pushedAt))
  const targets = readmeTargets(own)
  const readmes = (await Promise.all(targets.map(async (r) => ({ repo: r.name, text: await rawReadme(login, r.name, 12000) }))))
    .filter((r): r is { repo: string; text: string } => !!r.text)

  const langCount = new Map<string, number>()
  own.forEach((r) => r.language && langCount.set(r.language, (langCount.get(r.language) ?? 0) + 1))
  const cutoff = Date.now() - 90 * 864e5

  const facts: Facts = {
    login: user.login,
    name: user.name || user.login,
    bio: user.bio,
    company: user.company,
    location: user.location,
    createdAt: user.created_at,
    followers: user.followers,
    publicRepos: user.public_repos,
    ownRepos: own.length,
    totalStars: own.reduce((s, r) => s + r.stars, 0),
    languages: [...langCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    topRepos: own.slice(0, 8),
    repos: own.slice(0, 100),
    readmes,
    activeRepos90d: own.filter((r) => +new Date(r.pushedAt) > cutoff).length,
    recent: {
      events: events.length,
      commits: events.filter((e) => e.type === 'PushEvent').reduce((s, e) => s + (e.payload?.size ?? 0), 0),
      prsOpened: events.filter((e) => e.type === 'PullRequestEvent' && e.payload?.action === 'opened').length,
      reposTouched: new Set(events.map((e) => e.repo?.name)).size,
    },
    prs: { total: prAll.total_count, merged: prMerged.total_count },
    profileReadme: readme,
  }
  try { sessionStorage.setItem(key, JSON.stringify(facts)) } catch { /* ignore */ }
  return facts
}
