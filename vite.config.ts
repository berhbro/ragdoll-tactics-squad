import { defineConfig } from 'vite'

export default defineConfig({
  // AILab exposes the development server under this reverse-proxy prefix.
  // Keeping it here makes Vite rewrite the HTML entry, CSS and HMR client paths
  // consistently instead of relying on a per-command --base override.
  base: '/editor/proxy/5173/',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 5000,
  },
})
