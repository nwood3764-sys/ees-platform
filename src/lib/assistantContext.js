// assistantContext — what the LEAP assistant is allowed to know about the
// screen the user is actually looking at, and about any LEAP link they paste
// into the chat.
//
// Why this exists (2026-08-26): the assistant was told only `{object,
// record_id}` from the app's selected RECORD. On a related-list screen —
// Contacts filtered to one account — there is no selected record, so the
// context collapsed to `{object:'contacts'}` and the account the user was
// staring at was invisible to the model. It then searched, missed, and told
// the user "No account found for Community Management Corporation" while that
// account's own contact list was on screen. The parent account's id and label
// were in the URL the whole time (the `rel=` token).
//
// Two sources of screen truth are captured here:
//   1. listScope  — the related-list filter riding in the URL's `rel` token:
//                   {table, fk, via, parentId, label}. The parent record IS
//                   the context on that screen.
//   2. pasted URL — a user who pastes a LEAP address is naming a record (or a
//                   scoped list). Decode it rather than making the model
//                   pattern-match a base64 blob in prose.
//
// Pure: no React, no network, no globals. Pinned by
// scripts/assistant-context-fixture.mjs.

import { decodeListScope, isUrlAddressableTable } from './urlGrammar.js'

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
// Any http(s) URL in a message, stopping at whitespace or a trailing sentence
// mark. Trailing ) . , ; are stripped so "see https://x/y/z." resolves.
const URL_RE = /https?:\/\/[^\s<>"']+/gi

function trimUrlPunctuation(raw) {
  let u = raw
  while (u.length && '.,;:!?)]}'.includes(u[u.length - 1])) u = u.slice(0, -1)
  return u
}

// A record reference is the platform's own record grammar: /<table>/<uuid>.
// Deliberately syntactic — the same rule parsePath uses — so an object nobody
// registered still resolves (the 2026-08-24 objectNav lesson: allowlists rot).
function recordRefFromPath(pathname) {
  const m = new RegExp(`^/([a-z0-9_]+)/(${UUID_RE})/?$`, 'i').exec(pathname || '')
  if (!m) return null
  const table = m[1].toLowerCase()
  if (!isUrlAddressableTable(table)) return null
  return { table, id: m[2].toLowerCase() }
}

/**
 * Pull every LEAP reference out of a block of user text.
 *
 * Returns { records: [{table,id,url}], scopes: [{table,fk,via,parentId,label,url}] }
 * — both arrays de-duplicated, both possibly empty. A URL from another origin
 * is ignored: only the site the user is signed in to can be resolved, and a
 * foreign link must never be presented to the model as a LEAP record.
 */
export function parseLeapReferences(text, origin) {
  const out = { records: [], scopes: [] }
  if (typeof text !== 'string' || !text) return out
  const base = typeof origin === 'string' ? origin.replace(/\/+$/, '') : ''
  const seenRec = new Set()
  const seenScope = new Set()
  for (const raw of (text.match(URL_RE) || [])) {
    const clean = trimUrlPunctuation(raw)
    let u
    try { u = new URL(clean) } catch { continue }
    if (base && u.origin !== base) continue
    const rec = recordRefFromPath(u.pathname)
    if (rec) {
      const key = `${rec.table}:${rec.id}`
      if (!seenRec.has(key)) { seenRec.add(key); out.records.push({ ...rec, url: clean }) }
      continue
    }
    const scope = decodeListScope(u.search)
    if (scope) {
      const key = `${scope.table}:${scope.fk}:${scope.parentId}`
      if (!seenScope.has(key)) { seenScope.add(key); out.scopes.push({ ...scope, url: clean }) }
    }
  }
  return out
}

// Normalize a listScope to the wire shape the edge function reads. Kept
// separate from the app's own listScope so a rename on either side is a real,
// visible change rather than a silent drift.
function wireScope(scope) {
  if (!scope || !scope.table || !scope.parentId || !scope.fk) return null
  return {
    table: scope.table,
    fk: scope.fk,
    via: Array.isArray(scope.via) && scope.via.length
      ? scope.via.filter(v => v && v.table && v.fk).map(v => ({ table: v.table, fk: v.fk }))
      : null,
    parent_id: scope.parentId,
    parent_label: scope.label || null,
  }
}

/**
 * Build the context payload sent with every assistant turn.
 *
 * @param selectedRecord  the app's open record, if any ({table,id,name})
 * @param listTable       the object whose list is on screen, if any
 * @param listScope       the related-list filter on that list, if any
 * @param message         the user's text, scanned for pasted LEAP links
 * @param origin          window.location.origin (links from elsewhere ignored)
 *
 * Returns null only when there is genuinely nothing to say about the screen.
 */
export function buildAssistantContext({
  selectedRecord = null, listTable = null, listScope = null,
  message = '', origin = '',
} = {}) {
  const ctx = {}
  const object = selectedRecord?.table || selectedRecord?.object || listTable || null
  if (object) ctx.object = object
  if (selectedRecord?.id) {
    ctx.record_id = selectedRecord.id
    const label = selectedRecord.name || selectedRecord.label || null
    if (label) ctx.record_label = label
  }
  // The related-list filter only describes the screen when it is the filter ON
  // the list being shown — a stale scope for another object says nothing.
  const scopeForList = listScope && (!listTable || listScope.table === listTable)
    ? wireScope(listScope) : null
  if (scopeForList) ctx.list_scope = scopeForList

  const refs = parseLeapReferences(message, origin)
  if (refs.records.length) {
    ctx.referenced_records = refs.records.map(r => ({ object: r.table, record_id: r.id }))
  }
  if (refs.scopes.length) {
    ctx.referenced_scopes = refs.scopes.map(wireScope).filter(Boolean)
  }
  return Object.keys(ctx).length ? ctx : null
}

// The compact JSON persisted alongside a stored chat turn. Deliberately not
// the whole context: the transcript records WHERE the user was, not the full
// resolution payload.
export function contextForStorage(ctx) {
  if (!ctx) return null
  return {
    object: ctx.object || null,
    record_id: ctx.record_id || null,
    list_scope_parent_id: ctx.list_scope?.parent_id || null,
    list_scope_parent_label: ctx.list_scope?.parent_label || null,
  }
}
