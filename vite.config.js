import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// EES-WI LEAP build config
// - React.lazy already code-splits per module (see App.jsx). This config
//   pulls large vendor libraries out into their own long-lived chunks so
//   they cache across deploys instead of re-downloading on every app change.
// - Recharts is the heaviest non-React dep (used on dashboards only).
// - Supabase client ships to every user, but changes rarely.
//
// IMPORTANT: TipTap + ProseMirror must live in the SAME chunk as React.
// They have implicit React imports and if Vite splits them across vendor
// chunks an internal helper can land in `vendor-recharts` (because both
// recharts and prosemirror touch shared utilities), creating a circular
// import between vendor-react and vendor-recharts. The page then dies
// at module-load with "Cannot access '_' before initialization" — a TDZ
// error inside one of the cycle members.
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
          // Recharts + d3 → its own chunk. Must be tested FIRST so that any
          // node_module that recharts pulls in (d3-*, victory-vendor, etc.)
          // lands here too, not in vendor-react.
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'vendor-recharts'
          if (id.includes('@supabase')) return 'vendor-supabase'
          // React-family chunk: React itself, react-dom, scheduler, AND the
          // editor stack that depends on React. Pinning TipTap/ProseMirror
          // here prevents Vite from sliding any of their transitive helpers
          // into vendor-recharts and creating an evaluation cycle.
          if (id.includes('react-dom'))  return 'vendor-react'
          if (id.includes('/react/') || id.includes('\\react\\') || id.includes('scheduler')) return 'vendor-react'
          if (id.includes('@tiptap'))    return 'vendor-react'
          if (id.includes('prosemirror')) return 'vendor-react'
          if (id.includes('orderedmap'))  return 'vendor-react'
          if (id.includes('rope-sequence')) return 'vendor-react'
          if (id.includes('w3c-keyname'))   return 'vendor-react'
          // Shared utilities used by BOTH the editor stack (vendor-react)
          // and react-smooth/recharts. If these land in vendor-recharts
          // they cause vendor-react → vendor-recharts back-edge imports
          // and the resulting circular load order throws a TDZ error in
          // the recharts chunk ("Cannot access '_' before initialization").
          if (id.includes('fast-equals'))    return 'vendor-react'
          if (id.includes('use-sync-external-store')) return 'vendor-react'
        },
      },
    },
  },
})
