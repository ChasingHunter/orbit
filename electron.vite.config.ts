import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    resolve: { alias: shared },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          bar: resolve('src/renderer/bar/index.html'),
          snip: resolve('src/renderer/snip/index.html')
        }
      }
    }
  }
})
