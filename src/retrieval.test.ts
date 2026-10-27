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
