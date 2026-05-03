import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { C, CHART_COLORS, fmt } from '../data/constants'
import { Badge, Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import {
  fetchProducts,
  fetchProductItems,
  fetchMaterialsRequests,
  fetchEquipment,
} from '../data/stockService'

// ---------------------------------------------------------------------------
// Section & column definitions
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: 'home',      label: 'Home'              },
  { id: 'inventory', label: 'Inventory On-Hand' },
  { id: 'products',  label: 'Product Catalog'   },
  { id: 'requests',  label: 'Materials Requests'},
  { id: 'equipment', label: 'Equipment'         },
]

const INV_COLS = [
  { field:'id',             label:'Record #',   type:'text',   sortable:true, filterable:false },
  { field:'name',           label:'Product',    type:'text',   sortable:true, filterable:true  },
  { field:'family',         label:'Family',     type:'select', sortable:true, filterable:true,
    options:['HVAC Equipment','Water Heating','Insulation','Air Sealing','Ventilation','Lighting','Appliances','Tools & Equipment','Supplies','Services'] },
  { field:'manufacturer',   label:'Mfr',        type:'text',   sortable:true, filterable:true  },
  { field:'quantityOnHand', label:'On Hand',    type:'text',   sortable:true, filterable:false },
  { field:'location',       label:'Location',   type:'text',   sortable:true, filterable:true  },
  { field:'vendor',         label:'Vendor',     type:'text',   sortable:true, filterable:true  },
]

const PROD_COLS = [
  { field:'id',           label:'Record #',     type:'text',   sortable:true, filterable:false },
  { field:'name',         label:'Product Name', type:'text',   sortable:true, filterable:true  },
  { field:'family',       label:'Family',       type:'select', sortable:true, filterable:true,
    options:['HVAC Equipment','Water Heating','Insulation','Air Sealing','Ventilation','Lighting','Appliances','Tools & Equipment','Supplies','Services'] },
  { field:'manufacturer', label:'Mfr',          type:'text',   sortable:true, filterable:true  },
  { field:'model',        label:'Model',        type:'text',   sortable:true, filterable:true  },
  { field:'status',       label:'Status',       type:'select', sortable:true, filterable:true, options:['Active','Inactive'] },
]

const REQ_COLS = [
  { field:'id',             label:'Record #',      type:'text',   sortable:true, filterable:false },
  { field:'name',           label:'Request',       type:'text',   sortable:true, filterable:true  },
  { field:'property',       label:'Property',      type:'text',   sortable:true, filterable:true  },
  { field:'project',        label:'Project',       type:'text',   sortable:true, filterable:true  },
  { field:'status',         label:'Status',        type:'select', sortable:true, filterable:true,
    options:['Draft','Submitted','Approved','Ordered','Partially Received','Received','Canceled'] },
  { field:'sourceLocation', label:'Source',        type:'text',   sortable:true, filterable:true  },
  { field:'lineItems',      label:'Lines',         type:'text',   sortable:true, filterable:false },
  { field:'needBy',         label:'Need By',       type:'date',   sortable:true, filterable:true  },
  { field:'state',          label:'State',         type:'select', sortable:true, filterable:true, options:['WI','CO','NC','MI','IN'] },
]

const EQ_COLS = [
  { field:'id',           label:'Record #',    type:'text',   sortable:true, filterable:false },
  { field:'name',         label:'Equipment',   type:'text',   sortable:true, filterable:true  },
  { field:'manufacturer', label:'Mfr',         type:'text',   sortable:true, filterable:true  },
  { field:'model',        label:'Model',       type:'text',   sortable:true, filterable:true  },
  { field:'serialNumber', label:'Serial',      type:'text',   sortable:true, filterable:false },
  { field:'year',         label:'Year',        type:'text',   sortable:true, filterable:false },
  { field:'condition',    label:'Condition',   type:'select', sortable:true, filterable:true, options:['Excellent','Good','Fair','Poor','Non-Functioning'] },
  { field:'location',     label:'Location',    type:'text',   sortable:true, filterable:true  },
  { field:'assignedTo',   label:'Assigned To', type:'text',   sortable:true, filterable:true  },
  { field:'status',       label:'Status',      type:'select', sortable:true, filterable:true, options:['Active','Retired'] },
]

const INV_VIEWS = [
  { id:'IV-01', name:'All Inventory',         filters:[], sortField:'name', sortDir:'asc' },
  { id:'IV-02', name:'HVAC Equipment',        filters:[{ field:'family', label:'Family', op:'equals', value:'HVAC Equipment' }], sortField:'quantityOnHand', sortDir:'desc' },
  { id:'IV-03', name:'Insulation',            filters:[{ field:'family', label:'Family', op:'equals', value:'Insulation' }],    sortField:'quantityOnHand', sortDir:'desc' },
]
const PROD_VIEWS = [
  { id:'PRV-01', name:'All Products', filters:[], sortField:'name', sortDir:'asc' },
  { id:'PRV-02', name:'Active',       filters:[{ field:'status', label:'Status', op:'equals', value:'Active' }], sortField:'name', sortDir:'asc' },
]
const REQ_VIEWS = [
  { id:'RV-01', name:'All Requests',      filters:[], sortField:'needBy', sortDir:'asc' },
  { id:'RV-02', name:'Submitted',         filters:[{ field:'status', label:'Status', op:'equals', value:'Submitted' }],         sortField:'needBy', sortDir:'asc' },
  { id:'RV-03', name:'Approved',          filters:[{ field:'status', label:'Status', op:'equals', value:'Approved' }],          sortField:'needBy', sortDir:'asc' },
  { id:'RV-04', name:'Received',          filters:[{ field:'status', label:'Status', op:'equals', value:'Received' }],          sortField:'needBy', sortDir:'desc' },
]
const EQ_VIEWS = [
  { id:'EQV-01', name:'All Equipment', filters:[], sortField:'name', sortDir:'asc' },
  { id:'EQV-02', name:'Active',        filters:[{ field:'status', label:'Status', op:'equals', value:'Active' }], sortField:'name', sortDir:'asc' },
]

// ---------------------------------------------------------------------------
// Home dashboard
// ---------------------------------------------------------------------------

function StockHome({ setSec, products, inventory, requests, equipment }) {
  // KPI calculations
  const totalSkus = products.length
  const totalOnHand = inventory.reduce((s, r) => s + r.quantityOnHand, 0)
  const openRequests = requests.filter(r => r.status === 'Submitted' || r.status === 'Approved').length
  const activeEquipment = equipment.filter(e => e.status === 'Active').length

  // Inventory by family (for pie chart)
  const famMap = new Map()
  for (const r of inventory) famMap.set(r.family, (famMap.get(r.family) || 0) + r.quantityOnHand)
  const invByFamily = Array.from(famMap, ([name, value]) => ({ name, value }))

  // Requests by status (for bar chart)
  const statMap = new Map()
  for (const r of requests) statMap.set(r.status, (statMap.get(r.status) || 0) + 1)
  const reqByStatus = Array.from(statMap, ([name, value]) => ({ name, value }))

  return (
    <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:11, color:C.textMuted, marginBottom:2 }}>Stock</div>
        <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>Inventory & Materials Dashboard</h1>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>Nicholas Wood · Shop Steward · Today</div>
      </div>

      {/* KPI row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12, marginBottom:16 }}>
        {[
          { label:'Total SKUs',        value: totalSkus,     sub:`${products.length} products in catalog`, color:C.emerald, action: () => setSec('products') },
          { label:'Units On Hand',     value: totalOnHand.toLocaleString(), sub:'Across all locations',     color:C.sky,     action: () => setSec('inventory') },
          { label:'Open Requests',     value: openRequests,  sub:'Submitted or approved',                   color:C.amber,   action: () => setSec('requests')  },
          { label:'Active Equipment',  value: activeEquipment, sub:'Assigned and in service',               color:C.purple,  action: () => setSec('equipment') },
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
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>On-Hand by Product Family</div>
          {invByFamily.length === 0 ? (
            <div style={{ fontSize:12, color:C.textMuted, padding:'20px 0' }}>No inventory loaded yet.</div>
          ) : (
            <div style={{ display:'flex', gap:12, alignItems:'center' }}>
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={invByFamily} cx="50%" cy="50%" innerRadius={32} outerRadius={60} dataKey="value" strokeWidth={0}>
                    {invByFamily.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex:1 }}>
                {invByFamily.map((d, i) => (
                  <div key={d.name} style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:8, height:8, borderRadius:2, background:CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span style={{ fontSize:11, color:C.textSecondary }}>{d.name}</span>
                    </div>
                    <span style={{ fontSize:12, fontWeight:600, color:C.textPrimary, fontFamily:'JetBrains Mono, monospace' }}>{d.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Materials Requests by Status</div>
          {reqByStatus.length === 0 ? (
            <div style={{ fontSize:12, color:C.textMuted, padding:'20px 0' }}>No materials requests loaded.</div>
          ) : (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={reqByStatus} margin={{ left:0, right:10, top:8, bottom:0 }}>
                <XAxis dataKey="name" tick={{ fontSize:10, fill:C.textSecondary }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize:10, fill:C.textMuted }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize:11, border:`1px solid ${C.border}`, borderRadius:5 }} />
                <Bar dataKey="value" radius={[4,4,0,0]} fill={C.emerald} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Low on-hand watch list */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:10 }}>Inventory — Lowest On-Hand</div>
        {inventory.length === 0 ? (
          <div style={{ fontSize:12, color:C.textMuted, padding:'12px 0' }}>No inventory records.</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Product</th>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Family</th>
                <th style={{ textAlign:'left', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>Location</th>
                <th style={{ textAlign:'right', padding:'8px 0', fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em' }}>On Hand</th>
              </tr>
            </thead>
            <tbody>
              {inventory.slice().sort((a,b) => a.quantityOnHand - b.quantityOnHand).slice(0, 5).map(r => (
                <tr key={r._id} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textPrimary }}>{r.name}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textSecondary }}>{r.family}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textSecondary }}>{r.location}</td>
                  <td style={{ padding:'10px 0', fontSize:12, color:C.textPrimary, fontFamily:'JetBrains Mono, monospace', textAlign:'right' }}>{r.quantityOnHand.toLocaleString()}</td>
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
// LiveListView wrapper — same loading/error pattern as other modules
// ---------------------------------------------------------------------------

function LiveListView({ loading, error, data, onRetry, ...rest }) {
  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onRetry} />
  return <ListView data={data} {...rest} />
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default function StockModule({ selectedRecord: navSelectedRecord, sectionFromUrl, onNavigateToRecord, onCloseRecord, onSectionChange, onReplaceRecord } = {}) {
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

  const SEC_TABLE = {'inventory': 'product_items', 'products': 'products', 'requests': 'materials_requests', 'equipment': 'equipment'}
  const openRecord = (row) => { if (row?._id && SEC_TABLE[sec]) setSelectedRecord({ table: SEC_TABLE[sec], id: row._id, name: row.name }) }
  const closeRecord = () => setSelectedRecord(null)
  const [products,  setProducts]  = useState([])
  const [inventory, setInventory] = useState([])
  const [requests,  setRequests]  = useState([])
  const [equipment, setEquipment] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Pull-to-refresh handler. Refetches in the background without blanking
  // the UI; the ListView indicator shows progress inline.
  const loadAll = async () => {
    setError(null)
    try {
      const [p, i, r, e] = await Promise.all([
        fetchProducts(), fetchProductItems(), fetchMaterialsRequests(), fetchEquipment(),
      ])
      setProducts(p); setInventory(i); setRequests(r); setEquipment(e)
    } catch (err) {
      setError(err)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([fetchProducts(), fetchProductItems(), fetchMaterialsRequests(), fetchEquipment()])
      .then(([p, i, r, e]) => { if (!cancelled) { setProducts(p); setInventory(i); setRequests(r); setEquipment(e) } })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const counts = {
    inventory: inventory.length,
    products:  products.length,
    requests:  requests.length,
    equipment: equipment.length,
  }
  const urgentCount = requests.filter(r => r.status === 'Submitted').length
  const urgentSections = { requests: urgentCount }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div data-module-topbar="1" style={{ height: 54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Stock</span>
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
            onRecordCreated={(r) => replaceSelectedRecord({ table: r.table, id: r.id, mode: 'view' })}
            prefill={selectedRecord.prefill}
            onNavigateToRecord={(r) => setSelectedRecord({ table: r.table, id: r.id, mode: r.mode, prefill: r.prefill })} />
        ) : (<>
        {sec==='home'      && <StockHome setSec={setSec} products={products} inventory={inventory} requests={requests} equipment={equipment} />}
        {sec==='inventory' && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={inventory} columns={INV_COLS}  systemViews={INV_VIEWS}  defaultViewId="IV-01"  newLabel="Inventory Record" onNew={() => setSelectedRecord({ table: 'product_items', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='products'  && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={products}  columns={PROD_COLS} systemViews={PROD_VIEWS} defaultViewId="PRV-01" newLabel="Product"          onNew={() => setSelectedRecord({ table: 'products', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='requests'  && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={requests}  columns={REQ_COLS}  systemViews={REQ_VIEWS}  defaultViewId="RV-01"  newLabel="Materials Request" onNew={() => setSelectedRecord({ table: 'materials_requests', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        {sec==='equipment' && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={equipment} columns={EQ_COLS}   systemViews={EQ_VIEWS}   defaultViewId="EQV-01" newLabel="Equipment"        onNew={() => setSelectedRecord({ table: 'equipment', id: null, mode: 'create' })}  onOpenRecord={openRecord}/>}
        </>)}
      </div>
    </div>
  )
}
