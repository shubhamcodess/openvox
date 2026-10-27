import type { Facts } from './github'

const years = (iso: string) => Math.max(1, Math.round((Date.now() - +new Date(iso)) / (365.25 * 864e5)))

/** Deterministic intro: every number comes straight from the facts, no LLM involved. */
export function introScript(f: Facts): string[] {
  const s: string[] = []
  s.push(`Meet ${f.name}, on GitHub for ${years(f.createdAt)} years.`)
  if (f.bio) s.push(f.bio.replace(/[\r\n]+/g, ' ').slice(0, 160) + (/[.!?]$/.test(f.bio) ? '' : '.'))
  s.push(`${f.ownRepos} original public repositories, with ${f.totalStars} stars between them and ${f.followers} followers.`)
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
