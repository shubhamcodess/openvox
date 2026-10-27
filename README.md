# gitvox

Hear a GitHub profile. Type a username, and gitvox reads the public profile and speaks it, entirely in your browser: no backend, no API keys.

- **Voice:** [Phonon 31M](https://huggingface.co/gradium/phonon-31m-en) via `phonon-tts` (WASM / WebGPU), streamed sentence by sentence.
- **Facts:** GitHub public REST API. Every number is computed in code, never by a model.
- **Visual:** a sphere of cubes that distorts from the inside as words are spoken.

Two modes from one box: `username` (profile) or `owner/repo` (repo mode: reads the README and up to 7 more docs, chunks them by heading, and retrieves with BM25; the owner's profile facts ride along as context). Deep links: `?u=name` and `?r=owner/repo`.

Roadmap: talk back (VAD + small STT), narration personas.

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
