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
 * The module is implied by the table on record URLs — the object registry
 * in objectNav.js tells the App which module to activate on a deep link.
 * In-app record navigation (global search, related lists, lookups) does
 * NOT switch modules: the user stays in whatever module they're in and the
 * record renders there, Salesforce-style. Surfaces that can't host a
 * record (Home, Dispatch, Providers, Search, Help) send the user back to
 * the last workspace module they were in; the registry is only the
 * fallback for cold loads and fresh sessions. See resolveRecordModule.
 *
 * Two routes are reserved and bypass this controller (handled in main.jsx
 * and App.jsx respectively):
 *   /sign/<env_record_number>/<token>   — public signing portal
 *   /auth/outlook-callback              — Outlook OAuth callback page
 */

import { useState, useEffect, useCallback } from 'react'
import { createNavTrail } from './navTrail'
import { objectModuleFor } from './objectNav.js'
// The pure URL grammar. Re-exported below so every existing import of
// parsePath / buildPath / getTableListUrl / getTableForSection /
// buildScopedListUrl / isUrlAddressableTable from this module keeps working.
// getTableListUrl is imported (not just re-exported) because closeRecord
// USES it below: `export { x } from './y'` forwards the name to this module's
// consumers without binding it in this module's own scope, so calling it here
// off the re-export alone throws "getTableListUrl is not defined" — which is
// exactly what happened to every record close with no in-page history behind
// it (a deep link, a bookmark, a fresh tab, and the screen right after a
// delete). Guarded by scripts/reexport-binding-fixture.mjs.
import { parsePath, buildPath, getTableListUrl } from './urlGrammar.js'

export {
  parsePath, buildPath, isUrlAddressableTable, getTableListUrl,
  getTableForSection, buildScopedListUrl,
} from './urlGrammar.js'

// Modules that render a record detail surface from the selectedRecord nav
// prop (they pass it straight into the generic RecordDetail). Opening a
// record while one of these is active keeps the user in place instead of
// switching to the table's owning module — Salesforce behavior: apps are
// navigation chrome, records are global. Modules NOT listed (home, dispatch,
// providers have no record-detail surface; search and help are synthetic
// pages) can't display a record, so record-opens from them go to the last
// hosting module the user was in, then fall back to the object registry —
// the same resolution a cold deep link uses in parsePath.
/** True when a module renders a record-detail surface. */
export function isRecordHostingModule(moduleId) {
  return RECORD_HOSTING_MODULES.has(moduleId)
}

const RECORD_HOSTING_MODULES = new Set([
  'tasks', 'enrollment', 'outreach', 'qualification', 'field', 'planning',
  'implementation', 'incentives', 'stock', 'fleet', 'reports', 'admin',
  'portal',
])

// The last record-hosting module the user was in — their "workspace".
// Updated by useUrlNavigation whenever the active module is one that can
// host a record. Lets a record open from a surface with no record detail
// (Home, the /search results page, Dispatch, Providers) return the user to
// the workspace they were last working in rather than the record's owning
// module. Module-scoped rather than URL state: a cold-loaded deep link has
// no workspace history and falls back to the object registry.
let lastHostingModule = null

// Which module should be active after opening a record. Stay in the current
// module when it can host a record; from a non-hosting surface (Home,
// search results, Dispatch, Providers), return to the last workspace the
// user was in; otherwise (cold deep links, fresh sessions) use the table's
// owning module.
function resolveRecordModule(table, currentModule) {
  if (RECORD_HOSTING_MODULES.has(currentModule)) return currentModule
  if (RECORD_HOSTING_MODULES.has(lastHostingModule)) return lastHostingModule
  return objectModuleFor(table)
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
// ── Create-prefill stash ────────────────────────────────────────────────
//
// The URL is the source of truth for navigation, and a create URL is just
// "/<table>/new" — it carries NO field values (FKs/PII must never go in the
// URL). But a related-list "New" needs to hand the create form the parent
// context (e.g. project_id and the resolved opportunity/property/building
// chain) so the new child is pre-populated. That object cannot ride in the
// URL, so any time state is (re)derived from the URL — popstate, or the
// URL-is-truth reconciliation — the prefill is lost and the form opens blank.
//
// This module-scoped stash bridges that gap for EVERY object, not just one:
//   • navigateToRecord({mode:'create', prefill}) writes the prefill here,
//     keyed by the create target ("<table>/new").
//   • Whenever a create selectedRecord is produced from the URL, we re-attach
//     the stashed prefill for that exact key.
// It is single-use per key: consumed (cleared) once the matching create
// record has been hydrated, so a later blank "/<table>/new" stays blank.
let pendingPrefill = null   // { key: '<table>/new', prefill: {...} }

const prefillKeyFor = (rec) =>
  rec && rec.mode === 'create' && rec.table ? `${rec.table}/new` : null

// Re-attach a stashed prefill onto a URL-derived nav state, if one matches.
// Does not clear the stash — clearing happens after the create record is
// actually mounted (consumePendingPrefill), so a re-render that re-parses the
// URL before mount doesn't drop it.
function attachPendingPrefill(navState) {
  const rec = navState?.selectedRecord
  const key = prefillKeyFor(rec)
  if (key && pendingPrefill && pendingPrefill.key === key && !rec.prefill) {
    return { ...navState, selectedRecord: { ...rec, prefill: pendingPrefill.prefill } }
  }
  return navState
}

// ── Page-layout editor return target ────────────────────────────────────
//
// When the Setup gear opens the page layout editor from a record, we remember
// that record (and the module it was viewed in) so that saving — or closing —
// the layout returns the user to it, Salesforce-style, instead of stranding
// them in Object Manager where they have to hit Back. Module-scoped and
// single-use: consumed when the editor mounts. The gear sets it to null when
// opened off a record page, so a stale target never sends the user somewhere
// unexpected.
let pendingLayoutReturn = null

export function setLayoutReturnRecord(rec) {
  pendingLayoutReturn = (rec && rec.table && rec.id)
    ? { table: rec.table, id: rec.id, module: rec.module || null }
    : null
}

export function consumeLayoutReturnRecord() {
  const r = pendingLayoutReturn
  pendingLayoutReturn = null
  return r
}

// ── In-page navigation trail ────────────────────────────────────────────
//
// Where the user has been, so leaving a record goes BACK to it. The trail
// itself is a pure module (src/lib/navTrail.js); this file owns the History
// API calls and keeps the two in step. See navTrail.js for why a record URL
// can't carry this context itself.
const navTrail = createNavTrail()

// history.state is per-entry and survives a reload, so the index stamped here
// is what lets a Back land on the right trail entry.
function stampedState() {
  return { leap: { i: navTrail.index } }
}

// Push a sub-URL belonging to the SAME screen as the current entry — a record's
// ?tab=. Browser Back still steps through tabs; leaving the record steps over
// them in one go.
export function pushRecordSubPath(path) {
  navTrail.pushSub(path)
  window.history.pushState(stampedState(), '', path)
}

export function useUrlNavigation() {
  const [state, setState] = useState(() =>
    attachPendingPrefill(parsePath(window.location.pathname, window.location.search)))

  // popstate fires on browser back/forward. Re-parse and re-hydrate state
  // from the URL — the URL is the source of truth. Re-attach any stashed
  // prefill so a create form reached via history navigation still carries
  // its parent context.
  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname + window.location.search
      const parsed = parsePath(window.location.pathname, window.location.search)
      // The URL stays the source of truth for WHICH record/page this is; the
      // trail only restores what the URL can't carry — the module and section
      // the user was browsing in when they were last on this entry.
      setState(attachPendingPrefill(navTrail.restore(window.history.state?.leap?.i, path, parsed)))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Track the user's workspace — the last record-hosting module they were
  // in — so record opens from non-hosting surfaces (Home, search results,
  // Dispatch, Providers) can return them there. Covers every way the module
  // can change: sidebar clicks, record opens, popstate, initial load.
  useEffect(() => {
    if (RECORD_HOSTING_MODULES.has(state.activeModule)) {
      lastHostingModule = state.activeModule
    }
  }, [state.activeModule])

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
      navTrail.push(next, path)
      window.history.pushState(stampedState(), '', path)
    } else {
      navTrail.replace(next, path)
    }
    setState(next)
  }, [])

  const replace = useCallback((next) => {
    const path = buildPath(next)
    navTrail.replace(next, path)
    if (path !== currentFullPath()) {
      window.history.replaceState(stampedState(), '', path)
    }
    setState(next)
  }, [])

  // Switch modules. An optional sectionId lands the user directly on that
  // module's section (e.g. Incentives → Project Payment Requests) instead of
  // its Home tab, so a cross-module "View All" link resolves to the list it
  // names rather than dumping the user on a dashboard. Omitted → module home,
  // exactly as before.
  const navigateToModule = useCallback((moduleId, sectionId = null) => {
    pendingPrefill = null
    pendingLayoutReturn = null
    push({ activeModule: moduleId, selectedRecord: null, section: sectionId || null, subsection: null, searchQuery: null, searchType: null })
  }, [push])

  const navigateToSection = useCallback((sectionId) => {
    pendingPrefill = null
    setState((prev) => {
      const next = { ...prev, section: sectionId, subsection: null, selectedRecord: null, searchQuery: null, searchType: null }
      const path = buildPath(next)
      if (path !== currentFullPath()) {
        navTrail.push(next, path)
        window.history.pushState(stampedState(), '', path)
      } else {
        navTrail.replace(next, path)
      }
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
      if (path !== currentFullPath()) {
        navTrail.push(next, path)
        window.history.pushState(stampedState(), '', path)
      } else {
        navTrail.replace(next, path)
      }
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
  //   options.initialModule — appended to the URL as ?tab=<module-id>. Consumed
  //                  by ModuleSectionsPane to pre-select a module (the Edit
  //                  Module deep-link from the topbar gear).
  const navigateToSetup = useCallback((nodeId, subsectionId = null, options = {}) => {
    const next = {
      activeModule: 'admin',
      selectedRecord: null,
      section: nodeId || null,
      subsection: subsectionId || null,
      adminTab: options.initialSubTab || options.initialModule || null,
      adminLayoutId: options.initialLayoutId || null,
      // The page-layout editor's return-to-record target, carried in the URL
      // (?ret=) so it survives a reload / editor re-mount. Set by the Setup
      // gear when Edit Page Layout is opened from a record.
      adminLayoutReturn: options.layoutReturn || null,
      searchQuery: null,
      searchType: null,
    }
    const path = buildPath(next)
    if (path !== currentFullPath()) {
      navTrail.push(next, path)
      window.history.pushState(stampedState(), '', path)
    } else {
      navTrail.replace(next, path)
    }
    setState(next)
  }, [])

  const navigateToRecord = useCallback((rec) => {
    // rec: { table, id, mode, prefill? }
    if (!rec?.table) return
    // Stash any create-prefill so it survives the URL round-trip. The URL we
    // push ("/<table>/new") can't carry it; attachPendingPrefill re-attaches
    // it whenever this create record is re-derived from the URL.
    const key = prefillKeyFor(rec)
    if (key && rec.prefill && Object.keys(rec.prefill).length > 0) {
      pendingPrefill = { key, prefill: rec.prefill }
    }
    setState((prev) => {
      // An explicit, record-hosting module override (the page-layout editor
      // returning the user to the exact module + record they came from) wins
      // over the stay-in-current-module default — otherwise saving a layout
      // from Admin would reopen the record still inside the Admin app.
      const forced = rec.module
      const mod = (forced && RECORD_HOSTING_MODULES.has(forced))
        ? forced
        : resolveRecordModule(rec.table, prev.activeModule)
      // Remember which section we came from so closing the record returns to
      // that list's URL — but only when staying in the same module
      // (a cross-module open can't keep the prior module's section).
      const keepSection = mod === prev.activeModule
      // `module` is a navigation hint only — never let it leak into the
      // selectedRecord state (buildPath ignores it, but keep state clean).
      const { module: _forcedModule, ...recFields } = rec
      const next = { activeModule: mod, selectedRecord: { ...recFields },
        section: keepSection ? prev.section : null,
        subsection: keepSection ? prev.subsection : null,
        searchQuery: null, searchType: null }
      const path = buildPath(next)
      if (path !== currentFullPath()) {
        navTrail.push(next, path)
        window.history.pushState(stampedState(), '', path)
      } else {
        navTrail.replace(next, path)
      }
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
      if (useReplace) {
        navTrail.replace(next, path)
        window.history.replaceState(stampedState(), '', path)
      } else {
        navTrail.push(next, path)
        window.history.pushState(stampedState(), '', path)
      }
    } else {
      navTrail.replace(next, path)
    }
    setState(next)
  }, [])

  // Leaving a record goes BACK to the screen the user came from — the property,
  // the opportunity, the list they were browsing — not forward to a fresh list
  // page. That's what the breadcrumb and the mobile back arrow mean, and it's
  // what the browser's own Back does, so the two now agree instead of the app
  // pushing yet another entry the user then has to back out of.
  //
  // history.back() (rather than pushing the previous path) keeps the history
  // stack honest: the record is left behind instead of buried under a new
  // entry. Entries belonging to the record being closed — its own ?tab= URLs —
  // are stepped over in one go.
  //
  // With no in-page history to go back to (a deep link, a bookmark, a fresh
  // tab) there is nothing behind us, so fall back to the record's own object
  // list — never the module's Home page, which is where a null section used to
  // dump the user.
  const closeRecord = useCallback(() => {
    pendingPrefill = null   // leaving any record clears a pending create-prefill
    const steps = navTrail.stepsBackToPreviousScreen()
    if (steps > 0) {
      window.history.go(-steps)   // popstate handler re-derives state
      return
    }
    setState((prev) => {
      const table = prev.selectedRecord?.table || null
      const listPath = table ? getTableListUrl(table) : null
      const next = {
        activeModule: prev.activeModule,
        selectedRecord: null,
        section: prev.section,
        subsection: prev.subsection,
        searchQuery: null,
        searchType: null,
      }
      // Prefer the section we already know; otherwise derive the object's own
      // list from the table so we land on a list, not the module home tab.
      if (!next.section && listPath) {
        const parsedList = parsePath(listPath)
        next.activeModule = parsedList.activeModule || next.activeModule
        next.section = parsedList.section
      }
      const path = buildPath(next)
      if (path !== currentFullPath()) {
        navTrail.push(next, path)
        window.history.pushState(stampedState(), '', path)
      } else {
        navTrail.replace(next, path)
      }
      return next
    })
  }, [])

  const replaceRecord = useCallback((rec) => {
    // Clear a consumed prefill only when this replace is NOT itself carrying a
    // fresh create-prefill. ProjectPlanning/Implementation route related-list
    // creates through replaceRecord, so a blanket clear here would wipe the
    // prefill before the create form mounts. A create rec with its own prefill
    // re-stashes below; a view transition (post-save) clears.
    const key = prefillKeyFor(rec)
    if (key && rec.prefill && Object.keys(rec.prefill).length > 0) {
      pendingPrefill = { key, prefill: rec.prefill }
    } else {
      pendingPrefill = null
    }
    setState((prev) => {
      const mod = rec?.table
        ? resolveRecordModule(rec.table, prev.activeModule)
        : prev.activeModule
      const keepSection = mod === prev.activeModule
      const next = { activeModule: mod, selectedRecord: rec ? { ...rec } : null,
        section: keepSection ? prev.section : null,
        subsection: keepSection ? prev.subsection : null,
        searchQuery: null, searchType: null }
      const path = buildPath(next)
      navTrail.replace(next, path)
      if (path !== currentFullPath()) window.history.replaceState(stampedState(), '', path)
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
    adminLayoutReturnFromUrl: state.adminLayoutReturn,
    searchQuery: state.searchQuery,
    searchType: state.searchType,
    helpSlug: state.helpSlug,
    listScope: state.listScope,
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
