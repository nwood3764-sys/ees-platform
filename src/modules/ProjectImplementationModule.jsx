import { useState, useEffect, useMemo } from 'react'
import { useModuleSections } from '../lib/useModuleSections'
import { useRecharts } from '../lib/RechartsLazy'
import { C, CHART_COLORS, fmt } from '../data/constants'
import { SectionTabs, LoadingState, ErrorState } from '../components/UI'
import RecordDetail from '../components/RecordDetail'
import ObjectListSection from '../components/ObjectListSection'
import { fetchProjects, fetchWorkOrders } from '../data/fieldService'
import { fetchOpportunities } from '../data/outreachService'

// ── Project Implementation ───────────────────────────────────────────────────
// Field-side execution (lifecycle stage 8): Team Leads run crews and complete
// work orders per work plan, capture before/after evidence, and the Project
// Coordinator tracks daily progress while the Director of Field Services manages
// real-time execution. Home is a live execution dashboard (work orders + active
// projects); Opportunities is included because all work flows from there. Lists
// show ALL records per the platform rule; default views surface the in-flight
// slices.

const CODE_SECTIONS = [
  { id: 'home',          label: 'Dashboard'      },
  { id: 'workorders',    label: 'Work Orders'    },
  { id: 'projects',      label: 'Active Projects'},
  { id: 'opportunities', label: 'Opportunities'  },
]

const groupCount = (arr, key) => {
  const m = new Map()
  for (const r of arr) m.set(r[key] || '—', (m.get(r[key] || '—') || 0) + 1)
  return Array.from(m, ([name, value]) => ({ name, value }))
}
const shortStatus = s => (s || '—').replace(/^Work Order /, '').replace(/^Project /, '')

// Group records by their status, preserving BOTH the short display label (name)
// and the raw stored status value (raw). The raw value is what a segment click
// drills on — the list view filters on the object's *_status__label column,
// whose values are the full picklist labels, not the shortened chart label.
const groupByStatus = (arr) => {
  const m = new Map()
  for (const r of arr) {
    const raw = r.status || '—'
    m.set(raw, (m.get(raw) || 0) + 1)
  }
  return Array.from(m, ([raw, value]) => ({ raw, value, name: shortStatus(raw) }))
}

function Widget({ title, subtitle, children, footer, onFooter }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>{subtitle}</div>}
      </div>
      <div style={{ flex: 1, padding: '12px 14px 8px' }}>{children}</div>
      {footer && (
        <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span onClick={onFooter} style={{ color: '#1a5a8a', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>{footer}</span>
          <span style={{ color: C.textMuted, fontSize: 10 }}>Live</span>
        </div>
      )}
    </div>
  )
}

// Build a work-order status drill filter that the work_orders list view
// matches on (its resolved status column is work_order_status__label, whose
// values are the bare status labels — "In Progress", "To Be Verified", etc.).
const woStatusFilter = (raw) => (raw && raw !== '—')
  ? [{ field: 'work_order_status__label', label: 'Status', op: 'equals', value: raw }]
  : null
// Project status drill filter — the projects list resolves status to
// project_status__label (full picklist labels, e.g. "Project In Progress").
const projStatusFilter = (raw) => (raw && raw !== '—')
  ? [{ field: 'project_status__label', label: 'Status', op: 'equals', value: raw }]
  : null

function Dashboard({ workOrders, projects, opportunities, onDrill }) {
  const R = useRecharts()
  const woInProgress = workOrders.filter(w => w.status === 'In Progress').length
  const woToVerify   = workOrders.filter(w => w.status === 'To Be Verified').length
  const woCorrections= workOrders.filter(w => w.status === 'Corrections Needed').length
  const projActive   = projects.filter(p => p.status === 'Project In Progress').length
  const pipeline     = opportunities.reduce((s, o) => s + (o._amountRaw || 0), 0)

  const woByStatus = useMemo(() => groupByStatus(workOrders), [workOrders])
  const woByTeam   = useMemo(() => groupCount(workOrders.filter(w => w.teamLead), 'teamLead'), [workOrders])
  const projByStatus = useMemo(() => groupByStatus(projects), [projects])

  const kpis = [
    { label: 'Work Orders In Progress', value: woInProgress,  sub: 'Active in the field now',   color: C.purple || '#8b5cf6', go: 'workorders', filters: woStatusFilter('In Progress') },
    { label: 'Awaiting Verification',   value: woToVerify,    sub: 'Submitted, pending review', color: C.amber,  go: 'workorders', filters: woStatusFilter('To Be Verified') },
    { label: 'Corrections Needed',      value: woCorrections, sub: 'Kicked back to crews',      color: C.danger, go: 'workorders', filters: woStatusFilter('Corrections Needed') },
    { label: 'Active Projects',         value: projActive,    sub: `${projects.length} total projects`, color: C.emerald, go: 'projects', filters: projStatusFilter('Project In Progress') },
  ]

  return (
    <div style={{ padding: 24, overflow: 'auto' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18, color: C.textPrimary }}>Project Implementation</h2>
      <p style={{ margin: '0 0 16px', color: C.textSecondary, fontSize: 13, maxWidth: 660 }}>
        Field-side execution: Team Leads complete work orders per work plan and capture before/after evidence;
        the Project Coordinator tracks daily progress and the verification queue.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        {kpis.map(s => (
          <div key={s.label} onClick={() => onDrill(s.go, s.filters)}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`, borderRadius: 8, padding: '16px 18px', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
            <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: C.textMuted }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 14 }}>
        <Widget title="Work Orders by Status" subtitle={`Total: ${workOrders.length}`} footer="View Work Orders →" onFooter={() => onDrill('workorders', null)}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <R.ResponsiveContainer width={100} height={120}>
              <R.PieChart><R.Pie data={woByStatus} cx="50%" cy="50%" innerRadius={24} outerRadius={46} dataKey="value" strokeWidth={0}
                cursor="pointer"
                onClick={(d) => onDrill('workorders', woStatusFilter(d?.payload?.raw ?? d?.raw))}>{woByStatus.map((_, i) => <R.Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</R.Pie><R.Tooltip /></R.PieChart>
            </R.ResponsiveContainer>
            <div style={{ flex: 1, fontSize: 11, color: C.textSecondary }}>
              {woByStatus.map((d, i) => (
                <div key={d.raw}
                  onClick={() => onDrill('workorders', woStatusFilter(d.raw))}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, cursor: 'pointer' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{d.name}</span>
                  <span style={{ fontWeight: 600, color: C.textPrimary }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Widget>

        <Widget title="Active Work by Team Lead" subtitle="Open work orders per lead" footer="View Work Orders →" onFooter={() => onDrill('workorders', null)}>
          <R.ResponsiveContainer width="100%" height={140}>
            <R.BarChart data={woByTeam} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
              <R.XAxis type="number" hide /><R.YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: C.textSecondary }} />
              <R.Tooltip /><R.Bar dataKey="value" fill={C.emerald} radius={[0, 4, 4, 0]}
                cursor="pointer" onClick={() => onDrill('workorders', null)} />
            </R.BarChart>
          </R.ResponsiveContainer>
        </Widget>

        <Widget title="Projects by Status" subtitle={`Pipeline value: ${fmt(pipeline)}`} footer="View Active Projects →" onFooter={() => onDrill('projects', null)}>
          <R.ResponsiveContainer width="100%" height={140}>
            <R.BarChart data={projByStatus} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
              <R.XAxis type="number" hide /><R.YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: C.textSecondary }} />
              <R.Tooltip /><R.Bar dataKey="value" fill={C.sky} radius={[0, 4, 4, 0]}
                cursor="pointer" onClick={(d) => onDrill('projects', projStatusFilter(d?.payload?.raw ?? d?.raw))} />
            </R.BarChart>
          </R.ResponsiveContainer>
        </Widget>
      </div>
    </div>
  )
}

// Section id → object table for the built-in list tabs. ObjectListSection
// renders each object's universal list view (same records, saved views, and
// column picker everywhere) — no per-module list code needed.
const SEC_TABLE = {
  workorders:    'work_orders',
  projects:      'projects',
  opportunities: 'opportunities',
}

export default function ProjectImplementationModule({ selectedRecord: navSelectedRecord, sectionFromUrl, onNavigateToRecord, onCloseRecord, onSectionChange, onReplaceRecord, onOpenSetup } = {}) {
  const SECTIONS = useModuleSections('implementation', CODE_SECTIONS)
  const [sec, setSec] = useState(sectionFromUrl || 'home')
  const [projects, setProjects] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRecord, setSelectedRecord] = useState(navSelectedRecord || null)
  // Drill-down scope for the list tab, set when a dashboard widget/KPI is
  // clicked (null = show the whole list). Cleared on any plain tab navigation.
  const [drillFilters, setDrillFilters] = useState(null)

  useEffect(() => { setSec(sectionFromUrl || 'home') }, [sectionFromUrl])
  useEffect(() => { setSelectedRecord(navSelectedRecord || null) }, [navSelectedRecord])

  const loadAll = async () => {
    setLoading(true); setError(null)
    try {
      const [p, w, o] = await Promise.all([fetchProjects(), fetchWorkOrders(), fetchOpportunities()])
      setProjects(p); setWorkOrders(w); setOpportunities(o)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadAll() }, [])

  // Plain tab navigation (SectionTabs, footer "View X" links): switch section
  // and clear any drill-down scope so the list shows every record.
  const changeSection = (next) => {
    setDrillFilters(null)
    setSec(next)
    if (onSectionChange) onSectionChange(next)
  }
  // Widget/KPI drill-down: switch to the object's list tab, scoped to the
  // clicked segment. A null/empty filter list opens the whole list.
  const drillToSection = (next, filters) => {
    setDrillFilters(Array.isArray(filters) && filters.length ? filters : null)
    setSec(next)
    if (onSectionChange) onSectionChange(next)
  }

  if (selectedRecord) {
    return (
      <RecordDetail
        tableName={selectedRecord.table}
        recordId={selectedRecord.id}
        mode={selectedRecord.mode}
        onBack={() => { setSelectedRecord(null); if (onCloseRecord) onCloseRecord() }}
        onNavigateToRecord={onReplaceRecord}
        onRecordCreated={() => { setSelectedRecord(null); loadAll(); if (onCloseRecord) onCloseRecord() }}
      />
    )
  }

  // Resolve the list object for the active section: built-in tabs from
  // SEC_TABLE, admin-added custom sections from their configured objectTable.
  const listTable = sec !== 'home'
    ? (SEC_TABLE[sec] || SECTIONS.find(s => s.id === sec)?.objectTable || null)
    : null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '0 24px', flexShrink: 0 }}>
        <SectionTabs sections={SECTIONS} active={sec} onChange={changeSection} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {sec === 'home' && (
          loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={loadAll} /> :
          <Dashboard workOrders={workOrders} projects={projects} opportunities={opportunities} onDrill={drillToSection} />
        )}
        {listTable && (
          <ObjectListSection
            key={`${listTable}:${drillFilters ? JSON.stringify(drillFilters) : 'all'}`}
            objectTable={listTable}
            moduleId="implementation"
            initialFilters={drillFilters}
          />
        )}
      </div>
    </div>
  )
}
