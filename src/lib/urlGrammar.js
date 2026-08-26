/**
 * urlGrammar — the pure grammar of LEAP's URLs.
 *
 * Reading a path into navigation state (parsePath) and writing navigation
 * state back out as a path (buildPath), plus the small codecs the query
 * string uses. No React, no History API, no window — that lives in
 * urlNav.js, which drives this grammar and re-exports it.
 *
 * Split out so the rules can be executed by a fixture. The URL layer had
 * silently stopped resolving half the platform's record pages, and nothing
 * caught it because nothing could import this code without React.
 *
 * URL scheme:
 *   /                              → Home module
 *   /m/<module>                    → Module home tab (e.g. /m/field)
 *   /m/<module>/<section>          → Module section list (e.g. /m/field/projects)
 *   /<table>/<id>                  → Record detail (e.g. /projects/<uuid>)
 *   /<table>/new                   → Create form (e.g. /work_orders/new)
 *   /search?q=<term>&type=<obj>    → Universal search results page
 *   /help[/<slug>]                 → Help center
 *
 * Two routes are reserved and bypass this controller entirely (handled in
 * main.jsx and App.jsx respectively):
 *   /sign/<env_record_number>/<token>   — public signing portal
 *   /auth/outlook-callback              — Outlook OAuth callback page
 *
 * Fixture-tested by scripts/object-nav-fixture.mjs.
 */

import {
  isObjectTableSegment, objectModuleFor, objectListUrlFor, tableForSectionId,
} from './objectNav.js'

// True when a table can be addressed as a record URL root (`/<table>/<id>`).
//
// Every object is addressable. This used to gate on a hand-maintained
// allowlist, and an object missing from it was not merely un-linked — its URL
// stopped resolving, so browser Back, browser Forward, a reload and a shared
// link all fell through to the Home screen. 51 of LEAP's 103 record pages were
// in that state. The check is now syntactic: anything that looks like a table
// and is not a reserved route addresses a record, and an id that turns out not
// to exist is reported by the record loader instead of silently redirecting.
export function isUrlAddressableTable(table) {
  return isObjectTableSegment(table)
}

/**
 * The URL of a table's list view, or null when the object has no list view
 * anywhere in the app.
 *
 * Section ids are NOT the table name for a good number of objects (Field
 * exposes work_orders as "workorders", Enrollment exposes enrollments as
 * "enrollment", Fleet exposes vehicle_activities as "activities"), and
 * building a list URL from the table name landed on a section the module does
 * not declare — which rendered as the module's Home tab. The real section id
 * per object lives in the registry, and objects with no list return null so
 * callers can show a plain label instead of a link that goes nowhere.
 */
export function getTableListUrl(table) {
  if (!table) return null
  return objectListUrlFor(table)
}

/**
 * Build the URL for a related-list "View All" — the target object's list view
 * SCOPED to a single parent record, Salesforce-style (the related-list page
 * shows only the records related to this parent, not the whole object).
 *
 * scope: { table, fk, via, parentId, label }
 *   • table    — target object table (e.g. 'units')
 *   • fk       — the target's FK to the first intermediate (via-path) or the
 *                direct parent FK (e.g. 'building_id' or 'property_id')
 *   • via      — via-chain array for multi-hop related lists (null for direct)
 *   • parentId — the parent record UUID the list is scoped to
 *   • label    — display name of the parent (for the scope banner)
 *
 * The scope rides in a single `rel` query param (compact JSON) so the scoped
 * list is shareable/bookmarkable and survives a reload — parsePath decodes it
 * back into `listScope`. Returns null (caller falls back to the unscoped list
 * URL) when the table isn't addressable or there's nothing to scope on.
 */
export function buildScopedListUrl(scope) {
  if (!scope || !scope.table || !scope.parentId || !scope.fk) return null
  const base = getTableListUrl(scope.table)
  if (!base) return null
  const token = scopeToToken(scope)
  if (!token) return null
  return `${base}?rel=${token}`
}

// The scope rides in the URL as a single compact base64url token rather than
// raw JSON, so the address bar shows `?rel=eyJ0Ijoi…` instead of a wall of
// percent-escaped braces and quotes.
function scopeToToken(scope) {
  if (!scope || !scope.table || !scope.parentId || !scope.fk) return null
  const via = Array.isArray(scope.via)
    ? scope.via.filter(v => v && v.table && v.fk).map(v => ({ table: v.table, fk: v.fk }))
    : (scope.via && scope.via.table && scope.via.fk ? [{ table: scope.via.table, fk: scope.via.fk }] : [])
  const payload = {
    t: scope.table,
    fk: scope.fk,
    via: via.length ? via : null,
    pid: scope.parentId,
    lbl: scope.label || null,
  }
  try {
    return b64urlEncode(JSON.stringify(payload))
  } catch {
    return null
  }
}

// Decode the `rel` query param (see buildScopedListUrl) back into a listScope
// object, or null when absent/malformed. Exported so the assistant can read the
// scope out of a LEAP URL the user pastes into the chat (see assistantContext).
export function decodeListScope(search) {
  const params = new URLSearchParams(search || '')
  const raw = params.get('rel')
  if (!raw) return null
  try {
    const p = JSON.parse(b64urlDecode(raw))
    if (!p || !p.t || !p.pid || !p.fk) return null
    return {
      table: p.t,
      fk: p.fk,
      via: Array.isArray(p.via) && p.via.length ? p.via.filter(v => v && v.table && v.fk) : null,
      parentId: p.pid,
      label: p.lbl || null,
    }
  } catch {
    return null
  }
}

// Re-encode a listScope onto a URLSearchParams as the `rel` param (inverse of
// decodeListScope). No-op when scope is falsy. URLSearchParams won't touch a
// base64url token (its alphabet is URL-safe), so the address bar stays clean.
function encodeListScope(params, scope) {
  const token = scopeToToken(scope)
  if (token) params.set('rel', token)
}

// ── Page-layout editor return target (URL-encoded) ───────────────────────
//
// When the Setup gear opens the page-layout editor FROM a record, the record
// to return to on Close/Save rides in the URL as a compact `ret` token — the
// same base64url scheme as the listScope `rel` token. Unlike the in-memory
// stash (setLayoutReturnRecord below), a URL param survives a page reload and
// an editor re-mount, so the "return to the record" behavior holds up even
// after the admin refreshes the layout editor. Carries only table/id/module —
// the id is a plain record UUID, exactly what a normal record URL already
// exposes, so no new PII lands in the address bar.
function encodeLayoutReturn(ret) {
  if (!ret || !ret.table || !ret.id) return null
  try {
    return b64urlEncode(JSON.stringify({ t: ret.table, id: ret.id, m: ret.module || null }))
  } catch {
    return null
  }
}
function decodeLayoutReturn(search) {
  const params = new URLSearchParams(search || '')
  const raw = params.get('ret')
  if (!raw) return null
  try {
    const p = JSON.parse(b64urlDecode(raw))
    if (!p || !p.t || !p.id) return null
    return { table: p.t, id: p.id, module: p.m || null }
  } catch {
    return null
  }
}

// Unicode-safe base64url (RFC 4648 §5) — the JSON scope may carry a parent
// label with non-ASCII characters, so round-trip through UTF-8 bytes.
function b64urlEncode(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(token) {
  let b64 = token.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  return decodeURIComponent(escape(atob(b64)))
}

/**
 * Resolve the underlying table for a module's current list section. Used by
 * the topbar Setup gear so that, on a list page (no record open), it can still
 * deep-link to that object's setup instead of the generic Setup home, and by
 * the AI assistant to know which object the user is looking at.
 *
 * Modules are Salesforce-style apps over one shared database — the same
 * object's list appears in several modules — so the section resolves to its
 * table regardless of which module is active. A non-object section (a module
 * Home tab, the Outreach map, a dashboard) returns null and the gear falls
 * back to generic Setup.
 */
export function getTableForSection(moduleId, section) {
  return tableForSectionId(moduleId, section)
}

// Regex matching a UUID v4 — the only ID format we accept in record URLs.
// Record-number formats (PROJ-00001, ENV-00002, ...) are NOT accepted here
// because the RecordDetail loader takes a UUID. If we want record-number
// URLs in the future, we'd need an id-resolution step before mounting
// RecordDetail.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Module IDs that App.jsx knows how to render. 'search' is a synthetic
// module — not a navigable item in the sidebar; activated only when the
// user lands on /search?q=... (typically from the search modal's "View
// all results" footer button or a shared link).
const KNOWN_MODULES = new Set([
  'home', 'tasks', 'outreach', 'enrollment', 'qualification', 'field', 'planning', 'implementation', 'dispatch', 'incentives',
  'stock', 'fleet', 'reports', 'admin', 'portal', 'providers', 'search', 'help',
])

/**
 * Parse a pathname (and optional search string) into navigation state.
 * Returns null for selectedRecord when the URL doesn't address a record.
 *
 * Examples:
 *   '/'                          → { activeModule: 'home', selectedRecord: null }
 *   '/m/field'                   → { activeModule: 'field', selectedRecord: null }
 *   '/m/field/projects'          → { activeModule: 'field', selectedRecord: null, section: 'projects' }
 *   '/projects/<uuid>'           → { activeModule: 'field', selectedRecord: { table: 'projects', id: <uuid>, mode: 'view' } }
 *   '/work_orders/new'           → { activeModule: 'field', selectedRecord: { table: 'work_orders', id: null, mode: 'create' } }
 *   '/search?q=willow'           → { activeModule: 'search', searchQuery: 'willow' }
 *   '/search?q=willow&type=project' → { activeModule: 'search', searchQuery: 'willow', searchType: 'project' }
 *   '/garbage/foo'               → { activeModule: 'home', selectedRecord: null }   ← unknown table, no record-detail attempt
 */
export function parsePath(pathname, search = '') {
  const clean = (pathname || '/').replace(/\/+$/, '') || '/'
  const parts = clean.split('/').filter(Boolean)

  // Default empty navigation state — every return path overlays its own
  // fields on top of this so consumers always get the same shape.
  const base = {
    activeModule: 'home',
    selectedRecord: null,
    section: null,
    subsection: null,
    adminTab: null,
    adminLayoutId: null,
    adminLayoutReturn: null,
    searchQuery: null,
    searchType: null,
    helpSlug: null,
    listScope: null,
  }

  // /
  if (parts.length === 0) return base

  // /help                  → help center, no slug → show first article
  // /help/<slug>           → help center, deep-link to specific article
  // Bypasses the module switch so the help center is reachable from
  // anywhere — including external portal subdomains in the future.
  if (parts[0] === 'help') {
    return {
      ...base,
      activeModule: 'help',
      helpSlug: parts[1] || null,
    }
  }

  // /search?q=<term>&type=<object_type>
  // Reads the search string for q/type. type is optional. An empty/missing
  // q still routes to the search page — the page itself handles the empty
  // state by showing the search input and a hint.
  if (parts[0] === 'search') {
    const params = new URLSearchParams(search || '')
    return {
      ...base,
      activeModule: 'search',
      searchQuery: params.get('q') || '',
      searchType: params.get('type') || null,
    }
  }

  // /m/<module>[/<section>[/<subsection>]]
  // Examples:
  //   /m/field/projects              → { section: 'projects' }
  //   /m/admin/objects/properties    → { section: 'objects', subsection: 'properties' }
  // Subsection is consumed by modules that need a finer routing tier — today
  // only Admin's Object Manager (which needs the specific table the user is
  // viewing) so that browser-back lands on the manager list rather than home.
  if (parts[0] === 'm') {
    // Legacy slug aliases so old bookmarks resolve. /m/prospecting and the
    // retired /m/outreach_properties both now map to the Outreach app at
    // /m/outreach. (The Enrollment app, formerly at the 'outreach' id, now
    // lives at /m/enrollment; bare /m/outreach now correctly resolves to the
    // Outreach app.)
    let mod = parts[1]
    if (mod === 'prospecting' || mod === 'outreach_properties') mod = 'outreach'
    if (KNOWN_MODULES.has(mod) && mod !== 'search' && mod !== 'help') {
      // ?tab=<id> carries an admin-module sub-tab hint (used by ObjectDetail's
      // initialSubTab). ?layout=<uuid> carries a layout-id hint so the
      // Page Layouts sub-tab can open the specific layout's editor directly.
      const params = new URLSearchParams(search || '')
      return {
        ...base,
        activeModule: mod,
        section: parts[2] || null,
        subsection: parts[3] || null,
        adminTab: params.get('tab') || null,
        adminLayoutId: params.get('layout') || null,
        // The record (if any) the page-layout editor should return to on
        // Close/Save — encoded in the URL so it survives a reload or a
        // re-mount, unlike the in-memory stash below. See decodeLayoutReturn.
        adminLayoutReturn: decodeLayoutReturn(search),
        // A related-list "View All" scopes the section's list to one parent.
        listScope: decodeListScope(search),
      }
    }
    return base
  }

  // /<table>/<id>  or  /<table>/new
  //
  // Any object table resolves here. This used to require the table to appear
  // in a hand-maintained allowlist and returned the HOME module when it did
  // not — so for the 51 objects missing from that list (work steps, work
  // plans, photos, documents, activities, price books, …) the URL was written
  // to the address bar correctly by an in-app click but could never be read
  // back. Browser Back, browser Forward, a reload and a shared link therefore
  // all landed on the Home screen, and the record the user was looking at was
  // gone. The module is now resolved from the object registry, which always
  // answers, so the record survives the round trip for every object.
  if (parts.length === 2) {
    const [table, id] = parts
    if (!isObjectTableSegment(table)) return base
    const mod = objectModuleFor(table)
    if (id === 'new') {
      return { ...base, activeModule: mod, selectedRecord: { table, id: null, mode: 'create' } }
    }
    if (UUID_RE.test(id)) {
      return { ...base, activeModule: mod, selectedRecord: { table, id, mode: 'view' } }
    }
    // Unknown id format — drop to module home rather than 404.
    return { ...base, activeModule: mod }
  }

  // Anything else — fall through to home.
  return base
}

/**
 * Build a pathname (+ optional search string) for the given navigation
 * state. Inverse of parsePath. Returns the full path including any query
 * string the search route needs.
 */
export function buildPath({ activeModule, selectedRecord, section, subsection, adminTab, adminLayoutId, adminLayoutReturn, searchQuery, searchType, helpSlug, listScope }) {
  if (selectedRecord?.table) {
    if (selectedRecord.mode === 'create') return `/${selectedRecord.table}/new`
    if (selectedRecord.id) return `/${selectedRecord.table}/${selectedRecord.id}`
  }
  if (activeModule === 'help') {
    return helpSlug ? `/help/${helpSlug}` : '/help'
  }
  if (activeModule === 'search') {
    const params = new URLSearchParams()
    if (searchQuery) params.set('q', searchQuery)
    if (searchType) params.set('type', searchType)
    const qs = params.toString()
    return qs ? `/search?${qs}` : '/search'
  }
  let base
  if (section && subsection) base = `/m/${activeModule}/${section}/${subsection}`
  else if (section)          base = `/m/${activeModule}/${section}`
  else if (activeModule && activeModule !== 'home') base = `/m/${activeModule}`
  else return '/'
  const params = new URLSearchParams()
  if (adminTab) params.set('tab', adminTab)
  if (adminLayoutId) params.set('layout', adminLayoutId)
  const retToken = encodeLayoutReturn(adminLayoutReturn)
  if (retToken) params.set('ret', retToken)
  encodeListScope(params, listScope)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

