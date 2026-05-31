import { supabase } from './supabase'

// ─── Client-side error logger ────────────────────────────────────────────
// Posts uncaught exceptions to the `client_errors` table on Supabase. Used
// by the ErrorBoundary tree in App.jsx and by the global window error
// handlers below.
//
// Design contract:
//   • Fire-and-forget. The logger NEVER throws. If the insert fails, we
//     swallow the error and console.warn — the user is already seeing a
//     fallback UI and we don't want a logger crash to compound that.
//   • Synchronous-feeling. Returns immediately; the network request
//     happens in the background. The caller doesn't await it.
//   • Idempotent within a session. Repeated identical errors within the
//     same session id are still logged (we don't dedupe) but they're
//     trivially grouped on the triage side via ce_session_id.
// ─────────────────────────────────────────────────────────────────────────

// One session id per browser tab, persisted across reloads within the tab
// so a refresh cascade groups together. sessionStorage clears on tab close.
const SESSION_KEY = 'ees_client_error_session_id'

function getSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      // crypto.randomUUID is available in every browser that runs our build
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `fallback_${Date.now()}_${Math.random().toString(36).slice(2)}`
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    // sessionStorage can throw in private browsing on some browsers
    return `nostorage_${Date.now()}`
  }
}

// Resolve the public.users.id (NOT auth.users.id) for the current session.
// Mirrors getCurrentUserId() from layoutService but inlined here to avoid
// pulling the whole service into the logger module.
async function resolveAppUserId(authUserId) {
  if (!authUserId) return null
  try {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    return data?.id || null
  } catch {
    return null
  }
}

// Read the current active module from the URL. Mirrors the parsing in
// src/lib/urlNav.js but stays self-contained so a urlNav bug can't break
// the logger.
function parseModuleFromUrl() {
  try {
    const path = window.location.pathname
    // /m/<module>[/...]
    const moduleMatch = path.match(/^\/m\/([a-z0-9_-]+)/i)
    if (moduleMatch) return moduleMatch[1].toLowerCase()
    // /<table>/<uuid> or /<table>/new — record detail, infer module
    const recordMatch = path.match(/^\/([a-z0-9_]+)\/[a-f0-9-]{8,}/i)
    if (recordMatch) return `record:${recordMatch[1].toLowerCase()}`
    if (path === '/' || path === '') return 'home'
    return path
  } catch {
    return null
  }
}

// Parse a `<table>/<id>` pair out of the URL if a RecordDetail is open.
function parseRecordFromUrl() {
  try {
    const m = window.location.pathname.match(/^\/([a-z0-9_]+)\/([a-f0-9-]{8,})/i)
    if (!m) return { table: null, id: null }
    return { table: m[1].toLowerCase(), id: m[2] }
  } catch {
    return { table: null, id: null }
  }
}

// Build the row payload from a caught Error + optional React errorInfo.
// Pure function — does no I/O — so it stays trivially testable.
function buildPayload(error, errorInfo, extra = {}) {
  const { table, id } = parseRecordFromUrl()
  return {
    ce_error_name:        error?.name || 'Error',
    ce_message:           String(error?.message || error || 'Unknown error').slice(0, 4000),
    ce_stack:             error?.stack ? String(error.stack).slice(0, 8000) : null,
    ce_component_stack:   errorInfo?.componentStack ? String(errorInfo.componentStack).slice(0, 8000) : null,
    ce_module:            extra.module || parseModuleFromUrl(),
    ce_route:             typeof window !== 'undefined' ? window.location.pathname : null,
    ce_url:               typeof window !== 'undefined' ? window.location.href : null,
    ce_record_table:      extra.recordTable || table,
    ce_record_id:         extra.recordId || id,
    ce_user_agent:        typeof navigator !== 'undefined' ? navigator.userAgent : null,
    ce_app_version:       import.meta.env.VITE_APP_VERSION || null,
    ce_viewport_width:    typeof window !== 'undefined' ? window.innerWidth  : null,
    ce_viewport_height:   typeof window !== 'undefined' ? window.innerHeight : null,
    ce_session_id:        getSessionId(),
    ce_severity:          extra.severity || 'error',
  }
}

// ─── Stale-chunk auto-recovery ─────────────────────────────────────────────
// When a new build is deployed, the JS chunk filenames change (content hash).
// A browser tab that was open before the deploy still references the OLD chunk
// names; the next lazy import (route/module switch) fails with "Failed to fetch
// dynamically imported module" / "error loading dynamically imported module" /
// "Importing a module script failed". This is expected and recoverable: the
// fix is to reload the page, which pulls the current index.html and new chunks.
//
// We auto-reload ONCE per detection, guarded by a short-lived sessionStorage
// timestamp so a genuinely broken deploy can't trap the user in a reload loop.
// If we reloaded within the cooldown window already, we stop and let the error
// surface normally (so a real, persistent failure is still visible/logged).
//
// Two guard keys are honored so this layer and the ErrorBoundary's
// StaleVersionScreen (which uses 'leap.staleReload.attemptedAt') never reload
// in quick succession — whichever fires first sets its key, and the other sees
// a recent attempt and stands down.
const STALE_CHUNK_RELOAD_KEY = 'ees_stale_chunk_reloaded_at'
const STALE_CHUNK_BOUNDARY_KEY = 'leap.staleReload.attemptedAt'
const STALE_CHUNK_COOLDOWN_MS = 60 * 1000

function isStaleChunkError(err) {
  const msg = String(err?.message || err || '')
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /dynamically imported module/i.test(msg) ||
    // Safari/Firefox phrasings for a vanished chunk
    /Unable to preload CSS|preload.*failed/i.test(msg)
  )
}

// Returns true if it handled the error (triggered a reload or is within
// cooldown), meaning the caller should NOT also log it as a hard error.
function maybeRecoverFromStaleChunk(err) {
  if (!isStaleChunkError(err)) return false
  try {
    const now = Date.now()
    const lastGlobal = Number(sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) || 0)
    const lastBoundary = Number(sessionStorage.getItem(STALE_CHUNK_BOUNDARY_KEY) || 0)
    const last = Math.max(lastGlobal, lastBoundary)
    if (now - last < STALE_CHUNK_COOLDOWN_MS) {
      // Already tried very recently (either layer) — don't loop. Let it
      // through to logging so a persistent failure stays visible.
      return false
    }
    sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(now))
    sessionStorage.setItem(STALE_CHUNK_BOUNDARY_KEY, String(now))
  } catch { /* sessionStorage unavailable — fall through to reload anyway */ }
  // Log a benign breadcrumb (info severity) so we can see how often this fires,
  // then reload to pick up the new build.
  try { logClientError(err, null, { severity: 'info', module: 'stale-chunk-reload' }) } catch { /* noop */ }
  window.location.reload()
  return true
}

export { isStaleChunkError, maybeRecoverFromStaleChunk }

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Log a client-side error. Returns a Promise that resolves with the
 * inserted row's record number on success, or null on any failure.
 *
 * Never throws. Safe to call from inside an ErrorBoundary's
 * componentDidCatch.
 */
export async function logClientError(error, errorInfo, extra = {}) {
  try {
    // Always log to console first so devtools still has a record even
    // if the network insert fails.
    console.error('[client_errors]', error, errorInfo)

    // Best-effort user resolution. If auth is broken, we still log
    // the row with nulls in the user fields.
    let authUserId = null
    let userEmail  = null
    try {
      const { data: { session } } = await supabase.auth.getSession()
      authUserId = session?.user?.id || null
      userEmail  = session?.user?.email || null
    } catch { /* swallow */ }

    const appUserId = await resolveAppUserId(authUserId)

    const row = {
      ...buildPayload(error, errorInfo, extra),
      ce_app_user_id:  appUserId,
      ce_auth_user_id: authUserId,
      ce_user_email:   userEmail,
      ce_owner:        appUserId,
      ce_created_by:   appUserId,
    }

    const { data, error: insertErr } = await supabase
      .from('client_errors')
      .insert(row)
      .select('ce_record_number')
      .maybeSingle()

    if (insertErr) {
      console.warn('[client_errors] insert failed:', insertErr.message)
      return null
    }
    return data?.ce_record_number || null
  } catch (e) {
    // Defense in depth — logger must not throw under any circumstance
    console.warn('[client_errors] logger crashed:', e)
    return null
  }
}

/**
 * Install global handlers that catch unhandled errors and unhandled
 * promise rejections at the window level. These complement the React
 * ErrorBoundary (which only catches errors thrown during render).
 *
 * Call once from main.jsx.
 */
export function installGlobalErrorHandlers() {
  if (typeof window === 'undefined') return
  if (window.__eesGlobalHandlersInstalled) return
  window.__eesGlobalHandlersInstalled = true

  window.addEventListener('error', (event) => {
    // Filter out resource-load errors (script, img). Only log JS errors.
    if (event.error) {
      // Stale chunk after a deploy → reload to pick up the new build instead
      // of logging a hard error and leaving the user stuck.
      if (maybeRecoverFromStaleChunk(event.error)) return
      logClientError(event.error, null, { severity: 'error' })
    }
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const err = reason instanceof Error
      ? reason
      : new Error(typeof reason === 'string' ? reason : JSON.stringify(reason))
    err.name = err.name === 'Error' ? 'UnhandledPromiseRejection' : err.name
    if (maybeRecoverFromStaleChunk(err)) return
    logClientError(err, null, { severity: 'error' })
  })

  // Vite emits this specifically when a lazy import()'s chunk fails to load —
  // the most direct signal of a stale tab after a deploy. Recover immediately.
  window.addEventListener('vite:preloadError', (event) => {
    try { event.preventDefault() } catch { /* noop */ }
    const err = event?.payload || new Error('Failed to fetch dynamically imported module (vite:preloadError)')
    if (maybeRecoverFromStaleChunk(err)) return
    logClientError(err, null, { severity: 'error', module: 'vite-preload-error' })
  })
}
