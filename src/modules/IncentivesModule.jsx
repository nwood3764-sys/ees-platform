import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { C, CHART_COLORS, fmt } from '../data/constants'
import { Badge, Icon, TableRow, ProgramTag, SectionTabs } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import { fetchPaymentRequests, fetchPaymentReceipts } from '../data/incentivesService'

const SECTIONS = [
  { id:'home',     label:'Home'                       },
  { id:'requests', label:'Project Payment Requests'   },
  { id:'received', label:'Payment Receipt'            },
]

const PR_COLS = [
  { field:'id',          label:'Record #',    type:'text',   sortable:true, filterable:false },
  { field:'name',        label:'Request',     type:'text',   sortable:true, filterable:true  },
  { field:'property',    label:'Property',    type:'text',   sortable:true, filterable:true  },
  { field:'program',     label:'Program',     type:'select', sortable:true, filterable:true, options:['WI-IRA-MF-HOMES','WI-IRA-MF-HEAR','WI-IRA-SF-HOMES','CO - Denver','WI - FOE','MI-IRA-MF-HOMES'] },
  { field:'status',      label:'Status',      type:'select', sortable:true, filterable:true, options:['Payment Request To Be Prepared','Payment Request To Be Verified','Payment Request To Be Submitted','Payment Request Submitted — Awaiting Review','Payment Request Under Review','Payment Request Approved','Payment Request Payment Pending','Payment Request Payment Received','Payment Request Closed'] },
  { field:'owner',       label:'Owner',       type:'select', sortable:true, filterable:true, options:['Marcus Reid','Priya Nair','Lisa Tanaka'] },
  { field:'amount',      label:'Amount',      type:'text',   sortable:true, filterable:false },
  { field:'paymentBody', label:'Paid By',     type:'select', sortable:true, filterable:true, options:['DOE-HOMES','DOE-HEAR','Focus on Energy','Denver OEE','MI-EGLE'] },
  { field:'daysOpen',    label:'Days Open',   type:'text',   sortable:true, filterable:false },
  { field:'state',       label:'State',       type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

const PMT_COLS = [
  { field:'id',           label:'Payment #',   type:'text',   sortable:true, filterable:false },
  { field:'name',         label:'Application', type:'text',   sortable:true, filterable:true  },
  { field:'property',     label:'Property',    type:'text',   sortable:true, filterable:true  },
  { field:'program',      label:'Program',     type:'select', sortable:true, filterable:true, options:['WI-IRA-MF-HOMES','WI-IRA-MF-HEAR','WI-IRA-SF-HOMES','CO - Denver','WI - FOE','MI-IRA-MF-HOMES'] },
  { field:'paymentBody',  label:'Payment Body',type:'select', sortable:true, filterable:true, options:['DOE-HOMES','DOE-HEAR','Focus on Energy','Denver OEE','MI-EGLE'] },
  { field:'amount',       label:'Amount',      type:'text',   sortable:true, filterable:false },
  { field:'receivedDate', label:'Received',    type:'date',   sortable:true, filterable:true  },
  { field:'paymentRef',   label:'Reference',   type:'text',   sortable:true, filterable:true  },
  { field:'state',        label:'State',       type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

const PR_VIEWS = [
  { id:'PRV-01', name:'All Project Payment Requests', filters:[], sortField:'daysOpen', sortDir:'desc' },
  { id:'PRV-02', name:'Needs Action',   filters:[{ field:'status', label:'Status', op:'equals', value:'Payment Request To Be Prepared' }], sortField:'daysOpen', sortDir:'desc' },
  { id:'PRV-03', name:'Awaiting Review',filters:[{ field:'status', label:'Status', op:'equals', value:'Payment Request Submitted — Awaiting Review' }], sortField:'daysOpen', sortDir:'desc' },
  { id:'PRV-04', name:'Payment Pending',filters:[{ field:'status', label:'Status', op:'equals', value:'Payment Request Payment Pending' }], sortField:'daysOpen', sortDir:'desc' },
]
const PMT_VIEWS = [{ id:'PTV-01', name:'All Receipts', filters:[], sortField:'receivedDate', sortDir:'desc' }]

function prCell(col, r) {
  if (col.field === 'amount') return <td key={col.field} style={{ padding:'11px 12px', borderBottom:`1px solid ${C.border}`, color:C.textPrimary, fontWeight:500, fontFamily:'JetBrains Mono, monospace', fontSize:12 }}>{fmt(r[col.field])}</td>
  if (col.field === 'daysOpen') return <td key={col.field} style={{ padding:'11px 12px', borderBottom:`1px solid ${C.border}`, color:Number(r[col.field])>30?C.danger:C.textSecondary, fontWeight:Number(r[col.field])>30?700:400 }}>{r[col.field]}d{Number(r[col.field])>30?' ⚠':''}</td>
  return undefined
}

function pmtCell(col, r) {
  if (col.field === 'amount') return <td key={col.field} style={{ padding:'11px 12px', borderBottom:`1px solid ${C.border}`, color:'#1a7a4e', fontWeight:600, fontFamily:'JetBrains Mono, monospace', fontSize:12 }}>{fmt(r[col.field])}</td>
  if (col.field === 'paymentRef') return <td key={col.field} style={{ padding:'11px 12px', borderBottom:`1px solid ${C.border}`, color:C.textSecondary, fontFamily:'JetBrains Mono, monospace', fontSize:11 }}>{r[col.field]}</td>
  return undefined
}

function IncentivesHome({ setSec, requests, receipts }) {
  const toPrepare    = requests.filter(r => r.status==='Payment Request To Be Prepared'||r.status==='Payment Request To Be Verified')
  const toSubmit     = requests.filter(r => r.status==='Payment Request To Be Submitted')
  const awaitReview  = requests.filter(r => r.status.includes('Awaiting')||r.status==='Payment Request Under Review')
  const pmtPending   = requests.filter(r => r.status==='Payment Request Payment Pending')
  const overdue      = requests.filter(r => r.daysOpen>30&&!r.status.includes('Received'))
  const totalPipeline = requests.reduce((s,r)=>s+(r.amount||0),0)
  const totalApproved = requests.filter(r=>['Payment Request Approved','Payment Request Payment Pending','Payment Request Payment Received'].includes(r.status)).reduce((s,r)=>s+(r.amount||0),0)
  const totalReceived = receipts.reduce((s,r)=>s+(r.amount||0),0)

  const prByStatus = [
    { name:'To Prepare',     value:toPrepare.length  },
    { name:'To Submit',      value:toSubmit.length   },
    { name:'Awaiting Review',value:awaitReview.length },
    { name:'Pmt Pending',    value:pmtPending.length },
    { name:'Received',       value:receipts.length },
  ]

  // Pipeline by program computed from live requests
  const progMap = new Map()
  for (const r of requests) {
    const k = r.program || '—'
    progMap.set(k, (progMap.get(k) || 0) + (r.amount || 0))
  }
  const pipelineByProgram = Array.from(progMap, ([name, v]) => ({ name, value: Math.round(v/1000) }))
    .sort((a,b)=>b.value-a.value)

  // Payments received rolling 6-month line (from live receipts)
  const monthKeys = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1)
    monthKeys.push({
      key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
      label: d.toLocaleString('en-US', { month: 'short' }),
    })
  }
  const monthMap = new Map(monthKeys.map(m => [m.key, 0]))
  for (const r of receipts) {
    if (!r.receivedDate) continue
    const k = r.receivedDate.slice(0, 7)
    if (monthMap.has(k)) monthMap.set(k, monthMap.get(k) + (r.amount || 0))
  }
  const receivedByMonth = monthKeys.map(m => ({ month: m.label, value: Math.round((monthMap.get(m.key) || 0) / 1000) }))

  return (
    <div style={{ flex:1, overflow:'auto', display:'flex' }}>
      <div style={{ flex:1, overflow:'auto', padding:'20px 20px 24px' }}>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, color:C.textMuted, marginBottom:2 }}>Incentives / Home</div>
          <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>Incentives Dashboard</h1>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>Nicholas Wood · Program Manager · Sunday, April 12, 2026</div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12, marginBottom:16 }}>
          {[
            { label:'Requests to Prepare',  value:toPrepare.length,   color:C.amber,  action:() => setSec('requests') },
            { label:'Ready to Submit',       value:toSubmit.length,    color:C.sky,    action:() => setSec('requests') },
            { label:'Awaiting Review',       value:awaitReview.length, color:C.purple, action:() => setSec('requests') },
            { label:'Payment Pending',       value:pmtPending.length,  color:C.emerald,action:() => setSec('requests') },
          ].map(s => (
            <div key={s.label} onClick={s.action}
              style={{ background:C.card, border:`2px solid ${C.border}`, borderTop:`3px solid ${s.color}`, borderRadius:8, padding:'14px 16px', cursor:'pointer' }}
              onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.08)'}
              onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
              <div style={{ fontSize:11, color:C.textMuted, fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:8 }}>{s.label}</div>
              <div style={{ fontSize:26, fontWeight:700, color:s.color, fontFamily:'JetBrains Mono, monospace' }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:12, marginBottom:16 }}>
          {[
            { label:'Total Pipeline',     value:totalPipeline,  note:'All active project payment requests' },
            { label:'Approved / Pending', value:totalApproved,  note:'Approved + payment pending'          },
            { label:'Total Received YTD', value:totalReceived,  note:'Payments received this year'         },
          ].map(s => (
            <div key={s.label} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'16px 18px' }}>
              <div style={{ fontSize:11, color:C.textMuted, fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>{s.label}</div>
              <div style={{ fontSize:22, fontWeight:700, color:C.textPrimary, fontFamily:'JetBrains Mono, monospace', marginBottom:4 }}>{fmt(s.value)}</div>
              <div style={{ fontSize:11, color:C.textMuted }}>{s.note}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:14, marginBottom:14 }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
            <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}><div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Project Payment Requests by Status</div></div>
            <div style={{ padding:'12px 14px', display:'flex', gap:10, alignItems:'center' }}>
              <ResponsiveContainer width={80} height={80}>
                <PieChart><Pie data={prByStatus} cx="50%" cy="50%" innerRadius={18} outerRadius={36} dataKey="value" strokeWidth={0}>{prByStatus.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}</Pie></PieChart>
              </ResponsiveContainer>
              <div style={{ flex:1 }}>
                {prByStatus.map((d,i)=>(
                  <div key={d.name} style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:7, height:7, borderRadius:2, background:CHART_COLORS[i%CHART_COLORS.length], flexShrink:0 }}/><span style={{ fontSize:10, color:C.textSecondary }}>{d.name}</span></div>
                    <span style={{ fontSize:11, fontWeight:600, color:C.textPrimary, fontFamily:'JetBrains Mono, monospace' }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding:'8px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={()=>setSec('requests')} style={{ color:'#1a5a8a', fontSize:11, cursor:'pointer', fontWeight:500 }}>View Requests →</span></div>
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
            <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}><div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Pipeline by Program ($K)</div></div>
            <div style={{ padding:'10px 14px' }}>
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={pipelineByProgram} layout="vertical" margin={{ left:0, right:14, top:0, bottom:0 }}>
                  <XAxis type="number" hide/><YAxis type="category" dataKey="name" tick={{ fontSize:9, fill:C.textMuted }} tickLine={false} axisLine={false} width={100}/>
                  <Tooltip formatter={v=>[`$${v}K`,'Amount']} contentStyle={{ fontSize:11, border:`1px solid ${C.border}`, borderRadius:5 }}/>
                  <Bar dataKey="value" radius={[0,4,4,0]} fill={C.emerald}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ padding:'8px 14px', borderTop:`1px solid ${C.border}` }}><span style={{ color:'#1a5a8a', fontSize:11, cursor:'pointer', fontWeight:500 }}>View Report →</span></div>
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
            <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}><div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Payments Received ($K)</div><div style={{ fontSize:11, color:C.textMuted, marginTop:1 }}>Rolling 6 months</div></div>
            <div style={{ padding:'10px 14px' }}>
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={receivedByMonth} margin={{ left:0, right:14, top:8, bottom:0 }}>
                  <XAxis dataKey="month" tick={{ fontSize:10, fill:C.textSecondary }} tickLine={false} axisLine={false}/>
                  <YAxis tick={{ fontSize:10, fill:C.textMuted }} tickLine={false} axisLine={false}/>
                  <Tooltip formatter={v=>[`$${v}K`,'Received']} contentStyle={{ fontSize:11, border:`1px solid ${C.border}`, borderRadius:5 }}/>
                  <Line type="monotone" dataKey="value" stroke={C.emerald} strokeWidth={2} dot={{ fill:C.emerald, r:3 }}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ padding:'8px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={()=>setSec('received')} style={{ color:'#1a5a8a', fontSize:11, cursor:'pointer', fontWeight:500 }}>View Receipts →</span></div>
          </div>
        </div>

        {/* Aging table */}
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Project Payment Request Aging</div>
            <span style={{ fontSize:11, color:C.textMuted }}>Sorted by days open</span>
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr style={{ borderBottom:`1px solid ${C.border}` }}>{['Record #','Request','Property','Status','Amount','Days Open','Payment Body'].map(h=><th key={h} style={{ padding:'9px 12px', textAlign:'left', color:C.textMuted, fontWeight:500, fontSize:11, textTransform:'uppercase', letterSpacing:'0.04em' }}>{h}</th>)}</tr></thead>
            <tbody>
              {[...requests].sort((a,b)=>b.daysOpen-a.daysOpen).map(r=>(
                <TableRow key={r.id}>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textMuted, fontFamily:'JetBrains Mono, monospace', fontSize:10 }}>{r.id}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textPrimary, fontWeight:500, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textSecondary }}>{r.property}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}` }}><Badge s={r.status}/></td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textPrimary, fontWeight:500, fontFamily:'JetBrains Mono, monospace', fontSize:12 }}>{fmt(r.amount)}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:r.daysOpen>30?C.danger:r.daysOpen>14?C.amber:C.textSecondary, fontWeight:r.daysOpen>30?700:400 }}>{r.daysOpen}d {r.daysOpen>30?'⚠':''}</td>
                  <td style={{ padding:'10px 12px', borderBottom:`1px solid ${C.border}`, color:C.textSecondary }}>{r.paymentBody}</td>
                </TableRow>
              ))}
            </tbody>
          </table>
          <div style={{ padding:'9px 16px', borderTop:`1px solid ${C.border}` }}><span onClick={()=>setSec('requests')} style={{ color:'#1a5a8a', fontSize:11, cursor:'pointer', fontWeight:500 }}>View All Project Payment Requests →</span></div>
        </div>
      </div>

      {/* Right sidebar */}
      <div style={{ width:280, flexShrink:0, background:C.page, borderLeft:`1px solid ${C.border}`, padding:'20px 14px', overflowY:'auto' }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden', marginBottom:12 }}>
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontWeight:600, fontSize:13, color:C.textPrimary }}>Overdue — Action Required</span>
            <span style={{ background:overdue.length>0?C.danger:'#e8f8f2', color:overdue.length>0?'#fff':'#1a7a4e', fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:10 }}>{overdue.length}</span>
          </div>
          {overdue.length===0?<div style={{ padding:'16px', textAlign:'center', color:C.textMuted, fontSize:12 }}>All clear.</div>
          :overdue.map((r,i)=>(
            <div key={r.id} style={{ padding:'10px 14px', borderBottom:i<overdue.length-1?`1px solid ${C.border}`:'none', cursor:'pointer' }}
              onMouseEnter={e=>e.currentTarget.style.background='#fff8f8'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{ color:C.danger, fontSize:12, fontWeight:500, marginBottom:2 }}>{r.id} — {fmt(r.amount)}</div>
              <div style={{ color:C.textMuted, fontSize:11 }}>{r.property} · {r.daysOpen}d open</div>
            </div>
          ))}
          <div style={{ padding:'9px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={()=>setSec('requests')} style={{ color:'#1a5a8a', fontSize:12, cursor:'pointer', fontWeight:500 }}>View All</span></div>
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}><span style={{ fontWeight:600, fontSize:13, color:C.textPrimary }}>Recent Receipts</span></div>
          {receipts.map((r,i)=>(
            <div key={r.id} style={{ padding:'10px 14px', borderBottom:i<receipts.length-1?`1px solid ${C.border}`:'none', cursor:'pointer' }}
              onMouseEnter={e=>e.currentTarget.style.background='#f7f9fc'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{ color:'#1a7a4e', fontSize:12, fontWeight:600, marginBottom:2 }}>{fmt(r.amount)}</div>
              <div style={{ color:C.textSecondary, fontSize:11, marginBottom:1 }}>{r.property}</div>
              <div style={{ color:C.textMuted, fontSize:10 }}>{r.receivedDate} · {r.paymentBody}</div>
            </div>
          ))}
          <div style={{ padding:'9px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={()=>setSec('received')} style={{ color:'#1a5a8a', fontSize:12, cursor:'pointer', fontWeight:500 }}>View All</span></div>
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

export default function IncentivesModule() {
  const [sec, setSec] = useState('home')
  const [selectedRecord, setSelectedRecord] = useState(null)
  const SEC_TABLE = {'requests': 'project_payment_requests', 'receipts': 'payment_receipts'}
  const openRecord = (row) => { if (row?._id && SEC_TABLE[sec]) setSelectedRecord({ table: SEC_TABLE[sec], id: row._id, name: row.name }) }
  const closeRecord = () => setSelectedRecord(null)
  const [requests, setRequests] = useState([])
  const [receipts, setReceipts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Pull-to-refresh: re-fetch without flipping the main loading flag so the
  // UI doesn't blank out during the pull. The hook in ListView shows its own
  // inline indicator while this promise is in flight.
  const loadAll = async () => {
    setError(null)
    try {
      const [r, p] = await Promise.all([fetchPaymentRequests(), fetchPaymentReceipts()])
      setRequests(r); setReceipts(p)
    } catch (err) {
      setError(err)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([fetchPaymentRequests(), fetchPaymentReceipts()])
      .then(([r, p]) => { if (!cancelled) { setRequests(r); setReceipts(p) } })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const urgentCount = requests.filter(r=>r.daysOpen>30&&!r.status.includes('Received')).length
  const counts = { requests: requests.length, received: receipts.length }
  const urgentSections = { home: urgentCount }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div data-module-topbar="1" style={{ height: 54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Incentives</span><span style={{ color:C.textMuted }}>/</span>
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
        {sec==='home'     && <IncentivesHome setSec={setSec} requests={requests} receipts={receipts} />}
        {sec==='requests' && <LiveListView loading={loading} error={error} onRefresh={loadAll} data={requests} columns={PR_COLS}  systemViews={PR_VIEWS}  defaultViewId="PRV-01" newLabel="Project Payment Request" onNew={()=>{}} renderCell={prCell}  onOpenRecord={openRecord}/>}
        {sec==='received' && <LiveListView loading={loading} error={error} onRefresh={loadAll} data={receipts} columns={PMT_COLS} systemViews={PMT_VIEWS} defaultViewId="PTV-01" newLabel="Payment Receipt"         onNew={()=>{}} renderCell={pmtCell}  onOpenRecord={openRecord}/>}
        </>)}
      </div>
    </div>
  )
}
