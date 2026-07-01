import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendTarget = process.env.YUN_BACKEND_URL || `http://localhost:${process.env.PORT || 3030}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1300,
  },
  server: {
    proxy: {
      '/api': backendTarget,
      '/covers': backendTarget,
    },
  },
})
