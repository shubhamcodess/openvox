import { useEffect, useRef, useState } from 'react'
import Field from './Field'
import Lyrics, { type Line } from './Lyrics'
import Md from './Md'
import { loadFacts, takeRateLimited, type Facts } from './github'
import { introScript, repoIntro } from './narrate'
import { loadRepo, parseTarget, type RepoBundle } from './repo'
import { loadVoice, startSpeaker, stop } from './speech'
import { answer, answerRepo, buildRepoMessages, sourceLabel, SentenceChunker, clean } from './ask'
import { DEFAULT_MODEL, loadModel, type Msg } from './llm'
import Eval from './Eval'

type Phase = 'idle' | 'fetching' | 'voice' | 'speaking' | 'error'
type Turn = { q?: string; a: string; src?: { label: string; text: string }[] }

export default function App() {
  if (new URLSearchParams(location.search).has('eval')) return <Eval />
  return <Main />
}

const display = (s: string) => s.replace(/<\/?think>/g, '').trimStart()

function Main() {
  const qs = new URLSearchParams(location.search)
  const [init] = useState(() => parseTarget(qs.get('r') ?? qs.get('u') ?? ''))
  const [owner, setOwner] = useState(init ? ('repo' in init ? init.owner : init.user) : '')
  const [repoName, setRepoName] = useState(init && 'repo' in init ? init.repo : '')
  const [repo, setRepo] = useState<RepoBundle | null>(null)
  const [facts, setFacts] = useState<Facts | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [thinking, setThinking] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [msg, setMsg] = useState('')
  const [notice, setNotice] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [live, setLive] = useState<number | null>(null)
  const [ttfa, setTtfa] = useState<number | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const thread = useRef<HTMLDivElement>(null)
  const lineId = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const rec = useRef<any>(null)
  const [listening, setListening] = useState(false)
  const [cue, setCue] = useState('')
  const [log, setLog] = useState(false)

  // keep the thread pinned to the bottom unless the reader scrolled up
  useEffect(() => {
    const el = thread.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [turns, thinking, log])

  /** Speaker callback: each sentence that starts playing becomes a lyric (and, for the intro, part of turn 0). */
  const onSentence = (intro: boolean) => (i: number, text?: string) => {
    if (i < 0 || !text) { setLive(null); return }
    const id = ++lineId.current
    setLines((l) => [...l.slice(-6), { id, text }])
    setLive(id)
    if (intro) setTurns((t) => t.map((x, k) => (k === 0 ? { ...x, a: x.a ? `${x.a} ${text}` : text } : x)))
  }

  function splitPaste(v: string) {
    const t = v.includes('/') ? parseTarget(v) : null
    if (t && 'repo' in t) { setOwner(t.owner); setRepoName(t.repo) } else setOwner(v)
  }

  async function run(e: React.FormEvent) {
    e.preventDefault()
    const target = parseTarget(repoName.trim() ? `${owner.trim()}/${repoName.trim()}` : owner)
    if (!target) return
    let script: string[] = []
    try {
      hush()
      setPhase('fetching'); setMsg('reading github…'); setTtfa(null); setLive(null); setLines([]); setTurns([]); setCue('')
      if ('repo' in target) {
        const [bundle, o] = await Promise.all([
          loadRepo(target.owner, target.repo),
          loadFacts(target.owner).catch(() => null), // profile context is a bonus; rate limits must not block the repo
        ])
        setRepo(bundle); setFacts(o)
        script = repoIntro(bundle.facts, o?.name)
        history.replaceState(null, '', `?r=${target.owner}/${target.repo}`)
      } else {
        const f = await loadFacts(target.user)
        setRepo(null); setFacts(f)
        script = introScript(f)
        history.replaceState(null, '', `?u=${f.login}`)
      }
      setTurns([{ a: '' }])
      setNotice(takeRateLimited() ? 'GitHub rate limit hit (60 requests/hour, anonymous). Some details may be missing; it resets within the hour.' : '')
      setPhase('voice'); setMsg('loading voice · first run ~65 MB')
      await loadVoice((p) => setMsg(`loading voice · ${p}%`))
      setPhase('speaking'); setMsg('')
      const sp = startSpeaker(onSentence(true), setTtfa)
      script.forEach(sp.push)
      sp.end()
      await sp.done
      setPhase('idle')
    } catch (err) {
      if (script.length) setTurns([{ a: script.join(' ') }])
      setPhase('error'); setMsg(err instanceof Error ? err.message : String(err))
    }
  }

  async function send(raw: string) {
    const q = raw.trim()
    if (!q || (!facts && !repo) || thinking) return
    setQuestion(''); setCue(q); setThinking(true); stop(); setPhase('idle'); setLive(null)
    const ac = new AbortController()
    abort.current = ac
    const prior = turns.filter((t) => t.q)
    const idx = turns.length
    setTurns((t) => [...t, { q, a: '' }])
    const patch = (p: Partial<Turn>) => setTurns((t) => t.map((x, i) => (i === idx ? { ...x, ...p } : x)))
    try {
      await loadVoice(() => {})
      setMsg('loading language model · first run ~1 GB')
      await loadModel(DEFAULT_MODEL, (p) => setMsg(`loading language model · ${Math.round(p * 100)}%`))
      setMsg('')
      if (ac.signal.aborted) return
      const history: Msg[] = prior.flatMap((t) => [{ role: 'user' as const, content: t.q! }, { role: 'assistant' as const, content: clean(t.a) }])
      const sp = startSpeaker(onSentence(false), setTtfa)
      const chunker = new SentenceChunker()
      let full = ''
      let stream: AsyncGenerator<string>
      if (repo) {
        const hits = repo.index.search(q, 4)
        patch({ src: hits.map((h) => ({ label: sourceLabel(h), text: h.chunk.text })) })
        stream = answerRepo(buildRepoMessages(repo.facts, facts, history, q, hits), ac.signal)
      } else {
        stream = answer(facts!, history, q, ac.signal)
      }
      for await (const d of stream) {
        full += d
        patch({ a: display(full) })
        chunker.push(d).forEach(sp.push)
      }
      if (ac.signal.aborted) return
      chunker.flush().forEach(sp.push)
      sp.end()
      await sp.done
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setThinking(false)
    }
  }

  /** Stop everything that is talking: the LLM stream, queued audio, and the listening mic. */
  function hush() {
    abort.current?.abort()
    rec.current?.stop()
    stop(); setLive(null); setPhase('idle')
  }

  async function listen() {
    if (listening) { rec.current?.stop(); return }
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    const local = { langs: ['en-US'], processLocally: true }
    try {
      // on-device only: never fall back to the browser's cloud recognizer
      const st = SR?.available ? await SR.available(local) : 'unavailable'
      if (st === 'downloadable' || st === 'downloading') { setMsg('downloading on-device speech model…'); await SR.install(local); setMsg('') }
      else if (st !== 'available') { setMsg('On-device speech recognition is not available in this browser. Type instead.'); return }
      hush()
      const r = new SR()
      r.lang = 'en-US'; r.processLocally = true; r.interimResults = true; r.continuous = false
      let heard = ''
      r.onresult = (e: any) => { heard = Array.from(e.results as ArrayLike<any>).map((x) => x[0].transcript).join(''); setQuestion(heard) }
      r.onerror = (e: any) => e.error !== 'no-speech' && e.error !== 'aborted' && setMsg(`mic: ${e.error}`)
      r.onend = () => { setListening(false); rec.current = null; if (heard.trim()) send(heard) }
      rec.current = r
      r.start(); setListening(true)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const busy = phase === 'fetching' || phase === 'voice'
  const loaded = !!(facts || repo)
  const name = repo ? repo.facts.name : facts?.name ?? facts?.login
  const stats: [string, string][] = repo
    ? [
        ['stars', repo.facts.stars.toLocaleString()],
        ['forks', repo.facts.forks.toLocaleString()],
        ['language', repo.facts.languages[0]?.[0] ?? '—'],
        ['license', repo.facts.license ?? 'none'],
        ['contributors', `${repo.facts.contributors.count}${repo.facts.contributors.capped ? '+' : ''}`],
        ['prs merged', `${repo.facts.prs.merged}/${repo.facts.prs.total}`],
        ['commits 30d', String(repo.facts.commits30d)],
        ['indexed', `${repo.facts.docs.length} docs · ${repo.index.chunks.length} chunks`],
      ]
    : facts
      ? [
          ['repos', `${facts.ownRepos} / ${facts.publicRepos}`],
          ['stars', facts.totalStars.toLocaleString()],
          ['followers', facts.followers.toLocaleString()],
          ['prs merged', `${facts.prs.merged}/${facts.prs.total}`],
          ['active 90d', `${facts.activeRepos90d} repos`],
          ['languages', facts.languages.slice(0, 3).map(([l]) => l).join(' · ') || '—'],
        ]
      : []

  const talking = thinking || phase === 'speaking'

  return (
    <>
      <Field anchor={stage} />
      <main className={`app${log ? ' with-log' : ''}`}>
        <header className="top">
          <span className="brand">gitvox<i>.</i></span>
          <span className="pill">on-device · no cloud{ttfa !== null && <> · first audio {ttfa} ms</>}</span>
        </header>

        <section className="setup">
          <form className="target" onSubmit={run}>
            <span className="at">github.com/</span>
            <input value={owner} onChange={(e) => splitPaste(e.target.value)} placeholder="owner" aria-label="GitHub user or org" autoCapitalize="off" spellCheck={false} />
            <span className="slash">/</span>
            <input value={repoName} onChange={(e) => setRepoName(e.target.value.replace(/\s/g, ''))} placeholder="repo (optional)" aria-label="Repository (optional)" autoCapitalize="off" spellCheck={false} />
            <button className="go" disabled={busy || !owner.trim()} aria-label="Load">{busy ? <span className="spin" /> : '→'}</button>
          </form>
          {loaded && (
            <dl className="stats">
              <div className="who"><dt>{repo ? 'repo' : 'profile'}</dt><dd>{repo ? `${repo.facts.owner}/${repo.facts.name}` : `@${facts!.login}`}</dd></div>
              {stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          )}
        </section>

        <section className="stage" ref={stage}>
          {(cue || msg || notice) && (
            <div className="cue">
              {cue && <p className="q">{cue}</p>}
              {(msg || notice) && <p className={`status${phase === 'error' || notice ? ' warn' : ''}`}>{msg || notice}</p>}
            </div>
          )}
          {lines.length ? (
            <Lyrics lines={lines} live={live} />
          ) : (
            <div className="hello">
              <h1>Talk to GitHub.</h1>
              <p>A profile, or a repo. Read, spoken and answered in your browser.</p>
            </div>
          )}
          {thinking && live === null && !msg && <p className="dots stage-dots"><i /><i /><i /></p>}
        </section>

        <form className="dock" onSubmit={(e) => { e.preventDefault(); send(question) }}>
          <button type="button" className={`ico${log ? ' on' : ''}`} onClick={() => setLog((v) => !v)} aria-label="Toggle transcript" aria-pressed={log} title="Transcript">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M3 4h10M3 8h10M3 12h6" /></svg>
          </button>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={listening ? 'listening…' : loaded ? `Ask about ${name}…` : 'Load a profile first'}
            aria-label="Ask a question"
            disabled={!loaded}
          />
          <button type="button" className={`ico${listening ? ' rec' : ''}`} onClick={listen} disabled={!loaded || thinking} aria-label={listening ? 'Stop listening' : 'Speak'} title="Speak (on-device)">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15" /></svg>
          </button>
          {talking ? (
            <button type="button" className="act" onClick={hush} aria-label="Stop"><span className="sq" /></button>
          ) : (
            <button className="act" disabled={!loaded || !question.trim()} aria-label="Send">↑</button>
          )}
        </form>

        {log && (
          <section className="talk">
            <div className="thread" ref={thread}>
              {!turns.length && <p className="empty">{loaded ? 'Ask anything below.' : 'Enter an owner to begin. Add a repo now or later.'}</p>}
              {turns.map((t, i) => (
                <article className="turn" key={i}>
                  {t.q && <p className="q">{t.q}</p>}
                  {t.a ? <Md text={t.a} /> : (thinking || busy || phase === 'speaking') && <p className="dots"><i /><i /><i /></p>}
                  {t.src && (
                    <div className="src">
                      {t.src.map((h, j) => <details key={j}><summary>{h.label}</summary><pre>{h.text}</pre></details>)}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  )
}
