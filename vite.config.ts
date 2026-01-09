import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages project sites are served from /<repo>/.
  base: '/ZooMZ/',
  plugins: [react()],
  server: { port: 5173 }
})
