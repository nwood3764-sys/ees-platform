import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { C, CHART_COLORS } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import {
  fetchUsers,
  fetchTechnicians,
  fetchCertifications,
  fetchTimeSheets,
} from '../data/peopleService'

const SECTIONS = [
  { id: 'home',            label: 'Home'              },
  { id: 'users',           label: 'Users'             },
  { id: 'technicians',     label: 'Technicians'       },
  { id: 'certifications',  label: 'Certifications'    },
  { id: 'timesheets',      label: 'Time Sheets'       },
]

const USER_COLS = [
  { field:'id',        label:'Record #', type:'text',   sortable:true, filterable:false },
  { field:'name',      label:'Name',     type:'text',   sortable:true, filterable:true  },
  { field:'title',     label:'Title',    type:'text',   sortable:true, filterable:true  },
  { field:'role',      label:'Role',     type:'select', sortable:true, filterable:true,
    options:['Admin','Director of Field Services','Lead Technician','Program Manager','Project Coordinator','Project Manager','Project Site Lead','Property Manager','Property Owner','Shop Steward','Subcontractor Partner','Team Lead','Technician in Training'] },
  { field:'email',     label:'Email',    type:'text',   sortable:true, filterable:true  },
  { field:'phone',     label:'Phone',    type:'text',   sortable:true, filterable:false },
  { field:'status',    label:'Status',   type:'select', sortable:true, filterable:true, options:['Active','Inactive'] },
]

const TECH_COLS = [
  { field:'id',              label:'Record #',   type:'text',   sortable:true, filterable:false },
  { field:'name',            label:'Technician', type:'text',   sortable:true, filterable:true  },
  { field:'title',           label:'Title',      type:'text',   sortable:true, filterable:true  },
  { field:'employeeId',      label:'Emp ID',     type:'text',   sortable:true, filterable:false },
  { field:'status',          label:'Status',     type:'select', sortable:true, filterable:true, options:['Active','On Leave','Inactive','Terminated'] },
  { field:'hireDate',        label:'Hire Date',  type:'date',   sortable:true, filterable:true  },
  { field:'bpiCertified',    label:'BPI Cert',   type:'select', sortable:true, filterable:true, options:['Yes','No'] },
  { field:'bpiExpiry',       label:'BPI Expiry', type:'date',   sortable:true, filterable:true  },
  { field:'licenseState',    label:'DL State',   type:'text',   sortable:true, filterable:true  },
  { field:'licenseExpiry',   label:'DL Expiry',  type:'date',   sortable:true, filterable:true  },
  { field:'phone',           label:'Phone',      type:'text',   sortable:true, filterable:false },
]

const CERT_COLS = [
  { field:'id',             label:'Record #',   type:'text', sortable:true, filterable:false },
  { field:'name',           label:'Certification', type:'text', sortable:true, filterable:true },
  { field:'technician',     label:'Technician', type:'text', sortable:true, filterable:true },
  { field:'type',           label:'Type',       type:'select', sortable:true, filterable:true, options:['BPI','EPA','NATE','OSHA','HRAI','NEBB','Other'] },
  { field:'issuingBody',    label:'Issuing Body', type:'text', sortable:true, filterable:true },
  { field:'certNumber',     label:'Cert #',     type:'text', sortable:false, filterable:false },
  { field:'issueDate',      label:'Issued',     type:'date', sortable:true, filterable:true },
  { field:'expirationDate', label:'Expires',    type:'date', sortable:true, filterable:true },
  { field:'status',         label:'Status',     type:'select', sortable:true, filterable:true, options:['Active','Expired','Pending','Revoked'] },
]

const TS_COLS = [
  { field:'id',          label:'Record #',  type:'text', sortable:true, filterable:false },
  { field:'name',        label:'Time Sheet',type:'text', sortable:true, filterable:true },
  { field:'technician',  label:'Technician',type:'text', sortable:true, filterable:true },
  { field:'weekStart',   label:'Week Start',type:'date', sortable:true, filterable:true },
  { field:'weekEnd',     label:'Week End',  type:'date', sortable:true, filterable:true },
  { field:'status',      label:'Status',    type:'select', sortable:true, filterable:true, options:['Draft','Submitted','Approved','Rejected'] },
  { field:'totalHours',  label:'Hours',     type:'text', sortable:true, filterable:false },
]

const USER_VIEWS = [{ id:'UV-01', name:'All Users', filters:[], sortField:'name', sortDir:'asc' }]
const TECH_VIEWS = [
  { id:'TV-01', name:'All Technicians', filters:[], sortField:'name', sortDir:'asc' },
  { id:'TV-02', name:'Active',          filters:[{ field:'status', label:'Status', op:'equals', value:'Active' }], sortField:'name', sortDir:'asc' },
  { id:'TV-03', name:'BPI Certified',   filters:[{ field:'bpiCertified', label:'BPI', op:'equals', value:'Yes' }], sortField:'bpiExpiry', sortDir:'asc' },
]
const CERT_VIEWS = [
  { id:'CV-01', name:'All Certifications', filters:[], sortField:'expirationDate', sortDir:'asc' },
  { id:'CV-02', name:'Active',             filters:[{ field:'status', label:'Status', op:'equals', value:'Active' }], sortField:'expirationDate', sortDir:'asc' },
  { id:'CV-03', name:'BPI',                filters:[{ field:'type', label:'Type', op:'equals', value:'BPI' }], sortField:'expirationDate', sortDir:'asc' },
]
const TS_VIEWS = [
  { id:'TSV-01', name:'All Time Sheets', filters:[], sortField:'weekStart', sortDir:'desc' },
  { id:'TSV-02', name:'Submitted',       filters:[{ field:'status', label:'Status', op:'equals', value:'Submitted' }], sortField:'weekStart', sortDir:'desc' },
  { id:'TSV-03', name:'Approved',        filters:[{ field:'status', label:'Status', op:'equals', value:'Approved' }], sortField:'weekStart', sortDir:'desc' },
]

// ---------------------------------------------------------------------------
// Home dashboard
// ---------------------------------------------------------------------------

function PeopleHome({ setSec, users, technicians, certifications, timesheets }) {
  const totalUsers = users.length
  const activeTechs = technicians.filter(t => t.status === 'Active').length
  const bpiCertified = technicians.filter(t => t.bpiCertified === 'Yes').length

  // Certs expiring in next 90 days
  const now = new Date()
  const in90Days = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90)
  const expiringCerts = certifications.filter(c => {
    if (!c.expirationDate || c.expirationDate === '—') return false
    const exp = new Date(c.expirationDate)
    return exp <= in90Days
  })

  // Users by role
  const roleMap = new Map()
  for (const u of users) roleMap.set(u.role, (roleMap.get(u.role) || 0) + 1)
  const byRole = Array.from(roleMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

  // Time sheet status breakdown
  const tsMap = new Map()
  for (const t of timesheets) tsMap.set(t.status, (tsMap.get(t.status) || 0) + 1)
  const tsByStatus = Array.from(tsMap, ([name, value]) => ({ name, value }))

  return (
    <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:11, color:C.textMuted, marginBottom:2 }}>People</div>
        <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>People & Credentials Dashboard</h1>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>Nicholas Wood · Admin · Today</div>
      </div>

      {/* KPI row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12, marginBottom:16 }}>
        {[
          { label:'Total Users',       value: totalUsers,     sub:'Active internal accounts',            color:C.emerald, action: () => setSec('users')          },
          { label:'Active Technicians',value: activeTechs,    sub:`${technicians.length} technician records`, color:C.sky,     action: () => setSec('technicians')    },
          { label:'BPI Certified',     value: bpiCertified,   sub:`of ${technicians.length} technicians`,color:C.purple,  action: () => setSec('certifications') },
          { label:'Expiring ≤ 90d',    value: expiringCerts.length, sub:'Certs needing renewal',        color:C.amber,   action: () => setSec('certifications') },
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
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:14, marginBottom:14 }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Users by Role</div>
          {byRole.length === 0 ? (
            <div style={{ fontSize:12, color:C.textMuted, padding:'20px 0' }}>No users loaded.</div>
          ) : (
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={byRole} layout="vertical" margin={{ left:0, right:14, top:0, bottom:0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" tick={{ fontSize:10, fill:C.textSecondary }} tickLine={false} axisLine={false} width={150} />
                <Tooltip contentStyle={{ fontSize:11, border:`1px solid ${C.border}`, borderRadius:5 }} />
                <Bar dataKey="value" radius={[0,4,4,0]} fill={C.emerald} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Time Sheets by Status</div>
          {tsByStatus.length === 0 ? (
            <div style={{ fontSize:12, color:C.textMuted, padding:'20px 0' }}>No time sheets logged.</div>
          ) : (
            <div style={{ display:'flex', gap:12, alignItems:'center', padding:'10px 0' }}>
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={tsByStatus} cx="50%" cy="50%" innerRadius={30} outerRadius={58} dataKey="value" strokeWidth={0}>
                    {tsByStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex:1 }}>
                {tsByStatus.map((d, i) => (
                  <div key={d.name} style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:8, height:8, borderRadius:2, background:CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span style={{ fontSize:11, color:C.textSecondary }}>{d.name}</span>
                    </div>
                    <span style={{ fontSize:12, fontWeight:600, color:C.textPrimary, fontFamily:'JetBrains Mono, monospace' }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Expiring credentials watchlist */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Certifications Expiring in Next 90 Days</div>
        {expiringCerts.length === 0 ? (
          <div style={{ fontSize:12, color:C.textMuted, padding:'12px 0' }}>All certifications current. ✓</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Certification</th>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Technician</th>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Type</th>
                <th style={{ textAlign:'right', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Expires</th>
              </tr>
            </thead>
            <tbody>
              {expiringCerts.map(c => (
                <tr key={c._id} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textPrimary }}>{c.name}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textSecondary }}>{c.technician}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textSecondary }}>{c.type}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:'#b03a2e', fontFamily:'JetBrains Mono, monospace', textAlign:'right', fontWeight:600 }}>{c.expirationDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LiveListView wrapper
// ---------------------------------------------------------------------------

function LiveListView({ loading, error, data, onRetry, ...rest }) {
  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onRetry} />
  return <ListView data={data} {...rest} />
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default function PeopleModule() {
  const [sec, setSec] = useState('home')
  const [selectedRecord, setSelectedRecord] = useState(null)
  const SEC_TABLE = {'users': 'users', 'technicians': 'technicians', 'certifications': 'certifications', 'timesheets': 'time_sheets'}
  const openRecord = (row) => { if (row?._id && SEC_TABLE[sec]) setSelectedRecord({ table: SEC_TABLE[sec], id: row._id, name: row.name }) }
  const closeRecord = () => setSelectedRecord(null)
  const [users,          setUsers]          = useState([])
  const [technicians,    setTechnicians]    = useState([])
  const [certifications, setCertifications] = useState([])
  const [timesheets,     setTimesheets]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Pull-to-refresh handler.
  const loadAll = async () => {
    setError(null)
    try {
      const [u, t, c, ts] = await Promise.all([
        fetchUsers(), fetchTechnicians(), fetchCertifications(), fetchTimeSheets(),
      ])
      setUsers(u); setTechnicians(t); setCertifications(c); setTimesheets(ts)
    } catch (err) {
      setError(err)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([fetchUsers(), fetchTechnicians(), fetchCertifications(), fetchTimeSheets()])
      .then(([u, t, c, ts]) => { if (!cancelled) { setUsers(u); setTechnicians(t); setCertifications(c); setTimesheets(ts) } })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const counts = {
    users: users.length,
    technicians: technicians.length,
    certifications: certifications.length,
    timesheets: timesheets.length,
  }
  const urgentCount = timesheets.filter(t => t.status === 'Submitted').length
  const urgentSections = { timesheets: urgentCount }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div data-module-topbar="1" style={{ height: 54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>People</span>
          <span style={{ color:C.textMuted }}>/</span>
          <span style={{ color: selectedRecord ? C.textMuted : C.textPrimary, fontWeight: selectedRecord ? 400 : 500, cursor: selectedRecord ? 'pointer' : 'default' }} onClick={() => selectedRecord && closeRecord()}>{SECTIONS.find(s=>s.id===sec)?.label}</span>
          {selectedRecord && <><span style={{ color:C.textMuted }}>/</span><span style={{ color:C.textPrimary, fontWeight:500 }}>{selectedRecord.name}</span></>}
        </div>
        <button style={{ display:'flex', alignItems:'center', gap:6, background:C.page, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 12px', fontSize:12.5, color:C.textSecondary, cursor:'pointer', fontWeight:500 }}>
          <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" size={13} color={C.textSecondary}/>Reports
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
        {sec==='home'           && <PeopleHome setSec={setSec} users={users} technicians={technicians} certifications={certifications} timesheets={timesheets} />}
        {sec==='users'          && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={users}          columns={USER_COLS} systemViews={USER_VIEWS} defaultViewId="UV-01"  newLabel="User"          onNew={() => setSelectedRecord({ table: 'users', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='technicians'    && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={technicians}    columns={TECH_COLS} systemViews={TECH_VIEWS} defaultViewId="TV-01"  newLabel="Technician"    onNew={() => setSelectedRecord({ table: 'technicians', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='certifications' && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={certifications} columns={CERT_COLS} systemViews={CERT_VIEWS} defaultViewId="CV-01"  newLabel="Certification" onNew={() => setSelectedRecord({ table: 'certifications', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='timesheets'     && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={timesheets}     columns={TS_COLS}   systemViews={TS_VIEWS}   defaultViewId="TSV-01" newLabel="Time Sheet"    onNew={() => setSelectedRecord({ table: 'time_sheets', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        </>)}
      </div>
    </div>
  )
}
