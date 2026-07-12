import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Platforms cache og:image per-URL; versioning the URL with the deploy's
// commit SHA makes new shares fetch the latest screenshot, not a stale cache.
const ogVersion = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 8)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'og-image-cache-bust',
      transformIndexHtml: (html) =>
        html.replaceAll('/og.png', `/og.png?v=${ogVersion}`),
    },
  ],
})
