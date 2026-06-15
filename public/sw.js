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

const CACHE_VERSION = 'ees-field-v1'
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

  // Navigation → network-first, fall back to cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE_VERSION).then((c) => c.put('/field', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/field').then((r) => r || caches.match(req)))
    )
    return
  }

  // Static assets → stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone()
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
