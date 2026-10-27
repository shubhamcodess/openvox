import type { Facts } from './github'
import type { RepoFacts } from './repo'

const n = (k: number, one: string, many = one + 's') => `${k} ${k === 1 ? one : many}`
const years = (iso: string) => Math.max(1, Math.round((Date.now() - +new Date(iso)) / (365.25 * 864e5)))

/** Deterministic intro: every number comes straight from the facts, no LLM involved. */
export function introScript(f: Facts): string[] {
  const s: string[] = []
  s.push(`Meet ${f.name}, on GitHub for ${years(f.createdAt)} years.`)
  if (f.bio) s.push(f.bio.replace(/[\r\n]+/g, ' ').slice(0, 160) + (/[.!?]$/.test(f.bio) ? '' : '.'))
  s.push(`${n(f.ownRepos, 'original public repository', 'original public repositories')}, with ${n(f.totalStars, 'star')} between them and ${n(f.followers, 'follower')}.`)
  if (f.languages.length) s.push(`Mostly ${f.languages.slice(0, 3).map(([l]) => l).join(', ')}.`)
  if (f.topRepos[0]?.stars) {
    const t = f.topRepos[0]
    s.push(`The standout project is ${t.name.replace(/[-_]/g, ' ')}${t.description ? `: ${t.description.slice(0, 140).replace(/[.\s]+$/, '')}` : ''}.`)
  }
  if (f.prs.total) s.push(`${f.prs.total} pull requests opened in total, ${f.prs.merged} of them merged.`)
  s.push(
    f.activeRepos90d
      ? `${f.activeRepos90d} repositories saw pushes in the last ninety days, so this is an active profile.`
      : `No pushes in the last ninety days, so things are quiet right now.`,
  )
  return s
}

export function repoIntro(r: RepoFacts, ownerName?: string | null): string[] {
  const s: string[] = []
  s.push(`${r.name.replace(/[-_]/g, ' ')}, by ${ownerName || r.owner}.`)
  if (r.description) s.push(r.description.replace(/[\r\n]+/g, ' ').slice(0, 180).replace(/[.\s]+$/, '') + '.')
  s.push(`${n(r.stars, 'star')} and ${n(r.forks, 'fork')}${r.languages[0] ? `, written mostly in ${r.languages[0][0]}` : ''}.`)
  if (r.contributors.count) s.push(`${r.contributors.capped ? 'At least ' : ''}${r.contributors.count} ${r.contributors.count === 1 ? 'contributor' : 'contributors'}${r.license ? `, under the ${r.license} license` : ''}.`)
  if (r.prs.total) s.push(`${n(r.prs.total, 'pull request')} so far, ${r.prs.merged} merged.`)
  const days = Math.round((Date.now() - +new Date(r.pushedAt)) / 864e5)
  s.push(r.archived ? 'The repository is archived.' : days <= 30 ? `Last pushed ${days <= 1 ? 'in the last day' : `${days} days ago`}, so it is actively maintained.` : `Last pushed ${days} days ago.`)
  s.push(`Ask me anything about it. I have read ${r.docs.length === 1 ? 'the README' : `the README and ${r.docs.length - 1} more docs`}.`)
  return s
}
