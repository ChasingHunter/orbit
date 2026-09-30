import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

// Native addons must stay in node_modules next to their DLLs; never bundle them,
// even if the dev server started before they were installed.
const nativeExternals = ['sherpa-onnx-node', 'koffi', 'selection-hook', '@anthropic-ai/claude-agent-sdk']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: { rollupOptions: { external: nativeExternals } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    resolve: { alias: shared },
    plugins: [react(), tailwindcss()],
    build: {
      minify: true,
      rollupOptions: {
        input: {
          bar: resolve('src/renderer/bar/index.html'),
          snip: resolve('src/renderer/snip/index.html'),
          dashboard: resolve('src/renderer/dashboard/index.html')
        }
      }
    }
  }
})
