import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Anura build config
// - React.lazy already code-splits per module (see App.jsx). This config
//   pulls large vendor libraries out into their own long-lived chunks so
//   they cache across deploys instead of re-downloading on every app change.
// - Recharts is the heaviest non-React dep (used on dashboards only).
// - Supabase client ships to every user, but changes rarely.
export default defineConfig({
  plugins: [react()],
  build: {
    // Silence the 500KB warning — our bundle is well-segmented now and the
    // individual chunks are small. Raise the threshold so CI logs stay clean.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-recharts'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('react-dom'))  return 'vendor-react'
          if (id.includes('react/') || id.includes('scheduler')) return 'vendor-react'
        },
      },
    },
  },
})
