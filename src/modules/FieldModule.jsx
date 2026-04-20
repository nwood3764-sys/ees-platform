import { useState, useMemo, useEffect } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { C, CHART_COLORS, fmt } from '../data/constants'
import { Badge, Icon, TableRow, ProgramTag, SectionTabs } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import { fetchProjects, fetchWorkOrders } from '../data/fieldService'
import { fetchPaymentRequests } from '../data/incentivesService'

// Schedule crews are a UI feature that will be driven by service_appointments
// + crew assignments in a later pass. For now the schedule view shows an
// empty state with this constant so nothing breaks.
const SCHEDULE_CREWS = []

const SECTIONS = [
  { id:'home',       label:'Home'         },
  { id:'projects',   label:'Projects'     },
  { id:'workorders', label:'Work Orders'  },
  { id:'schedule',   label:'Schedule'     },
]

const PROJ_COLS = [
  { field:'id',         label:'Record #', type:'text',   sortable:true, filterable:false },
  { field:'name',       label:'Project',  type:'text',   sortable:true, filterable:true  },
  { field:'property',   label:'Property', type:'text',   sortable:true, filterable:true  },
  { field:'program',    label:'Program',  type:'select', sortable:true, filterable:true, options:['WI-IRA-MF-HOMES','WI-IRA-MF-HEAR','WI-IRA-SF-HOMES','CO - Denver','WI - FOE','MI-IRA-MF-HOMES'] },
  { field:'status',     label:'Status',   type:'select', sortable:true, filterable:true, options:['Project To Be Scheduled','Project Scheduled','Project In Progress','Project To Be Verified','Project Verified','Project Complete'] },
  { field:'owner',      label:'Owner',    type:'select', sortable:true, filterable:true, options:['Marcus Reid','Priya Nair','Lisa Tanaka'] },
  { field:'workOrders', label:'WOs',      type:'text',   sortable:true, filterable:false },
  { field:'startDate',  label:'Start',    type:'date',   sortable:true, filterable:true  },
  { field:'endDate',    label:'End',      type:'date',   sortable:true, filterable:true  },
  { field:'state',      label:'State',    type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

const WO_COLS = [
  { field:'id',           label:'Record #',  type:'text',   sortable:true, filterable:false },
  { field:'name',         label:'Work Order',type:'text',   sortable:true, filterable:true  },
  { field:'property',     label:'Property',  type:'text',   sortable:true, filterable:true  },
  { field:'building',     label:'Building',  type:'text',   sortable:true, filterable:true  },
  { field:'workType',     label:'Work Type', type:'select', sortable:true, filterable:true, options:['HP - Air to Air Install','Air Sealing - Multifamily','Insulation - Attic','Boiler Replacement','PTAC Install','Blower Door Diagnostic','Shop Kit - Equipment','Travel - Drive to Site','ASHRAE Level 2'] },
  { field:'status',       label:'Status',    type:'select', sortable:true, filterable:true, options:['Work Order To Be Scheduled','Work Order Scheduled','Work Order In Progress','Work Order Submitted','Work Order To Be Verified','Work Order Corrections Needed','Work Order Verified','Work Order Complete'] },
  { field:'teamLead',     label:'Team Lead', type:'select', sortable:true, filterable:true, options:['J. Martinez','K. Chen','A. Williams','D. Okonkwo','P. Nair'] },
  { field:'scheduledDate',label:'Scheduled', type:'date',   sortable:true, filterable:true  },
  { field:'duration',     label:'Est.',      type:'text',   sortable:false,filterable:false },
  { field:'state',        label:'State',     type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

const PROJ_VIEWS = [
  { id:'PJV-01', name:'All Projects',      filters:[], sortField:'startDate', sortDir:'asc' },
  { id:'PJV-02', name:'To Be Scheduled',   filters:[{ field:'status', label:'Status', op:'equals', value:'Project To Be Scheduled' }], sortField:'id', sortDir:'asc' },
  { id:'PJV-03', name:'In Progress',       filters:[{ field:'status', label:'Status', op:'equals', value:'Project In Progress' }],      sortField:'startDate', sortDir:'asc' },
]
const WO_VIEWS = [
  { id:'WOV-01', name:'All Work Orders',   filters:[], sortField:'scheduledDate', sortDir:'asc' },
  { id:'WOV-02', name:'To Be Verified',    filters:[{ field:'status', label:'Status', op:'equals', value:'Work Order To Be Verified' }],    sortField:'scheduledDate', sortDir:'asc' },
  { id:'WOV-03', name:'Corrections Needed',filters:[{ field:'status', label:'Status', op:'equals', value:'Work Order Corrections Needed' }], sortField:'scheduledDate', sortDir:'asc' },
  { id:'WOV-04', name:'In Progress Today', filters:[{ field:'status', label:'Status', op:'equals', value:'Work Order In Progress' }],         sortField:'scheduledDate', sortDir:'asc' },
]

// Schedule constants
const DAY_START=6, DAY_END=18, TOTAL=DAY_END-DAY_START
const pct = h => ((h-DAY_START)/TOTAL)*100
const fH = h => { const hr=Math.floor(h),mn=Math.round((h-hr)*60),ap=hr<12?'AM':'PM',h12=hr===0?12:hr>12?hr-12:hr; return mn===0?`${h12} ${ap}`:`${h12}:${String(mn).padStart(2,'0')} ${ap}` }

function ScheduleView() {
  const [selJob, setSelJob] = useState(null)
  const hrs = Array.from({ length: TOTAL+1 }, (_, i) => DAY_START+i)
  const nowH = 10.5

  return (
    <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button style={{ width:30, height:30, background:C.card, border:`1px solid ${C.border}`, borderRadius:6, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon path="M15 19l-7-7 7-7" size={13} color={C.textSecondary}/></button>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:C.textPrimary }}>Sunday, April 12, 2026</div>
            <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>2 active crews · 5 work orders scheduled</div>
          </div>
          <button style={{ width:30, height:30, background:C.card, border:`1px solid ${C.border}`, borderRadius:6, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><Icon path="M9 5l7 7-7 7" size={13} color={C.textSecondary}/></button>
          <button style={{ background:'#e8f8f2', border:`1px solid #b8e8d0`, borderRadius:6, padding:'5px 12px', fontSize:12, fontWeight:600, color:'#1a7a4e', cursor:'pointer' }}>Today</button>
        </div>
        <button style={{ background:C.emerald, color:'#fff', border:'none', borderRadius:6, padding:'7px 14px', fontSize:12.5, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
          <Icon path="M12 5v14M5 12h14" size={12} color="#fff"/>Schedule Work Order
        </button>
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden' }}>
        {/* Header row with time ticks */}
        <div style={{ display:'flex', borderBottom:`1px solid ${C.border}` }}>
          <div style={{ width:200, flexShrink:0, padding:'8px 14px', borderRight:`1px solid ${C.border}` }}>
            <span style={{ fontSize:11, color:C.textMuted, fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em' }}>Crew</span>
          </div>
          <div style={{ flex:1, position:'relative', height:36 }}>
            {hrs.map(h => (
              <div key={h} style={{ position:'absolute', left:`${pct(h)}%`, top:0, bottom:0, display:'flex', flexDirection:'column', justifyContent:'flex-end', paddingBottom:6 }}>
                <span style={{ fontSize:10, color:C.textMuted, transform:'translateX(-50%)', whiteSpace:'nowrap' }}>{fH(h)}</span>
              </div>
            ))}
            <div style={{ position:'absolute', left:`${pct(nowH)}%`, top:0, bottom:0, display:'flex', flexDirection:'column', justifyContent:'flex-start', paddingTop:4 }}>
              <span style={{ fontSize:9, color:C.danger, fontWeight:700, transform:'translateX(-50%)', whiteSpace:'nowrap' }}>NOW</span>
            </div>
          </div>
        </div>

        {/* Crew rows */}
        {SCHEDULE_CREWS.map((crew, ci) => (
          <div key={crew.id} style={{ display:'flex', borderBottom:ci < SCHEDULE_CREWS.length-1 ? `1px solid ${C.border}` : 'none', minHeight:72 }}>
            <div style={{ width:200, flexShrink:0, padding:'12px 14px', borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', justifyContent:'center' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <div style={{ width:28, height:28, borderRadius:'50%', background:crew.color+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:crew.color, flexShrink:0 }}>{crew.initials}</div>
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:C.textPrimary }}>{crew.name}</div>
                  <div style={{ fontSize:10, color:C.textMuted }}>{crew.vehicle}</div>
                </div>
              </div>
              <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                {crew.members.map(m => <span key={m} style={{ fontSize:9, background:C.page, color:C.textMuted, padding:'1px 5px', borderRadius:3 }}>{m.split(' ')[0]}</span>)}
              </div>
            </div>
            <div style={{ flex:1, position:'relative', minHeight:72 }}>
              {hrs.map(h => <div key={h} style={{ position:'absolute', left:`${pct(h)}%`, top:0, bottom:0, borderLeft:`1px solid ${C.border}`, opacity:0.5 }} />)}
              <div style={{ position:'absolute', left:`${pct(nowH)}%`, top:0, bottom:0, borderLeft:`2px solid ${C.danger}`, zIndex:10, opacity:0.7 }} />
              {crew.jobs.length === 0 && (
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <span style={{ fontSize:12, color:C.textMuted }}>No work orders today — available</span>
                </div>
              )}
              {crew.jobs.map((job, ji) => {
                const isSel = selJob?.uid === `${crew.id}-${ji}`
                return (
                  <div key={ji} onClick={() => setSelJob(isSel ? null : { ...job, uid:`${crew.id}-${ji}`, crewName:crew.name })}
                    style={{ position:'absolute', left:`${pct(job.start)}%`, width:`${(job.duration/TOTAL)*100}%`, top:10, bottom:10, background:job.color, borderRadius:6, cursor:'pointer', border:isSel?`2px solid ${C.textPrimary}`:`1px solid ${job.color}`, transition:'all 0.15s', overflow:'hidden', zIndex:isSel?20:5 }}>
                    <div style={{ padding:'5px 8px' }}>
                      <div style={{ fontSize:10, fontWeight:600, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{job.name}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {selJob && (
        <div style={{ marginTop:16, background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 18px' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:10 }}>
            <div>
              <div style={{ fontSize:14, fontWeight:600, color:C.textPrimary, marginBottom:4 }}>{selJob.name}</div>
              <div style={{ fontSize:12, color:C.textMuted }}>{selJob.crewName} · {selJob.property}</div>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <Badge s={selJob.status} />
              <button onClick={() => setSelJob(null)} style={{ background:'none', border:'none', cursor:'pointer', color:C.textMuted }}><Icon path="M18 6 6 18M6 6l12 12" size={14} /></button>
            </div>
          </div>
          <div style={{ display:'flex', gap:20, marginBottom:12 }}>
            {[['Work Type',selJob.workType],['Start',fH(selJob.start)],['End',fH(selJob.start+selJob.duration)],['Duration',selJob.duration+'h']].map(([l,v]) => (
              <div key={l}><div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:2 }}>{l}</div><div style={{ fontSize:13, color:C.textPrimary }}>{v}</div></div>
            ))}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={{ background:C.emerald, color:'#fff', border:'none', borderRadius:6, padding:'6px 14px', fontSize:12.5, fontWeight:500, cursor:'pointer' }}>Open Work Order</button>
            <button style={{ background:C.page, color:C.textSecondary, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 14px', fontSize:12.5, cursor:'pointer' }}>Reassign</button>
            <button style={{ background:C.page, color:C.textSecondary, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 14px', fontSize:12.5, cursor:'pointer' }}>Reschedule</button>
          </div>
        </div>
      )}
    </div>
  )
}

function FieldHome({ setSec, projects, workOrders, paymentRequests }) {
  const toVerify    = workOrders.filter(w => w.status === 'Work Order To Be Verified')
  const corrections = workOrders.filter(w => w.status === 'Work Order Corrections Needed')
  const toSchedProj = projects.filter(p => p.status === 'Project To Be Scheduled')
  const inProgress  = workOrders.filter(w => w.status === 'Work Order In Progress')

  const woByStatus = [
    { name:'In Progress',    value: inProgress.length },
    { name:'Scheduled',      value: workOrders.filter(w=>w.status==='Work Order Scheduled').length },
    { name:'To Be Verified', value: toVerify.length },
    { name:'Corrections',    value: corrections.length },
    { name:'Complete',       value: workOrders.filter(w=>w.status==='Work Order Complete' || w.status==='Work Order Verified').length },
    { name:'Unscheduled',    value: workOrders.filter(w=>w.status==='Work Order To Be Scheduled').length },
  ]

  return (
    <div style={{ flex:1, overflow:'auto', display:'flex' }}>
      <div style={{ flex:1, overflow:'auto', padding:'20px 20px 24px' }}>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, color:C.textMuted, marginBottom:2 }}>Field / Home</div>
          <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>Project Coordinator Dashboard</h1>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>Nicholas Wood · Sunday, April 12, 2026</div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:16 }}>
          {[
            { label:'Work Orders to Verify',  value:toVerify.length,    color:C.amber,  action:() => setSec('workorders') },
            { label:'Corrections Needed',      value:corrections.length, color:C.danger, urgent:corrections.length>0, action:() => setSec('workorders') },
            { label:'Projects to Schedule',    value:toSchedProj.length, color:C.sky,    action:() => setSec('projects')   },
            { label:'Work Orders In Progress', value:inProgress.length,  color:C.emerald,action:() => setSec('workorders') },
          ].map(s => (
            <div key={s.label} onClick={s.action}
              style={{ background:C.card, border:`2px solid ${s.urgent?C.danger:C.border}`, borderTop:`3px solid ${s.color}`, borderRadius:8, padding:'14px 16px', cursor:'pointer' }}
              onMouseEnter={e => e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.08)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
              <div style={{ fontSize:11, color:C.textMuted, fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:8 }}>{s.label}</div>
              <div style={{ fontSize:26, fontWeight:700, color:s.urgent?C.danger:s.color, fontFamily:'JetBrains Mono, monospace' }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14, marginBottom:14 }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
            <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}><div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Work Orders by Status</div></div>
            <div style={{ padding:'12px 14px', display:'flex', gap:10, alignItems:'center' }}>
              <ResponsiveContainer width={80} height={80}>
                <PieChart><Pie data={woByStatus} cx="50%" cy="50%" innerRadius={18} outerRadius={36} dataKey="value" strokeWidth={0}>{woByStatus.map((_,i) => <Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}</Pie></PieChart>
              </ResponsiveContainer>
              <div style={{ flex:1 }}>
                {woByStatus.map((d,i) => (
                  <div key={d.name} style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:7, height:7, borderRadius:2, background:CHART_COLORS[i%CHART_COLORS.length], flexShrink:0 }}/><span style={{ fontSize:10, color:C.textSecondary }}>{d.name}</span></div>
                    <span style={{ fontSize:11, fontWeight:600, color:C.textPrimary, fontFamily:'JetBrains Mono, monospace' }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding:'8px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={() => setSec('workorders')} style={{ color:'#1a5a8a', fontSize:11, cursor:'pointer', fontWeight:500 }}>View Work Orders →</span></div>
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
            <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}><div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Crews — Today</div><div style={{ fontSize:11, color:C.textMuted, marginTop:1 }}>April 12, 2026</div></div>
            {SCHEDULE_CREWS.map((crew,i) => (
              <div key={crew.id} style={{ padding:'10px 14px', borderBottom:i<SCHEDULE_CREWS.length-1?`1px solid ${C.border}`:'none' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <div style={{ width:22, height:22, borderRadius:'50%', background:crew.color+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:crew.color, flexShrink:0 }}>{crew.initials}</div>
                  <span style={{ fontSize:12, fontWeight:600, color:C.textPrimary }}>{crew.name}</span>
                  {crew.jobs.length===0 && <span style={{ fontSize:10, color:C.textMuted }}>— available</span>}
                </div>
                {crew.jobs.filter(j=>!j.workType.includes('Travel')).map(j => (
                  <div key={j.name} style={{ display:'flex', alignItems:'center', gap:6, marginLeft:30, marginBottom:2 }}>
                    <span style={{ width:6, height:6, borderRadius:2, background:j.color, flexShrink:0 }}/>
                    <span style={{ fontSize:10, color:C.textSecondary, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{j.name}</span>
                    <span style={{ fontSize:10, color:C.textMuted, flexShrink:0 }}>{fH(j.start)}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ padding:'8px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={() => setSec('schedule')} style={{ color:'#1a5a8a', fontSize:11, cursor:'pointer', fontWeight:500 }}>Open Schedule →</span></div>
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
            <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}><div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Projects to Schedule</div></div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead><tr style={{ borderBottom:`1px solid ${C.border}` }}>{['Project','WOs','Action'].map(h => <th key={h} style={{ padding:'8px 12px', textAlign:'left', color:C.textMuted, fontWeight:500, fontSize:11 }}>{h}</th>)}</tr></thead>
              <tbody>
                {toSchedProj.slice(0,4).map(p => (
                  <TableRow key={p.id}>
                    <td style={{ padding:'9px 12px', borderBottom:`1px solid ${C.border}`, color:C.textPrimary, fontWeight:500, maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</td>
                    <td style={{ padding:'9px 12px', borderBottom:`1px solid ${C.border}`, color:C.textSecondary }}>{p.workOrders}</td>
                    <td style={{ padding:'9px 12px', borderBottom:`1px solid ${C.border}` }}><button style={{ background:'#fef3e2', color:'#8a5a0a', border:`1px solid #f0d8a0`, borderRadius:4, padding:'2px 7px', fontSize:10, fontWeight:600, cursor:'pointer' }}>Schedule</button></td>
                  </TableRow>
                ))}
              </tbody>
            </table>
            <div style={{ padding:'8px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={() => setSec('projects')} style={{ color:'#1a5a8a', fontSize:11, cursor:'pointer', fontWeight:500 }}>View All Projects →</span></div>
          </div>
        </div>
      </div>

      {/* Right sidebar */}
      <div style={{ width:280, flexShrink:0, background:C.page, borderLeft:`1px solid ${C.border}`, padding:'20px 14px', overflowY:'auto' }}>
        {[
          { title:'Work Orders to Verify',  items:toVerify,    color:'#1a5a8a' },
          { title:'Corrections Needed',      items:corrections, color:C.danger  },
        ].map(sec2 => (
          <div key={sec2.title} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden', marginBottom:12 }}>
            <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontWeight:600, fontSize:13, color:C.textPrimary }}>{sec2.title}</span>
              <span style={{ background:sec2.items.length>0?C.danger:'#e8f8f2', color:sec2.items.length>0?'#fff':'#1a7a4e', fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:10 }}>{sec2.items.length}</span>
            </div>
            {sec2.items.length===0 ? <div style={{ padding:'16px 14px', textAlign:'center', color:C.textMuted, fontSize:12 }}>All clear.</div>
            : sec2.items.slice(0,4).map((w,i) => (
              <div key={w.id} style={{ padding:'10px 14px', borderBottom:i<Math.min(sec2.items.length,4)-1?`1px solid ${C.border}`:'none', cursor:'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background='#f7f9fc'} onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <div style={{ color:sec2.color, fontSize:12, fontWeight:500, marginBottom:2 }}>{w.id}</div>
                <div style={{ color:C.textMuted, fontSize:11 }}>{w.property} · {w.teamLead||'Unassigned'}</div>
              </div>
            ))}
            <div style={{ padding:'9px 14px', borderTop:`1px solid ${C.border}` }}><span onClick={() => setSec('workorders')} style={{ color:'#1a5a8a', fontSize:12, cursor:'pointer', fontWeight:500 }}>View All</span></div>
          </div>
        ))}

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}><span style={{ fontWeight:600, fontSize:13, color:C.textPrimary }}>Project Payment Requests</span></div>
          {paymentRequests.filter(r=>r.daysOpen>14).slice(0,5).map((pr,i) => (
            <div key={pr.id} style={{ padding:'9px 14px', borderBottom:i<4?`1px solid ${C.border}`:'none', cursor:'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background='#f7f9fc'} onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              <div style={{ color:pr.daysOpen>30?C.danger:'#1a5a8a', fontSize:11, fontWeight:600, marginBottom:2 }}>${Number(pr.amount).toLocaleString()} · {pr.daysOpen}d open</div>
              <div style={{ color:C.textMuted, fontSize:10 }}>{pr.property}</div>
              <div style={{ marginTop:3 }}><Badge s={pr.status} /></div>
            </div>
          ))}
          <div style={{ padding:'9px 14px', borderTop:`1px solid ${C.border}` }}><span style={{ color:'#1a5a8a', fontSize:12, cursor:'pointer', fontWeight:500 }}>View All</span></div>
        </div>
      </div>
    </div>
  )
}

function projRelatedList(row, paymentRequests) {
  const prs = paymentRequests.filter(r => r.name === row.name)
  if (prs.length === 0) return null
  return (
    <div style={{ marginTop:16 }}>
      <div style={{ fontSize:11, fontWeight:700, color:C.textSecondary, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:8 }}>Project Payment Requests</div>
      {prs.map(pr => (
        <div key={pr.id} style={{ background:C.page, borderRadius:6, padding:'9px 10px', marginBottom:6, border:`1px solid ${C.border}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
            <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:10, color:C.textMuted }}>{pr.id}</span>
            <span style={{ color:pr.daysOpen>30?C.danger:C.textMuted, fontSize:10, fontWeight:pr.daysOpen>30?700:400 }}>{pr.daysOpen}d open</span>
          </div>
          <div style={{ fontSize:11, fontWeight:500, color:C.textPrimary, marginBottom:5 }}>${Number(pr.amount).toLocaleString()}</div>
          <Badge s={pr.status} />
        </div>
      ))}
    </div>
  )
}

function LiveListView({ loading, error, data, ...rest }) {
  if (loading) return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:C.textMuted, fontSize:13 }}>Loading…</div>
  if (error) return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8, padding:24 }}><div style={{ color:'#b03a2e', fontSize:13, fontWeight:600 }}>Could not load records</div><div style={{ color:C.textMuted, fontSize:12, fontFamily:'JetBrains Mono, monospace', maxWidth:560, textAlign:'center' }}>{String(error.message || error)}</div></div>
  return <ListView data={data} {...rest} />
}

export default function FieldModule() {
  const [sec, setSec] = useState('home')
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [projects, setProjects] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [paymentRequests, setPaymentRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const SEC_TABLE = { projects: 'projects', workorders: 'work_orders' }
  const openRecord = (row) => { if (row?._id && SEC_TABLE[sec]) setSelectedRecord({ table: SEC_TABLE[sec], id: row._id, name: row.name }) }
  const closeRecord = () => setSelectedRecord(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchProjects(), fetchWorkOrders(), fetchPaymentRequests()])
      .then(([p, w, pr]) => { if (!cancelled) { setProjects(p); setWorkOrders(w); setPaymentRequests(pr) } })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const urgentCount = workOrders.filter(w => w.status==='Work Order To Be Verified'||w.status==='Work Order Corrections Needed').length
  const counts = { projects: projects.length, workorders: workOrders.length }
  const urgentSections = { home: urgentCount }

  // Project row detail renderer — shows all project fields plus any
  // related payment requests in a side panel
  const renderProjectDetail = row => {
    const prs = paymentRequests.filter(r => r.name === row.name)
    return (
      <div>
        <div>
          {PROJ_COLS.filter(c => !['id','name','status'].includes(c.field)).map(col => (
            <div key={col.field} style={{ display:'flex', justifyContent:'space-between', padding:'9px 0', borderBottom:`1px solid ${C.border}`, gap:12 }}>
              <span style={{ color:C.textMuted, fontSize:12, flexShrink:0 }}>{col.label}</span>
              <span style={{ color:C.textPrimary, fontSize:12, textAlign:'right' }}>{row[col.field] || '—'}</span>
            </div>
          ))}
        </div>
        {prs.length > 0 && (
          <div style={{ marginTop:16 }}>
            <div style={{ fontSize:11, fontWeight:700, color:C.textSecondary, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:8 }}>Project Payment Requests</div>
            {prs.map(pr => (
              <div key={pr.id} style={{ background:C.page, borderRadius:6, padding:'9px 10px', marginBottom:6, border:`1px solid ${C.border}` }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:10, color:C.textMuted }}>{pr.id}</span>
                  <span style={{ color:pr.daysOpen>30?C.danger:C.textMuted, fontSize:10, fontWeight:pr.daysOpen>30?700:400 }}>{pr.daysOpen}d open</span>
                </div>
                <div style={{ fontSize:11, fontWeight:500, color:C.textPrimary, marginBottom:5 }}>${Number(pr.amount).toLocaleString()}</div>
                <Badge s={pr.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ height:54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Field</span><span style={{ color:C.textMuted }}>/</span>
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
        {sec==='home'       && <FieldHome setSec={setSec} projects={projects} workOrders={workOrders} paymentRequests={paymentRequests} />}
        {sec==='projects'   && <LiveListView loading={loading} error={error} data={projects}   columns={PROJ_COLS} systemViews={PROJ_VIEWS} defaultViewId="PJV-01" newLabel="Project"    onNew={() => {}} onOpenRecord={openRecord} renderDetail={renderProjectDetail} />}
        {sec==='workorders' && <LiveListView loading={loading} error={error} data={workOrders} columns={WO_COLS}   systemViews={WO_VIEWS}   defaultViewId="WOV-01" newLabel="Work Order" onNew={() => {}} onOpenRecord={openRecord} />}
        {sec==='schedule'   && <ScheduleView />}
        </>)}
      </div>
    </div>
  )
}
