import { useState, useEffect, lazy, Suspense } from 'react'
import { C } from '../data/constants'
import { resolveHomePageForModule } from '../data/adminService'
import { getTemplate } from '../modules/admin/homePageTemplates'
import HomeComponentRenderer from '../modules/admin/HomeComponentRenderer'

// Lazy-loaded: these full-screen overlays only mount when the user drills into
// a report or edits a dashboard. Deferring them keeps their heavy deps — the
// report/dashboard builders and the mathjs/formulajs formula engine pulled in
// by ReportRunner — OFF the initial Home page load.
const ReportRunner = lazy(() => import('../modules/ReportRunner'))
const ReportBuilder = lazy(() => import('../modules/ReportBuilder'))
const DashboardCanvasEditor = lazy(() => import('../modules/DashboardCanvasEditor'))

function OverlayFallback() {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textMuted, fontSize: 13 }}>Loading…</div>
}

// ConfiguredHome renders a landing/dashboard screen entirely from a configured
// Home Page (home_pages + home_page_components), resolved for the current user
// via resolve_home_page_for_current_user (role-scoped page, else org default).
//
// This is the single rendering path for every home/dashboard surface — the
// global Home module and each module's Home tab alike — so no module ships a
// hardcoded dashboard. A module's home is just a Home Page built in the Home
// Page builder and assigned to the relevant role, mirroring Salesforce
// Lightning App Builder: build a page, assign it.
//
// Props:
//   crumb       — breadcrumb label shown left of the page name (e.g.
//                 'Qualification' or 'Home').
//   onOpenSetup — opens Setup; receives a node id. Used for the Edit Page
//                 button and the empty-state CTA.
//   onOpenRecord— ({ table, id, mode }) record opener for embedded components.
export default function ConfiguredHome({ crumb = 'Home', moduleId = null, onOpenSetup, onOpenRecord }) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // undefined = loading, null = none resolved, object = configured page
  const [page, setPage] = useState(undefined)
  const [error, setError] = useState(null)
  // Report drill is handled here, not delegated up to the host's RecordDetail:
  // a saved report opens in ReportRunner, never in the generic record viewer.
  // null = no report open; otherwise { reportId, extraFilters }.
  const [openReport, setOpenReport] = useState(null)
  // When the user clicks Edit on a drilled-in report, swap the runner for the
  // full Report Builder for that report. Save/Close returns to the runner.
  const [editingReport, setEditingReport] = useState(false)
  // Bumped after a builder save so the runner remounts and re-runs, showing
  // the edited fields/filters/groupings immediately.
  const [reportEditNonce, setReportEditNonce] = useState(0)
  // When the user clicks Edit on an embedded dashboard, open the full Dashboard
  // builder (widgets, types, group-by/summarize, filters) — the Salesforce-style
  // editor — full-screen over the home. null = none; otherwise a dashboard id.
  const [editingDashboard, setEditingDashboard] = useState(null)
  const [dashboardEditNonce, setDashboardEditNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setPage(undefined)
    resolveHomePageForModule(moduleId)
      .then(p => { if (!cancelled) setPage(p || null) })
      .catch(err => { if (!cancelled) { setError(err); setPage(null) } })
    return () => { cancelled = true }
  }, [moduleId])

  if (page === undefined) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textMuted, fontSize: 13 }}>Loading…</div>
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, padding: 24 }}>
        <div style={{ color: C.textPrimary, fontSize: 13, fontWeight: 600 }}>Could not load this page</div>
        <div style={{ color: C.textMuted, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', maxWidth: 560, textAlign: 'center' }}>{String(error.message || error)}</div>
      </div>
    )
  }

  // No configured page — point the user at the builder rather than a hardcoded
  // screen, consistent with the no-hardcoded-dashboard design.
  if (!page) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24 }}>
        <div style={{ color: C.textPrimary, fontSize: 15, fontWeight: 600 }}>No page configured</div>
        <div style={{ color: C.textMuted, fontSize: 13, maxWidth: 440, textAlign: 'center' }}>
          Build a page in Setup to define this landing screen, then assign it to a role or set it as the org-wide default.
        </div>
        {onOpenSetup && (
          <button onClick={() => onOpenSetup('home_pages')}
            style={{ background: C.emerald, border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            Open Home Page Builder
          </button>
        )}
      </div>
    )
  }

  // Editing an embedded dashboard — open the full Dashboard builder over the
  // home. Save/Close returns to the home and remounts the runner so edits show.
  if (editingDashboard) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 600,
        background: C.page, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <Suspense fallback={<OverlayFallback />}>
          <DashboardCanvasEditor
            dashboardId={editingDashboard}
            onClose={() => setEditingDashboard(null)}
            onSaved={() => { setDashboardEditNonce(n => n + 1); setEditingDashboard(null) }}
          />
        </Suspense>
      </div>
    )
  }

  // A widget drilled into a report — run it full-screen over the home, scoped
  // by any extraFilters from a clicked chart segment / metric. Clicking Edit
  // swaps to the full Report Builder for that report; Close/Save returns here.
  if (openReport) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 600,
        background: C.page, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <Suspense fallback={<OverlayFallback />}>
          {editingReport ? (
            <ReportBuilder
              reportId={openReport.reportId}
              onClose={() => setEditingReport(false)}
              onSaved={() => { setReportEditNonce(n => n + 1); setEditingReport(false) }}
            />
          ) : (
            <ReportRunner
              key={`${openReport.reportId}:${reportEditNonce}`}
              reportId={openReport.reportId}
              extraFilters={openReport.extraFilters}
              onEdit={() => setEditingReport(true)}
              onClose={() => { setEditingReport(false); setOpenReport(null) }}
            />
          )}
        </Suspense>
      </div>
    )
  }

  const tmpl = getTemplate(page.template)
  const comps = page.components || []
  // Pages built in the LEAP Canvas carry per-component _geometry — render them
  // on the same 12-col grid the builder used (view == build). Pages built in the
  // legacy fixed-template builder have no geometry → keep the region flow.
  const useGeometry = comps.some(c => c.config && c.config._geometry)

  const renderComp = (c) => (
    <HomeComponentRenderer
      key={`${c.id}:${dashboardEditNonce}`}
      component={{ type: c.type, sourceId: c.source_id, title: c.title, config: c.config }}
      onNavigate={(table, id) => onOpenRecord && onOpenRecord({ table, id, mode: 'view' })}
      onOpenReport={(reportId, extraFilters = null) => { setEditingReport(false); setOpenReport({ reportId, extraFilters }) }}
      onOpenDashboard={(dashboardId) => setEditingDashboard(dashboardId)}
    />
  )

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 2 }}>{crumb} / {page.name || 'Home'}</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>{greeting} · {today}</div>
        </div>
      </div>
      {useGeometry ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gridAutoRows: '56px', gap: 8, alignItems: 'stretch' }}>
          {comps.map(c => {
            const g = c.config._geometry || { x: 0, y: 0, w: 6, h: 4 }
            return (
              <div key={`${c.id}:${dashboardEditNonce}`} style={{
                gridColumn: `${(g.x | 0) + 1} / span ${Math.max(1, g.w | 0)}`,
                gridRow: `${(g.y | 0) + 1} / span ${Math.max(1, g.h | 0)}`,
                minWidth: 0, overflow: 'auto',
              }}>
                {renderComp(c)}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {tmpl.regions.map(region => {
            const regionComps = comps
              .filter(c => c.region === region.key)
              .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            return (
              <div key={region.key} style={{ flex: region.flex, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {regionComps.map(renderComp)}
                {regionComps.length === 0 && <div style={{ color: C.textMuted, fontSize: 12, padding: 12 }}>&nbsp;</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
