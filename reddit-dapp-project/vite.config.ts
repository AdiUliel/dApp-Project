import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built app runs from an IPFS gateway subpath
  // (e.g. https://<gateway>/ipfs/<CID>/) - with the default absolute '/assets'
  // paths the bundle 404s there. This is what makes the frontend itself
  // deployable to IPFS, removing the last centralized web host.
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
