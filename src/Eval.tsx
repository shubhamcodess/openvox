import { useState } from 'react'
import { buildMessages } from './ask'
import { FIXTURE, QUESTIONS } from './fixture'
import { CANDIDATES, chat, loadModel } from './llm'

interface Row { model: string; pass: number; facts: string; traps: string; ttft: number; tps: number; fails: string[]; error?: string }

export default function Eval() {
  const [rows, setRows] = useState<Row[]>([])
  const [status, setStatus] = useState('')
  const [picked, setPicked] = useState<string[]>(CANDIDATES)
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    const out: Row[] = []
    for (const model of picked) {
      try {
        setStatus(`${model}: loading…`)
        await loadModel(model, (p) => setStatus(`${model}: loading ${Math.round(p * 100)}%`))
        let pass = 0, f = 0, t = 0, ttfts: number[] = [], toks = 0, genMs = 0
        const fails: string[] = []
        for (const q of QUESTIONS) {
          setStatus(`${model}: ${q.id}`)
          const t0 = performance.now()
          let tFirst = 0, n = 0, a = ''
          for await (const d of chat(buildMessages(FIXTURE, [], q.q))) {
            if (!tFirst) tFirst = performance.now()
            n++; a += d
          }
          const t1 = performance.now()
          ttfts.push(tFirst - t0); toks += n; genMs += t1 - tFirst
          const ok = q.pass(a)
          if (ok) { pass++; q.kind === 'fact' ? f++ : t++ } else fails.push(`${q.id}: ${a.replace(/\s+/g, ' ').slice(0, 120)}`)
        }
        out.push({
          model, pass, facts: `${f}/6`, traps: `${t}/4`,
          ttft: Math.round(ttfts.reduce((s, x) => s + x, 0) / ttfts.length),
          tps: Math.round(toks / (genMs / 1000)), fails,
        })
      } catch (e) {
        out.push({ model, pass: 0, facts: '-', traps: '-', ttft: 0, tps: 0, fails: [], error: String(e) })
      }
      setRows([...out]); (window as any).__eval = out
    }
    setStatus('done'); setRunning(false)
  }

  return (
    <main className="shell">
      <header className="top"><span className="brand">openvox<i>.</i> eval</span></header>
      <p className="msg">10 questions on a fictional profile: 6 fact lookups, 4 traps where the right answer is “I don’t have that”.</p>
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        {CANDIDATES.map((m) => (
          <label key={m} className="pill">
            <input type="checkbox" style={{ width: 14, height: 14 }} checked={picked.includes(m)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, m] : picked.filter((x) => x !== m))} />
            &nbsp;{m.replace('-MLC', '')}
          </label>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <button className="primary" disabled={running} onClick={run}>{running ? 'Running…' : 'Run eval'}</button>
        <span className="msg">{status}</span>
      </div>
      <div className="card terminal" style={{ marginTop: 16, overflowX: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>model</th><th>pass</th><th>facts</th><th>traps</th><th>ttft ms</th><th>tok/s</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model}><td>{r.model.replace('-MLC', '')}</td><td>{r.error ? 'ERR' : `${r.pass}/10`}</td><td>{r.facts}</td><td>{r.traps}</td><td>{r.ttft}</td><td>{r.tps}</td></tr>
            ))}
          </tbody>
        </table>
        {rows.flatMap((r) => r.fails.map((f) => <p key={r.model + f} className="msg">{r.model.split('-')[0]} · {f}</p>))}
        {rows.filter((r) => r.error).map((r) => <p key={r.model} className="msg err">{r.model}: {r.error}</p>)}
      </div>
    </main>
  )
}
