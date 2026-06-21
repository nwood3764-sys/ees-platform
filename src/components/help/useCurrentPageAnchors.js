import { useMemo } from 'react'

// ---------------------------------------------------------------------------
// useCurrentPageAnchors
//
// Derives the set of help anchors that describe what the user is currently
// looking at. The HelpPanel uses these to surface relevant articles
// automatically when the user clicks the topbar ? button.
//
// Inputs:
//   • activeModule    — current module id from urlNav ('field', 'outreach', etc.)
//   • selectedRecord  — { table, id, mode } when a record is open, else null
//
// Output: array of anchor specs (route / object / concept) ordered by
// relevance — most-specific first. The lookup RPC dedupes on the server
// so safe to include overlapping anchors.
//
// Anchor priority:
//   1. The specific table the user is viewing (object anchor)        — most specific
//   2. The module-level route (route anchor)                         — moderate
//   3. Falls back to a 'module:<id>' concept anchor                   — broad catch-all
// ---------------------------------------------------------------------------

// Map activeModule → a base route string that admins can anchor articles to.
// Mirrors what the URL would show on a module home tab.
const MODULE_ROUTES = {
  home:          '/',
  outreach:      '/m/outreach',
  enrollment:    '/m/enrollment',
  qualification: '/m/qualification',
  field:         '/m/field',
  incentives:    '/m/incentives',
  stock:         '/m/stock',
  fleet:         '/m/fleet',
  reports:       '/m/reports',
  admin:         '/m/admin',
  portal:        '/m/portal',
}

export function useCurrentPageAnchors({ activeModule, selectedRecord }) {
  return useMemo(() => {
    const anchors = []

    // Most specific first: the table the user is viewing.
    if (selectedRecord?.table) {
      anchors.push({ type: 'object', object: selectedRecord.table })
    }

    // Module-level route — admins anchor module-overview articles here.
    if (activeModule && MODULE_ROUTES[activeModule]) {
      anchors.push({ type: 'route', route: MODULE_ROUTES[activeModule] })
    }

    // Module-level concept as a final catch-all. Admins who want an article
    // to appear "anywhere in module X" anchor it to `module:<id>`.
    if (activeModule) {
      anchors.push({ type: 'concept', concept: `module:${activeModule}` })
    }

    return anchors
  }, [activeModule, selectedRecord?.table])
}

// Build a human-friendly title for the "Help for this page" header.
// Used in HelpPanel when opened from the topbar button.
export function describeCurrentPage({ activeModule, selectedRecord }) {
  if (selectedRecord?.table) {
    const tableLabel = humanizeTableName(selectedRecord.table)
    if (selectedRecord.mode === 'create') return `Help for: New ${tableLabel}`
    return `Help for: ${tableLabel}`
  }
  if (activeModule && activeModule !== 'home') {
    return `Help for: ${capitalize(activeModule)}`
  }
  return 'Help for this page'
}

function humanizeTableName(table) {
  // accounts → Account · work_orders → Work Order · project_report_templates → Project Report Template
  return table
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/s$/, '')   // singularize trailing s for "Help for: Work Order" reads cleaner than "Work Orders"
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1) }
