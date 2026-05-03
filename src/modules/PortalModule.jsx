import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { C, CHART_COLORS } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import { fetchPortalUsers, fetchPartnerOrganizations } from '../data/portalService'

const SECTIONS = [
  { id: 'home',     label: 'Home' },
  { id: 'users',    label: 'Portal Users' },
  { id: 'partners', label: 'Partner Organizations' },
]

const USER_COLS = [
  { field:'id',            label:'Record #',  type:'text',   sortable:true, filterable:false },
  { field:'name',          label:'Name',      type:'text',   sortable:true, filterable:true  },
  { field:'email',         label:'Email',     type:'text',   sortable:true, filterable:true  },
  { field:'phone',         label:'Phone',     type:'text',   sortable:true, filterable:false },
  { field:'portalRole',    label:'Portal Role', type:'select', sortable:true, filterable:true,
    options:['Property Owner','Property Manager','Regional Decision Maker','Partner Admin','Partner Coordinator','Partner Technician'] },
  { field:'userType',      label:'Portal',    type:'select', sortable:true, filterable:true, options:['Property Owner Portal','Partner Portal'] },
  { field:'organization',  label:'Organization', type:'text', sortable:true, filterable:true },
  { field:'lastLogin',     label:'Last Login',type:'text',   sortable:true, filterable:false },
  { field:'status',        label:'Status',    type:'select', sortable:true, filterable:true, options:['Active','Inactive','Suspended'] },
]

const PARTNER_COLS = [
  { field:'id',                  label:'Short Name',     type:'text',   sortable:true, filterable:false },
  { field:'name',                label:'Organization',   type:'text',   sortable:true, filterable:true  },
  { field:'partnerType',         label:'Partner Type',   type:'text',   sortable:true, filterable:true  },
  { field:'city',                label:'City',           type:'text',   sortable:true, filterable:true  },
  { field:'state',               label:'State',          type:'select', sortable:true, filterable:true, options:['WI','CO','NC','MI','IN'] },
  { field:'primaryContact',      label:'Primary Contact',type:'text',   sortable:true, filterable:true  },
  { field:'primaryContactPhone', label:'Contact Phone',  type:'text',   sortable:false, filterable:false },
  { field:'primaryContactEmail', label:'Contact Email',  type:'text',   sortable:true, filterable:true  },
  { field:'status',              label:'Status',         type:'select', sortable:true, filterable:true, options:['Active','Inactive','Suspended'] },
]

const USER_VIEWS = [
  { id:'PUV-01', name:'All Portal Users',  filters:[], sortField:'lastLogin', sortDir:'desc' },
  { id:'PUV-02', name:'Property Owners',   filters:[{ field:'userType', label:'Portal', op:'equals', value:'Property Owner Portal' }], sortField:'name', sortDir:'asc' },
  { id:'PUV-03', name:'Partners',          filters:[{ field:'userType', label:'Portal', op:'equals', value:'Partner Portal' }],        sortField:'name', sortDir:'asc' },
  { id:'PUV-04', name:'Active',            filters:[{ field:'status',   label:'Status', op:'equals', value:'Active' }],                sortField:'name', sortDir:'asc' },
]

const PARTNER_VIEWS = [
  { id:'POV-01', name:'All Partners', filters:[], sortField:'name', sortDir:'asc' },
  { id:'POV-02', name:'Active',       filters:[{ field:'status', label:'Status', op:'equals', value:'Active' }], sortField:'name', sortDir:'asc' },
]

// ---------------------------------------------------------------------------
// Home dashboard
// ---------------------------------------------------------------------------

function PortalHome({ setSec, users, partners }) {
  const total = users.length
  const propertyOwnerUsers = users.filter(u => u.userType === 'Property Owner Portal').length
  const partnerUsers = users.filter(u => u.userType === 'Partner Portal').length
  const activePartners = partners.filter(p => p.status === 'Active').length

  // Portal users by role
  const roleMap = new Map()
  for (const u of users) roleMap.set(u.portalRole, (roleMap.get(u.portalRole) || 0) + 1)
  const byRole = Array.from(roleMap, ([name, value]) => ({ name, value }))

  // Partners by state
  const stateMap = new Map()
  for (const p of partners) stateMap.set(p.state, (stateMap.get(p.state) || 0) + 1)
  const byState = Array.from(stateMap, ([name, value]) => ({ name, value }))

  // Most recently active users
  const recentUsers = users.slice(0, 5)

  return (
    <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:11, color:C.textMuted, marginBottom:2 }}>Portal</div>
        <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>External Access Dashboard</h1>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>Nicholas Wood · Admin · Portal user & partner management</div>
      </div>

      {/* KPI row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12, marginBottom:16 }}>
        {[
          { label:'Total Portal Users', value: total,              sub:'Active external accounts',       color:C.emerald, action: () => setSec('users')    },
          { label:'Property Owner',     value: propertyOwnerUsers, sub:'Customer portal users',          color:C.sky,     action: () => setSec('users')    },
          { label:'Partner Portal',     value: partnerUsers,       sub:'Service provider users',         color:C.purple,  action: () => setSec('users')    },
          { label:'Partner Orgs',       value: activePartners,     sub:`${partners.length} total`,       color:C.amber,   action: () => setSec('partners') },
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
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Portal Users by Role</div>
          {byRole.length === 0 ? (
            <div style={{ fontSize:12, color:C.textMuted, padding:'20px 0' }}>No portal users yet.</div>
          ) : (
            <div style={{ display:'flex', gap:12, alignItems:'center' }}>
              <ResponsiveContainer width={130} height={150}>
                <PieChart>
                  <Pie data={byRole} cx="50%" cy="50%" innerRadius={30} outerRadius={58} dataKey="value" strokeWidth={0}>
                    {byRole.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex:1 }}>
                {byRole.map((d, i) => (
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

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Partners by State</div>
          {byState.length === 0 ? (
            <div style={{ fontSize:12, color:C.textMuted, padding:'20px 0' }}>No partner organizations yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={byState} margin={{ left:0, right:10, top:8, bottom:0 }}>
                <XAxis dataKey="name" tick={{ fontSize:11, fill:C.textSecondary }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize:10, fill:C.textMuted }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize:11, border:`1px solid ${C.border}`, borderRadius:5 }} />
                <Bar dataKey="value" radius={[4,4,0,0]} fill={C.emerald} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recently active users */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Recently Active Portal Users</div>
        {recentUsers.length === 0 ? (
          <div style={{ fontSize:12, color:C.textMuted, padding:'12px 0' }}>No portal activity.</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Name</th>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Role</th>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Organization</th>
                <th style={{ textAlign:'right', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Last Login</th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.map(u => (
                <tr key={u._id} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textPrimary }}>{u.name}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textSecondary }}>{u.portalRole}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textSecondary }}>{u.organization}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textMuted, textAlign:'right' }}>{u.lastLogin}</td>
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

export default function PortalModule({ selectedRecord: navSelectedRecord, sectionFromUrl, onNavigateToRecord, onCloseRecord, onSectionChange, onReplaceRecord } = {}) {
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

  const SEC_TABLE = {'users': 'portal_users', 'partners': 'accounts'}
  const openRecord = (row) => { if (row?._id && SEC_TABLE[sec]) setSelectedRecord({ table: SEC_TABLE[sec], id: row._id, name: row.name }) }
  const closeRecord = () => setSelectedRecord(null)
  const [users,    setUsers]    = useState([])
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Pull-to-refresh handler.
  const loadAll = async () => {
    setError(null)
    try {
      const [u, p] = await Promise.all([fetchPortalUsers(), fetchPartnerOrganizations()])
      setUsers(u); setPartners(p)
    } catch (err) {
      setError(err)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([fetchPortalUsers(), fetchPartnerOrganizations()])
      .then(([u, p]) => { if (!cancelled) { setUsers(u); setPartners(p) } })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const counts = { users: users.length, partners: partners.length }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div data-module-topbar="1" style={{ height: 54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Portal</span>
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
          <RecordDetail tableName={selectedRecord.table} recordId={selectedRecord.id} onBack={closeRecord}
            mode={selectedRecord.mode || 'view'}
            onRecordCreated={(r) => replaceSelectedRecord({ table: r.table, id: r.id, mode: 'view' })}
            prefill={selectedRecord.prefill}
            onNavigateToRecord={(r) => setSelectedRecord({ table: r.table, id: r.id, mode: r.mode, prefill: r.prefill })} />
        ) : (<>
        {sec==='home'     && <PortalHome setSec={setSec} users={users} partners={partners} />}
        {sec==='users'    && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={users}    columns={USER_COLS}    systemViews={USER_VIEWS}    defaultViewId="PUV-01" newLabel="Portal User"           onNew={() => setSelectedRecord({ table: 'portal_users', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='partners' && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={partners} columns={PARTNER_COLS} systemViews={PARTNER_VIEWS} defaultViewId="POV-01" newLabel="Partner Organization"  onNew={() => setSelectedRecord({ table: 'accounts', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        </>)}
      </div>
    </div>
  )
}
