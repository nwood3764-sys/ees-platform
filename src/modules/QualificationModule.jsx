import { useState, useEffect } from 'react'
import { useModuleSections } from '../lib/useModuleSections'
import { C } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import ObjectListSection from '../components/ObjectListSection'
import ConfiguredHome from '../components/ConfiguredHome'
import { fetchAssessments, fetchIncentiveApplications, fetchEfrReports } from '../data/qualificationService'
import { fetchOpportunities } from '../data/outreachService'

const CODE_SECTIONS = [
  { id:'home',        label:'Home'                   },
  { id:'assessments', label:'Assessments'            },
  { id:'applications',label:'Incentive Applications' },
  { id:'efr',         label:'EFR Reports'            },
  { id:'opportunities', label:'Opportunities'        },
]

const ASMT_COLS = [
  { field:'id',            label:'Record #',   type:'text',   sortable:true, filterable:false },
  { field:'name',          label:'Assessment', type:'text',   sortable:true, filterable:true  },
  { field:'property',      label:'Property',   type:'text',   sortable:true, filterable:true  },
  { field:'type',          label:'Type',       type:'select', sortable:true, filterable:true, options:['ASHRAE Level 2','Blower Door Diagnostic','ASHRAE Level 1'] },
  { field:'status',        label:'Status',     type:'select', sortable:true, filterable:true, options:['Assessment To Be Scheduled','Assessment Scheduled','Assessment In Progress','Assessment Completed — To Be Reviewed','Assessment Verified'] },
  { field:'assessor',      label:'Assessor',   type:'select', sortable:true, filterable:true, options:['Marcus Reid','Priya Nair','Lisa Tanaka'] },
  { field:'scheduledDate', label:'Scheduled',  type:'date',   sortable:true, filterable:true  },
  { field:'completedDate', label:'Completed',  type:'date',   sortable:true, filterable:true  },
  { field:'units',         label:'Units',      type:'text',   sortable:true, filterable:false },
  { field:'state',         label:'State',      type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

const IA_COLS = [
  { field:'id',            label:'Record #',   type:'text',   sortable:true, filterable:false },
  { field:'name',          label:'Application',type:'text',   sortable:true, filterable:true  },
  { field:'property',      label:'Property',   type:'text',   sortable:true, filterable:true  },
  { field:'program',       label:'Program',    type:'select', sortable:true, filterable:true, options:['WI-IRA-MF-HOMES','WI-IRA-MF-HEAR','WI-IRA-SF-HOMES','CO - Denver','WI - FOE','MI-IRA-MF-HOMES'] },
  { field:'status',        label:'Status',     type:'select', sortable:true, filterable:true, options:['Incentive Application To Be Prepared','Incentive Application To Be Verified','Incentive Application To Be Submitted','Incentive Application Submitted — Awaiting Program Response','Incentive Application Pre-Approved','Incentive Application Approved','Incentive Application Corrections Needed','Incentive Application Denied'] },
  { field:'owner',         label:'Owner',      type:'select', sortable:true, filterable:true, options:['Marcus Reid','Priya Nair','Lisa Tanaka'] },
  { field:'amount',        label:'Amount',     type:'text',   sortable:true, filterable:false },
  { field:'submittedDate', label:'Submitted',  type:'date',   sortable:true, filterable:true  },
  { field:'programYear',   label:'Program Year',type:'select',sortable:true, filterable:true, options:['2025','2026'] },
  { field:'state',         label:'State',      type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

const EFR_COLS = [
  { field:'id',            label:'Record #',  type:'text',   sortable:true, filterable:false },
  { field:'name',          label:'EFR',       type:'text',   sortable:true, filterable:true  },
  { field:'property',      label:'Property',  type:'text',   sortable:true, filterable:true  },
  { field:'status',        label:'Status',    type:'select', sortable:true, filterable:true, options:['EFR To Be Scheduled','EFR In Progress','EFR Completed — To Be Reviewed','EFR Verified'] },
  { field:'assessor',      label:'Assessor',  type:'select', sortable:true, filterable:true, options:['Marcus Reid','Priya Nair','Lisa Tanaka'] },
  { field:'reportType',    label:'Report Type',type:'text',  sortable:true, filterable:true  },
  { field:'scheduledDate', label:'Scheduled', type:'date',   sortable:true, filterable:true  },
  { field:'completedDate', label:'Completed', type:'date',   sortable:true, filterable:true  },
  { field:'buildings',     label:'Buildings', type:'text',   sortable:true, filterable:false },
  { field:'units',         label:'Units',     type:'text',   sortable:true, filterable:false },
  { field:'state',         label:'State',     type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

const ASMT_VIEWS = [
  { id:'AV-01', name:'All Assessments', filters:[], sortField:'scheduledDate', sortDir:'asc' },
  { id:'AV-02', name:'To Be Reviewed',  filters:[{ field:'status', label:'Status', op:'equals', value:'Assessment Completed — To Be Reviewed' }], sortField:'scheduledDate', sortDir:'asc' },
  { id:'AV-03', name:'Verified',        filters:[{ field:'status', label:'Status', op:'equals', value:'Assessment Verified' }], sortField:'property', sortDir:'asc' },
]
const IA_VIEWS = [
  { id:'IV-01', name:'All Applications',    filters:[], sortField:'submittedDate', sortDir:'desc' },
  { id:'IV-02', name:'Approved',            filters:[{ field:'status', label:'Status', op:'equals', value:'Incentive Application Approved' }], sortField:'property', sortDir:'asc' },
  { id:'IV-03', name:'Corrections Needed',  filters:[{ field:'status', label:'Status', op:'equals', value:'Incentive Application Corrections Needed' }], sortField:'property', sortDir:'asc' },
  { id:'IV-04', name:'To Be Submitted',     filters:[{ field:'status', label:'Status', op:'equals', value:'Incentive Application To Be Submitted' }], sortField:'property', sortDir:'asc' },
]
const EFR_VIEWS = [{ id:'EV-01', name:'All EFR Reports', filters:[], sortField:'scheduledDate', sortDir:'asc' }]

const OPP_COLS = [
  { field:'id',        label:'Record #',    type:'text',   sortable:true, filterable:false },
  { field:'name',      label:'Opportunity', type:'text',   sortable:true, filterable:true  },
  { field:'property',  label:'Property',    type:'text',   sortable:true, filterable:true  },
  { field:'stage',     label:'Stage',       type:'text',   sortable:true, filterable:true  },
  { field:'program',   label:'Program',     type:'text',   sortable:true, filterable:true  },
  { field:'amount',    label:'Amount',      type:'text',   sortable:true, filterable:false },
  { field:'closeDate', label:'Close',       type:'date',   sortable:true, filterable:true  },
  { field:'state',     label:'State',       type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]
const OPP_VIEWS = [{ id:'QOP-01', name:'All Opportunities', filters:[], sortField:'closeDate', sortDir:'asc' }]

function LiveListView({ loading, error, data, onRetry, ...rest }) {
  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onRetry} />
  return <ListView data={data} {...rest} />
}

export default function QualificationModule({ selectedRecord: navSelectedRecord, sectionFromUrl, onNavigateToRecord, onCloseRecord, onSectionChange, onReplaceRecord, onOpenSetup } = {}) {
  const SECTIONS = useModuleSections('qualification', CODE_SECTIONS)
  // Navigation is URL-driven when App passes nav props (the default in the
  // shipping app). The local-state fallback path remains so this module can
  // still mount in isolation (tests, future embeds).
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

  const SEC_TABLE = {'assessments': 'assessments', 'applications': 'incentive_applications', 'efr': 'efr_reports', 'opportunities': 'opportunities'}
  const openRecord = (row) => { if (row?._id && SEC_TABLE[sec]) setSelectedRecord({ table: SEC_TABLE[sec], id: row._id, name: row.name }) }
  const closeRecord = () => setSelectedRecord(null)
  const [assessments, setAssessments] = useState([])
  const [applications, setApplications] = useState([])
  const [efrReports, setEfrReports] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Pull-to-refresh handler.
  const loadAll = async () => {
    setError(null)
    try {
      const [a, i, e, o] = await Promise.all([
        fetchAssessments(), fetchIncentiveApplications(), fetchEfrReports(), fetchOpportunities(),
      ])
      setAssessments(a); setApplications(i); setEfrReports(e); setOpportunities(o)
    } catch (err) {
      setError(err)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([fetchAssessments(), fetchIncentiveApplications(), fetchEfrReports(), fetchOpportunities()])
      .then(([a, i, e, o]) => { if (!cancelled) { setAssessments(a); setApplications(i); setEfrReports(e); setOpportunities(o) } })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const corrections = applications.filter(a => a.status === 'Incentive Application Corrections Needed').length
  const counts = { assessments: assessments.length, applications: applications.length, efr: efrReports.length, opportunities: opportunities.length }
  const urgentSections = { home: corrections }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div data-module-topbar="1" style={{ height: 54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Qualification</span><span style={{ color:C.textMuted }}>/</span>
          <span style={{ color:C.textPrimary, fontWeight:500 }}>{SECTIONS.find(s => s.id===sec)?.label}</span>
        </div>
        <button style={{ display:'flex', alignItems:'center', gap:6, background:C.page, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 12px', fontSize:12.5, color:C.textSecondary, cursor:'pointer', fontWeight:500 }}>
          <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" size={13} color={C.textSecondary} />Reports
        </button>
      </div>
      <SectionTabs sections={SECTIONS} active={sec} onChange={s => { setSec(s); closeRecord(); }} counts={counts} urgentSections={urgentSections} />
      <div style={{ flex:1, overflow:'hidden', display:'flex' }}>
        {selectedRecord ? (
          <RecordDetail tableName={selectedRecord.table} recordId={selectedRecord.id} onBack={closeRecord}
            mode={selectedRecord.mode || 'view'}
            onRecordCreated={(r) => replaceSelectedRecord({ table: r.table, id: r.id, mode: 'view' })}
            prefill={selectedRecord.prefill}
            onNavigateToRecord={(r) => setSelectedRecord({ table: r.table, id: r.id, mode: r.mode, prefill: r.prefill })} />
        ) : (<>
        {SECTIONS.find(s=>s.id===sec)?.objectTable && (
          <ObjectListSection objectTable={SECTIONS.find(s=>s.id===sec).objectTable} moduleId="qualification" />
        )}
        {sec==='home'         && <ConfiguredHome crumb="Qualification" moduleId="qualification" onOpenSetup={onOpenSetup} onOpenRecord={(r) => setSelectedRecord(r)} />}
        {sec==='assessments'  && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={assessments} listObject="assessments" listModule="qualification" columns={ASMT_COLS} systemViews={ASMT_VIEWS} defaultViewId="AV-01" newLabel="Assessment"  onNew={() => setSelectedRecord({ table: 'assessments', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='applications' && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={applications} listObject="incentive_applications" listModule="qualification" columns={IA_COLS}   systemViews={IA_VIEWS}   defaultViewId="IV-01" newLabel="Application" onNew={() => setSelectedRecord({ table: 'incentive_applications', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='efr'          && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={efrReports}  listObject="efr_reports" listModule="qualification" columns={EFR_COLS}  systemViews={EFR_VIEWS}  defaultViewId="EV-01" newLabel="EFR Report"  onNew={() => setSelectedRecord({ table: 'efr_reports', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='opportunities'&& <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={opportunities} listObject="opportunities_qualification" listModule="qualification" columns={OPP_COLS} systemViews={OPP_VIEWS} defaultViewId="QOP-01" newLabel="Opportunity" onNew={() => setSelectedRecord({ table: 'opportunities', id: null, mode: 'create' })} onOpenRecord={openRecord}/>}
        </>)}
      </div>
    </div>
  )
}
