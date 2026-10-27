const API = 'https://api.github.com'

export interface Repo {
  name: string
  description: string | null
  stars: number
  language: string | null
  pushedAt: string
  fork: boolean
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
  activeRepos90d: number
  recent: { commits: number; prsOpened: number; reposTouched: number; events: number }
  prs: { total: number; merged: number }
  profileReadme: string | null
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(API + path, { headers: { Accept: 'application/vnd.github+json' } })
  if (res.status === 404) throw new Error('No such GitHub user')
  if (res.status === 403 || res.status === 429) throw new Error('GitHub rate limit hit (60/hr). Try again later.')
  if (!res.ok) throw new Error(`GitHub error ${res.status}`)
  return res.json()
}

async function profileReadme(login: string): Promise<string | null> {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${login}/${login}/HEAD/README.md`)
    if (!res.ok) return null
    const text = await res.text()
    return text
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*`>_|-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600)
  } catch {
    return null
  }
}

export async function loadFacts(login: string): Promise<Facts> {
  const key = `gitvox:${login.toLowerCase()}`
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
    profileReadme(login),
  ])

  const own: Repo[] = repos.map((r) => ({
    name: r.name,
    description: r.description,
    stars: r.stargazers_count,
    language: r.language,
    pushedAt: r.pushed_at,
    fork: r.fork,
  })).filter((r) => !r.fork)

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
    topRepos: [...own].sort((a, b) => b.stars - a.stars).slice(0, 5),
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
