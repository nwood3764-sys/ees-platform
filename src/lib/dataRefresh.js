import { useEffect } from 'react'

// ---------------------------------------------------------------------------
// Data-refresh signal — a purpose-built broadcast that tells the currently
// mounted record and list views to re-fetch after a background mutation, so the
// user sees their change without a manual browser reload.
//
// Today's only emitter is the LEAP Assistant: when it commits a create/update
// action (a new contact, an edited field), it calls emitDataRefresh with the
// tables and record ids it touched. Every open RecordDetail and
// ObjectListSection subscribes and re-fetches IN PLACE — no full page reload,
// so the assistant panel, scroll position, and nav state are all preserved.
//
// This is the standard hook for any future background action that changes data
// the user may be looking at (a scheduled job, a bulk operation, a webhook
// result): emit here and every live view stays current.
//
// Event shape: { source, tables: string[], ids: string[] }
//   source — short tag for who triggered the refresh (e.g. 'assistant'); for
//            debugging/telemetry only.
//   tables — object tables that were touched. A list view refreshes when its
//            own object appears here; an empty array means "refresh regardless".
//   ids    — affected record ids (informational). An open RecordDetail refreshes
//            on any signal — a commit can change the open record directly OR add
//            a child that shows in one of its related lists — so it does not
//            filter on ids.
// ---------------------------------------------------------------------------

const listeners = new Set()

// Broadcast a data-refresh event to every subscriber. One listener throwing
// never blocks the rest.
export function emitDataRefresh(detail = {}) {
  const evt = {
    source: detail.source || null,
    tables: Array.isArray(detail.tables) ? detail.tables.filter(Boolean) : [],
    ids: Array.isArray(detail.ids) ? detail.ids.filter(Boolean) : [],
  }
  listeners.forEach((fn) => { try { fn(evt) } catch { /* isolate a bad listener */ } })
}

// Low-level subscribe; returns an unsubscribe function.
export function subscribeDataRefresh(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// Hook: run `handler(evt)` whenever a data-refresh is emitted. Wrap `handler`
// in useCallback (or otherwise keep it stable) so it isn't re-subscribed on
// every render.
export function useDataRefresh(handler) {
  useEffect(() => subscribeDataRefresh(handler), [handler])
}
