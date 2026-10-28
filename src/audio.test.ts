import test from 'node:test'
import assert from 'node:assert/strict'
import { polish, join } from './polish.ts'
import { sanitize } from './sanitize.ts'

const tone = (sec: number, amp: number, hz = 220) =>
  Float32Array.from({ length: Math.round(sec * 16000) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / 16000))
const silence = (sec: number) => new Float32Array(Math.round(sec * 16000))

test('polish trims long silence but keeps a pad', () => {
  const x = join([silence(2), tone(1, 0.05), silence(2)], 0)
  const p = polish(x)
  assert.ok(p.seconds > 1.2 && p.seconds < 1.6, `got ${p.seconds}`)
})

test('polish lifts quiet speech to about -3 dBFS, capped', () => {
  const p = polish(tone(1, 0.1))
  assert.ok(p.peak > 0.6 && p.peak <= 1, `peak ${p.peak}`)
  assert.ok(polish(tone(1, 0.001)).gain <= 12)
})

test('polish never amplifies loud audio and removes DC offset', () => {
  const loud = tone(1, 0.95).map((v) => v + 0.2)
  const p = polish(loud)
  assert.equal(p.gain, 1)
  const mean = p.audio.reduce((s, v) => s + v, 0) / p.audio.length
  assert.ok(Math.abs(mean) < 0.02)
})

test('polish handles silence and tiny input', () => {
  assert.equal(polish(silence(1)).gain, 1)
  assert.doesNotThrow(() => polish(new Float32Array(5)))
  assert.doesNotThrow(() => polish(new Float32Array(0)))
})

test('join puts a gap between pieces', () => {
  assert.equal(join([tone(1, 0.1), tone(1, 0.1)], 100).length, 32000 + 1600)
})

test('sanitize drops fillers and stutters', () => {
  assert.equal(sanitize('um so what, uh, what does it do'), 'So what does it do')
  assert.equal(sanitize('how do I I install the the cli'), 'How do I install the cli')
})

test('sanitize drops phantom transcripts from silence', () => {
  for (const s of ['Thank you.', 'you', '[BLANK_AUDIO]', '(music)', '...', 'Thanks for watching!', '']) assert.equal(sanitize(s), '')
})

test('sanitize keeps real short questions', () => {
  assert.equal(sanitize('what languages does he use'), 'What languages does he use')
  assert.equal(sanitize('Who is the owner?'), 'Who is the owner?')
})

import { patience } from './sanitize.ts'
test('patience waits longer when a sentence trails off', () => {
  assert.ok(patience('Tell me about the').grace > patience('What languages does it use?').grace * 2)
  assert.ok(patience('How do I install it,').unfinished)
  assert.ok(!patience('Who is the owner?').unfinished)
  assert.ok(patience('Hmm').grace >= 1400)
})
