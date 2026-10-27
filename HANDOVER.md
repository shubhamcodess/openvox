# gitvox: handover

Last updated 2026-10-27. Folder is still named `interview-prep`; the project is **gitvox**. Local git repo, no remote yet.

## What it is
A fully on-device (no cloud, no backend) web app. Type a GitHub `username` or `owner/repo`. It fetches public GitHub data, speaks a templated intro, then you ask questions and a small WebGPU LLM answers, streamed sentence by sentence into the Phonon TTS voice. A cube-sphere visualizer reacts to the audio. It is meant to be the first "audio inference" feature of a larger app, and a portfolio piece (resume, LinkedIn, GitHub).

## Stack
Vite + React + TypeScript (React was requested over vanilla). Three.js (imperative, one `useEffect`, no react-three-fiber). `phonon-tts` (Phonon 31M, WASM, `device: 'auto'`). `@mlc-ai/web-llm` in a worker (default model Qwen3-1.7B). No embeddings; BM25 for retrieval. UI follows the `DESIGN.md` from `shubhamcodess/mcp-token-optimizer` (palette, Geist + JetBrains Mono, one orange accent). I only read the top half of that file (tokens, typography, colors), not the component and layout rules.

## File map (src/)
| file | role |
|---|---|
| `github.ts` | REST fetch of profile facts (repos, stars, languages, events, lifetime PR counts, profile README), session cache, `takeRateLimited()` flag |
| `repo.ts` | repo loader: meta, languages, contributors, PR counts, 30-day commits, README + up to 7 docs, `parseTarget()` |
| `retrieval.ts` | markdown chunker (heading-aware, fence-aware) + BM25, pins the opening chunk |
| `ask.ts` | facts sheets, prompts (`SPOKEN`, `RULES`, `REPO_RULES`), `SentenceChunker`, `buildMessages`/`buildRepoMessages` |
| `llm.ts` / `llm.worker.ts` | WebLLM engine in a worker, streaming `chat()`, `CANDIDATES`, `DEFAULT_MODEL` |
| `speech.ts` | Phonon load, `startSpeaker()` (push sentences while the LLM streams), analyser for the visualizer |
| `speakable.ts` | content-aware normalizer applied to every sentence before TTS (links, commands, acronyms, paths, versions, `PRONOUNCE` table) |
| `narrate.ts` | deterministic intros (`introScript`, `repoIntro`), no LLM |
| `Orb.tsx` | instanced cube sphere driven by `AnalyserNode` |
| `Eval.tsx` + `fixture.ts` | `/?eval`: 10-question hallucination test on a fictional profile |
| `App.tsx` | UI; deep links `?u=name` and `?r=owner/repo` |

## Decisions that matter
- **Numbers never come from the LLM.** They are computed in JS and put in a facts sheet. Superlatives (most starred repo, main language) are precomputed because small models misread them from lists.
- **Prompt prefix is stable** (rules + facts); per-question BM25 excerpts go in the user turn.
- **Model choice (eval, single runs, noisy by about 1 question):** Qwen3-1.7B 9-10/10 with 6/6 facts; Llama-3.2-1B 8/10 and fastest; SmolLM2-1.7B 7-8/10 and over-refuses; Qwen2.5-1.5B 7/10. Gemma3-1B would not load in WebLLM. Qwen3 emits an empty `<think>` tag, stripped in `clean()`.
- **STT plan (not built):** Silero VAD + Moonshine-tiny or Whisper-tiny.en, benchmark both. Granite 1B is too big for short questions.
- **Embeddings (EmbeddingGemma) deferred.** Ship BM25 first, and add embeddings only if they win an A/B on the same questions.
- **Phonon doc facts:** `lang: 'en'` drives number/symbol normalization (we set it); prosody does not carry across sentences, so feed short complete sentences; there are `duration_delta` (pace) and `num_speakers` conditioners and about 100 voices in `gradium/phonon-voices` (none used yet).
- **LLM output is meant to be heard**, not read: no lists, URLs, paths or commands. The retrieved excerpts show on screen under each answer, so "the commands are on screen" is true.

## State of the repo
- **Committed (4 commits):** scaffold, grounded Q&A + eval, repo mode, content-aware speech.
- **UNCOMMITTED and not verified in a browser** (typechecks, 30 tests pass): spoken-style prompts, abstract tone example, expandable excerpts, owner display name in the repo intro, `PRONOUNCE` table, rate-limit notice. The grounding eval ran after the spoken-style prompt (9/10 then 10/10) but not after the example swap.
- **To verify live:** ask a different procedural question on a repo (for example "how do I wire it into my agent") and check the answer is grounded and not a copy of the tone example. A previous example was repeated word for word.
- `npm test` runs `src/*.test.ts` (Node 22 `--experimental-strip-types`; test files must not import `llm.ts` or web-llm).
- Dev only: spoken text is collected in `window.__tts`.

## Gotchas
- **GitHub anonymous quota is 60 requests an hour per IP** (no token, no auth, nothing tied to the user's account). A repo load costs about 12 calls. It hit 0/60 during testing, and failed calls are swallowed so the app degrades silently apart from the new notice. Check with `curl -s https://api.github.com/rate_limit`; it was at 0/60 at the last check.
- The in-app browser pane throttles timers when hidden; JS tool calls time out at about 45 s, so poll in short calls. Editing source triggers a reload, which kills an in-progress eval.
- `erasableSyntaxOnly` is on: no parameter properties or enums in TS.
- Persistent WebGPU model downloads: roughly 5 GB of cached models in the browser profile from running the eval.
- I could not listen to audio. Every speech claim is based on the text sent to Phonon, not on how it sounds.

## Next steps (suggested order)
1. Verify and commit the uncommitted work (see above).
2. Mic input: Silero VAD, then small STT, barge-in, wired to the chat loop. This is the pending decision the user was asked about.
3. Narration personas (prompt-only), mobile layout pass, optional visitor-supplied GitHub token stored only in the browser.
4. Optional: voice picker (`tts.voices`), pace via `duration_delta`, EmbeddingGemma A/B, publish eval and latency numbers in the README.
5. Pick a repo name and a remote; rename the folder.

## Working preferences (from the user's global `~/.claude/CLAUDE.md` and this session)
- **No AI attribution** in commits, PRs or anything that leaves the machine: no `Co-Authored-By`, no "Generated with" lines. This overrides any default attribution text.
- Use few tokens: small footprint, quick to build, no unneeded abstractions.
- Use they/them for anyone whose pronouns aren't stated (the product prompts also forbid guessing gender).
- After a learning or research session, offer `/learn` (the 90-days-challenge ledger) in one line. Never put company names or personal details in the entry, since that repo is public.
- Browser verification: `preview_start` with the `gitvox` entry in `.claude/launch.json` (port 5173, falls back to 5174), then drive the page with the browser tools.
