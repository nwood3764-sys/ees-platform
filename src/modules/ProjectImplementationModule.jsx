import { useState, useEffect, useMemo } from 'react'
import { useModuleSections } from '../lib/useModuleSections'
import { useRecharts } from '../lib/RechartsLazy'
import { C, CHART_COLORS, fmt } from '../data/constants'
import { SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
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

function Dashboard({ workOrders, projects, opportunities, onGo }) {
  const R = useRecharts()
  const woInProgress = workOrders.filter(w => w.status === 'In Progress').length
  const woToVerify   = workOrders.filter(w => w.status === 'To Be Verified').length
  const woCorrections= workOrders.filter(w => w.status === 'Corrections Needed').length
  const projActive   = projects.filter(p => p.status === 'Project In Progress').length
  const pipeline     = opportunities.reduce((s, o) => s + (o._amountRaw || 0), 0)

  const woByStatus = useMemo(() => groupCount(workOrders, 'status').map(d => ({ ...d, name: shortStatus(d.name) })), [workOrders])
  const woByTeam   = useMemo(() => groupCount(workOrders.filter(w => w.teamLead), 'teamLead'), [workOrders])
  const projByStatus = useMemo(() => groupCount(projects, 'status').map(d => ({ ...d, name: shortStatus(d.name) })), [projects])

  const kpis = [
    { label: 'Work Orders In Progress', value: woInProgress,  sub: 'Active in the field now', color: C.purple || '#8b5cf6', go: 'workorders' },
    { label: 'Awaiting Verification',   value: woToVerify,    sub: 'Submitted, pending review', color: C.amber, go: 'workorders' },
    { label: 'Corrections Needed',      value: woCorrections, sub: 'Kicked back to crews',     color: C.danger, go: 'workorders' },
    { label: 'Active Projects',         value: projActive,    sub: `${projects.length} total projects`, color: C.emerald, go: 'projects' },
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
          <div key={s.label} onClick={() => onGo(s.go)}
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
        <Widget title="Work Orders by Status" subtitle={`Total: ${workOrders.length}`} footer="View Work Orders →" onFooter={() => onGo('workorders')}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <R.ResponsiveContainer width={100} height={120}>
              <R.PieChart><R.Pie data={woByStatus} cx="50%" cy="50%" innerRadius={24} outerRadius={46} dataKey="value" strokeWidth={0}>{woByStatus.map((_, i) => <R.Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</R.Pie><R.Tooltip /></R.PieChart>
            </R.ResponsiveContainer>
            <div style={{ flex: 1, fontSize: 11, color: C.textSecondary }}>
              {woByStatus.map((d, i) => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{d.name}</span>
                  <span style={{ fontWeight: 600, color: C.textPrimary }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Widget>

        <Widget title="Active Work by Team Lead" subtitle="Open work orders per lead" footer="View Work Orders →" onFooter={() => onGo('workorders')}>
          <R.ResponsiveContainer width="100%" height={140}>
            <R.BarChart data={woByTeam} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
              <R.XAxis type="number" hide /><R.YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: C.textSecondary }} />
              <R.Tooltip /><R.Bar dataKey="value" fill={C.emerald} radius={[0, 4, 4, 0]} />
            </R.BarChart>
          </R.ResponsiveContainer>
        </Widget>

        <Widget title="Projects by Status" subtitle={`Pipeline value: ${fmt(pipeline)}`} footer="View Active Projects →" onFooter={() => onGo('projects')}>
          <R.ResponsiveContainer width="100%" height={140}>
            <R.BarChart data={projByStatus} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
              <R.XAxis type="number" hide /><R.YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: C.textSecondary }} />
              <R.Tooltip /><R.Bar dataKey="value" fill={C.sky} radius={[0, 4, 4, 0]} />
            </R.BarChart>
          </R.ResponsiveContainer>
        </Widget>
      </div>
    </div>
  )
}

const WO_COLS = [
  { field:'id',           label:'Record #',  type:'text',   sortable:true, filterable:false },
  { field:'name',         label:'Work Order',type:'text',   sortable:true, filterable:true  },
  { field:'property',     label:'Property',  type:'text',   sortable:true, filterable:true  },
  { field:'building',     label:'Building',  type:'text',   sortable:true, filterable:true  },
  { field:'workType',     label:'Work Type', type:'select', sortable:true, filterable:true, options:['HP - Air to Air Install','Air Sealing - Multifamily','Insulation - Attic','Boiler Replacement','PTAC Install','Blower Door Diagnostic','Shop Kit - Equipment','Travel - Drive to Site','ASHRAE Level 2'] },
  { field:'status',       label:'Status',    type:'select', sortable:true, filterable:true, options:['New','To Be Scheduled','To Be Assigned','Assigned','To Be Accepted','Scheduled','In Progress','To Be Verified','Corrections Needed','Verified','Unable to Complete','Closed'] },
  { field:'teamLead',     label:'Team Lead', type:'select', sortable:true, filterable:true, options:['J. Martinez','K. Chen','A. Williams','D. Okonkwo','P. Nair'] },
  { field:'scheduledDate',label:'Scheduled', type:'date',   sortable:true, filterable:true  },
  { field:'duration',     label:'Est.',      type:'text',   sortable:false,filterable:false },
  { field:'state',        label:'State',     type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

const WO_VIEWS = [
  { id:'IWO-01', name:'All Work Orders',   filters:[], sortField:'scheduledDate', sortDir:'asc' },
  { id:'IWO-02', name:'In Progress',       filters:[{ field:'status', label:'Status', op:'equals', value:'In Progress' }],          sortField:'scheduledDate', sortDir:'asc' },
  { id:'IWO-03', name:'To Be Verified',    filters:[{ field:'status', label:'Status', op:'equals', value:'To Be Verified' }],       sortField:'scheduledDate', sortDir:'asc' },
  { id:'IWO-04', name:'Corrections Needed',filters:[{ field:'status', label:'Status', op:'equals', value:'Corrections Needed' }],   sortField:'scheduledDate', sortDir:'asc' },
]

const PROJ_COLS = [
  { field:'id',         label:'Record #', type:'text',   sortable:true, filterable:false },
  { field:'name',       label:'Project',  type:'text',   sortable:true, filterable:true  },
  { field:'property',   label:'Property', type:'text',   sortable:true, filterable:true  },
  { field:'program',    label:'Program',  type:'select', sortable:true, filterable:true, options:['WI-IRA-MF-HOMES','WI-IRA-MF-HEAR','WI-IRA-SF-HOMES','CO - Denver','WI - FOE','MI-IRA-MF-HOMES'] },
  { field:'status',     label:'Status',   type:'select', sortable:true, filterable:true, options:['Project To Be Scheduled','Project Scheduled','Project In Progress','Project To Be Verified','Project Verified','Project Complete'] },
  { field:'owner',      label:'Owner',    type:'select', sortable:true, filterable:true, options:['Marcus Reid','Priya Nair','Lisa Tanaka'] },
  { field:'workOrders', label:'WOs',      type:'text',   sortable:true, filterable:false },
  { field:'startDate',  label:'Start',    type:'date',   sortable:true, filterable:true  },
  { field:'endDate',    label:'End',      type:'date',   sortable:true, filterable:true  },
  { field:'state',      label:'State',    type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

const PROJ_VIEWS = [
  { id:'IPJ-01', name:'All Projects',  filters:[], sortField:'startDate', sortDir:'asc' },
  { id:'IPJ-02', name:'In Progress',   filters:[{ field:'status', label:'Status', op:'equals', value:'Project In Progress' }],   sortField:'startDate', sortDir:'asc' },
  { id:'IPJ-03', name:'To Be Verified',filters:[{ field:'status', label:'Status', op:'equals', value:'Project To Be Verified' }], sortField:'startDate', sortDir:'asc' },
]

const OPP_COLS = [
  { field:'id',        label:'Record #', type:'text',   sortable:true, filterable:false },
  { field:'name',      label:'Opportunity', type:'text', sortable:true, filterable:true },
  { field:'property',  label:'Property', type:'text',   sortable:true, filterable:true  },
  { field:'stage',     label:'Stage',    type:'text',   sortable:true, filterable:true  },
  { field:'program',   label:'Program',  type:'text',   sortable:true, filterable:true  },
  { field:'amount',    label:'Amount',   type:'text',   sortable:true, filterable:false },
  { field:'closeDate', label:'Close',    type:'date',   sortable:true, filterable:true  },
  { field:'state',     label:'State',    type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]
const OPP_VIEWS = [{ id:'IOP-01', name:'All Opportunities', filters:[], sortField:'closeDate', sortDir:'asc' }]

export default function ProjectImplementationModule({ selectedRecord: navSelectedRecord, sectionFromUrl, onNavigateToRecord, onCloseRecord, onSectionChange, onReplaceRecord, onOpenSetup } = {}) {
  const SECTIONS = useModuleSections('implementation', CODE_SECTIONS)
  const [sec, setSec] = useState(sectionFromUrl || 'home')
  const [projects, setProjects] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRecord, setSelectedRecord] = useState(navSelectedRecord || null)

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

  const openRecord = (table, id) => {
    const rec = { table, id, mode: 'view' }
    setSelectedRecord(rec)
    if (onNavigateToRecord) onNavigateToRecord(rec)
  }
  const openOpp = (_table, id) => openRecord('opportunities', id)
  const changeSection = (next) => {
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

  function LiveListView({ loading, error, data, onRetry, ...rest }) {
    if (loading) return <LoadingState />
    if (error) return <ErrorState error={error} onRetry={onRetry} />
    return <ListView data={data} {...rest} />
  }

  const SEC_OBJ = {'projects':'projects', 'workorders':'work_orders', 'opportunities':'opportunities'}
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '0 24px', flexShrink: 0 }}>
        <SectionTabs sections={SECTIONS} active={sec} onChange={changeSection} moduleId="implementation" />
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {sec === 'home' && (
          loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={loadAll} /> :
          <Dashboard workOrders={workOrders} projects={projects} opportunities={opportunities} onGo={changeSection} />
        )}
        {!CODE_SECTIONS.some(cs=>cs.id===sec) && SECTIONS.find(s=>s.id===sec)?.objectTable && (
          <ObjectListSection objectTable={SECTIONS.find(s=>s.id===sec).objectTable} moduleId="implementation" />
        )}
      </div>
    </div>
  )
}
