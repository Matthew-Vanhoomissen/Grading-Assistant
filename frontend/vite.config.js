// Vite configuration for the dev server and production build.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Forward /api to Flask so the browser talks to one origin and Flask needs no CORS setup.
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
})
