import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import { fetchReportFolders, fetchReports, fetchScheduledReports } from '../data/reportsService'
import ReportBuilder from './ReportBuilder'
import ReportRunner from './ReportRunner'

// ─── Section definitions ──────────────────────────────────────────────────

const SECTIONS = [
  { id: 'home',      label: 'Home' },
  { id: 'folders',   label: 'Folders' },
  { id: 'reports',   label: 'All Reports' },
  { id: 'scheduled', label: 'Scheduled' },
]

const SEC_TABLE = {
  folders:   'report_folders',
  reports:   'reports',
  scheduled: 'scheduled_reports',
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

  const [folders, setFolders]     = useState([])
  const [reports, setReports]     = useState([])
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  const loadAll = async () => {
    setError(null)
    try {
      const [f, r, s] = await Promise.all([
        fetchReportFolders(), fetchReports(), fetchScheduledReports(),
      ])
      setFolders(f); setReports(r); setSchedules(s)
    } catch (err) {
      setError(err)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([fetchReportFolders(), fetchReports(), fetchScheduledReports()])
      .then(([f, r, s]) => { if (!cancelled) { setFolders(f); setReports(r); setSchedules(s) } })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const counts = { folders: folders.length, reports: reports.length, scheduled: schedules.length }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div data-module-topbar="1" style={{ height:54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Reports</span>
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
              />
            )
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
              data={folders} columns={FOLDER_COLS} systemViews={FOLDER_VIEWS} defaultViewId="FV-01"
              newLabel="Folder"
              onNew={() => setSelectedRecord({ table:'report_folders', id:null, mode:'create' })}
              onOpenRecord={openRecord} />
          )}
          {sec === 'reports' && (
            <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll}
              data={reports} columns={REPORT_COLS} systemViews={REPORT_VIEWS} defaultViewId="RV-01"
              newLabel="Report"
              onNew={() => setSelectedRecord({ table:'reports', id:null, mode:'create' })}
              onOpenRecord={openRecord} />
          )}
          {sec === 'scheduled' && (
            <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll}
              data={schedules} columns={SCHED_COLS} systemViews={SCHED_VIEWS} defaultViewId="SV-01"
              newLabel="Schedule"
              onNew={() => setSelectedRecord({ table:'scheduled_reports', id:null, mode:'create' })}
              onOpenRecord={openRecord} />
          )}
        </>)}
      </div>
    </div>
  )
}
