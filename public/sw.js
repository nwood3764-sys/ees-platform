/* ─── sw.js — Energy Efficiency Services Field PWA service worker ───────────────
 *
 * Scope: registered from /field only (see FieldMobileRoot). Other surfaces
 * (staff app, /sa, /sign) do not register a service worker.
 *
 * Strategy:
 *   • Navigation requests  → network-first, fall back to cached index.html.
 *     Keeps the technician on the latest deployed bundle when online, but a
 *     cold launch with no signal still boots the shell (offline-first per the
 *     field-mobile spec — concrete buildings, basements, no cell service).
 *   • Same-origin static assets (hashed JS/CSS/icons) → stale-while-revalidate.
 *     Hashed filenames make this safe: a new build emits new names, so we
 *     never serve a stale chunk under a fresh name.
 *   • Supabase / cross-origin / non-GET  → never intercepted. Auth, RPCs,
 *     Storage uploads, and the REST layer always hit the network. Caching any
 *     of these would risk stale data, stale auth, or duplicated writes.
 *
 * Cache versioning: bump CACHE_VERSION to force a clean swap. Old caches are
 * purged on activate.
 * ───────────────────────────────────────────────────────────────────────── */

// CACHE_VERSION carries the build SHA, injected at build time by the
// emit-service-worker plugin in vite.config.js (it rewrites the __SW_VERSION__
// token below to ees-field-<sha>). This is what makes the file BYTE-DIFFERENT
// on every deploy — without it sw.js is identical across builds, the browser's
// update check finds no change, a stale worker is never replaced, and the
// technician stays pinned to an old bundle. If the token is ever left
// un-rewritten (dev/un-built copy), fall back to a static dev version.
const RAW_VERSION = '__SW_VERSION__'
const CACHE_VERSION = RAW_VERSION.startsWith('ees-field-') ? RAW_VERSION : 'ees-field-dev'
const SHELL_URLS = [
  '/field',
  '/field-app.webmanifest',
  '/field-icon.svg',
  '/favicon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Best-effort precache; individual failures must not abort install.
      Promise.allSettled(SHELL_URLS.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

function isSupabase(url) {
  return url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // Only handle GET, same-origin, non-Supabase. Everything else passes
  // straight through to the network untouched.
  if (req.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (isSupabase(url)) return

  // Network-first for ALL same-origin GETs (navigation + assets). When online,
  // the freshest deployed build always wins — no stale chunks served from a
  // previously cached index.html. The cache is only a fallback for offline
  // (basement / no-signal field use, per the field-mobile spec). This trades a
  // little extra network for correctness: a technician on signal is never
  // stuck on an old build, and one with no signal still boots the last-seen
  // version.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(() =>
        caches.match(req).then((cached) =>
          cached || (req.mode === 'navigate' ? caches.match('/field') : undefined)
        )
      )
  )
})
