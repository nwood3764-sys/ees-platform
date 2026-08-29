import { useState, useEffect, useMemo } from 'react'
import { useModuleSections } from '../lib/useModuleSections'
import { useRecharts } from '../lib/RechartsLazy'
import { C, CHART_COLORS } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import ObjectListSection from '../components/ObjectListSection'
import NavLink from '../components/NavLink'
import { fetchPortalUsers, fetchPartnerOrganizations, fetchPropertyOwnerPortals } from '../data/portalService'
import { getCurrentUserProfile } from '../data/layoutService'
import ModuleHomeByline from '../components/ModuleHomeByline'

const CODE_SECTIONS = [
  { id: 'home',     label: 'Home' },
  { id: 'portals',  label: 'Property Owner Portals' },
  { id: 'users',    label: 'Portal Users' },
  { id: 'partners', label: 'Partner Organizations' },
]

const USER_COLS = [
  { field:'id',            label:'Record #',  type:'text',   sortable:true, filterable:false },
  { field:'name',          label:'Name',      type:'text',   sortable:true, filterable:true  },
  { field:'email',         label:'Email',     type:'text',   sortable:true, filterable:true  },
  { field:'phone',         label:'Phone',     type:'text',   sortable:true, filterable:false },
  { field:'portalRole',    label:'Portal Role', type:'select', sortable:true, filterable:true,
    options:['Property Administrator','Property Viewer','Service Provider Admin','Service Provider Technician','Program Manager','Program Reviewer'] },
  { field:'userType',      label:'Portal',    type:'select', sortable:true, filterable:true, options:['Property Owner Portal','Partner Portal','Program Manager Portal'] },
  { field:'organization',  label:'Organization', type:'text', sortable:true, filterable:true },
  { field:'lastLogin',     label:'Last Login',type:'text',   sortable:true, filterable:false },
  // portal_users.status picklist values, verbatim — the old ['Active','Inactive',
  // 'Suspended'] list matched no row, so the filter could never return anything.
  { field:'status',        label:'Status',    type:'select', sortable:true, filterable:true,
    options:['Portal User Pending','Portal User Invited','Portal User Active','Portal User Suspended','Portal User Deactivated'] },
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
  const R = useRecharts()
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
        <ModuleHomeByline note="Portal user & partner management" />
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
              <R.ResponsiveContainer width={130} height={150}>
                <R.PieChart>
                  <R.Pie data={byRole} cx="50%" cy="50%" innerRadius={30} outerRadius={58} dataKey="value" strokeWidth={0}>
                    {byRole.map((_, i) => <R.Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </R.Pie>
                </R.PieChart>
              </R.ResponsiveContainer>
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
            <R.ResponsiveContainer width="100%" height={150}>
              <R.BarChart data={byState} margin={{ left:0, right:10, top:8, bottom:0 }}>
                <R.XAxis dataKey="name" tick={{ fontSize:11, fill:C.textSecondary }} tickLine={false} axisLine={false} />
                <R.YAxis tick={{ fontSize:10, fill:C.textMuted }} tickLine={false} axisLine={false} />
                <R.Tooltip contentStyle={{ fontSize:11, border:`1px solid ${C.border}`, borderRadius:5 }} />
                <R.Bar dataKey="value" radius={[4,4,0,0]} fill={C.emerald} />
              </R.BarChart>
            </R.ResponsiveContainer>
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
// Property Owner Portals — pick an organization, open their portal.
//
// This is the entry point for "go look at a portal." The per-record Actions
// menus (View Owner Portal on an account, View Portal as This User on a portal
// user) still exist for when you are already on that record, but nobody should
// have to find a record first just to look at a portal.
// ---------------------------------------------------------------------------

function PortalReadiness({ row }) {
  // Publication comes first: an organization that is not included shows nothing
  // in the portal no matter how much content or how many grants it has.
  const cfg = !row.included
    ? { label: 'Not published', color: C.textMuted, bg: C.page }
    : row.opportunities === 0
      ? { label: 'No content yet', color: C.textMuted, bg: C.page }
      : row.activeUsers > 0
        ? { label: 'Owner invited', color: C.emeraldMid, bg: '#e8f8f2' }
        : { label: 'Ready to review', color: '#1a5a8a', bg: '#e8f3fb' }
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, fontWeight:600,
                   color:cfg.color, background:cfg.bg, padding:'3px 8px', borderRadius:11 }}>
      {cfg.label}
    </span>
  )
}

function PropertyOwnerPortals({ isSystemAdmin, onOpenAccount }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [onlyWithContent, setOnlyWithContent] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetchPropertyOwnerPortals(onlyWithContent)
      .then(r => { if (!cancelled) setRows(r) })
      .catch(e => { if (!cancelled) setError(e) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [onlyWithContent])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(r => (r.name || '').toLowerCase().includes(needle)
                         || (r.id || '').toLowerCase().includes(needle))
  }, [rows, q])

  const th = { textAlign:'left', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase',
               letterSpacing:'.04em', padding:'8px 12px', borderBottom:`1px solid ${C.border}`, whiteSpace:'nowrap' }
  const td = { fontSize:12.5, color:C.textSecondary, padding:'10px 12px', borderBottom:`1px solid ${C.border}` }
  const num = { ...td, fontFamily:'JetBrains Mono, monospace', textAlign:'right' }

  if (loading) return <LoadingState message="Loading portals…" />
  if (error)   return <ErrorState error={error} />

  return (
    <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
      <div style={{ marginBottom:14 }}>
        <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>Property Owner Portals</h1>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>
          Open any organization&rsquo;s portal and see it exactly as they would. Check the content before anyone is invited.
          {' '}An organization appears to its owners only when <strong>Include in Property Owner Portal</strong> is ticked on the
          account, and each property and building carries the same control.
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12, flexWrap:'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search organizations…"
          style={{ flex:'1 1 240px', maxWidth:360, padding:'7px 11px', fontSize:12.5, border:`1px solid ${C.border}`,
                   borderRadius:6, background:C.card, color:C.textPrimary, outline:'none' }} />
        <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12.5, color:C.textSecondary, cursor:'pointer' }}>
          <input type="checkbox" checked={onlyWithContent} onChange={e => setOnlyWithContent(e.target.checked)} />
          Only organizations with portal content
        </label>
        <span style={{ fontSize:12, color:C.textMuted, marginLeft:'auto' }}>
          {filtered.length} organization{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {!isSystemAdmin && (
        <div style={{ background:'#e8f3fb', border:`1px solid ${C.border}`, borderRadius:6, padding:'10px 12px',
                      fontSize:12.5, color:'#1a5a8a', marginBottom:12 }}>
          Opening a portal as an organization is limited to system administrators.
        </div>
      )}

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Organization</th>
              <th style={th}>Record Type</th>
              <th style={{ ...th, textAlign:'right' }}>Properties</th>
              <th style={{ ...th, textAlign:'right' }}>Buildings</th>
              <th style={{ ...th, textAlign:'right' }}>Programs</th>
              <th style={{ ...th, textAlign:'right' }}>Work Orders</th>
              <th style={{ ...th, textAlign:'right' }}>Visits</th>
              <th style={{ ...th, textAlign:'right' }}>Portal Users</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td style={{ ...td, color:C.textMuted }} colSpan={10}>
                {onlyWithContent
                  ? 'No organizations have portal content yet. Untick the filter to see every property-owning account.'
                  : 'No organizations found.'}
              </td></tr>
            )}
            {filtered.map(r => (
              <tr key={r._id}>
                <td style={{ ...td, color:C.textPrimary, fontWeight:600 }}>
                  <span onClick={() => onOpenAccount(r)} style={{ cursor:'pointer', color:C.emeraldMid }}>{r.name}</span>
                  <div style={{ fontSize:11, color:C.textMuted, fontFamily:'JetBrains Mono, monospace', fontWeight:400 }}>{r.id}</div>
                </td>
                <td style={td}>{r.recordType}</td>
                <td style={num} title="Published / total">
                  {r.propertiesIncluded}<span style={{ color:C.textMuted }}>/{r.properties}</span>
                </td>
                <td style={num} title="Published / total">
                  {r.buildingsIncluded}<span style={{ color:C.textMuted }}>/{r.buildings}</span>
                </td>
                <td style={num}>{r.opportunities}</td>
                <td style={num}>{r.workOrders}</td>
                <td style={num}>{r.visits}</td>
                <td style={num}>{r.portalUsers}</td>
                <td style={td}><PortalReadiness row={r} /></td>
                <td style={{ ...td, textAlign:'right' }}>
                  {isSystemAdmin && (
                    <a href={`/project-portal?account=${r._id}`} target="_blank" rel="noopener noreferrer"
                       style={{ display:'inline-block', background:C.emerald, color:'#07111f', fontWeight:600, fontSize:12,
                                padding:'6px 12px', borderRadius:6, textDecoration:'none', whiteSpace:'nowrap' }}>
                      Open Portal
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default function PortalModule({ selectedRecord: navSelectedRecord, sectionFromUrl, onNavigateToRecord, onCloseRecord, onSectionChange, onReplaceRecord, onOpenSetup } = {}) {
  const SECTIONS = useModuleSections('portal', CODE_SECTIONS)
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

  // Switching section tabs is a FORWARD navigation, not a Back. navigateToSection
  // (reached through setSec) already clears the open record, so calling
  // closeRecord() here as well fired a second navigation — and since 2026-08-22
  // closeRecord means "go back to the screen behind this record", not "clear the
  // record". Clicking a tab while a record was open therefore sent the browser
  // BACK to whatever preceded it: the record the user had just come from, or
  // another list entirely, while the tab strip showed the tab they clicked
  // (Nicholas, 2026-08-25: clicking Opportunities on an account record "just
  // keeps going back to the account record"). Only the local-state fallback
  // path (no URL navigation) has a record to clear here.
  const changeSection = (nextSection) => {
    setSec(nextSection)
    if (!urlDriven) setSelectedRecordLocal(null)
  }
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

  // Opening a portal as someone else is Admin-only (enforced again in the DB);
  // the list itself is visible to any internal user.
  const [isSystemAdmin, setIsSystemAdmin] = useState(false)
  useEffect(() => {
    let alive = true
    getCurrentUserProfile().then(p => { if (alive) setIsSystemAdmin(p?.roleName === 'Admin') }).catch(() => {})
    return () => { alive = false }
  }, [])

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div data-module-topbar="1" style={{ height: 54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <NavLink to={{ activeModule: 'portal' }} onActivate={() => { closeRecord(); setSec('home') }}
            style={{ color: C.emeraldMid, fontWeight:500, cursor:'pointer' }}>Portal</NavLink>
          <span style={{ color:C.textMuted }}>/</span>
          <NavLink to={{ activeModule: 'portal', section: sec }} onActivate={() => selectedRecord && closeRecord()}
            style={{ color: selectedRecord ? C.emeraldMid : C.textPrimary, fontWeight: selectedRecord ? 500 : 600, cursor: selectedRecord ? 'pointer' : 'default' }}>{SECTIONS.find(s=>s.id===sec)?.label}</NavLink>
          {selectedRecord && <><span style={{ color:C.textMuted }}>/</span><span style={{ color:C.textPrimary, fontWeight:500 }}>{selectedRecord.name}</span></>}
        </div>
        <button style={{ display:'flex', alignItems:'center', gap:6, background:C.page, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 12px', fontSize:12.5, color:C.textSecondary, cursor:'pointer', fontWeight:500 }}>
          <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" size={13} color={C.textSecondary}/>Reports
        </button>
      </div>
      <SectionTabs sections={SECTIONS} moduleId="portal" active={sec} onChange={changeSection} counts={counts} />
      <div style={{ flex:1, overflow:'hidden', display:'flex' }}>
        {selectedRecord ? (
          <RecordDetail tableName={selectedRecord.table} recordId={selectedRecord.id} onBack={closeRecord}
            mode={selectedRecord.mode || 'view'}
            onRecordCreated={(r) => replaceSelectedRecord({ table: r.table, id: r.id, mode: 'view' })}
            prefill={selectedRecord.prefill}
            onNavigateToRecord={(r) => setSelectedRecord({ table: r.table, id: r.id, mode: r.mode, prefill: r.prefill })} />
        ) : (<>
        {sec!=='home' && (SEC_TABLE[sec] || SECTIONS.find(s=>s.id===sec)?.objectTable) && (
          <ObjectListSection
            key={SEC_TABLE[sec] || SECTIONS.find(s=>s.id===sec).objectTable}
            objectTable={SEC_TABLE[sec] || SECTIONS.find(s=>s.id===sec).objectTable}
            moduleId="portal" />
        )}
        {sec==='home'     && <PortalHome setSec={setSec} users={users} partners={partners} />}
        {sec==='portals'  && <PropertyOwnerPortals isSystemAdmin={isSystemAdmin}
          onOpenAccount={(r) => setSelectedRecord({ table:'accounts', id:r._id, name:r.name })} />}
        </>)}
      </div>
    </div>
  )
}
