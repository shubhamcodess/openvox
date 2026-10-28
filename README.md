# openvox

Hear a GitHub profile. Type a username, and openvox reads the public profile and speaks it, entirely in your browser: no backend, no API keys.

- **Voice:** [Phonon 31M](https://huggingface.co/gradium/phonon-31m-en) via `phonon-tts` (WASM / WebGPU), streamed sentence by sentence.
- **Facts:** GitHub public REST API. Every number is computed in code, never by a model.
- **Visual:** a sphere of cubes that distorts from the inside as words are spoken.

Two modes from one box: `username` (profile) or `owner/repo` (repo mode: reads the README and up to 7 more docs, chunks them by heading, and retrieves with BM25; the owner's profile facts ride along as context). Deep links: `?u=name` and `?r=owner/repo`.

**Content-aware speech:** the screen shows the original text, but Phonon gets a speakable version (`src/speakable.ts`): links become "this link", shell commands become "the command shown on screen", acronyms are spelled or pronounced (N P M, Jason, yammel), and file paths, versions and symbols are read naturally. Add words to the tables at the top of that file.

Talk back: tap the mic. Everything runs on-device: the browser cleans the signal (echo cancel, noise suppression), Silero VAD finds speech with a 400 ms pre-roll, and it waits through thinking pauses (about 1.6 s after a finished sentence, up to about 3.5 s after one that trails off) before sending. The audio is high-passed, trimmed, levelled and transcribed by Moonshine-base in a worker; fillers, stutters and phantom "thank you" transcripts are removed before the LLM sees it. Starting to speak interrupts the voice.

**How it answers:**
- **Profile mode** indexes every original repo as a small card (up to 100), the profile README, and the READMEs of the top starred repos plus the most recently pushed one. After loading, the repo box becomes a picker of all of them; picking one switches to repo mode.
- **Routing:** the question is classified first. Employer and location questions are answered straight from the profile. Things GitHub cannot show (comments, salary, lifetime commits, work history) get a direct "I can't see that" plus what can be covered. Questions about the person or their repo list use the facts sheet alone, and "tell me about them" gets the openings of the top READMEs. Anything about content is retrieved.
- **Retrieval:** BM25 over heading-aware chunks with synonym expansion ("set up" finds Installation), a boost for a repo named in the question, a relevance floor so weak matches are dropped, and short follow-ups borrow the previous question.
- **Conversation:** refusals are kept out of the history, because a small model copies its own earlier answers. Prompts describe style in rules, never with an example, for the same reason.

Roadmap: narration personas.

```bash
npm install
npm run dev
```

## Model pick (WebLLM, WebGPU, Apple M-series)

`/?eval` runs 10 questions on a fictional profile: 6 fact lookups and 4 traps where the right answer is "I don't have that".

| model | pass | facts | traps | first token | tok/s |
|---|---|---|---|---|---|
| Qwen3-1.7B (default) | 9/10 | 6/6 | 3/4 | ~400 ms | ~60 |
| Llama-3.2-1B | 8/10 | 5/6 | 3/4 | ~260 ms | ~99 |
| SmolLM2-1.7B | 7-8/10 | 3-5/6 | 4/4 | ~420 ms | ~85 |
| Qwen2.5-1.5B | 7/10 | 4/6 | 3/4 | ~650 ms | ~32 |

Single runs, so treat ±1 question as noise. Gemma3-1B did not load in WebLLM. Superlatives ("most starred") are precomputed in code, because small models misread them from a list.

`npm test` runs the retrieval tests (Node 22+).
