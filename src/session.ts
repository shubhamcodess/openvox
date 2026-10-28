import type { Msg } from './llm'
import { REFUSAL_RE } from './convo.ts'

// Context is 4096 tokens; leave room for the reply. Chars are a cheap, conservative proxy.
const BUDGET_CHARS = 10500
const KEEP_PAIRS = 4

interface Exchange { q: string; sent: string; reply: string }

/**
 * The conversation exactly as the model has seen it. web-llm only reuses its KV cache when the messages it is
 * given extend the previous request byte for byte, so we keep what we sent (excerpts and all) and append to it.
 * When the context fills up it is rebuilt once from plain question/answer pairs, then grows again.
 */
export class Session {
  private system = ''
  private done: Exchange[] = []
  private pending: { q: string; sent: string } | null = null
  /** Repos named in the last answer, in the order they were said ("the second one"). */
  entities: string[] = []

  clear() { this.system = ''; this.done = []; this.pending = null; this.entities = [] }

  /** Messages to send for a new turn. A different system prompt (new profile or repo) starts a fresh session. */
  begin(system: string, sent: string, q: string): Msg[] {
    if (system !== this.system) { this.clear(); this.system = system }
    if (this.size(sent) > BUDGET_CHARS) this.compact()
    this.pending = { q, sent }
    return this.messages(sent)
  }

  /** Record the model's reply to the last `begin`. Refusals are left out: small models copy them. */
  finish(reply: string) {
    const p = this.pending
    this.pending = null
    if (!p || !reply.trim()) return
    if (REFUSAL_RE.test(reply.slice(0, 120))) return
    this.done.push({ ...p, reply })
  }

  abandon() { this.pending = null }

  /** Plain question/answer pairs, for anything that needs the gist rather than the exact prefix. */
  recap(): { q: string; a: string }[] {
    return this.done.map((e) => ({ q: e.q, a: e.reply }))
  }

  private messages(sent: string): Msg[] {
    return [
      { role: 'system', content: this.system },
      ...this.done.flatMap((e): Msg[] => [{ role: 'user', content: e.sent }, { role: 'assistant', content: e.reply }]),
      { role: 'user', content: sent },
    ]
  }

  private size(sent: string) {
    return this.system.length + sent.length + this.done.reduce((n, e) => n + e.sent.length + e.reply.length, 0)
  }

  private compact() {
    this.done = this.done
      .slice(-KEEP_PAIRS)
      .map((e) => ({ ...e, sent: e.q, reply: e.reply.replace(/<\/?think>/g, '').replace(/\s*NEXT\s*:[\s\S]*$/i, '').trim().slice(0, 420) }))
  }
}
