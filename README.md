# gitvox

Hear a GitHub profile. Type a username, and gitvox reads the public profile and speaks it, entirely in your browser: no backend, no API keys.

- **Voice:** [Phonon 31M](https://huggingface.co/gradium/phonon-31m-en) via `phonon-tts` (WASM / WebGPU), streamed sentence by sentence.
- **Facts:** GitHub public REST API. Every number is computed in code, never by a model.
- **Visual:** a sphere of cubes that distorts from the inside as words are spoken.

Roadmap: talk back (VAD + small STT), grounded Q&A with a WebGPU LLM, repo mode with README retrieval, narration personas.

```bash
npm install
npm run dev
```
