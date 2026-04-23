import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { C, fmt } from '../data/constants'
import { Badge, Icon, TableRow, ProgramTag, SectionTabs } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import { fetchAssessments, fetchIncentiveApplications, fetchEfrReports } from '../data/qualificationService'

const SECTIONS = [
  { id:'home',        label:'Home'                   },
  { id:'assessments', label:'Assessments'            },
  { id:'applications',label:'Incentive Applications' },
  { id:'efr',         label:'EFR Reports'            },
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

function QualHome({ setSec, assessments, applications, efrReports }) {
  const toReview = assessments.filter(a => a.status === 'Assessment Completed — To Be Reviewed')
  const verified = assessments.filter(a => a.status === 'Assessment Verified')
  const corrections = applications.filter(a => a.status === 'Incentive Application Corrections Needed')
  const toPrepare = applications.filter(a => a.status === 'Incentive Application To Be Prepared' || a.status === 'Incentive Application To Be Verified' || a.status === 'Incentive Application To Be Submitted')
  const approvedPipeline = applications.filter(a => a.status === 'Incentive Application Approved' || a.status === 'Incentive Application Pre-Approved').reduce((s,r) => s + (r.amount||0), 0)

  const asmtByStatus = [
    { name: 'To Be Scheduled', value: assessments.filter(a => a.status === 'Assessment To Be Scheduled').length },
    { name: 'Scheduled',       value: assessments.filter(a => a.status === 'Assessment Scheduled').length },
    { name: 'To Be Reviewed',  value: toReview.length },
    { name: 'Verified',        value: verified.length },
  ]

  return (
    <div style={{ flex:1, overflow:'auto', display:'flex' }}>
      <div style={{ flex:1, overflow:'auto', padding:'20px 20px 24px' }}>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, color:C.textMuted, marginBottom:2 }}>Qualification / Home</div>
          <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>Qualification Dashboard</h1>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>Nicholas Wood · Sunday, April 12, 2026</div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12, marginBottom:16 }}>
          {[
            { label:'Assessments to Review',  value:toReview.length,   color:C.amber,  action:() => setSec('assessments')  },
            { label:'Corrections Needed',     value:corrections.length,color:C.danger, urgent:corrections.length>0, action:() => setSec('applications') },
            { label:'Applications to Prepare',value:toPrepare.length,  color:C.sky,    action:() => setSec('applications') },
            { label:'Approved Pipeline',      value:fmt(approvedPipeline), color:C.emerald, action:() => setSec('applications') },
          ].map(s => (
            <div key={s.label} onClick={s.action}
              style={{ background:C.card, border:`2px solid ${s.urgent?C.danger:C.border}`, borderTop:`3px solid ${s.color}`, borderRadius:8, padding:'14px 16px', cursor:'pointer' }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
              <div style={{ fontSize:11, color:C.textMuted, fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:8 }}>{s.label}</div>
              <div style={{ fontSize:s.label==='Approved Pipeline'?18:26, fontWeight:700, color:s.urgent?C.danger:s.color, fontFamily:'JetBrains Mono, monospace', marginBottom:4 }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:14, marginBottom:14 }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
            <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}><div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Assessments by Status</div></div>
            <div style={{ padding:'10px 14px' }}>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={asmtByStatus} margin={{ left:0, right:10, top:8, bottom:0 }}>
                  <XAxis dataKey="name" tick={{ fontSize:10, fill:C.textMuted }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize:10, fill:C.textMuted }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize:11, border:`1px solid ${C.border}`, borderRadius:5 }} />
                  <Bar dataKey="value" radius={[4,4,0,0]} fill={C.sky} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ padding:'8px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={() => setSec('assessments')} style={{ color:'#1a5a8a', fontSize:11, cursor:'pointer', fontWeight:500 }}>View Assessments →</span></div>
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
            <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}><div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Incentive Applications by Status</div></div>
            <div style={{ padding:'10px 14px' }}>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={[
                  { name:'To Prepare', value: applications.filter(a => a.status.includes('To Be')).length },
                  { name:'Submitted',  value: applications.filter(a => a.status.includes('Submitted')).length },
                  { name:'Pre-Approved',value:applications.filter(a => a.status === 'Incentive Application Pre-Approved').length },
                  { name:'Approved',   value: applications.filter(a => a.status === 'Incentive Application Approved').length },
                  { name:'Corrections',value: corrections.length },
                ]} margin={{ left:0, right:10, top:8, bottom:0 }}>
                  <XAxis dataKey="name" tick={{ fontSize:10, fill:C.textMuted }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize:10, fill:C.textMuted }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize:11, border:`1px solid ${C.border}`, borderRadius:5 }} />
                  <Bar dataKey="value" radius={[4,4,0,0]} fill={C.emerald} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ padding:'8px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={() => setSec('applications')} style={{ color:'#1a5a8a', fontSize:11, cursor:'pointer', fontWeight:500 }}>View Applications →</span></div>
          </div>
        </div>

        {/* Assessments to review */}
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Assessments — To Be Reviewed</div>
            <span style={{ background:toReview.length>0?C.amber:'#e8f8f2', color:toReview.length>0?'#8a5a0a':'#1a7a4e', fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:10 }}>{toReview.length}</span>
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr style={{ borderBottom:`1px solid ${C.border}` }}>{['Record #','Assessment','Property','Assessor','Completed','Buildings','Units','Action'].map(h => <th key={h} style={{ padding:'9px 12px', textAlign:'left', color:C.textMuted, fontWeight:500, fontSize:11, textTransform:'uppercase', letterSpacing:'0.04em' }}>{h}</th>)}</tr></thead>
            <tbody>
              {toReview.map(a => (
                <TableRow key={a.id}>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textMuted, fontFamily:'JetBrains Mono, monospace', fontSize:10 }}>{a.id}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textPrimary, fontWeight:500 }}>{a.name}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textSecondary }}>{a.property}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textSecondary }}>{a.assessor}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textSecondary }}>{a.completedDate || '—'}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textSecondary }}>{a.buildings}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textSecondary }}>{a.units}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}` }}><button style={{ background:'#fef3e2', color:'#8a5a0a', border:`1px solid #f0d8a0`, borderRadius:5, padding:'3px 8px', fontSize:11, fontWeight:600, cursor:'pointer' }}>Review</button></td>
                </TableRow>
              ))}
              {toReview.length === 0 && <tr><td colSpan={8} style={{ padding:'24px', textAlign:'center', color:C.textMuted, fontSize:12 }}>No assessments pending review.</td></tr>}
            </tbody>
          </table>
          <div style={{ padding:'9px 16px', borderTop:`1px solid ${C.border}` }}><span onClick={() => setSec('assessments')} style={{ color:'#1a5a8a', fontSize:11, cursor:'pointer', fontWeight:500 }}>View All Assessments →</span></div>
        </div>
      </div>

      {/* Right sidebar */}
      <div style={{ width:280, flexShrink:0, background:C.page, borderLeft:`1px solid ${C.border}`, padding:'20px 14px', overflowY:'auto' }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden', marginBottom:12 }}>
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontWeight:600, fontSize:13, color:C.textPrimary }}>Corrections Needed</span>
            <span style={{ background:corrections.length>0?C.danger:'#e8f8f2', color:corrections.length>0?'#fff':'#1a7a4e', fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:10 }}>{corrections.length}</span>
          </div>
          {corrections.map((a,i) => (
            <div key={a.id} style={{ padding:'10px 14px', borderBottom:i<corrections.length-1?`1px solid ${C.border}`:'none', cursor:'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background='#fff8f8'} onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              <div style={{ color:C.danger, fontSize:12, fontWeight:500, marginBottom:2 }}>{a.id}</div>
              <div style={{ color:C.textSecondary, fontSize:11, marginBottom:1 }}>{a.property}</div>
              <ProgramTag value={a.program} />
            </div>
          ))}
          {corrections.length === 0 && <div style={{ padding:'16px', textAlign:'center', color:C.textMuted, fontSize:12 }}>All clear.</div>}
          <div style={{ padding:'9px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={() => setSec('applications')} style={{ color:'#1a5a8a', fontSize:12, cursor:'pointer', fontWeight:500 }}>View All</span></div>
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}><span style={{ fontWeight:600, fontSize:13, color:C.textPrimary }}>Recent Applications</span></div>
          {applications.slice(0,5).map((a,i) => (
            <div key={a.id} style={{ padding:'9px 14px', borderBottom:i<4?`1px solid ${C.border}`:'none', cursor:'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background='#f7f9fc'} onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              <div style={{ color:'#1a5a8a', fontSize:11, fontWeight:500, marginBottom:2 }}>{a.id}</div>
              <div style={{ color:C.textMuted, fontSize:10, marginBottom:3 }}>{a.property}</div>
              <Badge s={a.status} />
            </div>
          ))}
          <div style={{ padding:'9px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={() => setSec('applications')} style={{ color:'#1a5a8a', fontSize:12, cursor:'pointer', fontWeight:500 }}>View All</span></div>
        </div>
      </div>
    </div>
  )
}

function LiveListView({ loading, error, data, ...rest }) {
  if (loading) return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:C.textMuted, fontSize:13 }}>Loading…</div>
  if (error) return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8, padding:24 }}><div style={{ color:'#b03a2e', fontSize:13, fontWeight:600 }}>Could not load records</div><div style={{ color:C.textMuted, fontSize:12, fontFamily:'JetBrains Mono, monospace', maxWidth:560, textAlign:'center' }}>{String(error.message || error)}</div></div>
  return <ListView data={data} {...rest} />
}

export default function QualificationModule() {
  const [sec, setSec] = useState('home')
  const [selectedRecord, setSelectedRecord] = useState(null)
  const SEC_TABLE = {'assessments': 'assessments', 'applications': 'incentive_applications', 'efr': 'efr_reports'}
  const openRecord = (row) => { if (row?._id && SEC_TABLE[sec]) setSelectedRecord({ table: SEC_TABLE[sec], id: row._id, name: row.name }) }
  const closeRecord = () => setSelectedRecord(null)
  const [assessments, setAssessments] = useState([])
  const [applications, setApplications] = useState([])
  const [efrReports, setEfrReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchAssessments(), fetchIncentiveApplications(), fetchEfrReports()])
      .then(([a, i, e]) => { if (!cancelled) { setAssessments(a); setApplications(i); setEfrReports(e) } })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const corrections = applications.filter(a => a.status === 'Incentive Application Corrections Needed').length
  const counts = { assessments: assessments.length, applications: applications.length, efr: efrReports.length }
  const urgentSections = { home: corrections }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ height:54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
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
            onRecordCreated={(r) => setSelectedRecord({ table: r.table, id: r.id })}
            prefill={selectedRecord.prefill}
            onNavigateToRecord={(r) => setSelectedRecord({ table: r.table, id: r.id, mode: r.mode, prefill: r.prefill })} />
        ) : (<>
        {sec==='home'         && <QualHome setSec={setSec} assessments={assessments} applications={applications} efrReports={efrReports} />}
        {sec==='assessments'  && <LiveListView loading={loading} error={error} data={assessments} columns={ASMT_COLS} systemViews={ASMT_VIEWS} defaultViewId="AV-01" newLabel="Assessment"  onNew={() => setSelectedRecord({ table: 'assessments', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='applications' && <LiveListView loading={loading} error={error} data={applications} columns={IA_COLS}   systemViews={IA_VIEWS}   defaultViewId="IV-01" newLabel="Application" onNew={() => setSelectedRecord({ table: 'incentive_applications', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='efr'          && <LiveListView loading={loading} error={error} data={efrReports}  columns={EFR_COLS}  systemViews={EFR_VIEWS}  defaultViewId="EV-01" newLabel="EFR Report"  onNew={() => setSelectedRecord({ table: 'efr_reports', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        </>)}
      </div>
    </div>
  )
}
