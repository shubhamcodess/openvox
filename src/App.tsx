import { useState } from 'react'
import Orb from './Orb'
import { loadFacts, type Facts } from './github'
import { introScript } from './narrate'
import { loadVoice, speak, stop } from './speech'

type Phase = 'idle' | 'fetching' | 'voice' | 'speaking' | 'error'

export default function App() {
  const [user, setUser] = useState(new URLSearchParams(location.search).get('u') ?? '')
  const [phase, setPhase] = useState<Phase>('idle')
  const [msg, setMsg] = useState('')
  const [facts, setFacts] = useState<Facts | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [active, setActive] = useState(-1)
  const [ttfa, setTtfa] = useState<number | null>(null)

  async function run(e: React.FormEvent) {
    e.preventDefault()
    const login = user.trim().replace(/^@/, '')
    if (!login) return
    try {
      stop()
      setPhase('fetching'); setMsg('Reading GitHub…'); setTtfa(null); setActive(-1)
      const f = await loadFacts(login)
      const script = introScript(f)
      setFacts(f); setLines(script)
      setPhase('voice'); setMsg('Loading voice model (first run downloads ~65 MB)…')
      await loadVoice((p) => setMsg(`Loading voice model… ${p}%`))
      setPhase('speaking'); setMsg('')
      history.replaceState(null, '', `?u=${f.login}`)
      await speak(script, setActive, setTtfa)
      setPhase('idle')
    } catch (err) {
      setPhase('error'); setMsg(err instanceof Error ? err.message : String(err))
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
        <h1>Hear a GitHub profile.</h1>
        <p className="sub">Type a username. It reads the profile, then speaks it, all in your browser.</p>
        <form onSubmit={run} className="row">
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="github username"
            aria-label="GitHub username"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button className="primary" disabled={busy}>{busy ? 'Loading…' : phase === 'speaking' ? 'Restart' : 'Speak'}</button>
          {phase === 'speaking' && <button type="button" className="line" onClick={() => { stop(); setPhase('idle'); setActive(-1) }}>Stop</button>}
        </form>
        {msg && <p className={phase === 'error' ? 'msg err' : 'msg'}>{msg}</p>}
        {ttfa !== null && <p className="pill">first audio in {ttfa} ms</p>}
      </section>

      {facts && (
        <section className="grid">
          <div className="card terminal">
            <h2>facts</h2>
            <dl>
              <dt>repos</dt><dd>{facts.ownRepos} original / {facts.publicRepos} public</dd>
              <dt>stars</dt><dd>{facts.totalStars}</dd>
              <dt>followers</dt><dd>{facts.followers}</dd>
              <dt>prs</dt><dd>{facts.prs.total} opened / {facts.prs.merged} merged</dd>
              <dt>recent</dt><dd>{facts.recent.commits} commits, {facts.recent.prsOpened} PRs across {facts.recent.reposTouched} repos</dd>
              <dt>active 90d</dt><dd>{facts.activeRepos90d} repos</dd>
              <dt>languages</dt><dd>{facts.languages.map(([l]) => l).join(', ') || '—'}</dd>
            </dl>
          </div>
          <div className="card">
            <h2>narration</h2>
            <ol className="script">
              {lines.map((l, i) => <li key={i} className={i === active ? 'on' : ''}>{l}</li>)}
            </ol>
          </div>
        </section>
      )}
    </main>
  )
}
