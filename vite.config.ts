import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    // Shiki ships large TextMate grammars (cpp, emacs-lisp, wolfram, ...) as
    // separate lazy chunks under bundle/full. They are only fetched when a
    // finding's file matches that language — never on initial load. Raise the
    // warning threshold past the biggest grammar so the build output isn't
    // dominated by noise we already understand.
    chunkSizeWarningLimit: 1024,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/web'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  server: { port: 5174, proxy: { '/api': 'http://127.0.0.1:7345' } },
})
