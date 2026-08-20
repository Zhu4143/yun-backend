import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The backend binds to IPv4 loopback. Resolving `localhost` can choose an
// unavailable/blocked address family on Windows, which turns otherwise healthy
// cover and voice requests into Vite proxy EACCES errors.
const backendTarget = process.env.YUN_BACKEND_URL || `http://127.0.0.1:${process.env.PORT || 3030}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1300,
  },
  server: {
    // Local speech and voiceprint runtimes contain tens of thousands of
    // Python/package files. They are not frontend source and must not be
    // traversed by Vite's file watcher, otherwise first page load can stall.
    watch: {
      ignored: [
        '**/yun-desktop-agent/local-speech-service/.venv/**',
        '**/yun-desktop-agent/local-speech-service/models/**',
        '**/yun-desktop-agent/local-speech-service/cache/**',
        '**/yun-desktop-agent/voiceprint-service/.venv/**',
      ],
    },
    proxy: {
      '/api': backendTarget,
      '/covers': backendTarget,
    },
  },
})
