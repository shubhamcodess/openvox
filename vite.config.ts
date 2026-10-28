import { readFile } from 'node:fs/promises'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Dev server refuses to import .mjs files from /public; the ONNX runtime does exactly that, so serve them raw. */
const rawRuntime: Plugin = {
  name: 'raw-onnx-runtime',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = req.url?.split('?')[0] ?? ''
      if (!/^\/(vad|ort)\/[\w.-]+\.mjs$/.test(url)) return next()
      try {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(await readFile(`public${url}`))
      } catch {
        next()
      }
    })
  },
}

export default defineConfig({
  plugins: [react(), rawRuntime],
  optimizeDeps: { exclude: ['phonon-tts'] },
  worker: { format: 'es' },
})
