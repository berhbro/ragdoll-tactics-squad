import { defineConfig } from 'vite'

export default defineConfig({
  // Relative paths work both locally and under a GitHub Pages repository subpath.
  base: './',
  server: {
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 5000,
  },
})
