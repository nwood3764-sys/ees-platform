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
import { fetchTechnicians } from '../data/peopleService'
import { fetchPartnerOrganizations } from '../data/portalService'

// ── Project Planning ─────────────────────────────────────────────────────────
// Office-side project preparation (lifecycle stage 7): work plans, work orders
// built per building/unit, crew assignment, and scheduling — owned by Project
// Managers and Project Coordinators, days/weeks ahead of execution. Home is a
// live planning dashboard; Projects/Work Orders are the prep queues; Workforce
// shows the technicians and service providers available to assign;
// Opportunities is included because all work flows from there. Lists show ALL
// records per the platform rule; default views surface the planning-relevant
// slices.

const CODE_SECTIONS = [
  { id: 'home',          label: 'Dashboard'      },
  { id: 'projects',      label: 'Projects'       },
  { id: 'workorders',    label: 'Work Orders'    },
  { id: 'workforce',     label: 'Workforce'      },
  { id: 'opportunities', label: 'Opportunities'  },
]

const groupCount = (arr, key) => {
  const m = new Map()
  for (const r of arr) m.set(r[key] || '—', (m.get(r[key] || '—') || 0) + 1)
  return Array.from(m, ([name, value]) => ({ name, value }))
}
const shortStatus = s => (s == null || s === '' ? '—' : String(s)).replace(/^Work Order /, '').replace(/^Project /, '')

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

function Dashboard({ workOrders, projects, opportunities, technicians, partners, onGo }) {
  const R = useRecharts()
  const projToSchedule = projects.filter(p => p.status === 'Project To Be Scheduled').length
  const woToSchedule   = workOrders.filter(w => w.status === 'To Be Scheduled').length
  const activeTechs    = technicians.filter(t => /active/i.test(t.status)).length || technicians.length
  const pipeline       = opportunities.reduce((s, o) => s + (o._amountRaw || 0), 0)

  const woByStatus   = useMemo(() => groupCount(workOrders, 'status').map(d => ({ ...d, name: shortStatus(d.name) })), [workOrders])
  const projByStatus = useMemo(() => groupCount(projects, 'status').map(d => ({ ...d, name: shortStatus(d.name) })), [projects])

  const serviceProviders = partners.length

  const kpis = [
    { label: 'Projects To Schedule', value: projToSchedule, sub: `${projects.length} total projects`, color: C.amber,   go: 'projects' },
    { label: 'Work Orders To Build', value: woToSchedule,   sub: 'Awaiting scheduling',              color: C.sky,     go: 'workorders' },
    { label: 'Technicians',          value: technicians.length, sub: `${activeTechs} active`,        color: C.emerald, go: 'workforce' },
    { label: 'Service Providers',    value: serviceProviders, sub: 'Partner organizations',          color: C.purple || '#8b5cf6', go: 'workforce' },
  ]

  return (
    <div style={{ padding: 24, overflow: 'auto' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18, color: C.textPrimary }}>Project Planning</h2>
      <p style={{ margin: '0 0 16px', color: C.textSecondary, fontSize: 13, maxWidth: 660 }}>
        Office-side preparation: build work orders per building and unit, assign crews and partners, order materials,
        and schedule the work ahead of field execution. Use the Workforce tab to see who's available to assign.
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
        <Widget title="Projects by Status" subtitle={`Total: ${projects.length} · Pipeline ${fmt(pipeline)}`} footer="View Projects →" onFooter={() => onGo('projects')}>
          <R.ResponsiveContainer width="100%" height={150}>
            <R.BarChart data={projByStatus} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
              <R.XAxis type="number" hide /><R.YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: C.textSecondary }} />
              <R.Tooltip /><R.Bar dataKey="value" fill={C.emerald} radius={[0, 4, 4, 0]} />
            </R.BarChart>
          </R.ResponsiveContainer>
        </Widget>

        <Widget title="Work Orders by Status" subtitle={`Total: ${workOrders.length}`} footer="View Work Orders →" onFooter={() => onGo('workorders')}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <R.ResponsiveContainer width={100} height={130}>
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

        <Widget title="Workforce Available" subtitle="Internal crews and partners to assign" footer="View Workforce →" onFooter={() => onGo('workforce')}>
          <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Technicians (internal)</span><span style={{ fontWeight: 600, color: C.textPrimary }}>{technicians.length}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Service Providers</span><span style={{ fontWeight: 600, color: C.textPrimary }}>{serviceProviders}</span></div>
          </div>
        </Widget>
      </div>
    </div>
  )
}

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
  { id:'PPJ-01', name:'All Projects',     filters:[], sortField:'startDate', sortDir:'asc' },
  { id:'PPJ-02', name:'To Be Scheduled',  filters:[{ field:'status', label:'Status', op:'equals', value:'Project To Be Scheduled' }], sortField:'id', sortDir:'asc' },
  { id:'PPJ-03', name:'Scheduled',        filters:[{ field:'status', label:'Status', op:'equals', value:'Project Scheduled' }],      sortField:'startDate', sortDir:'asc' },
]

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
  { id:'PWO-01', name:'All Work Orders',   filters:[], sortField:'scheduledDate', sortDir:'asc' },
  { id:'PWO-02', name:'To Be Scheduled',   filters:[{ field:'status', label:'Status', op:'equals', value:'To Be Scheduled' }], sortField:'id', sortDir:'asc' },
  { id:'PWO-03', name:'Scheduled',         filters:[{ field:'status', label:'Status', op:'equals', value:'Scheduled' }],       sortField:'scheduledDate', sortDir:'asc' },
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
const OPP_VIEWS = [{ id:'POP-01', name:'All Opportunities', filters:[], sortField:'closeDate', sortDir:'asc' }]

// Workforce — internal technicians (contacts) + partner organizations
// (service providers). Unified into one tab with a "kind" column so planners
// see everyone assignable in one place.
const WF_COLS = [
  { field:'id',        label:'Record #', type:'text',   sortable:true, filterable:false },
  { field:'name',      label:'Name',     type:'text',   sortable:true, filterable:true  },
  { field:'kind',      label:'Kind',     type:'select', sortable:true, filterable:true, options:['Technician','Service Provider'] },
  { field:'role',      label:'Role / Type', type:'text', sortable:true, filterable:true },
  { field:'status',    label:'Status',   type:'text',   sortable:true, filterable:true  },
  { field:'phone',     label:'Phone',    type:'text',   sortable:false,filterable:false },
  { field:'location',  label:'Location', type:'text',   sortable:true, filterable:true  },
  { field:'bpi',       label:'BPI',      type:'text',   sortable:true, filterable:true  },
]
const WF_VIEWS = [
  { id:'PWF-01', name:'All Workforce',     filters:[], sortField:'name', sortDir:'asc' },
  { id:'PWF-02', name:'Technicians',       filters:[{ field:'kind', label:'Kind', op:'equals', value:'Technician' }],       sortField:'name', sortDir:'asc' },
  { id:'PWF-04', name:'Service Providers', filters:[{ field:'kind', label:'Kind', op:'equals', value:'Service Provider' }], sortField:'name', sortDir:'asc' },
]

function partnerKind() {
  // All partner organizations are service providers in EES terminology.
  return 'Service Provider'
}

export default function ProjectPlanningModule({ selectedRecord: navSelectedRecord, sectionFromUrl, onNavigateToRecord, onCloseRecord, onSectionChange, onReplaceRecord, onOpenSetup } = {}) {
  const SECTIONS = useModuleSections('planning', CODE_SECTIONS)
  const [sec, setSec] = useState(sectionFromUrl || 'home')
  const [projects, setProjects] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [technicians, setTechnicians] = useState([])
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRecord, setSelectedRecord] = useState(navSelectedRecord || null)

  useEffect(() => { setSec(sectionFromUrl || 'home') }, [sectionFromUrl])
  useEffect(() => { setSelectedRecord(navSelectedRecord || null) }, [navSelectedRecord])

  const loadAll = async () => {
    setLoading(true); setError(null)
    try {
      const [p, w, o, t, pr] = await Promise.all([
        fetchProjects(), fetchWorkOrders(), fetchOpportunities(), fetchTechnicians(), fetchPartnerOrganizations(),
      ])
      setProjects(p); setWorkOrders(w); setOpportunities(o); setTechnicians(t); setPartners(pr)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadAll() }, [])

  // Unified workforce rows for the Workforce tab.
  const workforce = useMemo(() => {
    const techRows = technicians.map(t => ({
      id: t.id, _id: t._id, _table: 'contacts',
      name: t.name, kind: 'Technician', role: t.title || '—',
      status: t.status, phone: t.phone, location: '—',
      bpi: t.bpiCertified === 'Yes' ? `Yes (exp ${t.bpiExpiry})` : 'No',
    }))
    const partnerRows = partners.map(p => ({
      id: p.id, _id: p._id, _table: 'accounts',
      name: p.name, kind: partnerKind(), role: p.partnerType || '—',
      status: p.status, phone: p.phone,
      location: [p.city, p.state].filter(x => x && x !== '—').join(', ') || '—',
      bpi: '—',
    }))
    return [...techRows, ...partnerRows]
  }, [technicians, partners])

  const openRecord = (table, id) => {
    const rec = { table, id, mode: 'view' }
    setSelectedRecord(rec)
    if (onNavigateToRecord) onNavigateToRecord(rec)
  }
  const openOpp = (_table, id) => openRecord('opportunities', id)
  // Workforce rows carry their own target table (contacts vs accounts).
  const openWorkforce = (_table, id) => {
    const row = workforce.find(r => r.id === id || r._id === id)
    if (row) openRecord(row._table, row._id)
  }
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
        <SectionTabs sections={SECTIONS} active={sec} onChange={changeSection} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {sec === 'home' && (
          loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={loadAll} /> :
          <Dashboard workOrders={workOrders} projects={projects} opportunities={opportunities} technicians={technicians} partners={partners} onGo={changeSection} />
        )}
        {sec === 'workforce'     && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={workforce}     listObject="workforce_planning"     listModule="planning" columns={WF_COLS}   systemViews={WF_VIEWS}   defaultViewId="PWF-01" onOpenRecord={openWorkforce} />}
        {!CODE_SECTIONS.some(cs=>cs.id===sec) && SECTIONS.find(s=>s.id===sec)?.objectTable && (
          <ObjectListSection objectTable={SECTIONS.find(s=>s.id===sec).objectTable} moduleId="planning" />
        )}
      </div>
    </div>
  )
}
