/**
 * URL navigation — Salesforce-style addressable records.
 *
 * Goal: every record has a stable shareable URL. A user can copy the URL
 * from the address bar, paste it to a coworker, and the coworker lands on
 * the same record after signing in.
 *
 * URL scheme:
 *   /                              → Home module
 *   /m/<module>                    → Module home tab (e.g. /m/field)
 *   /m/<module>/<section>          → Module section list (e.g. /m/field/projects)
 *   /<table>/<id>                  → Record detail (e.g. /projects/<uuid>)
 *   /<table>/new                   → Create form (e.g. /work_orders/new)
 *   /search?q=<term>&type=<obj>    → Universal search results page (full
 *                                    grouped view, like Salesforce search
 *                                    results). type= is optional and filters
 *                                    to a single object_type.
 *
 * The module is implied by the table on record URLs — TABLE_MODULE_MAP
 * tells the App which module to activate when a user opens a deep link.
 *
 * Two routes are reserved and bypass this controller (handled in main.jsx
 * and App.jsx respectively):
 *   /sign/<env_record_number>/<token>   — public signing portal
 *   /auth/outlook-callback              — Outlook OAuth callback page
 */

import { useState, useEffect, useCallback } from 'react'

// Map of record-detail tables to their owning module. Mirrors TABLE_META
// in RecordDetail.jsx but only includes tables we expose as URL roots.
// Tables not in this map fall through to /m/<module> when opened.
//
// NB: this is the SOURCE OF TRUTH for "which module owns which table" in
// the URL layer. RecordDetail.TABLE_META has the same info but is keyed
// for display purposes — keep them aligned when adding new objects.
const TABLE_MODULE_MAP = {
  // Outreach
  accounts: 'outreach',
  contacts: 'outreach',
  account_contact_relations: 'outreach',
  properties: 'outreach',
  buildings: 'outreach',
  units: 'outreach',
  opportunities: 'outreach',
  property_programs: 'outreach',
  // Field
  projects: 'field',
  work_orders: 'field',
  envelopes: 'field',
  envelope_recipients: 'field',
  envelope_tabs: 'field',
  envelope_events: 'field',
  // Qualification
  assessments: 'qualification',
  incentive_applications: 'qualification',
  efr_reports: 'qualification',
  // Incentives
  project_payment_requests: 'incentives',
  payment_receipts: 'incentives',
  // Stock
  products: 'stock',
  product_items: 'stock',
  materials_requests: 'stock',
  equipment: 'stock',
  // Fleet
  vehicles: 'fleet',
  vehicle_activities: 'fleet',
  equipment_containers: 'fleet',
  // Field — people-related (Field module exposes Technicians/Credentials/Time Sheets)
  contact_skills: 'field',
  time_sheets: 'field',
  // Admin
  programs: 'admin',
  work_types: 'admin',
  work_type_skill_requirements: 'admin',
  email_templates: 'admin',
  document_templates: 'admin',
  document_template_snapshots: 'admin',
  automation_rules: 'admin',
  validation_rules: 'admin',
  roles: 'admin',
  picklist_values: 'admin',
  skills: 'admin',
  users: 'admin',
  project_report_templates: 'admin',
  project_report_template_sections: 'admin',
  project_report_template_record_type_assignments: 'admin',
  project_report_template_snapshots: 'admin',
  // Portal
  portal_users: 'portal',
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
  'home', 'outreach', 'qualification', 'field', 'incentives',
  'stock', 'fleet', 'admin', 'portal', 'search',
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
    searchQuery: null,
    searchType: null,
  }

  // /
  if (parts.length === 0) return base

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

  // /m/<module>[/<section>]
  if (parts[0] === 'm') {
    const mod = parts[1]
    if (KNOWN_MODULES.has(mod) && mod !== 'search') {
      return { ...base, activeModule: mod, section: parts[2] || null }
    }
    return base
  }

  // /<table>/<id>  or  /<table>/new
  if (parts.length === 2) {
    const [table, id] = parts
    const mod = TABLE_MODULE_MAP[table]
    if (!mod) return base
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
export function buildPath({ activeModule, selectedRecord, section, searchQuery, searchType }) {
  if (selectedRecord?.table) {
    if (selectedRecord.mode === 'create') return `/${selectedRecord.table}/new`
    if (selectedRecord.id) return `/${selectedRecord.table}/${selectedRecord.id}`
  }
  if (activeModule === 'search') {
    const params = new URLSearchParams()
    if (searchQuery) params.set('q', searchQuery)
    if (searchType) params.set('type', searchType)
    const qs = params.toString()
    return qs ? `/search?${qs}` : '/search'
  }
  if (section) return `/m/${activeModule}/${section}`
  if (activeModule && activeModule !== 'home') return `/m/${activeModule}`
  return '/'
}

/**
 * Hook: bidirectional sync between window.location and React state.
 *
 * Returns:
 *   activeModule        — current module ID
 *   selectedRecord      — { table, id, mode, prefill } | null
 *   sectionFromUrl      — the section from /m/<mod>/<section>, if any (modules
 *                          can use this to set their internal sec on first
 *                          mount; subsequent section changes are pushed via
 *                          navigateToSection)
 *   searchQuery         — the q= param when on /search
 *   searchType          — the type= param when on /search (object_type filter)
 *   navigateToModule    — switch active module (clears selectedRecord)
 *   navigateToSection   — switch module section
 *   navigateToRecord    — open a record detail
 *   navigateToSearch    — open the universal search results page
 *   closeRecord         — close current record (back to module/section)
 *   replaceRecord       — replace current URL without history push (used after
 *                          a successful create transitions create → view)
 *
 * Routes that bypass this hook entirely (handled at the entrypoint or in
 * App.jsx exact-path checks): /sign/* and /auth/outlook-callback.
 */
export function useUrlNavigation() {
  const [state, setState] = useState(() => parsePath(window.location.pathname, window.location.search))

  // popstate fires on browser back/forward. Re-parse and re-hydrate state
  // from the URL — the URL is the source of truth.
  useEffect(() => {
    const onPop = () => setState(parsePath(window.location.pathname, window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Compare a target path (which may include ?queryString) against the
  // current full URL. We must include search here because /search?q=foo
  // and /search?q=bar share the same pathname — comparing pathname only
  // would skip the pushState and the URL bar would lie.
  const currentFullPath = () => window.location.pathname + window.location.search

  // Internal: push a new URL + sync state. We keep the title slot empty
  // because the document title is owned by the active record/component.
  const push = useCallback((next) => {
    const path = buildPath(next)
    if (path !== currentFullPath()) {
      window.history.pushState(null, '', path)
    }
    setState(next)
  }, [])

  const replace = useCallback((next) => {
    const path = buildPath(next)
    if (path !== currentFullPath()) {
      window.history.replaceState(null, '', path)
    }
    setState(next)
  }, [])

  const navigateToModule = useCallback((moduleId) => {
    push({ activeModule: moduleId, selectedRecord: null, section: null, searchQuery: null, searchType: null })
  }, [push])

  const navigateToSection = useCallback((sectionId) => {
    setState((prev) => {
      const next = { ...prev, section: sectionId, selectedRecord: null, searchQuery: null, searchType: null }
      const path = buildPath(next)
      if (path !== currentFullPath()) window.history.pushState(null, '', path)
      return next
    })
  }, [])

  const navigateToRecord = useCallback((rec) => {
    // rec: { table, id, mode, prefill? }
    if (!rec?.table) return
    setState((prev) => {
      const mod = TABLE_MODULE_MAP[rec.table] || prev.activeModule
      const next = { activeModule: mod, selectedRecord: { ...rec }, section: null, searchQuery: null, searchType: null }
      const path = buildPath(next)
      if (path !== currentFullPath()) window.history.pushState(null, '', path)
      return next
    })
  }, [])

  // Open the universal search results page. Called from the search
  // modal's "View all results" footer button and any deep-link sources.
  // typeFilter is optional — pass null/undefined to show all object types.
  // useReplace=true rewrites the current URL instead of pushing a new
  // history entry; the search page uses this for in-page query refinement
  // so the back button doesn't accumulate one entry per keystroke.
  const navigateToSearch = useCallback((query, typeFilter = null, { useReplace = false } = {}) => {
    const next = {
      activeModule: 'search',
      selectedRecord: null,
      section: null,
      searchQuery: query || '',
      searchType: typeFilter || null,
    }
    const path = buildPath(next)
    if (path !== currentFullPath()) {
      if (useReplace) window.history.replaceState(null, '', path)
      else            window.history.pushState(null, '', path)
    }
    setState(next)
  }, [])

  const closeRecord = useCallback(() => {
    setState((prev) => {
      const next = { activeModule: prev.activeModule, selectedRecord: null, section: prev.section, searchQuery: null, searchType: null }
      const path = buildPath(next)
      if (path !== currentFullPath()) window.history.pushState(null, '', path)
      return next
    })
  }, [])

  const replaceRecord = useCallback((rec) => {
    setState((prev) => {
      const mod = TABLE_MODULE_MAP[rec?.table] || prev.activeModule
      const next = { activeModule: mod, selectedRecord: rec ? { ...rec } : null, section: null, searchQuery: null, searchType: null }
      const path = buildPath(next)
      if (path !== currentFullPath()) window.history.replaceState(null, '', path)
      return next
    })
  }, [])

  return {
    activeModule: state.activeModule,
    selectedRecord: state.selectedRecord,
    sectionFromUrl: state.section,
    searchQuery: state.searchQuery,
    searchType: state.searchType,
    navigateToModule,
    navigateToSection,
    navigateToRecord,
    navigateToSearch,
    closeRecord,
    replaceRecord,
  }
}
