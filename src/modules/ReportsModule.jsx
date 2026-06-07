import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import {
  fetchReportFolders, fetchReports, fetchScheduledReports,
  fetchDashboardFolders, fetchDashboards,
} from '../data/reportsService'
import ReportBuilder from './ReportBuilder'
import ReportRunner from './ReportRunner'
import DashboardRunner from './DashboardRunner'
import DashboardEditor from './DashboardEditor'
import ScheduleEditor from './ScheduleEditor'

// ─── Section definitions ──────────────────────────────────────────────────

const SECTIONS = [
  { id: 'home',           label: 'Home' },
  { id: 'folders',        label: 'Report Folders' },
  { id: 'reports',        label: 'All Reports' },
  { id: 'dashboard_folders', label: 'Dashboard Folders' },
  { id: 'dashboards',     label: 'All Dashboards' },
  { id: 'scheduled',      label: 'Scheduled' },
]

const SEC_TABLE = {
  folders:           'report_folders',
  reports:           'reports',
  dashboard_folders: 'dashboard_folders',
  dashboards:        'dashboards',
  scheduled:         'scheduled_reports',
}

const FOLDER_COLS = [
  { field:'id',          label:'Folder #',     type:'text',   sortable:true,  filterable:false },
  { field:'name',        label:'Folder',       type:'text',   sortable:true,  filterable:true  },
  { field:'description', label:'Description',  type:'text',   sortable:false, filterable:true  },
  { field:'ownerName',   label:'Owner',        type:'text',   sortable:true,  filterable:true  },
  { field:'isPublic',    label:'Visibility',   type:'select', sortable:true,  filterable:true,  options:['Public','Private'] },
  { field:'accessLevel', label:'Your Access',  type:'select', sortable:true,  filterable:true,  options:['viewer','editor','manager'] },
  { field:'updatedAt',   label:'Updated',      type:'text',   sortable:true,  filterable:false },
]

const REPORT_COLS = [
  { field:'id',            label:'Report #',       type:'text',   sortable:true,  filterable:false },
  { field:'name',          label:'Report',         type:'text',   sortable:true,  filterable:true  },
  { field:'folder',        label:'Folder',         type:'text',   sortable:true,  filterable:true  },
  { field:'primaryObject', label:'Primary Object', type:'text',   sortable:true,  filterable:true  },
  { field:'format',        label:'Format',         type:'select', sortable:true,  filterable:true, options:['Tabular','Summary','Matrix'] },
  { field:'owner',         label:'Owner',          type:'text',   sortable:true,  filterable:true  },
  { field:'lastRun',       label:'Last Run',       type:'text',   sortable:true,  filterable:false },
  { field:'updatedAt',     label:'Updated',        type:'text',   sortable:true,  filterable:false },
]

const SCHED_COLS = [
  { field:'id',        label:'Schedule #',  type:'text',   sortable:true,  filterable:false },
  { field:'name',      label:'Name',        type:'text',   sortable:true,  filterable:true  },
  { field:'report',    label:'Report',      type:'text',   sortable:true,  filterable:true  },
  { field:'frequency', label:'Frequency',   type:'select', sortable:true,  filterable:true, options:['Daily','Weekly','Monthly','Custom'] },
  { field:'format',    label:'Format',      type:'select', sortable:true,  filterable:true, options:['PDF','CSV','EXCEL'] },
  { field:'sendTime',  label:'Send Time',   type:'text',   sortable:true,  filterable:false },
  { field:'active',    label:'Status',      type:'select', sortable:true,  filterable:true, options:['Active','Paused'] },
  { field:'nextSend',  label:'Next Send',   type:'text',   sortable:true,  filterable:false },
  { field:'owner',     label:'Owner',       type:'text',   sortable:true,  filterable:true  },
]

const FOLDER_VIEWS = [
  { id:'FV-01', name:'All Folders',    filters:[],                                                                       sortField:'name', sortDir:'asc' },
  { id:'FV-02', name:'Public Folders', filters:[{ field:'isPublic', label:'Visibility', op:'equals', value:'Public' }],   sortField:'name', sortDir:'asc' },
  { id:'FV-03', name:'My Folders',     filters:[{ field:'isPublic', label:'Visibility', op:'equals', value:'Private' }],  sortField:'name', sortDir:'asc' },
]

const REPORT_VIEWS = [
  { id:'RV-01', name:'Recently Updated', filters:[],                                                                     sortField:'updatedAt', sortDir:'desc' },
  { id:'RV-02', name:'Tabular',          filters:[{ field:'format', label:'Format', op:'equals', value:'Tabular' }],     sortField:'name',      sortDir:'asc' },
  { id:'RV-03', name:'Summary',          filters:[{ field:'format', label:'Format', op:'equals', value:'Summary' }],     sortField:'name',      sortDir:'asc' },
  { id:'RV-04', name:'Matrix',           filters:[{ field:'format', label:'Format', op:'equals', value:'Matrix'  }],     sortField:'name',      sortDir:'asc' },
]

const SCHED_VIEWS = [
  { id:'SV-01', name:'All Schedules', filters:[],                                                                        sortField:'nextSend', sortDir:'asc' },
  { id:'SV-02', name:'Active',        filters:[{ field:'active', label:'Status', op:'equals', value:'Active' }],         sortField:'nextSend', sortDir:'asc' },
  { id:'SV-03', name:'Paused',        filters:[{ field:'active', label:'Status', op:'equals', value:'Paused' }],         sortField:'name',     sortDir:'asc' },
]

// ─── Dashboard list view configuration ────────────────────────────────────

const DASHBOARD_FOLDER_COLS = [
  { field:'id',          label:'Folder #',     type:'text',   sortable:true,  filterable:false },
  { field:'name',        label:'Folder',       type:'text',   sortable:true,  filterable:true  },
  { field:'description', label:'Description',  type:'text',   sortable:false, filterable:true  },
  { field:'ownerName',   label:'Owner',        type:'text',   sortable:true,  filterable:true  },
  { field:'isPublic',    label:'Visibility',   type:'select', sortable:true,  filterable:true,  options:['Public','Private'] },
  { field:'accessLevel', label:'Your Access',  type:'select', sortable:true,  filterable:true,  options:['viewer','editor','manager'] },
  { field:'updatedAt',   label:'Updated',      type:'text',   sortable:true,  filterable:false },
]

const DASHBOARD_COLS = [
  { field:'id',          label:'Dashboard #', type:'text',   sortable:true,  filterable:false },
  { field:'name',        label:'Dashboard',   type:'text',   sortable:true,  filterable:true  },
  { field:'folder',      label:'Folder',      type:'text',   sortable:true,  filterable:true  },
  { field:'description', label:'Description', type:'text',   sortable:false, filterable:true  },
  { field:'columns',     label:'Layout',      type:'text',   sortable:true,  filterable:false },
  { field:'owner',       label:'Owner',       type:'text',   sortable:true,  filterable:true  },
  { field:'lastRun',     label:'Last Run',    type:'text',   sortable:true,  filterable:false },
  { field:'updatedAt',   label:'Updated',     type:'text',   sortable:true,  filterable:false },
]

const DASHBOARD_FOLDER_VIEWS = [
  { id:'DFV-01', name:'All Folders',    filters:[],                                                                         sortField:'name', sortDir:'asc' },
  { id:'DFV-02', name:'Public Folders', filters:[{ field:'isPublic', label:'Visibility', op:'equals', value:'Public' }],     sortField:'name', sortDir:'asc' },
  { id:'DFV-03', name:'My Folders',     filters:[{ field:'isPublic', label:'Visibility', op:'equals', value:'Private' }],    sortField:'name', sortDir:'asc' },
]

const DASHBOARD_VIEWS = [
  { id:'DV-01', name:'Recently Updated', filters:[], sortField:'updatedAt', sortDir:'desc' },
  { id:'DV-02', name:'Recently Run',     filters:[], sortField:'lastRun',   sortDir:'desc' },
]

// ─── Home dashboard ──────────────────────────────────────────────────────

function ReportsHome({ setSec, folders, reports, schedules }) {
  const totalReports = reports.length
  const totalFolders = folders.length
  const activeSchedules = schedules.filter(s => s.active === 'Active').length
  const recentReports = reports.slice(0, 5)

  return (
    <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:11, color:C.textMuted, marginBottom:2 }}>Reports</div>
        <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>Reports & Dashboards</h1>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>Build, run, schedule, and share reports across the database.</div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12, marginBottom:24 }}>
        <StatTile label="Total Reports"    value={totalReports}    onClick={() => setSec('reports')} />
        <StatTile label="Folders"          value={totalFolders}    onClick={() => setSec('folders')} />
        <StatTile label="Active Schedules" value={activeSchedules} onClick={() => setSec('scheduled')} />
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:16 }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:12 }}>Recently Updated Reports</div>
        {recentReports.length === 0 ? (
          <div style={{ fontSize:13, color:C.textMuted, padding:'12px 0', textAlign:'center' }}>
            No reports yet. Build the first one to get started.
          </div>
        ) : (
          <div style={{ display:'grid', gap:6 }}>
            {recentReports.map(r => (
              <div key={r._id} style={{
                display:'grid', gridTemplateColumns:'1fr auto auto', gap:12,
                padding:'8px 10px', background:C.cardSecondary, borderRadius:6,
                fontSize:12, color:C.textPrimary,
              }}>
                <div style={{ fontWeight:500 }}>{r.name}</div>
                <div style={{ color:C.textMuted }}>{r.format}</div>
                <div style={{ color:C.textMuted }}>{r.updatedAt}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background:C.card, border:`1px solid ${C.border}`, borderRadius:8,
        padding:'14px 16px', textAlign:'left', cursor:'pointer', font:'inherit',
        transition:'border-color 200ms',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.borderDark}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
    >
      <div style={{ fontSize:11, color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:24, fontWeight:700, color:C.textPrimary }}>{value}</div>
    </button>
  )
}

// ─── LiveListView wrapper (matches PortalModule pattern) ──────────────────

function LiveListView({ loading, error, data, onRetry, ...rest }) {
  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onRetry} />
  return <ListView data={data} {...rest} />
}

// ─── Module shell ─────────────────────────────────────────────────────────

export default function ReportsModule({
  selectedRecord: navSelectedRecord,
  sectionFromUrl,
  onNavigateToRecord,
  onCloseRecord,
  onSectionChange,
  onReplaceRecord,
  onOpenSetup,
} = {}) {
  // URL-driven nav when App passes nav props (the default in shipping app);
  // local-state fallback so this module can mount in isolation.
  const urlDriven = !!onNavigateToRecord
  const [secLocal, setSecLocal] = useState(() => sectionFromUrl || 'home')
  const sec = sectionFromUrl || secLocal
  const setSec = (s) => {
    if (urlDriven && onSectionChange) onSectionChange(s)
    setSecLocal(s)
  }

  const [selectedRecordLocal, setSelectedRecordLocal] = useState(null)
  const selectedRecord = urlDriven ? navSelectedRecord : selectedRecordLocal
  const setSelectedRecord = (rec) => {
    if (urlDriven) {
      if (rec) onNavigateToRecord(rec)
      else onCloseRecord()
    } else {
      setSelectedRecordLocal(rec)
    }
  }
  const replaceSelectedRecord = (rec) => {
    if (urlDriven && onReplaceRecord) onReplaceRecord(rec)
    else setSelectedRecordLocal(rec)
  }

  const openRecord = (row) => {
    if (row?._id && SEC_TABLE[sec]) {
      setSelectedRecord({ table: SEC_TABLE[sec], id: row._id, name: row.name })
    }
  }
  const closeRecord = () => setSelectedRecord(null)

  const [folders, setFolders]                       = useState([])
  const [reports, setReports]                       = useState([])
  const [schedules, setSchedules]                   = useState([])
  const [dashboardFolders, setDashboardFolders]     = useState([])
  const [dashboards, setDashboards]                 = useState([])
  const [loading, setLoading]                       = useState(true)
  const [error, setError]                           = useState(null)

  const loadAll = async () => {
    setError(null)
    try {
      const [f, r, s, df, d] = await Promise.all([
        fetchReportFolders(), fetchReports(), fetchScheduledReports(),
        fetchDashboardFolders(), fetchDashboards(),
      ])
      setFolders(f); setReports(r); setSchedules(s)
      setDashboardFolders(df); setDashboards(d)
    } catch (err) {
      setError(err)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([
      fetchReportFolders(), fetchReports(), fetchScheduledReports(),
      fetchDashboardFolders(), fetchDashboards(),
    ])
      .then(([f, r, s, df, d]) => {
        if (!cancelled) {
          setFolders(f); setReports(r); setSchedules(s)
          setDashboardFolders(df); setDashboards(d)
        }
      })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const counts = {
    folders:           folders.length,
    reports:           reports.length,
    dashboard_folders: dashboardFolders.length,
    dashboards:        dashboards.length,
    scheduled:         schedules.length,
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div data-module-topbar="1" style={{ height:54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Reports & Dashboards</span>
          <span style={{ color:C.textMuted }}>/</span>
          <span style={{ color: selectedRecord ? C.textMuted : C.textPrimary, fontWeight: selectedRecord ? 400 : 500, cursor: selectedRecord ? 'pointer' : 'default' }} onClick={() => selectedRecord && closeRecord()}>{SECTIONS.find(s=>s.id===sec)?.label}</span>
          {selectedRecord && <><span style={{ color:C.textMuted }}>/</span><span style={{ color:C.textPrimary, fontWeight:500 }}>{selectedRecord.name || 'Record'}</span></>}
        </div>
      </div>
      <SectionTabs sections={SECTIONS} active={sec} onChange={s => { setSec(s); closeRecord(); }} counts={counts} />
      <div style={{ flex:1, overflow:'hidden', display:'flex' }}>
        {selectedRecord ? (
          selectedRecord.table === 'reports' ? (
            // New report or explicit edit mode → Builder.
            // Existing report opened from the list → run it.
            (selectedRecord.id === null || selectedRecord.id === 'new' || selectedRecord.mode === 'edit') ? (
              <ReportBuilder
                reportId={selectedRecord.id || 'new'}
                onClose={closeRecord}
                onSaved={(newId) => {
                  loadAll()
                  // After saving, drop into runner mode for the freshly-saved report
                  replaceSelectedRecord({ table:'reports', id:newId, mode:'view' })
                }}
              />
            ) : (
              <ReportRunner
                reportId={selectedRecord.id}
                onClose={closeRecord}
                onEdit={() => replaceSelectedRecord({ table:'reports', id:selectedRecord.id, mode:'edit' })}
                onDuplicate={(newId) => {
                  // After a clone, refresh the list view (so the new
                  // report appears in the Reports tab if the user
                  // closes the record) and drop the user straight into
                  // the Builder for the new copy. Edit mode rather than
                  // view: the most-likely first action after duplicating
                  // is to rename and tweak the clone.
                  loadAll()
                  replaceSelectedRecord({ table:'reports', id:newId, mode:'edit' })
                }}
              />
            )
          ) : selectedRecord.table === 'dashboards' ? (
            // Same pattern for dashboards: new or edit → Editor, otherwise Runner
            (selectedRecord.id === null || selectedRecord.id === 'new' || selectedRecord.mode === 'edit' || selectedRecord.mode === 'create') ? (
              <DashboardEditor
                dashboardId={selectedRecord.id || 'new'}
                onClose={closeRecord}
                onSaved={(newId) => {
                  loadAll()
                  replaceSelectedRecord({ table:'dashboards', id:newId, mode:'view' })
                }}
              />
            ) : (
              <DashboardRunner
                dashboardId={selectedRecord.id}
                onClose={closeRecord}
                onEdit={() => replaceSelectedRecord({ table:'dashboards', id:selectedRecord.id, mode:'edit' })}
                onOpenReport={(reportId) => setSelectedRecord({ table:'reports', id:reportId, mode:'view' })}
              />
            )
          ) : selectedRecord.table === 'scheduled_reports' ? (
            // Schedule editor — single screen (no separate runner; the
            // dispatcher fires schedules in the background). New or
            // existing both go to ScheduleEditor.
            <ScheduleEditor
              scheduleId={selectedRecord.id || 'new'}
              onClose={closeRecord}
              onSaved={(newId) => {
                loadAll()
                replaceSelectedRecord({ table:'scheduled_reports', id:newId, mode:'view' })
              }}
            />
          ) : (
            <RecordDetail
              tableName={selectedRecord.table}
              recordId={selectedRecord.id}
              onBack={closeRecord}
              mode={selectedRecord.mode || 'view'}
              onRecordCreated={(r) => replaceSelectedRecord({ table: r.table, id: r.id, mode: 'view' })}
              prefill={selectedRecord.prefill}
              onNavigateToRecord={(r) => setSelectedRecord({ table: r.table, id: r.id, mode: r.mode, prefill: r.prefill })}
            />
          )
        ) : (<>
          {sec === 'home' && (
            <ReportsHome setSec={setSec} folders={folders} reports={reports} schedules={schedules} />
          )}
          {sec === 'folders' && (
            <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll}
              data={folders} listObject="report_folders" listModule="reports" columns={FOLDER_COLS} systemViews={FOLDER_VIEWS} defaultViewId="FV-01"
              newLabel="Folder"
              onNew={() => setSelectedRecord({ table:'report_folders', id:null, mode:'create' })}
              onOpenRecord={openRecord} />
          )}
          {sec === 'reports' && (
            <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll}
              data={reports} listObject="reports" listModule="reports" columns={REPORT_COLS} systemViews={REPORT_VIEWS} defaultViewId="RV-01"
              newLabel="Report"
              onNew={() => setSelectedRecord({ table:'reports', id:null, mode:'create' })}
              onOpenRecord={openRecord} />
          )}
          {sec === 'dashboard_folders' && (
            <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll}
              data={dashboardFolders} listObject="dashboard_folders" listModule="reports" columns={DASHBOARD_FOLDER_COLS} systemViews={DASHBOARD_FOLDER_VIEWS} defaultViewId="DFV-01"
              newLabel="Folder"
              onNew={() => setSelectedRecord({ table:'dashboard_folders', id:null, mode:'create' })}
              onOpenRecord={openRecord} />
          )}
          {sec === 'dashboards' && (
            <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll}
              data={dashboards} listObject="dashboards" listModule="reports" columns={DASHBOARD_COLS} systemViews={DASHBOARD_VIEWS} defaultViewId="DV-01"
              newLabel="Dashboard"
              onNew={() => setSelectedRecord({ table:'dashboards', id:null, mode:'create' })}
              onOpenRecord={openRecord} />
          )}
          {sec === 'scheduled' && (
            <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll}
              data={schedules} listObject="scheduled_reports" listModule="reports" columns={SCHED_COLS} systemViews={SCHED_VIEWS} defaultViewId="SV-01"
              newLabel="Schedule"
              onNew={() => setSelectedRecord({ table:'scheduled_reports', id:null, mode:'create' })}
              onOpenRecord={openRecord} />
          )}
        </>)}
      </div>
    </div>
  )
}
