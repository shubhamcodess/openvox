import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Bm25, chunkMarkdown } from './retrieval.ts'

const README = `# fastvox

[![build](https://img.shields.io/x.svg)](https://ci) <img src="logo.png">

Fastvox is a tiny speech toolkit for embedded devices.

## Installation

\`\`\`bash
# install with cargo
cargo install fastvox --features onnx
\`\`\`

## Usage

Run \`fastvox speak "hello"\` to synthesize audio. Pass --voice to pick a speaker.

## Configuration

Set FASTVOX_CACHE to change where model files are stored. The default is ~/.cache/fastvox.

## Contributing

Open an issue first, then send a pull request. Tests run with cargo test.

## License

MIT licensed.
`

const bm = new Bm25(chunkMarkdown('README.md', README))
const top = (q: string) => bm.search(q, 2).find((h) => h.chunk.id !== 0)!.chunk

test('headings and code fences are handled', () => {
  const chunks = chunkMarkdown('README.md', README)
  assert.ok(chunks.some((c) => c.heading === 'fastvox › Installation'))
  assert.ok(!chunks.some((c) => c.heading.includes('install with cargo')), '# inside a fence is not a heading')
  assert.ok(!chunks.some((c) => /<img|shields\.io/.test(c.text)), 'badges and html removed')
})

for (const [q, expect] of [
  ['How do I install it?', 'cargo install'],
  ['where are model files cached', 'FASTVOX_CACHE'],
  ['what license is it under', 'MIT'],
  ['how can I contribute', 'pull request'],
  ['how do I choose a voice', '--voice'],
] as const) {
  test(`retrieves: ${q}`, () => assert.match(top(q).text, new RegExp(expect.replace(/[-]/g, '\\-'))))
}

test('no match returns just the overview', () => {
  assert.equal(bm.search('zzzz qqqq', 3).length, 1)
})

test('overview chunk is always pinned', () => {
  const hits = bm.search('where are model files cached', 2)
  assert.ok(hits.some((h) => h.chunk.id === 0))
  assert.match(hits.find((h) => h.chunk.id !== 0)!.chunk.text, /FASTVOX_CACHE/)
})

import { Bm25 as B2, chunkMarkdown as cm } from './retrieval.ts'
import { mentionedRepos, repoCard } from './profile.ts'
import { trimHistory, retrievalQuery } from './convo.ts'

test('synonyms: "set it up" finds the Installation section', () => {
  const idx = new B2(cm('README', '# Tool\nIt does things well for everyone who needs it daily.\n\n## Installation\nRun the installer and you are done with it quickly.\n\n## Credits\nThanks to everyone who helped build this tool over time.'))
  assert.match(idx.search('how do I set it up', 1, { pinFirst: false })[0].chunk.heading, /Installation/)
})

test('a named repo is favoured', () => {
  const chunks = [
    { id: 0, source: 'a README', heading: 'a', text: 'a fast parser for logs and metrics', tag: 'alpha' },
    { id: 1, source: 'b README', heading: 'b', text: 'a fast parser for logs and traces', tag: 'beta' },
  ]
  assert.equal(new B2(chunks).search('fast parser logs', 1, { boost: new Set(['beta']), pinFirst: false })[0].chunk.tag, 'beta')
})

test('mentionedRepos matches spoken and hyphenated names', () => {
  const r = (name: string) => ({ name, description: null, stars: 0, language: null, pushedAt: '', fork: false, topics: [] })
  assert.deepEqual([...mentionedRepos('tell me about spoon knife please', [r('Spoon-Knife'), r('hello-world')])], ['spoon-knife'])
  assert.equal(mentionedRepos('anything else?', [r('Spoon-Knife')]).size, 0)
})

test('repoCard has name, language and stars', () => {
  assert.match(repoCard({ name: 'vox-kit', description: 'TTS kit', stars: 9, language: 'Rust', pushedAt: new Date().toISOString(), fork: false, topics: ['tts'] }), /vox kit.*TTS kit.*Rust.*tts.*9 stars/)
})

test('trimHistory drops refusals and their questions, keeps recent turns', () => {
  const h = [
    { role: 'user' as const, content: 'When was their last comment?' }, { role: 'assistant' as const, content: "I don't have information about that." },
    { role: 'user' as const, content: 'Main language?' }, { role: 'assistant' as const, content: 'The main language is HTML.' },
  ]
  const t = trimHistory(h)
  assert.equal(t.length, 2)
  assert.match(t[1].content, /HTML/)
})

test('short follow-ups borrow the previous question for retrieval', () => {
  const h = [{ role: 'user' as const, content: 'How do I install the cli?' }]
  assert.match(retrievalQuery('and on windows?', h), /install/)
  assert.equal(retrievalQuery('How do I install the command line tool?', h), 'How do I install the command line tool?')
})

import { intentOf } from './convo.ts'
test('intent routing', () => {
  assert.equal(intentOf('Where has this person worked?', false), 'person')
  assert.equal(intentOf('What is their favorite language?', false), 'person')
  assert.equal(intentOf('What repositories do they have?', false), 'repos')
  assert.equal(intentOf('What are they known for?', false), 'broad')
  assert.equal(intentOf('How do I install it?', false), 'content')
  assert.equal(intentOf('When was it last pushed?', true), 'content')
})

import { gapReply } from './convo.ts'
test('gapReply answers what GitHub cannot, and passes everything else through', () => {
  assert.match(gapReply('When was the last comment this person made?', ['their projects', 'their languages'])!, /Comments.*their projects, or their languages instead/)
  assert.match(gapReply('What is their salary?', [])!, /Pay/)
  assert.equal(gapReply('What is their main language?', []), null)
  assert.equal(gapReply('How many pull requests did they merge?', []), null)
})

import { factReply } from './convo.ts'
test('factReply answers employer and location from the profile', () => {
  const f = { name: 'Ada Okafor', company: '@IBM', location: 'Berlin' }
  assert.match(factReply('Where has this person worked?', f)!, /IBM/)
  assert.match(factReply('Where do they live?', f)!, /Berlin/)
  assert.match(factReply('which company do they work for', { ...f, company: null })!, /hasn't listed a company/)
  assert.equal(factReply('What is their main language?', f), null)
  assert.equal(factReply('Where is the config file?', f), null)
})
