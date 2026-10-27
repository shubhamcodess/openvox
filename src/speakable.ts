/**
 * Turns on-screen text into something worth hearing: links become "this link", shell commands become
 * "the command shown on screen", acronyms are spelled or pronounced, paths and versions are read naturally.
 * The transcript keeps the original text; only the voice gets this version.
 */

// Said as a word, not letter by letter.
const SAY: Record<string, string> = {
  json: 'Jason', yaml: 'yammel', sql: 'sequel', gui: 'gooey', wasm: 'wazum', regex: 'reg ex', sudo: 'sue doo',
  kubectl: 'kube control', nginx: 'engine X', oauth: 'oh auth', readme: 'read me', vite: 'veet',
  numpy: 'num pie', scipy: 'sigh pie', sqlite: 'S Q lite', graphql: 'graph Q L', pypi: 'pie P I',
  fastapi: 'fast A P I', gitignore: 'git ignore', dockerfile: 'docker file', eslint: 'E S lint',
  localhost: 'local host', stdin: 'standard in', stdout: 'standard out', stderr: 'standard error',
  k8s: 'Kubernetes', nodejs: 'node J S', nextjs: 'next J S', webgpu: 'web G P U', webgl: 'web G L',
  ios: 'i O S', macos: 'mac O S', toml: 'tom el', npm: 'N P M', npx: 'N P X', pnpm: 'P N P M',
  async: 'ay sink',
}

// Spelled out letter by letter when written in lowercase prose.
const SPELL_LOWER = new Set(
  'llm tts stt vad gpu cpu mcp pdf html css url http https ssh jwt cdn dns tcp udp api ui ux sdk cli ide ci tsx jsx ram ssd usb '.split(' ').filter(Boolean),
)

// Plain English words that are sometimes SHOUTED and must not be spelled out.
const SHOUTED = new Set('THE AND FOR NOT ALL ANY BUT CAN NEW NOW OFF OUT USE WHY HOW WHO YES ONE TWO TOP RUN SET GET TODO NOTE'.split(' '))

const EXT: Record<string, string> = {
  js: 'J S', ts: 'T S', tsx: 'T S X', jsx: 'J S X', py: 'P Y', md: 'M D', json: 'Jason', yml: 'Y M L', yaml: 'yammel',
  toml: 'tom el', rs: 'R S', go: 'go', css: 'C S S', html: 'H T M L', sh: 'S H', txt: 'T X T', lock: 'lock', mjs: 'M J S', cjs: 'C J S',
}

const spell = (w: string) => w.toUpperCase().split('').join(' ')
const VOWEL = /[AEIOU]/

function pronounce(w: string): string {
  if (w === 'PR') return 'pull request'
  if (w === 'PRs') return 'pull requests'
  if (w === 'OSS') return 'open source'
  const lower = w.toLowerCase()
  if (Object.hasOwn(SAY, lower)) return SAY[lower]
  if (SPELL_LOWER.has(lower)) return spell(lower)
  if (lower.endsWith('s') && SPELL_LOWER.has(lower.slice(0, -1))) return spell(lower.slice(0, -1)) + "'s"
  if (/^[A-Z]{2,}s$/.test(w)) return pronounce(w.slice(0, -1)) + "'s"
  if (/^[A-Z]{2,6}$/.test(w)) {
    if (SHOUTED.has(w)) return w
    return w.length <= 3 || !VOWEL.test(w) ? spell(w) : w
  }
  // WebGPU, OpenAI, PostgreSQL: split at the capital runs so each piece is read properly
  if (/[a-z]/.test(w) && /[A-Z]{2,}/.test(w)) {
    const parts = w.match(/[A-Z]{2,}(?![a-z])|[A-Z][a-z]+|[a-z]+|\d+/g)
    if (parts && parts.join('').length === w.length) return parts.map((p) => (p.length > 1 && /^[A-Z]+$/.test(p) ? pronounce(p) : p)).join(' ')
  }
  return w
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()"']+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|ai|app)\/[^\s<>()"']*/gi
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

const CMD_RE = new RegExp(
  '\\b(?:git\\s+(?:clone|pull|push|commit|checkout|init|add|status|log|fetch|merge|rebase|branch|remote|stash|diff|reset)' +
    '|(?:npm|pnpm|yarn|bun)\\s+(?:install|i|run|start|test|build|publish|init|ci|exec|link|add|dlx|-g|--[\\w-]+)' +
    '|npx\\s+\\S+|cargo\\s+(?:install|build|run|test|add|new)|pip3?\\s+(?:install|uninstall|freeze)' +
    '|docker\\s+(?:run|build|compose|pull|push|exec|ps|up)|brew\\s+(?:install|tap|update|upgrade)' +
    '|(?:curl|wget)\\s+-?\\S+|sudo\\s+\\S+|cd\\s+[\\w./~-]+|node\\s+\\S+\\.[mc]?js\\b|python3?\\s+\\S+\\.py\\b)[^\\n]*',
  'g',
)
const CMD_STOP = new Set('then and or to in for so which that if when will you the a it this now next after before once'.split(' '))
const COMMAND = 'the command shown on screen'

/** A command runs until a stop word or a token that ends the clause; whatever follows is kept. */
function collapseCommand(match: string): string {
  const toks = match.split(/\s+/)
  let end = Math.min(toks.length, 10)
  let tail = ''
  for (let i = 2; i < toks.length && i < 10; i++) {
    if (CMD_STOP.has(toks[i].toLowerCase())) { end = i; break }
  }
  for (let i = 0; i < end; i++) {
    if (/[.!?;:,]$/.test(toks[i])) {
      tail = toks[i].slice(-1)
      end = i + 1
      break
    }
  }
  // the regex ran to end of line, so later commands live in the remainder
  const rest = toks.slice(end).join(' ').replace(CMD_RE, collapseCommand)
  return COMMAND + tail + (rest ? ' ' + rest : '')
}

function filePart(path: string): string {
  const name = path.split('/').filter(Boolean).pop() ?? path
  const m = /^(.*?)\.([A-Za-z0-9]{1,5})$/.exec(name)
  if (m && (EXT[m[2].toLowerCase()] || /^(env)$/i.test(m[2]))) return `${m[1].replace(/[-_]+/g, ' ')} dot ${EXT[m[2].toLowerCase()] ?? m[2]}`.trim()
  return name.replace(/[-_]+/g, ' ')
}

export function toSpeech(input: string): string {
  let t = input
    .replace(/<[^>]+>/g, ' ')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/[*_`#>]+/g, (m) => (m.includes('_') ? m : ''))

  // commands first so a URL inside `git clone <url>` is swallowed with it
  t = t.replace(CMD_RE, collapseCommand)

  // links and emails, so nothing below tries to read them
  let links = 0
  t = t.replace(URL_RE, (m) => {
    const trail = /[.,;:!?)]+$/.exec(m)?.[0] ?? ''
    return (links++ ? 'another link' : 'this link') + trail
  })
  t = t.replace(EMAIL_RE, 'an email address')

  // step markers from numbered lists
  t = t.replace(/^\s*(\d{1,2})[.)]\s+/, 'Step $1, ').replace(/\.?\s(\d{1,2})\.\s+(?=[A-Z])/g, ', step $1, ')

  // release archives: not worth reading their file names aloud
  t = t.replace(/[\w.@-]+\.(?:tgz|zip|tar\.gz|whl|jar|dmg|exe|deb)\b/gi, 'the release file')

  // versions: v0.1.0 -> "version 0 point 1 point 0"
  t = t.replace(/\b(v)?(\d+(?:\.\d+){2,3})\b/gi, (_, v, n) => (v ? 'version ' : '') + n.split('.').join(' point '))

  // paths and file names
  t = t.replace(/(?:[\w@~.-]+\/)+[\w@.-]+/g, (p) => {
    const segs = p.split('/').filter(Boolean)
    if (segs.length >= 3 || /\.\w{1,5}$/.test(p)) return filePart(p)
    return segs.map((s) => s.replace(/[-_]+/g, ' ')).join(' slash ') // owner/repo
  })
  t = t.replace(/\b([\w-]+)\.(js|ts|tsx|jsx|py|md|json|yml|yaml|toml|rs|css|html|sh|txt|mjs|cjs)\b/g, (_, n, e) => `${n.replace(/[-_]+/g, ' ')} dot ${EXT[e]}`)

  // snake_case and kebab-case identifiers read as separate words
  t = t.replace(/\b([A-Za-z][A-Za-z0-9]*)(?:[-_]([A-Za-z0-9]+))+\b/g, (m) => m.replace(/[-_]+/g, ' '))

  // symbols
  t = t
    .replace(/\s*(?:->|=>|→|›|»)\s*/g, ' to ')
    .replace(/\s*[·•]\s*/g, ', ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/&/g, ' and ')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent')
    .replace(/(\d+(?:\.\d+)?)k\b/gi, '$1 thousand')
    .replace(/(\d+(?:\.\d+)?)x\b/g, '$1 times')
    .replace(/~(?=\d)/g, 'about ')
    .replace(/(?<=\s)@(?=\w)/g, '')
    .replace(/\be\.g\.,?/gi, 'for example,')
    .replace(/\bi\.e\.,?/gi, 'that is,')
    .replace(/\betc\./gi, 'and so on.')
    .replace(/\bvs\.?\s/gi, 'versus ')
    .replace(/\bw\//gi, 'with ')
    .replace(/\band\/or\b/gi, 'and or')

  // acronyms and tech words, one token at a time
  t = t.replace(/[A-Za-z][A-Za-z0-9]*/g, pronounce)

  return t.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim()
}
