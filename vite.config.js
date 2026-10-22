import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'

// The default app no longer uses the archived avatar/3D assets. Keep source
// masters intact while publishing only this interface's public assets. Album
// covers remain runtime data served by the backend, not bundled user exports.
const releaseAssets = ['favicon.svg', 'artwork/coast.webp', 'artwork/meadow.webp', 'artwork/night-cover.webp', 'covers/default-cover.jpg']
const lightweightPublicAssets = {
  name: 'yun-lightweight-public-assets',
  apply: 'build',
  async generateBundle() {
    const fontManifest = JSON.parse(await readFile(new URL('./public/fonts/lyrics/manifest.json', import.meta.url), 'utf8'))
    const fontAssets = ['fonts/lyrics/manifest.json', 'fonts/lyrics/README.md', ...fontManifest.fonts.flatMap(font => [
      `fonts/lyrics/${font.id}/font.css`, `fonts/lyrics/${font.id}/OFL.txt`,
      ...font.files.map(file => `fonts/lyrics/${font.id}/${file.filename}`),
    ])]
    for (const fileName of [...releaseAssets, ...fontAssets]) {
      this.emitFile({ type: 'asset', fileName, source: await readFile(new URL(`./public/${fileName}`, import.meta.url)) })
    }
  },
}

// The backend binds to IPv4 loopback. Resolving `localhost` can choose an
// unavailable/blocked address family on Windows, which turns otherwise healthy
// cover and voice requests into Vite proxy EACCES errors.
const backendTarget = process.env.YUN_BACKEND_URL || `http://127.0.0.1:${process.env.PORT || 3030}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), lightweightPublicAssets],
  build: {
    copyPublicDir: false,
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
      // Preserve the browser authority so the backend's source check sees
      // the same Host as Origin/Referer. Vite's shorthand rewrites Host.
      '/api': { target: backendTarget, changeOrigin: false },
      '/covers': { target: backendTarget, changeOrigin: false },
    },
  },
})
