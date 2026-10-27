import { useState } from 'react'
import Orb from './Orb'
import { loadFacts, type Facts } from './github'
import { introScript, repoIntro } from './narrate'
import { loadRepo, parseTarget, type RepoBundle } from './repo'
import { loadVoice, speak, startSpeaker, stop } from './speech'
import { answer, answerRepo, buildRepoMessages, sourceLabel, SentenceChunker, clean } from './ask'
import { DEFAULT_MODEL, loadModel, type Msg } from './llm'
import Eval from './Eval'

type Phase = 'idle' | 'fetching' | 'voice' | 'speaking' | 'error'

export default function App() {
  if (new URLSearchParams(location.search).has('eval')) return <Eval />
  return <Main />
}

function Main() {
  const [turns, setTurns] = useState<{ q: string; a: string; src?: string[] }[]>([])
  const [repo, setRepo] = useState<RepoBundle | null>(null)
  const [question, setQuestion] = useState('')
  const [thinking, setThinking] = useState(false)
  const qs = new URLSearchParams(location.search)
  const [user, setUser] = useState(qs.get('r') ?? qs.get('u') ?? '')
  const [phase, setPhase] = useState<Phase>('idle')
  const [msg, setMsg] = useState('')
  const [facts, setFacts] = useState<Facts | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [active, setActive] = useState(-1)
  const [ttfa, setTtfa] = useState<number | null>(null)

  async function run(e: React.FormEvent) {
    e.preventDefault()
    const target = parseTarget(user)
    if (!target) return
    try {
      stop()
      setPhase('fetching'); setMsg('Reading GitHub…'); setTtfa(null); setActive(-1); setTurns([]); setRepo(null); setFacts(null)
      let script: string[]
      if ('repo' in target) {
        const [bundle, owner] = await Promise.all([
          loadRepo(target.owner, target.repo),
          loadFacts(target.owner).catch(() => null), // profile context is a bonus; rate limits must not block the repo
        ])
        setRepo(bundle); setFacts(owner)
        script = repoIntro(bundle.facts)
        history.replaceState(null, '', `?r=${target.owner}/${target.repo}`)
      } else {
        const f = await loadFacts(target.user)
        setFacts(f)
        script = introScript(f)
        history.replaceState(null, '', `?u=${f.login}`)
      }
      setLines(script)
      setPhase('voice'); setMsg('Loading voice model (first run downloads ~65 MB)…')
      await loadVoice((p) => setMsg(`Loading voice model… ${p}%`))
      setPhase('speaking'); setMsg('')
      await speak(script, setActive, setTtfa)
      setPhase('idle')
    } catch (err) {
      setPhase('error'); setMsg(err instanceof Error ? err.message : String(err))
    }
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q || (!facts && !repo) || thinking) return
    setQuestion(''); setThinking(true); stop()
    const idx = turns.length
    setTurns((t) => [...t, { q, a: '' }])
    try {
      await loadVoice(() => {})
      setMsg('Loading language model (first run downloads ~1 GB)…')
      await loadModel(DEFAULT_MODEL, (p) => setMsg(`Loading language model… ${Math.round(p * 100)}%`))
      setMsg('')
      const history: Msg[] = turns.flatMap((t) => [{ role: 'user' as const, content: t.q }, { role: 'assistant' as const, content: t.a }])
      const sp = startSpeaker(() => {}, (ms) => setTtfa(ms))
      const chunker = new SentenceChunker()
      let full = ''
      let stream: AsyncGenerator<string>
      if (repo) {
        const hits = repo.index.search(q, 4)
        setTurns((t) => t.map((x, i) => (i === idx ? { ...x, src: [...new Set(hits.map(sourceLabel))] } : x)))
        stream = answerRepo(buildRepoMessages(repo.facts, facts, history, q, hits))
      } else {
        stream = answer(facts!, history, q)
      }
      for await (const d of stream) {
        full += d
        setTurns((t) => t.map((x, i) => (i === idx ? { ...x, a: clean(full) } : x)))
        chunker.push(d).forEach(sp.push)
      }
      chunker.flush().forEach(sp.push)
      sp.end()
      await sp.done
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setThinking(false)
    }
  }

  const busy = phase === 'fetching' || phase === 'voice'

  return (
    <main className="shell">
      <header className="top">
        <span className="brand">gitvox<i>.</i></span>
        <span className="pill">on-device · no cloud</span>
      </header>

      <section className="hero">
        <Orb />
        <h1>Talk to GitHub.</h1>
        <p className="sub">Type a username or owner/repo. It reads it, speaks it, and answers questions, all in your browser.</p>
        <form onSubmit={run} className="row">
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="username or owner/repo"
            aria-label="GitHub username or owner/repo"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button className="primary" disabled={busy}>{busy ? 'Loading…' : phase === 'speaking' ? 'Restart' : 'Speak'}</button>
          {phase === 'speaking' && <button type="button" className="line" onClick={() => { stop(); setPhase('idle'); setActive(-1) }}>Stop</button>}
        </form>
        {msg && <p className={phase === 'error' ? 'msg err' : 'msg'}>{msg}</p>}
        {ttfa !== null && <p className="pill">first audio in {ttfa} ms</p>}
      </section>

      {(facts || repo) && (
        <section className="grid">
          <div className="card terminal">
            <h2>{repo ? `${repo.facts.owner}/${repo.facts.name}` : 'facts'}</h2>
            {repo ? (
              <dl>
                <dt>stars</dt><dd>{repo.facts.stars} · {repo.facts.forks} forks</dd>
                <dt>language</dt><dd>{repo.facts.languages.map(([l, p]) => `${l} ${p}%`).join(', ') || '—'}</dd>
                <dt>license</dt><dd>{repo.facts.license ?? 'none'}</dd>
                <dt>people</dt><dd>{repo.facts.contributors.count}{repo.facts.contributors.capped ? '+' : ''} contributors</dd>
                <dt>prs</dt><dd>{repo.facts.prs.total} opened / {repo.facts.prs.merged} merged</dd>
                <dt>30d</dt><dd>{repo.facts.commits30d} commits</dd>
                <dt>indexed</dt><dd>{repo.facts.docs.length} docs · {repo.index.chunks.length} chunks</dd>
              </dl>
            ) : facts && (
              <dl>
                <dt>repos</dt><dd>{facts.ownRepos} original / {facts.publicRepos} public</dd>
                <dt>stars</dt><dd>{facts.totalStars}</dd>
                <dt>followers</dt><dd>{facts.followers}</dd>
                <dt>prs</dt><dd>{facts.prs.total} opened / {facts.prs.merged} merged</dd>
                <dt>recent</dt><dd>{facts.recent.commits} commits, {facts.recent.prsOpened} PRs across {facts.recent.reposTouched} repos</dd>
                <dt>active 90d</dt><dd>{facts.activeRepos90d} repos</dd>
                <dt>languages</dt><dd>{facts.languages.map(([l]) => l).join(', ') || '—'}</dd>
              </dl>
            )}
          </div>
          <div className="card">
            <h2>narration</h2>
            <ol className="script">
              {lines.map((l, i) => <li key={i} className={i === active ? 'on' : ''}>{l}</li>)}
            </ol>
          </div>
        </section>
      )}

      {(facts || repo) && (
        <section className="chat">
          {turns.map((t, i) => (
            <div className="turn" key={i}><q>{t.q}</q><p>{t.a || '…'}</p>{t.src && <span className="src">from {t.src.join(' · ')}</span>}</div>
          ))}
          <form onSubmit={ask}>
            <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`Ask about ${repo ? repo.facts.name : facts?.name}…`} aria-label="Ask a question" />
            <button className="primary" disabled={thinking}>{thinking ? '…' : 'Ask'}</button>
          </form>
        </section>
      )}
    </main>
  )
}
