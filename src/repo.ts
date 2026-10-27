import { gh } from './github'
import { Bm25, chunkMarkdown, type Chunk } from './retrieval'

export interface RepoFacts {
  owner: string
  name: string
  description: string | null
  homepage: string | null
  stars: number
  forks: number
  openIssues: number
  license: string | null
  topics: string[]
  createdAt: string
  pushedAt: string
  archived: boolean
  languages: [string, number][]
  contributors: { count: number; capped: boolean; top: [string, number][] }
  prs: { total: number; merged: number }
  commits30d: number
  docs: string[]
}

export interface RepoBundle { facts: RepoFacts; index: Bm25 }

export function parseTarget(input: string): { owner: string; repo: string } | { user: string } | null {
  const s = input.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/^@/, '')
  const m = /^([\w.-]+)\/([\w.-]+)/.exec(s)
  if (m) return { owner: m[1], repo: m[2] }
  return /^[\w-]+$/.test(s) ? { user: s } : null
}

async function rawText(url: string, max = 40_000): Promise<string | null> {
  try {
    const r = await fetch(url)
    return r.ok ? (await r.text()).slice(0, max) : null
  } catch { return null }
}

const SKIP = /(^|\/)(node_modules|vendor|third_party|i18n|locales?|translations?)\/|changelog|release|\.[a-z]{2}(-[a-z]{2})?\.mdx?$/i

/** Root-level docs first, then docs/ by depth; README is fetched separately. */
function pickDocs(paths: string[]): string[] {
  return paths
    .filter((p) => /\.mdx?$/i.test(p) && !/^readme(\.|$)/i.test(p) && !SKIP.test(p))
    .filter((p) => !p.includes('/') || /^docs?\//i.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)
    .slice(0, 8)
}

export async function loadRepo(owner: string, name: string): Promise<RepoBundle> {
  const key = `gitvox:repo:${owner}/${name}`.toLowerCase()
  const since = new Date(Date.now() - 30 * 864e5).toISOString()
  const base = `/repos/${owner}/${name}`

  const [meta, langs, contribs, tree, prAll, prMerged, commits, readme] = await Promise.all([
    gh<any>(base),
    gh<Record<string, number>>(`${base}/languages`).catch(() => ({})),
    gh<any[]>(`${base}/contributors?per_page=100`).catch(() => []),
    gh<any>(`${base}/git/trees/HEAD?recursive=1`).catch(() => ({ tree: [] })),
    gh<any>(`/search/issues?q=repo:${owner}/${name}+type:pr&per_page=1`).catch(() => ({ total_count: 0 })),
    gh<any>(`/search/issues?q=repo:${owner}/${name}+type:pr+is:merged&per_page=1`).catch(() => ({ total_count: 0 })),
    gh<any[]>(`${base}/commits?per_page=100&since=${since}`).catch(() => []),
    fetch(`https://api.github.com${base}/readme`, { headers: { Accept: 'application/vnd.github.raw+json' } })
      .then((r) => (r.ok ? r.text() : null)).catch(() => null),
  ])

  const paths: string[] = (tree.tree ?? []).filter((t: any) => t.type === 'blob').map((t: any) => t.path)
  const docPaths = pickDocs(paths)
  const docs = await Promise.all(
    docPaths.map(async (p) => [p, await rawText(`https://raw.githubusercontent.com/${owner}/${name}/HEAD/${p}`)] as const),
  )

  const chunks: Chunk[] = []
  // README is the best source for most questions; policy files match many words but rarely answer anything.
  const weightFor = (source: string) => (source === 'README' ? 1.3 : /(security|code_of_conduct|contributing|governance)/i.test(source) ? 0.6 : 1)
  const add = (source: string, md: string | null) =>
    md && chunks.push(...chunkMarkdown(source, md, chunks.length).map((c) => ({ ...c, weight: weightFor(source) })))
  add('README', readme)
  docs.forEach(([p, text]) => add(p, text))

  const total = Object.values(langs).reduce((s, n) => s + n, 0) || 1
  const facts: RepoFacts = {
    owner, name,
    description: meta.description,
    homepage: meta.homepage || null,
    stars: meta.stargazers_count,
    forks: meta.forks_count,
    openIssues: meta.open_issues_count,
    license: meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION' ? meta.license.spdx_id : meta.license?.name ?? null,
    topics: meta.topics ?? [],
    createdAt: meta.created_at,
    pushedAt: meta.pushed_at,
    archived: !!meta.archived,
    languages: Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, n]) => [l, Math.round((n / total) * 100)] as [string, number]),
    contributors: {
      count: contribs.length,
      capped: contribs.length >= 100,
      top: contribs.slice(0, 3).map((c) => [c.login, c.contributions] as [string, number]),
    },
    prs: { total: prAll.total_count, merged: prMerged.total_count },
    commits30d: commits.length,
    docs: ['README', ...docs.filter(([, t]) => t).map(([p]) => p)],
  }
  try { sessionStorage.setItem(key, '1') } catch { /* ignore */ }
  return { facts, index: new Bm25(chunks) }
}
