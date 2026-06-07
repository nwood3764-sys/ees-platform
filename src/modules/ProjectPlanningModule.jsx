import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import { fetchProjects, fetchWorkOrders } from '../data/fieldService'

// ── Project Planning ─────────────────────────────────────────────────────────
// Office-side project preparation (lifecycle stage 7): work plans, work orders
// built per building/unit, crew assignment, and scheduling — owned by Project
// Managers and Project Coordinators, days/weeks ahead of execution. Reads the
// same projects/work_orders objects as Field; oriented to the prep queue.
// Per the platform rule, the lists show ALL records; default views surface the
// planning-relevant slices.

const SECTIONS = [
  { id: 'home',       label: 'Home'        },
  { id: 'projects',   label: 'Projects'    },
  { id: 'workorders', label: 'Work Orders' },
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

// Planning is the prep queue: surface projects not yet in the field first.
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
  { field:'status',       label:'Status',    type:'select', sortable:true, filterable:true, options:['Work Order To Be Scheduled','Work Order Scheduled','Work Order In Progress','Work Order Submitted','Work Order To Be Verified','Work Order Corrections Needed','Work Order Verified','Work Order Complete'] },
  { field:'teamLead',     label:'Team Lead', type:'select', sortable:true, filterable:true, options:['J. Martinez','K. Chen','A. Williams','D. Okonkwo','P. Nair'] },
  { field:'scheduledDate',label:'Scheduled', type:'date',   sortable:true, filterable:true  },
  { field:'duration',     label:'Est.',      type:'text',   sortable:false,filterable:false },
  { field:'state',        label:'State',     type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

// Planning surfaces work orders awaiting scheduling/assignment first.
const WO_VIEWS = [
  { id:'PWO-01', name:'All Work Orders',   filters:[], sortField:'scheduledDate', sortDir:'asc' },
  { id:'PWO-02', name:'To Be Scheduled',   filters:[{ field:'status', label:'Status', op:'equals', value:'Work Order To Be Scheduled' }], sortField:'id', sortDir:'asc' },
  { id:'PWO-03', name:'Scheduled',         filters:[{ field:'status', label:'Status', op:'equals', value:'Work Order Scheduled' }],       sortField:'scheduledDate', sortDir:'asc' },
]

export default function ProjectPlanningModule({ selectedRecord: navSelectedRecord, sectionFromUrl, onNavigateToRecord, onCloseRecord, onSectionChange, onReplaceRecord, onOpenSetup } = {}) {
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
            <h2 style={{ margin: '0 0 6px', fontSize: 18, color: C.textPrimary }}>Project Planning</h2>
            <p style={{ margin: 0, color: C.textSecondary, fontSize: 14, maxWidth: 620 }}>
              Office-side project preparation: build work orders per building and unit, assign crews,
              order materials, and schedule the work ahead of field execution. Use the Projects and
              Work Orders tabs to work the planning queue.
            </p>
          </div>
        )}
        {sec === 'projects'   && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={projects}   listObject="projects_planning" listModule="planning" columns={PROJ_COLS} systemViews={PROJ_VIEWS} defaultViewId="PPJ-01" newLabel="Project"    onNew={() => setSelectedRecord({ table: 'projects', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'workorders' && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={workOrders} listObject="work_orders_planning" listModule="planning" columns={WO_COLS}   systemViews={WO_VIEWS}   defaultViewId="PWO-01" newLabel="Work Order" onNew={() => setSelectedRecord({ table: 'work_orders', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
      </div>
    </div>
  )
}
