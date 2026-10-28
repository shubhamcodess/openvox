import { useEffect, useMemo, useRef, useState } from 'react'
import Field from './Field'
import Lyrics, { type Line } from './Lyrics'
import Md from './Md'
import { loadFacts, takeRateLimited, type Facts } from './github'
import { introScript, repoIntro } from './narrate'
import { loadRepo, parseTarget, type RepoBundle } from './repo'
import { loadVoice, startSpeaker, stop } from './speech'
import { factReply, gapReply, intentOf, nextRule, orderedMentions, parseNext, resolveRefs, retrievalQuery, splitNext } from './convo'
import { Session } from './session'
import { answerMsgs, buildMessages, buildRepoMessages, sourceLabel, suggestFollowups, SentenceChunker, clean } from './ask'
import { buildProfileIndex, mentionedRepos, portraitHits } from './profile'
import { isMobile, loadModel, pickModel, type Msg } from './llm'
import { loadStt } from './stt'
import Eval from './Eval'
import Wave from './Wave'
import { startListening, type ListenState } from './listen'

type Phase = 'idle' | 'fetching' | 'voice' | 'speaking' | 'error'
/** `gap`: a canned "GitHub can't tell" reply; shown and spoken but never fed back to the model, which would copy it. */
type Turn = { q?: string; a: string; src?: { label: string; text: string }[]; gap?: boolean }

export default function App() {
  if (new URLSearchParams(location.search).has('eval')) return <Eval />
  return <Main />
}

/** Modes of openvox. More will be added here; each gets its own subpage under the tab. */
const MODES = ['GitHub']

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
  const ear = useRef<{ stop(): void } | null>(null)
  const [earState, setEarState] = useState<ListenState>('waiting')
  const [heard, setHeard] = useState('')
  const [listening, setListening] = useState(false)
  const [cue, setCue] = useState('')
  const [log, setLog] = useState(false)
  const pindex = useMemo(() => (facts && !repo ? buildProfileIndex(facts) : null), [facts, repo])

  // Load the three models one by one on page load, shown as lyrics. Cached loads still show for a moment.
  const [followups, setFollowups] = useState<string[]>([])
  const prevRepo = useRef('')
  const session = useRef(new Session()).current
  const suggested = useRef<string[]>([])
  const ctx = useRef<{ sys: string; subject: string; intro: string } | null>(null)
  const booting = useRef(false)
  useEffect(() => {
    if (booting.current) return
    booting.current = true
    void navigator.storage?.persist?.().catch(() => {})
    const stages: [string, (on: (pct: number) => void) => Promise<unknown>][] = [
      ['voice', (on) => loadVoice(on)],
      ['language model', async (on) => loadModel(await pickModel(), (p) => on(Math.round(p * 100)))],
      // on phones the speech model waits until the mic is first used, to keep memory and the first load light
      ...(isMobile() ? [] : [['speech recognition', (on: (pct: number) => void) => loadStt(on)] as [string, (on: (pct: number) => void) => Promise<unknown>]]),
    ]
    void (async () => {
      for (const [name, load] of stages) {
        if (!booting.current) return
        const id = ++lineId.current
        const set = (text: string) => setLines((l) => (booting.current ? l.map((x) => (x.id === id ? { ...x, text } : x)) : l))
        setLines((l) => [...l.slice(-6), { id, text: `Loading ${name}…` }])
        setLive(id)
        const t0 = Date.now()
        await load((p) => set(`Loading ${name} · ${Math.round(p)}%`)).catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
        await sleep(Math.max(0, 900 - (Date.now() - t0)))
        set(`Loaded ${name}.`)
        await sleep(350)
      }
      if (!booting.current) return
      setLive(null)
      await sleep(1400)
      if (booting.current) { booting.current = false; setLines([]) }
    })()
  }, [])

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

  function run(e: React.FormEvent) {
    e.preventDefault()
    const target = parseTarget(repoName.trim() ? `${owner.trim()}/${repoName.trim()}` : owner)
    if (target) void go(target)
  }

  async function go(target: NonNullable<ReturnType<typeof parseTarget>>) {
    let script: string[] = []
    try {
      booting.current = false
      session.clear(); ctx.current = null; suggested.current = []
      setFollowups([])
      hush()
      setPhase('fetching'); setMsg('reading github…'); setTtfa(null); setLive(null); setLines([]); setTurns([]); setCue('')
      if ('repo' in target) {
        setOwner(target.owner); setRepoName(target.repo)
        const [bundle, o] = await Promise.all([
          loadRepo(target.owner, target.repo),
          loadFacts(target.owner).catch(() => null), // profile context is a bonus; rate limits must not block the repo
        ])
        setRepo(bundle); setFacts(o)
        script = repoIntro(bundle.facts, o?.name)
        ctx.current = { sys: buildRepoMessages(bundle.facts, o, '', [])[0].content, subject: bundle.facts.name, intro: '' }
        history.replaceState(null, '', `?r=${target.owner}/${target.repo}`)
      } else {
        const f = await loadFacts(target.user)
        setRepo(null); setFacts(f)
        script = introScript(f)
        ctx.current = { sys: buildMessages(f, '', [])[0].content, subject: f.name ?? f.login, intro: '' }
        history.replaceState(null, '', `?u=${f.login}`)
      }
      setTurns([{ a: '' }])
      if (ctx.current) ctx.current.intro = script.join(' ')
      warm()
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

  /** Quietly ask the model what to ask first / next, inside the live session. */
  function warm(asked: string[] = []) {
    const c = ctx.current
    if (!c) return
    const ctl = new AbortController()
    abort.current = ctl
    void suggestFollowups(session, c.sys, c.subject, [...asked, ...suggested.current], ctl.signal).then((f) => { if (ctl.signal.aborted) return; suggested.current.push(...f); setFollowups(f) })
  }

  function newSession() {
    hush()
    session.clear(); suggested.current = []
    setTurns([{ a: ctx.current?.intro ?? '' }]); setCue(''); setLines([]); setLive(null); setMsg(''); setThinking(false); setFollowups([])
    warm()
  }

  async function send(raw: string) {
    const q = raw.trim()
    if (!q || (!facts && !repo) || thinking) return
    const prevChips = followups
    abort.current?.abort()
    setQuestion(''); setCue(q); setFollowups([]); setThinking(true); stop(); setPhase('idle'); setLive(null)
    const ac = new AbortController()
    abort.current = ac
    const prior = turns.filter((t) => t.q && !t.gap)
    const idx = turns.length
    setTurns((t) => [...t, { q, a: '' }])
    const patch = (p: Partial<Turn>) => setTurns((t) => t.map((x, i) => (i === idx ? { ...x, ...p } : x)))
    try {
      await loadVoice(() => {})
      setMsg('loading language model · first run ~1 GB')
      await loadModel(await pickModel(), (p) => setMsg(`loading language model · ${Math.round(p * 100)}%`))
      setMsg('')
      if (ac.signal.aborted) return
      const history: Msg[] = prior.flatMap((t) => [{ role: 'user' as const, content: t.q! }, { role: 'assistant' as const, content: clean(t.a) }])
      const sp = startSpeaker(onSentence(false), setTtfa)
      const rq = repo ? q : resolveRefs(q, session.entities)
      const gap = (!repo && facts ? factReply(q, facts) : null) ?? gapReply(q, repo ? [] : facts!.repos.slice(0, 3).map((r) => r.name))
      if (gap) {
        patch({ a: gap, gap: true })
        setFollowups(prevChips)
        gap.split(/(?<=[.!?])\s+/).forEach(sp.push)
        sp.end()
        await sp.done
        return
      }
      const chunker = new SentenceChunker()
      let full = ''
      let said = 0
      const asked = [...prior.map((t) => t.q!), q, ...suggested.current]
      const query = retrievalQuery(rq, history, session.entities)
      let hits: ReturnType<NonNullable<typeof pindex>['search']>
      let msgs: Msg[]
      if (repo) {
        hits = repo.index.search(query, 4)
        const [sys, usr] = buildRepoMessages(repo.facts, facts, rq, hits)
        msgs = session.begin(sys.content, `${usr.content}\n\n${nextRule(asked)}`, q)
      } else {
        const named = mentionedRepos(query, facts!.repos)
        const intent = intentOf(rq, mentionedRepos(rq, facts!.repos).size > 0)
        hits = intent === 'broad' ? portraitHits(pindex!) : intent === 'content' ? pindex!.search(query, 4, { boost: named, pinFirst: false }) : []
        const [sys, usr] = buildMessages(facts!, rq, hits)
        msgs = session.begin(sys.content, `${usr.content}\n\n${nextRule(asked)}`, q)
      }
      patch({ src: hits.map((h) => ({ label: sourceLabel(h), text: h.chunk.text })) })
      const stream = answerMsgs(msgs, ac.signal)
      for await (const d of stream) {
        full += d
        const { say } = splitNext(full, false)
        patch({ a: display(say) })
        chunker.push(say.slice(said)).forEach(sp.push)
        said = say.length
      }
      if (ac.signal.aborted) { session.abandon(); return }
      session.finish(full)
      const end = splitNext(full, true)
      patch({ a: display(end.say) })
      chunker.push(end.say.slice(said)).forEach(sp.push)
      if (facts && !repo) { const m = orderedMentions(clean(end.say), facts.repos.map((r) => r.name)); if (m.length) session.entities = m }
      const more = parseNext(end.next, asked)
      suggested.current.push(...more)
      setFollowups(more)
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
    stop(); setLive(null); setPhase('idle')
  }

  async function listen() {
    if (listening) { ear.current?.stop(); return }
    hush()
    setMsg(''); setHeard('')
    setListening(true)
    ear.current = await startListening({
      onState: (s, d) => { setEarState(s); if (s === 'loading') setMsg(d ? `loading ${d}` : 'loading on-device speech model…'); else setMsg('') },
      onText: setHeard,
      onBargeIn: () => { abort.current?.abort(); stop(); setLive(null) },
      onFinal: (t) => { setListening(false); ear.current = null; setHeard(''); send(t) },
      onError: (m) => { setListening(false); ear.current = null; setHeard(''); setMsg(m) },
    })
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

  const picks = facts && owner.trim().toLowerCase() === facts.login.toLowerCase() ? facts.repos : []
  const talking = thinking || phase === 'speaking'

  return (
    <>
      <Field anchor={stage} />
      <main className={`app${log ? ' with-log' : ''}`}>
        <header className="top">
          <span className="brand">openvox<i>.</i><b>{MODES[0].toLowerCase()}</b></span>
          <nav className="modes" aria-label="Mode">
            {MODES.map((m) => <button key={m} className="on" aria-current="page">{m}</button>)}
          </nav>
        </header>

        <section className="setup">
          <form className="target" onSubmit={run}>
            <span className="at">github.com/</span>
            <input value={owner} onChange={(e) => splitPaste(e.target.value)} placeholder="owner" aria-label="GitHub user or org" autoCapitalize="off" spellCheck={false} />
            <span className="slash">/</span>
            <input
              value={repoName}
              list="gv-repos"
              onFocus={() => { if (picks.some((r) => r.name === repoName)) { prevRepo.current = repoName; setRepoName('') } }} // empty so the whole list shows
              onBlur={() => { if (!repoName && prevRepo.current) setRepoName(prevRepo.current); prevRepo.current = '' }}
              onChange={(e) => {
                const v = e.target.value.replace(/\s/g, '')
                setRepoName(v)
                if (picks.some((r) => r.name === v)) void go({ owner: facts!.login, repo: v }) // picked from the list
              }}
              placeholder={picks.length ? `pick one of ${picks.length} repos` : 'repo (optional)'}
              aria-label="Repository (optional)"
              autoCapitalize="off"
              spellCheck={false}
            />
            <datalist id="gv-repos">
              {picks.map((r) => <option key={r.name} value={r.name} label={`${r.stars ? `★ ${r.stars} · ` : ''}${r.description ?? r.language ?? ''}`.slice(0, 90)} />)}
            </datalist>
            <button className="go" disabled={busy || !owner.trim()} aria-label="Load">{busy ? <span className="spin" /> : '→'}</button>
            {loaded && <button type="button" className="go fresh" onClick={newSession} disabled={busy} aria-label="New session" title="New session">↺</button>}
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
          <div className="under">
            {loaded && !log && !thinking && !listening && phase !== 'fetching' && followups.length ? (
              <div className="starters">
                {followups.map((t) => <button key={t} type="button" onClick={() => send(t)}>{t}</button>)}
              </div>
            ) : null}
          </div>
        </section>

        <form className="dock" onSubmit={(e) => { e.preventDefault(); send(question) }}>
          <button type="button" className={`ico${log ? ' on' : ''}`} onClick={() => setLog((v) => !v)} aria-label="Toggle transcript" aria-pressed={log} title="Transcript">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M3 4h10M3 8h10M3 12h6" /></svg>
          </button>
          {listening && earState !== 'loading' ? (
            <div className={`ear ${earState}`}>
              <Wave state={earState} />
              <span className="heard">{heard || (earState === 'hearing' ? 'listening…' : earState === 'finishing' ? 'still with you…' : 'go ahead, I am listening')}</span>
            </div>
          ) : (
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={listening ? 'loading speech model…' : loaded ? `Ask about ${name}…` : 'Load a profile first'}
              aria-label="Ask a question"
              disabled={!loaded || listening}
            />
          )}
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
        <footer className="foot">
          <span className="lat" title="Time to first audio · on-device, no cloud" aria-label={ttfa !== null ? `On-device, no cloud. Time to first audio ${ttfa} milliseconds` : 'On-device, no cloud'}>
            on-device · no cloud ·
            <svg viewBox="0 0 18 12" width="18" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden><path d="M1 5v2M5 2.5v7M9 1v10M13 3v6M17 5v2" /></svg>
            {ttfa !== null && <>{ttfa} ms</>}
          </span>
          <span>AI can make mistakes.</span>
        </footer>
      </main>
    </>
  )
}
