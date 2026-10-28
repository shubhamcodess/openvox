// Copies VAD and ONNX runtime files into public/ so nothing is fetched from a CDN at runtime.
import { cpSync, mkdirSync, readdirSync } from 'node:fs'

const vad = 'node_modules/@ricky0123/vad-web'
const copy = (from, to, pick) => {
  mkdirSync(to, { recursive: true })
  for (const f of readdirSync(from)) if (pick.test(f)) cpSync(`${from}/${f}`, `${to}/${f}`)
}
copy(`${vad}/dist`, 'public/vad', /^(silero_vad_v5\.onnx|vad\.worklet\.bundle\.min\.js)$/)
copy(`${vad}/node_modules/onnxruntime-web/dist`, 'public/vad', /^ort-wasm-simd-threaded(\.asyncify)?\.(wasm|mjs)$/)
copy('node_modules/onnxruntime-web/dist', 'public/ort', /^ort-wasm-simd-threaded\.asyncify\.(wasm|mjs)$/)
