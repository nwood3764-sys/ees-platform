import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { C, CHART_COLORS } from '../data/constants'
import { Icon, SectionTabs } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import { fetchVehicles, fetchVehicleActivities, fetchEquipmentContainers } from '../data/fleetService'

const SECTIONS = [
  { id: 'home',       label: 'Home'       },
  { id: 'vehicles',   label: 'Vehicles'   },
  { id: 'activities', label: 'Activities' },
  { id: 'kits',       label: 'Vehicle Kits' },
]

const VEH_COLS = [
  { field:'id',                 label:'Record #',     type:'text',   sortable:true, filterable:false },
  { field:'name',               label:'Vehicle',      type:'text',   sortable:true, filterable:true  },
  { field:'yearMakeModel',      label:'Year / Make / Model', type:'text', sortable:true, filterable:true },
  { field:'vinLast3',           label:'VIN (last 3)', type:'text',   sortable:false,filterable:false },
  { field:'plate',              label:'Plate',        type:'text',   sortable:true, filterable:true  },
  { field:'type',               label:'Type',         type:'select', sortable:true, filterable:true, options:['Box Truck','Van','Pickup Truck','Cargo Van','Sedan'] },
  { field:'status',             label:'Status',       type:'select', sortable:true, filterable:true, options:['Active','In Maintenance','Out of Service','Retired'] },
  { field:'odometer',           label:'Odometer',     type:'text',   sortable:true, filterable:false },
  { field:'assignedTo',         label:'Assigned To',  type:'text',   sortable:true, filterable:true  },
  { field:'insuranceExpiry',    label:'Ins. Expiry',  type:'date',   sortable:true, filterable:true  },
  { field:'registrationExpiry', label:'Reg. Expiry',  type:'date',   sortable:true, filterable:true  },
]

const VEH_VIEWS = [
  { id:'VV-01', name:'All Vehicles',    filters:[], sortField:'name', sortDir:'asc' },
  { id:'VV-02', name:'Active',          filters:[{ field:'status', label:'Status', op:'equals', value:'Active' }],         sortField:'name', sortDir:'asc' },
  { id:'VV-03', name:'In Maintenance',  filters:[{ field:'status', label:'Status', op:'equals', value:'In Maintenance' }], sortField:'name', sortDir:'asc' },
]

const ACT_COLS = [
  { field:'id',               label:'Record #',    type:'text',   sortable:true, filterable:false },
  { field:'name',             label:'Activity',    type:'text',   sortable:true, filterable:true  },
  { field:'vehicle',          label:'Vehicle',     type:'text',   sortable:true, filterable:true  },
  { field:'plate',            label:'Plate',       type:'text',   sortable:true, filterable:true  },
  { field:'activityType',     label:'Type',        type:'select', sortable:true, filterable:true,
    options:['Pre-Trip Inspection','Post-Trip Inspection','Fuel Log','Maintenance','Damage Report','Mileage Log','Vehicle Check-Out','Vehicle Check-In'] },
  { field:'activityDate',     label:'Date',        type:'date',   sortable:true, filterable:true  },
  { field:'odometer',         label:'Odometer',    type:'text',   sortable:true, filterable:false },
  { field:'fuelGallons',      label:'Fuel (gal)',  type:'text',   sortable:true, filterable:false },
  { field:'fuelCost',         label:'Fuel Cost',   type:'text',   sortable:true, filterable:false },
  { field:'maintenanceCost',  label:'Maint. Cost', type:'text',   sortable:true, filterable:false },
  { field:'performedBy',      label:'By',          type:'text',   sortable:true, filterable:true  },
]

const ACT_VIEWS = [
  { id:'AV-01', name:'All Activities',    filters:[], sortField:'activityDate', sortDir:'desc' },
  { id:'AV-02', name:'Pre-Trip Today',    filters:[{ field:'activityType', label:'Type', op:'equals', value:'Pre-Trip Inspection' }], sortField:'activityDate', sortDir:'desc' },
  { id:'AV-03', name:'Fuel Logs',         filters:[{ field:'activityType', label:'Type', op:'equals', value:'Fuel Log' }], sortField:'activityDate', sortDir:'desc' },
  { id:'AV-04', name:'Maintenance',       filters:[{ field:'activityType', label:'Type', op:'equals', value:'Maintenance' }], sortField:'activityDate', sortDir:'desc' },
]

const KIT_COLS = [
  { field:'id',               label:'Record #',     type:'text', sortable:true, filterable:false },
  { field:'name',             label:'Kit',          type:'text', sortable:true, filterable:true  },
  { field:'vehicle',          label:'On Vehicle',   type:'text', sortable:true, filterable:true  },
  { field:'expectedContents', label:'Expected Contents', type:'text', sortable:false, filterable:false },
]

const KIT_VIEWS = [
  { id:'KV-01', name:'All Kits', filters:[], sortField:'vehicle', sortDir:'asc' },
]

// ---------------------------------------------------------------------------
// Home dashboard
// ---------------------------------------------------------------------------

function FleetHome({ setSec, vehicles, activities, kits }) {
  const active = vehicles.filter(v => v.status === 'Active').length
  const inMaint = vehicles.filter(v => v.status === 'In Maintenance').length
  const totalMiles = vehicles.reduce((s, v) => s + (v.odometer || 0), 0)

  // Fuel spend last 30 days from activities
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)
  const fuelLast30 = activities
    .filter(a => a.activityType === 'Fuel Log' && a.activityDate && new Date(a.activityDate) >= thirtyDaysAgo)
    .reduce((s, a) => s + (a.fuelCost || 0), 0)

  // Activities by type
  const typeMap = new Map()
  for (const a of activities) typeMap.set(a.activityType, (typeMap.get(a.activityType) || 0) + 1)
  const byType = Array.from(typeMap, ([name, value]) => ({ name, value }))

  // Expiring soon — insurance or registration within 60 days
  const in60Days = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60)
  const expiringSoon = vehicles.filter(v => {
    const ins = v.insuranceExpiry && v.insuranceExpiry !== '—' ? new Date(v.insuranceExpiry) : null
    const reg = v.registrationExpiry && v.registrationExpiry !== '—' ? new Date(v.registrationExpiry) : null
    return (ins && ins <= in60Days) || (reg && reg <= in60Days)
  })

  return (
    <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:11, color:C.textMuted, marginBottom:2 }}>Fleet</div>
        <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>Fleet Operations Dashboard</h1>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>Nicholas Wood · Director of Field Services · Today</div>
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:16 }}>
        {[
          { label:'Active Vehicles',  value: active,                    sub:`${vehicles.length} total in fleet`,       color:C.emerald, action: () => setSec('vehicles') },
          { label:'In Maintenance',   value: inMaint,                   sub:'Currently out of service',                 color:C.amber,   action: () => setSec('vehicles') },
          { label:'Total Fleet Miles',value: totalMiles.toLocaleString(),sub:'Across all vehicles',                     color:C.sky,     action: () => setSec('vehicles') },
          { label:'Fuel Spend 30d',   value: `$${Math.round(fuelLast30).toLocaleString()}`, sub:'Last 30 days',           color:C.purple,  action: () => setSec('activities') },
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

      {/* Charts + watch list */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Activities by Type</div>
          {byType.length === 0 ? (
            <div style={{ fontSize:12, color:C.textMuted, padding:'20px 0' }}>No vehicle activities logged.</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={byType} layout="vertical" margin={{ left:0, right:14, top:0, bottom:0 }}>
                <XAxis type="number" tick={{ fontSize:10, fill:C.textMuted }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize:10, fill:C.textSecondary }} tickLine={false} axisLine={false} width={130} />
                <Tooltip contentStyle={{ fontSize:11, border:`1px solid ${C.border}`, borderRadius:5 }} />
                <Bar dataKey="value" radius={[0,4,4,0]} fill={C.emerald} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Insurance / Registration Expiring ≤ 60 days</div>
          {expiringSoon.length === 0 ? (
            <div style={{ fontSize:12, color:C.textMuted, padding:'20px 0' }}>Everything current. ✓</div>
          ) : (
            <div>
              {expiringSoon.map(v => (
                <div key={v._id} style={{ padding:'8px 0', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontSize:12, color:C.textPrimary, fontWeight:500 }}>{v.name}</div>
                    <div style={{ fontSize:10, color:C.textMuted }}>{v.plate}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:10, color:C.textMuted }}>Ins: {v.insuranceExpiry}</div>
                    <div style={{ fontSize:10, color:C.textMuted }}>Reg: {v.registrationExpiry}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Today's fleet */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Today's Fleet</div>
        {vehicles.length === 0 ? (
          <div style={{ fontSize:12, color:C.textMuted, padding:'12px 0' }}>No vehicles in fleet.</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Vehicle</th>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Year / Make / Model</th>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Plate</th>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Status</th>
                <th style={{ textAlign:'right', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Odometer</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map(v => (
                <tr key={v._id} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textPrimary }}>{v.name}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textSecondary }}>{v.yearMakeModel}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textSecondary, fontFamily:'JetBrains Mono, monospace' }}>{v.plate}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textSecondary }}>{v.status}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textPrimary, fontFamily:'JetBrains Mono, monospace', textAlign:'right' }}>{v.odometer.toLocaleString()}</td>
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

function LiveListView({ loading, error, data, ...rest }) {
  if (loading) return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:C.textMuted, fontSize:13 }}>Loading…</div>
  if (error)   return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8, padding:24 }}><div style={{ color:'#b03a2e', fontSize:13, fontWeight:600 }}>Could not load records</div><div style={{ color:C.textMuted, fontSize:12, fontFamily:'JetBrains Mono, monospace', maxWidth:560, textAlign:'center' }}>{String(error.message || error)}</div></div>
  return <ListView data={data} {...rest} />
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default function FleetModule() {
  const [sec, setSec] = useState('home')
  const [selectedRecord, setSelectedRecord] = useState(null)
  const SEC_TABLE = {'vehicles': 'vehicles', 'activities': 'vehicle_activities', 'kits': 'equipment_containers'}
  const openRecord = (row) => { if (row?._id && SEC_TABLE[sec]) setSelectedRecord({ table: SEC_TABLE[sec], id: row._id, name: row.name }) }
  const closeRecord = () => setSelectedRecord(null)
  const [vehicles,   setVehicles]   = useState([])
  const [activities, setActivities] = useState([])
  const [kits,       setKits]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchVehicles(), fetchVehicleActivities(), fetchEquipmentContainers()])
      .then(([v, a, k]) => { if (!cancelled) { setVehicles(v); setActivities(a); setKits(k) } })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const counts = { vehicles: vehicles.length, activities: activities.length, kits: kits.length }
  const urgentCount = vehicles.filter(v => v.status === 'In Maintenance').length
  const urgentSections = { vehicles: urgentCount }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ height:54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Fleet</span>
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
          <RecordDetail tableName={selectedRecord.table} recordId={selectedRecord.id} onBack={closeRecord} />
        ) : (<>
        {sec==='home'       && <FleetHome setSec={setSec} vehicles={vehicles} activities={activities} kits={kits} />}
        {sec==='vehicles'   && <LiveListView loading={loading} error={error} data={vehicles}   columns={VEH_COLS} systemViews={VEH_VIEWS} defaultViewId="VV-01" newLabel="Vehicle"  onNew={() => {}}  onOpenRecord={openRecord}/>}
        {sec==='activities' && <LiveListView loading={loading} error={error} data={activities} columns={ACT_COLS} systemViews={ACT_VIEWS} defaultViewId="AV-01" newLabel="Activity" onNew={() => {}}  onOpenRecord={openRecord}/>}
        {sec==='kits'       && <LiveListView loading={loading} error={error} data={kits}       columns={KIT_COLS} systemViews={KIT_VIEWS} defaultViewId="KV-01" newLabel="Kit"      onNew={() => {}}  onOpenRecord={openRecord}/>}
        </>)}
      </div>
    </div>
  )
}
