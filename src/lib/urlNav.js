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
  service_appointments: 'field',
  service_appointment_assignments: 'field',
  resource_absences: 'field',
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
  // Field — dispatcher follow-up queue (captured leads from public scheduling
  // pages when auto-scheduling hit a dead-end — out_of_territory etc.)
  dispatcher_followup_requests: 'field',
  // Tasks (global to-do queue)
  tasks: 'tasks',
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
  page_layouts: 'admin',
  skills: 'admin',
  users: 'admin',
  project_report_templates: 'admin',
  project_report_template_sections: 'admin',
  project_report_template_record_type_assignments: 'admin',
  project_report_template_snapshots: 'admin',
  // Portal
  portal_users: 'portal',
  // Reports & Dashboards
  reports: 'reports',
  report_folders: 'reports',
  report_filters: 'reports',
  report_groupings: 'reports',
  report_calculated_fields: 'reports',
  scheduled_reports: 'reports',
  scheduled_report_runs: 'reports',
  dashboards: 'reports',
  dashboard_folders: 'reports',
  dashboard_widgets: 'reports',
  dashboard_filters: 'reports',
  dashboard_folder_user_shares: 'reports',
  dashboard_folder_role_shares: 'reports',
}

// Some module sections drop or change the table name — e.g. the Field
// module exposes work_orders under section id "workorders" (no underscore),
// time_sheets under "timesheets", and resource_absences under "absences".
// When wiring a related-list "View All" link to a list view we look up the
// section here first, then fall back to the table name.
const TABLE_LIST_SECTION_MAP = {
  work_orders: 'workorders',
  time_sheets: 'timesheets',
  resource_absences: 'absences',
}

/**
 * Compute the URL of a table's list view, if one is reachable.
 * Returns null when the table isn't mapped to a module.
 */
export function getTableListUrl(table) {
  if (!table) return null
  const moduleId = TABLE_MODULE_MAP[table]
  if (!moduleId) return null
  const section = TABLE_LIST_SECTION_MAP[table] || table
  return `/m/${moduleId}/${section}`
}

// Reverse of TABLE_LIST_SECTION_MAP — section id back to its table name for
// the handful of sections whose id differs from the table.
const SECTION_TABLE_MAP = Object.fromEntries(
  Object.entries(TABLE_LIST_SECTION_MAP).map(([table, section]) => [section, table])
)

/**
 * Resolve the underlying table for a module's current list section. Used by
 * the topbar Setup gear so that, on a list page (no record open), it can still
 * deep-link to that object's setup instead of the generic Setup home.
 *
 * Sections whose id equals the table name resolve directly; the few that
 * differ (workorders→work_orders, etc.) come from SECTION_TABLE_MAP. The
 * candidate is validated against TABLE_MODULE_MAP for the active module, so a
 * non-object section (e.g. a module "home" or dashboard tab) returns null and
 * the gear falls back to generic Setup.
 */
export function getTableForSection(moduleId, section) {
  if (!moduleId || !section) return null
  const candidate = SECTION_TABLE_MAP[section] || section
  if (TABLE_MODULE_MAP[candidate] === moduleId) return candidate
  return null
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
  'home', 'tasks', 'outreach', 'prospecting', 'qualification', 'field', 'planning', 'implementation', 'dispatch', 'incentives',
  'stock', 'fleet', 'reports', 'admin', 'portal', 'search', 'help',
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
    searchQuery: null,
    searchType: null,
    helpSlug: null,
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
    const mod = parts[1]
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
      }
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
export function buildPath({ activeModule, selectedRecord, section, subsection, adminTab, adminLayoutId, searchQuery, searchType, helpSlug }) {
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
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
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
    push({ activeModule: moduleId, selectedRecord: null, section: null, subsection: null, searchQuery: null, searchType: null })
  }, [push])

  const navigateToSection = useCallback((sectionId) => {
    setState((prev) => {
      const next = { ...prev, section: sectionId, subsection: null, selectedRecord: null, searchQuery: null, searchType: null }
      const path = buildPath(next)
      if (path !== currentFullPath()) window.history.pushState(null, '', path)
      return next
    })
  }, [])

  // Push the third URL tier — e.g. /m/admin/objects/<table-name>. Lets the
  // Admin Object Manager record which object you're drilled into so the
  // browser back button takes you up one level (objects list) rather than
  // all the way home. Pass null to clear the subsection (return to section
  // list view).
  const navigateToSubsection = useCallback((subsectionId) => {
    setState((prev) => {
      const next = { ...prev, subsection: subsectionId || null, selectedRecord: null, searchQuery: null, searchType: null }
      const path = buildPath(next)
      if (path !== currentFullPath()) window.history.pushState(null, '', path)
      return next
    })
  }, [])

  // navigateToSetup is for the global Setup gear-icon menu in the topbar.
  // Forces activeModule='admin' regardless of where the user currently is.
  //
  // Args:
  //   nodeId       — the SetupHome node or section to land on (e.g. 'objects',
  //                  'page_layouts', 'record_types'). Pass null for /m/admin
  //                  (Setup Home with no node selected).
  //   subsectionId — third URL tier. For Object Manager, this is the table
  //                  name so the user lands on /m/admin/objects/<table>.
  //   options.initialSubTab — appended to the URL as ?tab=<id>. Consumed
  //                  by ObjectDetail to pre-select a sub-tab (e.g.
  //                  'recordtypes' for the Edit Record Types deep-link).
  const navigateToSetup = useCallback((nodeId, subsectionId = null, options = {}) => {
    const next = {
      activeModule: 'admin',
      selectedRecord: null,
      section: nodeId || null,
      subsection: subsectionId || null,
      adminTab: options.initialSubTab || null,
      adminLayoutId: options.initialLayoutId || null,
      searchQuery: null,
      searchType: null,
    }
    const path = buildPath(next)
    if (path !== currentFullPath()) window.history.pushState(null, '', path)
    setState(next)
  }, [])

  const navigateToRecord = useCallback((rec) => {
    // rec: { table, id, mode, prefill? }
    if (!rec?.table) return
    setState((prev) => {
      const mod = TABLE_MODULE_MAP[rec.table] || prev.activeModule
      const next = { activeModule: mod, selectedRecord: { ...rec }, section: null, subsection: null, searchQuery: null, searchType: null }
      const path = buildPath(next)
      if (path !== currentFullPath()) window.history.pushState(null, '', path)
      return next
    })
  }, [])

  // Open the universal search results page. Called from the search
  // modal's "View all results" footer button and any deep-link sources.
  const navigateToSearch = useCallback((query, typeFilter = null, { useReplace = false } = {}) => {
    const next = {
      activeModule: 'search',
      selectedRecord: null,
      section: null,
      subsection: null,
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
      const next = { activeModule: prev.activeModule, selectedRecord: null, section: prev.section, subsection: prev.subsection, searchQuery: null, searchType: null }
      const path = buildPath(next)
      if (path !== currentFullPath()) window.history.pushState(null, '', path)
      return next
    })
  }, [])

  const replaceRecord = useCallback((rec) => {
    setState((prev) => {
      const mod = TABLE_MODULE_MAP[rec?.table] || prev.activeModule
      const next = { activeModule: mod, selectedRecord: rec ? { ...rec } : null, section: null, subsection: null, searchQuery: null, searchType: null }
      const path = buildPath(next)
      if (path !== currentFullPath()) window.history.replaceState(null, '', path)
      return next
    })
  }, [])

  return {
    activeModule: state.activeModule,
    selectedRecord: state.selectedRecord,
    sectionFromUrl: state.section,
    subsectionFromUrl: state.subsection,
    adminTabFromUrl: state.adminTab,
    adminLayoutIdFromUrl: state.adminLayoutId,
    searchQuery: state.searchQuery,
    searchType: state.searchType,
    helpSlug: state.helpSlug,
    navigateToModule,
    navigateToSection,
    navigateToSubsection,
    navigateToSetup,
    navigateToRecord,
    navigateToSearch,
    closeRecord,
    replaceRecord,
  }
}
