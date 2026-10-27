import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toSpeech } from './speakable.ts'

const cases: [string, string][] = [
  // links
  ['See https://github.com/foo/bar for details.', 'See this link for details.'],
  ['Docs at www.example.com/docs, and https://x.dev/a.', 'Docs at this link, and another link.'],
  ['Mail me at a.b@gmail.com now', 'Mail me at an email address now'],
  // commands
  ['Clone it: git clone https://github.com/foo/bar.git then open the folder.', 'Clone it: the command shown on screen then open the folder.'],
  ['Run `npm install -g mcp-token-optimizer-0.1.0.tgz.`', 'Run the command shown on screen.'],
  ['The git history is clean.', 'The git history is clean.'],
  ['Start it with node dist/cli.js --version.', 'Start it with the command shown on screen.'],
  ['1. Clone: git clone https://x.com/a/b.git 2. Go: cd my-app 3. Run npm install then npm run build.', 'Step 1, Clone: the command shown on screen. Go: the command shown on screen. Run the command shown on screen then the command shown on screen.'],
  ['Download mcp-token-optimizer-0.1.0.tgz from Releases.', 'Download the release file from Releases.'],
  // acronyms
  ['It uses an LLM and TTS over the API.', 'It uses an L L M and T T S over the A P I.'],
  ['Great for PRs and CLI tools, MIT licensed.', 'Great for pull requests and C L I tools, M I T licensed.'],
  ['The format is JSON or YAML.', 'The format is Jason or yammel.'],
  ['Runs on WebGPU in macOS.', 'Runs on web G P U in mac O S.'],
  ['Never use NOT as an acronym; TOON stays a word.', 'Never use NOT as an acronym; TOON stays a word.'],
  ['Install with npm or pnpm.', 'Install with N P M or P N P M.'],
  // paths, versions, symbols
  ['Edit src/app/config.ts first.', 'Edit config dot T S first.'],
  ['See README.md and DESIGN.md.', 'See read me dot M D and DESIGN dot M D.'],
  ['Created by shubhamcodess/mcp-token-optimizer.', 'Created by shubhamcodess slash M C P token optimizer.'],
  ['Released v0.1.0 with 75% TypeScript, 3.8k stars.', 'Released version 0 point 1 point 0 with 75 percent TypeScript, 3.8 thousand stars.'],
  ['Fast, e.g. under 100ms — and cheap.', 'Fast, for example, under 100ms, and cheap.'],
  ['Built 🚀 with **care**', 'Built with care'],
  ['1. Clone the repo. 2. Install.', 'Step 1, Clone the repo, step 2, Install.'],
]

for (const [input, want] of cases) {
  test(input.slice(0, 50), () => assert.equal(toSpeech(input), want))
}
