import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Bare short git SHA, reused by both the footer build id and the service
// worker cache version. Netlify provides COMMIT_REF; local falls back to git.
function buildSha() {
  let sha = process.env.COMMIT_REF || ''
  try { if (!sha) sha = execSync('git rev-parse --short HEAD').toString().trim() } catch { /* noop */ }
  return (sha || 'local').slice(0, 7)
}

// Build identifier: short git SHA + UTC build date. Surfaced in the field PWA
// footer so a technician (or Nicholas during testing) can confirm at a glance
// which build is loaded after a reload.
function buildId() {
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return `${buildSha()} · ${date}Z`
}

// Emit sw.js with a per-build CACHE_VERSION so the file is byte-different on
// every deploy. Without this the service worker source is identical across
// builds: the browser's update check (reg.update()) sees no byte change,
// installs no new worker, and the technician stays pinned to a stale bundle
// forever — exactly the failure that left old chunks (and old red styling) on
// the device after a deploy. Reads the authored public/sw.js, rewrites the
// __SW_VERSION__ placeholder to ees-field-<sha>, and overwrites the copied
// asset in the output.
function emitServiceWorker() {
  const sha = buildSha()
  return {
    name: 'emit-service-worker',
    apply: 'build',
    generateBundle() {
      let src = readFileSync('public/sw.js', 'utf8')
      src = src.split('__SW_VERSION__').join(`ees-field-${sha}`)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src })
    },
  }
}

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
  plugins: [react(), emitServiceWorker()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
  build: {
    // Silence the 500KB warning — our bundle is well-segmented now and the
    // individual chunks are small. Raise the threshold so CI logs stay clean.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // mammoth (DOCX preview) → its own chunk, loaded only when a Word
          // document is previewed via the dynamic import in FileGallery.
          if (id.includes('mammoth')) return 'vendor-mammoth'
          // react-grid-layout (the WYSIWYG builder canvas: free positioning,
          // resize handles, responsive breakpoints) + its drag/resize stack →
          // its own chunk, downloaded only with the lazy-loaded builder. These
          // import React (a forward edge to vendor-react) but nothing in the
          // React/editor stack imports them back, so there is no cycle and no
          // TDZ risk. Shared micro-utils (clsx, prop-types, fast-equals) are
          // deliberately NOT claimed here: clsx and prop-types are also used by
          // recharts, so pulling them into vendor-grid created a vendor-grid ↔
          // vendor-recharts cycle (clsx in grid, prop-types in recharts → each
          // imports the other → TDZ). Leaving them out keeps vendor-grid a pure
          // leaf that nothing but the lazy builder imports — only forward edges
          // to vendor-react / vendor-recharts, no cycle.
          if (id.includes('react-grid-layout') || id.includes('react-resizable') ||
              id.includes('react-draggable')   || id.includes('resize-observer-polyfill')) return 'vendor-grid'
          // dnd-kit (sortable palettes / nested field & section lists) → own
          // chunk, same forward-edge-only rationale as vendor-grid.
          if (id.includes('@dnd-kit')) return 'vendor-dndkit'
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
