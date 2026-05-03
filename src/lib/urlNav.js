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

// Module IDs that App.jsx knows how to render.
const KNOWN_MODULES = new Set([
  'home', 'outreach', 'qualification', 'field', 'incentives',
  'stock', 'fleet', 'admin', 'portal',
])

/**
 * Parse a pathname into { activeModule, selectedRecord }.
 * Returns null for selectedRecord when the URL doesn't address a record.
 *
 * Examples:
 *   '/'                          → { activeModule: 'home', selectedRecord: null }
 *   '/m/field'                   → { activeModule: 'field', selectedRecord: null }
 *   '/m/field/projects'          → { activeModule: 'field', selectedRecord: null, section: 'projects' }
 *   '/projects/<uuid>'           → { activeModule: 'field', selectedRecord: { table: 'projects', id: <uuid>, mode: 'view' } }
 *   '/work_orders/new'           → { activeModule: 'field', selectedRecord: { table: 'work_orders', id: null, mode: 'create' } }
 *   '/garbage/foo'               → { activeModule: 'home', selectedRecord: null }   ← unknown table, no record-detail attempt
 */
export function parsePath(pathname) {
  const clean = (pathname || '/').replace(/\/+$/, '') || '/'
  const parts = clean.split('/').filter(Boolean)

  // /
  if (parts.length === 0) return { activeModule: 'home', selectedRecord: null, section: null }

  // /m/<module>[/<section>]
  if (parts[0] === 'm') {
    const mod = parts[1]
    if (KNOWN_MODULES.has(mod)) {
      return { activeModule: mod, selectedRecord: null, section: parts[2] || null }
    }
    return { activeModule: 'home', selectedRecord: null, section: null }
  }

  // /<table>/<id>  or  /<table>/new
  if (parts.length === 2) {
    const [table, id] = parts
    const mod = TABLE_MODULE_MAP[table]
    if (!mod) return { activeModule: 'home', selectedRecord: null, section: null }
    if (id === 'new') {
      return { activeModule: mod, selectedRecord: { table, id: null, mode: 'create' }, section: null }
    }
    if (UUID_RE.test(id)) {
      return { activeModule: mod, selectedRecord: { table, id, mode: 'view' }, section: null }
    }
    // Unknown id format — drop to module home rather than 404.
    return { activeModule: mod, selectedRecord: null, section: null }
  }

  // Anything else — fall through to home.
  return { activeModule: 'home', selectedRecord: null, section: null }
}

/**
 * Build a pathname for the given navigation state. Inverse of parsePath.
 */
export function buildPath({ activeModule, selectedRecord, section }) {
  if (selectedRecord?.table) {
    if (selectedRecord.mode === 'create') return `/${selectedRecord.table}/new`
    if (selectedRecord.id) return `/${selectedRecord.table}/${selectedRecord.id}`
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
 *   navigateToModule    — switch active module (clears selectedRecord)
 *   navigateToSection   — switch module section
 *   navigateToRecord    — open a record detail
 *   closeRecord         — close current record (back to module/section)
 *   replaceRecord       — replace current URL without history push (used after
 *                          a successful create transitions create → view)
 *
 * Routes that bypass this hook entirely (handled at the entrypoint or in
 * App.jsx exact-path checks): /sign/* and /auth/outlook-callback.
 */
export function useUrlNavigation() {
  const [state, setState] = useState(() => parsePath(window.location.pathname))

  // popstate fires on browser back/forward. Re-parse and re-hydrate state
  // from the URL — the URL is the source of truth.
  useEffect(() => {
    const onPop = () => setState(parsePath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Internal: push a new URL + sync state. We keep the title slot empty
  // because the document title is owned by the active record/component.
  const push = useCallback((next) => {
    const path = buildPath(next)
    if (path !== window.location.pathname) {
      window.history.pushState(null, '', path)
    }
    setState(next)
  }, [])

  const replace = useCallback((next) => {
    const path = buildPath(next)
    if (path !== window.location.pathname) {
      window.history.replaceState(null, '', path)
    }
    setState(next)
  }, [])

  const navigateToModule = useCallback((moduleId) => {
    push({ activeModule: moduleId, selectedRecord: null, section: null })
  }, [push])

  const navigateToSection = useCallback((sectionId) => {
    setState((prev) => {
      const next = { ...prev, section: sectionId, selectedRecord: null }
      const path = buildPath(next)
      if (path !== window.location.pathname) window.history.pushState(null, '', path)
      return next
    })
  }, [])

  const navigateToRecord = useCallback((rec) => {
    // rec: { table, id, mode, prefill? }
    if (!rec?.table) return
    setState((prev) => {
      const mod = TABLE_MODULE_MAP[rec.table] || prev.activeModule
      const next = { activeModule: mod, selectedRecord: { ...rec }, section: null }
      const path = buildPath(next)
      if (path !== window.location.pathname) window.history.pushState(null, '', path)
      return next
    })
  }, [])

  const closeRecord = useCallback(() => {
    setState((prev) => {
      const next = { activeModule: prev.activeModule, selectedRecord: null, section: prev.section }
      const path = buildPath(next)
      if (path !== window.location.pathname) window.history.pushState(null, '', path)
      return next
    })
  }, [])

  const replaceRecord = useCallback((rec) => {
    setState((prev) => {
      const mod = TABLE_MODULE_MAP[rec?.table] || prev.activeModule
      const next = { activeModule: mod, selectedRecord: rec ? { ...rec } : null, section: null }
      const path = buildPath(next)
      if (path !== window.location.pathname) window.history.replaceState(null, '', path)
      return next
    })
  }, [])

  return {
    activeModule: state.activeModule,
    selectedRecord: state.selectedRecord,
    sectionFromUrl: state.section,
    navigateToModule,
    navigateToSection,
    navigateToRecord,
    closeRecord,
    replaceRecord,
  }
}
