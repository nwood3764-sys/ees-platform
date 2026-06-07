import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import { fetchProjects, fetchWorkOrders } from '../data/fieldService'

// ── Project Implementation ───────────────────────────────────────────────────
// Field-side execution (lifecycle stage 8): Team Leads run crews and complete
// work orders per work plan, capture before/after evidence, and the Project
// Coordinator tracks daily progress while the Director of Field Services manages
// real-time execution. Reads the same projects/work_orders objects as Field;
// oriented to the active-execution and verification queue. Lists show ALL
// records per the platform rule; default views surface the in-flight slices.

const SECTIONS = [
  { id: 'home',       label: 'Home'             },
  { id: 'workorders', label: 'Work Orders'      },
  { id: 'projects',   label: 'Active Projects'  },
]

const WO_COLS = [
  { field:'id',           label:'Record #',  type:'text',   sortable:true, filterable:false },
  { field:'name',         label:'Work Order',type:'text',   sortable:true, filterable:true  },
  { field:'property',     label:'Property',  type:'text',   sortable:true, filterable:true  },
  { field:'building',     label:'Building',  type:'text',   sortable:true, filterable:true  },
  { field:'workType',     label:'Work Type', type:'select', sortable:true, filterable:true, options:['HP - Air to Air Install','Air Sealing - Multifamily','Insulation - Attic','Boiler Replacement','PTAC Install','Blower Door Diagnostic','Shop Kit - Equipment','Travel - Drive to Site','ASHRAE Level 2'] },
  { field:'status',       label:'Status',    type:'select', sortable:true, filterable:true, options:['Work Order To Be Scheduled','Work Order Scheduled','Work Order In Progress','Work Order Submitted','Work Order To Be Verified','Work Order Corrections Needed','Work Order Verified','Work Order Complete'] },
  { field:'teamLead',     label:'Team Lead', type:'select', sortable:true, filterable:true, options:['J. Martinez','K. Chen','A. Williams','D. Okonkwo','P. Nair'] },
  { field:'scheduledDate',label:'Scheduled', type:'date',   sortable:true, filterable:true  },
  { field:'duration',     label:'Est.',      type:'text',   sortable:false,filterable:false },
  { field:'state',        label:'State',     type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

// Implementation surfaces work that is live in the field or awaiting verification.
const WO_VIEWS = [
  { id:'IWO-01', name:'All Work Orders',   filters:[], sortField:'scheduledDate', sortDir:'asc' },
  { id:'IWO-02', name:'In Progress',       filters:[{ field:'status', label:'Status', op:'equals', value:'Work Order In Progress' }],          sortField:'scheduledDate', sortDir:'asc' },
  { id:'IWO-03', name:'To Be Verified',    filters:[{ field:'status', label:'Status', op:'equals', value:'Work Order To Be Verified' }],       sortField:'scheduledDate', sortDir:'asc' },
  { id:'IWO-04', name:'Corrections Needed',filters:[{ field:'status', label:'Status', op:'equals', value:'Work Order Corrections Needed' }],   sortField:'scheduledDate', sortDir:'asc' },
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

export default function ProjectImplementationModule({ selectedRecord: navSelectedRecord, sectionFromUrl, onNavigateToRecord, onCloseRecord, onSectionChange, onReplaceRecord, onOpenSetup } = {}) {
  const [sec, setSec] = useState(sectionFromUrl || 'home')
  const [projects, setProjects] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRecord, setSelectedRecord] = useState(navSelectedRecord || null)

  useEffect(() => { setSec(sectionFromUrl || 'home') }, [sectionFromUrl])
  useEffect(() => { setSelectedRecord(navSelectedRecord || null) }, [navSelectedRecord])

  const loadAll = async () => {
    setLoading(true); setError(null)
    try {
      const [p, w] = await Promise.all([fetchProjects(), fetchWorkOrders()])
      setProjects(p); setWorkOrders(w)
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

  // LiveListView wrapper — same loading/error pattern as other modules
  function LiveListView({ loading, error, data, onRetry, ...rest }) {
    if (loading) return <LoadingState />
    if (error) return <ErrorState error={error} onRetry={onRetry} />
    return <ListView data={data} {...rest} />
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '0 24px', flexShrink: 0 }}>
        <SectionTabs sections={SECTIONS} active={sec} onChange={changeSection} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {sec === 'home' && (
          <div style={{ padding: 24, overflow: 'auto' }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 18, color: C.textPrimary }}>Project Implementation</h2>
            <p style={{ margin: 0, color: C.textSecondary, fontSize: 14, maxWidth: 620 }}>
              Field-side execution: Team Leads complete work orders per work plan and capture
              before/after evidence; the Project Coordinator tracks daily progress and verification.
              Use the Work Orders tab for the active execution and verification queue.
            </p>
          </div>
        )}
        {sec === 'workorders' && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={workOrders} listObject="work_orders_implementation" listModule="implementation" columns={WO_COLS}   systemViews={WO_VIEWS}   defaultViewId="IWO-01" newLabel="Work Order" onNew={() => setSelectedRecord({ table: 'work_orders', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'projects'   && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={projects}   listObject="projects_implementation" listModule="implementation" columns={PROJ_COLS} systemViews={PROJ_VIEWS} defaultViewId="IPJ-01" newLabel="Project"    onNew={() => setSelectedRecord({ table: 'projects', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
      </div>
    </div>
  )
}
