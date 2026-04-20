import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { C } from '../data/constants'
import { Icon, SectionTabs } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import {
  fetchRoles,
  fetchPrograms,
  fetchWorkTypes,
  fetchEmailTemplates,
  fetchDocumentTemplates,
  fetchAutomationRules,
  fetchValidationRules,
  fetchPicklistValues,
} from '../data/adminService'

// ---------------------------------------------------------------------------
// Tab definitions — roughly mapped to the Builder suite in project instructions
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: 'home',        label: 'Home'              },
  { id: 'programs',    label: 'Program Builder'   },
  { id: 'worktypes',   label: 'Work Plan Builder' },
  { id: 'emails',      label: 'Email Templates'   },
  { id: 'documents',   label: 'Document Templates'},
  { id: 'automations', label: 'Automation Builder'},
  { id: 'validations', label: 'Validation Rules'  },
  { id: 'roles',       label: 'Roles & Permissions'},
  { id: 'picklists',   label: 'Picklist Values'   },
]

const ROLE_COLS = [
  { field:'id',          label:'Record #',   type:'text', sortable:true, filterable:false },
  { field:'name',        label:'Role',       type:'text', sortable:true, filterable:true  },
  { field:'description', label:'Description',type:'text', sortable:false, filterable:true },
  { field:'status',      label:'Status',     type:'select', sortable:true, filterable:true, options:['Active','Inactive'] },
]

const PROG_COLS = [
  { field:'id',                label:'Short Name',        type:'text', sortable:true, filterable:false },
  { field:'name',              label:'Program',           type:'text', sortable:true, filterable:true  },
  { field:'state',             label:'State',             type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI','IN','All'] },
  { field:'programType',       label:'Type',              type:'text', sortable:true, filterable:true  },
  { field:'housingType',       label:'Housing',           type:'text', sortable:true, filterable:true  },
  { field:'roleType',          label:'Our Role',          type:'text', sortable:true, filterable:true  },
  { field:'administeringBody', label:'Administered By',   type:'text', sortable:true, filterable:true  },
  { field:'year',              label:'Year',              type:'text', sortable:true, filterable:false },
  { field:'version',           label:'Version',           type:'text', sortable:true, filterable:false },
  { field:'status',            label:'Status',            type:'text', sortable:true, filterable:true  },
]

const WT_COLS = [
  { field:'id',           label:'Record #',     type:'text', sortable:true, filterable:false },
  { field:'name',         label:'Work Type',    type:'text', sortable:true, filterable:true },
  { field:'description',  label:'Description',  type:'text', sortable:false, filterable:true },
  { field:'estDuration',  label:'Est. Duration',type:'text', sortable:true, filterable:false },
  { field:'minCrew',      label:'Min Crew',     type:'text', sortable:true, filterable:false },
  { field:'recCrew',      label:'Rec Crew',     type:'text', sortable:true, filterable:false },
  { field:'status',       label:'Status',       type:'select', sortable:true, filterable:true, options:['Active','Inactive'] },
]

const ET_COLS = [
  { field:'id',            label:'Record #',    type:'text', sortable:true, filterable:false },
  { field:'name',          label:'Template',    type:'text', sortable:true, filterable:true },
  { field:'subject',       label:'Subject',     type:'text', sortable:true, filterable:true },
  { field:'relatedObject', label:'Object',      type:'text', sortable:true, filterable:true },
  { field:'state',         label:'State',       type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI','IN','—'] },
  { field:'triggerStatus', label:'Trigger Status', type:'text', sortable:true, filterable:true },
  { field:'automated',     label:'Auto',        type:'select', sortable:true, filterable:true, options:['Yes','No'] },
  { field:'status',        label:'Status',      type:'text', sortable:true, filterable:true },
]

const DT_COLS = [
  { field:'id',                 label:'Record #',        type:'text', sortable:true, filterable:false },
  { field:'name',               label:'Document Template', type:'text', sortable:true, filterable:true },
  { field:'templateType',       label:'Type',            type:'text', sortable:true, filterable:true },
  { field:'relatedObject',      label:'Object',          type:'text', sortable:true, filterable:true },
  { field:'requiresSignature',  label:'Signature',       type:'select', sortable:true, filterable:true, options:['Yes','No'] },
  { field:'signerRole',         label:'Signer Role',     type:'text', sortable:true, filterable:true },
  { field:'automated',          label:'Auto',            type:'select', sortable:true, filterable:true, options:['Yes','No'] },
  { field:'status',             label:'Status',          type:'text', sortable:true, filterable:true },
]

const AR_COLS = [
  { field:'id',             label:'Record #',   type:'text', sortable:true, filterable:false },
  { field:'name',           label:'Rule',       type:'text', sortable:true, filterable:true },
  { field:'triggerObject',  label:'Trigger Object', type:'text', sortable:true, filterable:true },
  { field:'triggerEvent',   label:'Event',      type:'text', sortable:true, filterable:true },
  { field:'triggerStatus',  label:'Status',     type:'text', sortable:true, filterable:true },
  { field:'actionType',     label:'Action',     type:'text', sortable:true, filterable:true },
  { field:'executionOrder', label:'Order',      type:'text', sortable:true, filterable:false },
  { field:'status',         label:'Active?',    type:'select', sortable:true, filterable:true, options:['Active','Inactive'] },
]

const VR_COLS = [
  { field:'id',             label:'Record #',  type:'text', sortable:true, filterable:false },
  { field:'name',           label:'Rule',      type:'text', sortable:true, filterable:true },
  { field:'relatedObject',  label:'Object',    type:'text', sortable:true, filterable:true },
  { field:'blockOnEvent',   label:'Blocks On', type:'text', sortable:true, filterable:true },
  { field:'blockOnStatus',  label:'At Status', type:'text', sortable:true, filterable:true },
  { field:'errorMessage',   label:'Error Message', type:'text', sortable:false, filterable:false },
  { field:'status',         label:'Active?',   type:'select', sortable:true, filterable:true, options:['Active','Inactive'] },
]

const PL_COLS = [
  { field:'id',       label:'Record #', type:'text', sortable:true, filterable:false },
  { field:'object',   label:'Object',   type:'text', sortable:true, filterable:true },
  { field:'field',    label:'Field',    type:'text', sortable:true, filterable:true },
  { field:'value',    label:'Value',    type:'text', sortable:true, filterable:true },
  { field:'label',    label:'Label',    type:'text', sortable:true, filterable:true },
  { field:'sortOrder',label:'Order',    type:'text', sortable:true, filterable:false },
  { field:'status',   label:'Status',   type:'select', sortable:true, filterable:true, options:['Active','Inactive'] },
]

const ALL_V = filters => [{ id:'AV', name:'All', filters, sortField:'name', sortDir:'asc' }]
const PROG_VIEWS = [
  { id:'PV-01', name:'All Programs', filters:[], sortField:'state', sortDir:'asc' },
  { id:'PV-02', name:'Wisconsin',    filters:[{ field:'state', label:'State', op:'equals', value:'WI' }], sortField:'name', sortDir:'asc' },
  { id:'PV-03', name:'Multifamily',  filters:[{ field:'housingType', label:'Housing', op:'equals', value:'Multifamily' }], sortField:'state', sortDir:'asc' },
]
const ET_VIEWS = [
  { id:'ETV-01', name:'All Email Templates', filters:[], sortField:'name', sortDir:'asc' },
  { id:'ETV-02', name:'Automated',           filters:[{ field:'automated', label:'Auto', op:'equals', value:'Yes' }], sortField:'name', sortDir:'asc' },
]
const AR_VIEWS = [
  { id:'ARV-01', name:'All Rules', filters:[], sortField:'triggerObject', sortDir:'asc' },
  { id:'ARV-02', name:'Active',    filters:[{ field:'status', label:'Active?', op:'equals', value:'Active' }], sortField:'triggerObject', sortDir:'asc' },
]

// ---------------------------------------------------------------------------
// Home dashboard — system overview for admins
// ---------------------------------------------------------------------------

function AdminHome({ setSec, roles, programs, workTypes, emails, documents, automations, validations, picklists }) {
  // Configuration density by area — shows what's built out and what isn't
  const configCounts = [
    { name:'Programs',             value: programs.length    },
    { name:'Work Types',           value: workTypes.length   },
    { name:'Email Templates',      value: emails.length      },
    { name:'Document Templates',   value: documents.length   },
    { name:'Automation Rules',     value: automations.length },
    { name:'Validation Rules',     value: validations.length },
    { name:'Roles',                value: roles.length       },
  ]

  // Automation rules by trigger object (what gets automated where)
  const triggerMap = new Map()
  for (const a of automations) triggerMap.set(a.triggerObject, (triggerMap.get(a.triggerObject) || 0) + 1)
  const autoByObject = Array.from(triggerMap, ([name, value]) => ({ name, value }))

  return (
    <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:11, color:C.textMuted, marginBottom:2 }}>Admin</div>
        <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>Anura Admin — Configuration Overview</h1>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>Nicholas Wood · Admin · System configuration & builders</div>
      </div>

      {/* KPI row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:16 }}>
        {[
          { label:'Configured Programs',    value: programs.length,    sub:`${new Set(programs.map(p=>p.state)).size} states`, color:C.emerald, action: () => setSec('programs')   },
          { label:'Work Type Catalog',      value: workTypes.length,   sub:'Field execution blueprints',                      color:C.sky,     action: () => setSec('worktypes')  },
          { label:'Active Automations',     value: automations.filter(a=>a.status==='Active').length, sub:`of ${automations.length} total rules`, color:C.amber,   action: () => setSec('automations') },
          { label:'Picklist Values',        value: picklists.length,   sub:'System-wide reference data',                      color:C.purple,  action: () => setSec('picklists')  },
        ].map(s => (
          <div key={s.label} onClick={s.action}
            style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${s.color}`, borderRadius:8, padding:'16px 18px', cursor:'pointer' }}
            onMouseEnter={e => e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.08)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
            <div style={{ fontSize:11, color:C.textMuted, fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:8 }}>{s.label}</div>
            <div style={{ fontSize:22, fontWeight:700, color:s.color, fontFamily:'JetBrains Mono, monospace', marginBottom:4 }}>{s.value}</div>
            <div style={{ fontSize:11, color:C.textMuted }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Configuration Inventory</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={configCounts} layout="vertical" margin={{ left:0, right:14, top:0, bottom:0 }}>
              <XAxis type="number" tick={{ fontSize:10, fill:C.textMuted }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize:10, fill:C.textSecondary }} tickLine={false} axisLine={false} width={135} />
              <Tooltip contentStyle={{ fontSize:11, border:`1px solid ${C.border}`, borderRadius:5 }} />
              <Bar dataKey="value" radius={[0,4,4,0]} fill={C.emerald} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Automation Rules by Trigger Object</div>
          {autoByObject.length === 0 ? (
            <div style={{ fontSize:12, color:C.textMuted, padding:'20px 0' }}>No automation rules configured.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={autoByObject} margin={{ left:0, right:10, top:8, bottom:0 }}>
                <XAxis dataKey="name" tick={{ fontSize:10, fill:C.textSecondary }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize:10, fill:C.textMuted }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize:11, border:`1px solid ${C.border}`, borderRadius:5 }} />
                <Bar dataKey="value" radius={[4,4,0,0]} fill={C.sky} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Builder shortcuts */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Builders</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10 }}>
          {[
            { name:'Program Builder',    sub:`${programs.length} programs`,    tab:'programs'    },
            { name:'Work Plan Builder',  sub:`${workTypes.length} work types`, tab:'worktypes'   },
            { name:'Template Builder',   sub:`${emails.length + documents.length} templates`, tab:'emails' },
            { name:'Automation Builder', sub:`${automations.length} rules`,    tab:'automations' },
            { name:'Validation Rules',   sub:`${validations.length} rules`,    tab:'validations' },
            { name:'Permission Builder', sub:`${roles.length} roles`,          tab:'roles'       },
            { name:'Picklist Values',    sub:`${picklists.length} values`,     tab:'picklists'   },
          ].map(b => (
            <div key={b.name} onClick={() => setSec(b.tab)}
              style={{ background:C.page, border:`1px solid ${C.border}`, borderRadius:6, padding:'12px 14px', cursor:'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f7f9fc'; e.currentTarget.style.borderColor = C.emerald }}
              onMouseLeave={e => { e.currentTarget.style.background = C.page;   e.currentTarget.style.borderColor = C.border }}>
              <div style={{ fontSize:12, fontWeight:600, color:C.textPrimary, marginBottom:3 }}>{b.name}</div>
              <div style={{ fontSize:11, color:C.textMuted }}>{b.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LiveListView wrapper
// ---------------------------------------------------------------------------

function LiveListView({ loading, error, data, ...rest }) {
  if (loading) return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:C.textMuted, fontSize:13 }}>Loading…</div>
  if (error)   return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8, padding:24 }}><div style={{ color:'#b03a2e', fontSize:13, fontWeight:600 }}>Could not load records</div><div style={{ color:C.textMuted, fontSize:12, fontFamily:'JetBrains Mono, monospace', maxWidth:560, textAlign:'center' }}>{String(error.message || error)}</div></div>
  return <ListView data={data} {...rest} />
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default function AdminModule() {
  const [sec, setSec] = useState('home')
  const [selectedRecord, setSelectedRecord] = useState(null)
  const SEC_TABLE = {'programs': 'programs', 'worktypes': 'work_types', 'emails': 'email_templates', 'documents': 'document_templates', 'automations': 'automation_rules', 'validations': 'validation_rules', 'roles': 'roles', 'picklists': 'picklist_values'}
  const openRecord = (row) => { if (row?._id && SEC_TABLE[sec]) setSelectedRecord({ table: SEC_TABLE[sec], id: row._id, name: row.name }) }
  const closeRecord = () => setSelectedRecord(null)
  const [roles,       setRoles]       = useState([])
  const [programs,    setPrograms]    = useState([])
  const [workTypes,   setWorkTypes]   = useState([])
  const [emails,      setEmails]      = useState([])
  const [documents,   setDocuments]   = useState([])
  const [automations, setAutomations] = useState([])
  const [validations, setValidations] = useState([])
  const [picklists,   setPicklists]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      fetchRoles(), fetchPrograms(), fetchWorkTypes(),
      fetchEmailTemplates(), fetchDocumentTemplates(),
      fetchAutomationRules(), fetchValidationRules(), fetchPicklistValues(),
    ])
      .then(([r, p, w, e, d, a, v, pl]) => {
        if (cancelled) return
        setRoles(r); setPrograms(p); setWorkTypes(w)
        setEmails(e); setDocuments(d)
        setAutomations(a); setValidations(v); setPicklists(pl)
      })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const counts = {
    programs: programs.length,
    worktypes: workTypes.length,
    emails: emails.length,
    documents: documents.length,
    automations: automations.length,
    validations: validations.length,
    roles: roles.length,
    picklists: picklists.length,
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ height:54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Admin</span>
          <span style={{ color:C.textMuted }}>/</span>
          <span style={{ color: selectedRecord ? C.textMuted : C.textPrimary, fontWeight: selectedRecord ? 400 : 500, cursor: selectedRecord ? 'pointer' : 'default' }} onClick={() => selectedRecord && closeRecord()}>{SECTIONS.find(s=>s.id===sec)?.label}</span>
          {selectedRecord && <><span style={{ color:C.textMuted }}>/</span><span style={{ color:C.textPrimary, fontWeight:500 }}>{selectedRecord.name}</span></>}
        </div>
        <button style={{ display:'flex', alignItems:'center', gap:6, background:C.page, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 12px', fontSize:12.5, color:C.textSecondary, cursor:'pointer', fontWeight:500 }}>
          <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" size={13} color={C.textSecondary}/>Reports
        </button>
      </div>
      <SectionTabs sections={SECTIONS} active={sec} onChange={s => { setSec(s); closeRecord(); }} counts={counts} />
      <div style={{ flex:1, overflow:'hidden', display:'flex' }}>
        {selectedRecord ? (
          <RecordDetail tableName={selectedRecord.table} recordId={selectedRecord.id} onBack={closeRecord} />
        ) : (<>
        {sec==='home'        && <AdminHome setSec={setSec} roles={roles} programs={programs} workTypes={workTypes} emails={emails} documents={documents} automations={automations} validations={validations} picklists={picklists} />}
        {sec==='programs'    && <LiveListView loading={loading} error={error} data={programs}    columns={PROG_COLS} systemViews={PROG_VIEWS}     defaultViewId="PV-01"  newLabel="Program"       onNew={() => {}}  onOpenRecord={openRecord}/>}
        {sec==='worktypes'   && <LiveListView loading={loading} error={error} data={workTypes}   columns={WT_COLS}   systemViews={ALL_V([])}      defaultViewId="AV"     newLabel="Work Type"     onNew={() => {}}  onOpenRecord={openRecord}/>}
        {sec==='emails'      && <LiveListView loading={loading} error={error} data={emails}      columns={ET_COLS}   systemViews={ET_VIEWS}       defaultViewId="ETV-01" newLabel="Email Template" onNew={() => {}}  onOpenRecord={openRecord}/>}
        {sec==='documents'   && <LiveListView loading={loading} error={error} data={documents}   columns={DT_COLS}   systemViews={ALL_V([])}      defaultViewId="AV"     newLabel="Document Template" onNew={() => {}}  onOpenRecord={openRecord}/>}
        {sec==='automations' && <LiveListView loading={loading} error={error} data={automations} columns={AR_COLS}   systemViews={AR_VIEWS}       defaultViewId="ARV-01" newLabel="Automation Rule" onNew={() => {}}  onOpenRecord={openRecord}/>}
        {sec==='validations' && <LiveListView loading={loading} error={error} data={validations} columns={VR_COLS}   systemViews={ALL_V([])}      defaultViewId="AV"     newLabel="Validation Rule" onNew={() => {}}  onOpenRecord={openRecord}/>}
        {sec==='roles'       && <LiveListView loading={loading} error={error} data={roles}       columns={ROLE_COLS} systemViews={ALL_V([])}      defaultViewId="AV"     newLabel="Role"          onNew={() => {}}  onOpenRecord={openRecord}/>}
        {sec==='picklists'   && <LiveListView loading={loading} error={error} data={picklists}   columns={PL_COLS}   systemViews={ALL_V([])}      defaultViewId="AV"     newLabel="Picklist Value" onNew={() => {}}  onOpenRecord={openRecord}/>}
        </>)}
      </div>
    </div>
  )
}
