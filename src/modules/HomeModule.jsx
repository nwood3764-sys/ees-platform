import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { C, CHART_COLORS, fmt } from '../data/constants'
import { Badge, Icon, TableRow } from '../components/UI'
import { fetchProperties, fetchOpportunities } from '../data/outreachService'
import { fetchProjects, fetchWorkOrders } from '../data/fieldService'
import { fetchPaymentRequests, fetchPaymentReceipts } from '../data/incentivesService'
import { fetchIncentiveApplications } from '../data/qualificationService'

function Widget({ title, subtitle, children, footer, onFooter }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>{subtitle}</div>}
      </div>
      <div style={{ flex: 1, padding: '12px 14px 8px' }}>{children}</div>
      <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span onClick={onFooter} style={{ color: '#1a5a8a', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>{footer || 'View Report →'}</span>
        <span style={{ color: C.textMuted, fontSize: 10 }}>Live</span>
      </div>
    </div>
  )
}

function SideSection({ title, badge, children, onViewAll }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: C.textPrimary }}>{title}</span>
        {badge != null && <span style={{ background: badge > 0 ? C.danger : '#e8f8f2', color: badge > 0 ? '#fff' : '#1a7a4e', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>{badge}</span>}
      </div>
      <div>{children}</div>
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}` }}>
        <span onClick={onViewAll} style={{ color: '#1a5a8a', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>View All</span>
      </div>
    </div>
  )
}

// Group an array by a key into Recharts-shaped [{name, value}]
const groupCount = (arr, key) => {
  const m = new Map()
  for (const r of arr) m.set(r[key] || '—', (m.get(r[key] || '—') || 0) + 1)
  return Array.from(m, ([name, value]) => ({ name, value }))
}

export default function HomeModule({ onNavigate }) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const [properties, setProperties] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [projects, setProjects] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [paymentRequests, setPaymentRequests] = useState([])
  const [paymentReceipts, setPaymentReceipts] = useState([])
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      fetchProperties(),
      fetchOpportunities(),
      fetchProjects(),
      fetchWorkOrders(),
      fetchPaymentRequests(),
      fetchPaymentReceipts(),
      fetchIncentiveApplications(),
    ])
      .then(([p, o, pr, w, pq, rc, ia]) => {
        if (cancelled) return
        setProperties(p)
        setOpportunities(o)
        setProjects(pr)
        setWorkOrders(w)
        setPaymentRequests(pq)
        setPaymentReceipts(rc)
        setApplications(ia)
      })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // KPI calculations
  const pipeline = opportunities.reduce((s, r) => s + (r._amountRaw || 0), 0)
  const enrolled = properties.filter(p => p.status === 'Enrolled')
  const enrolledUnits = enrolled.reduce((s, p) => s + (Number(p.units) || 0), 0)
  const toVerify = workOrders.filter(w => w.status === 'Work Order To Be Verified').length
  const inProgress = workOrders.filter(w => w.status === 'Work Order In Progress').length

  // Work orders by status
  const woByStatus = [
    { name: 'In Progress',        value: workOrders.filter(w=>w.status==='Work Order In Progress').length },
    { name: 'Scheduled',          value: workOrders.filter(w=>w.status==='Work Order Scheduled').length },
    { name: 'To Be Verified',     value: toVerify },
    { name: 'Corrections Needed', value: workOrders.filter(w=>w.status==='Work Order Corrections Needed').length },
    { name: 'Verified',           value: workOrders.filter(w=>w.status==='Work Order Verified').length },
    { name: 'To Be Scheduled',    value: workOrders.filter(w=>w.status==='Work Order To Be Scheduled').length },
  ]
  const woTotal = woByStatus.reduce((s, r) => s + r.value, 0)

  // Pipeline by program ($K) — computed from payment requests
  const progMap = new Map()
  for (const r of paymentRequests) {
    const k = r.program || '—'
    progMap.set(k, (progMap.get(k) || 0) + (r.amount || 0))
  }
  const pipelineByProgram = Array.from(progMap, ([name, v]) => ({ name, value: Math.round(v / 1000) }))
    .sort((a, b) => b.value - a.value)

  // Payments received — rolling 6 months ($K)
  const monthKeys = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthKeys.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: d.toLocaleString('en-US', { month: 'short' }) })
  }
  const monthMap = new Map(monthKeys.map(m => [m.key, 0]))
  for (const r of paymentReceipts) {
    if (!r.receivedDate) continue
    const k = r.receivedDate.slice(0, 7)
    if (monthMap.has(k)) monthMap.set(k, monthMap.get(k) + (r.amount || 0))
  }
  const receivedByMonth = monthKeys.map(m => ({ month: m.label, value: Math.round((monthMap.get(m.key) || 0) / 1000) }))

  // Properties by status
  const propByStatus = groupCount(properties, 'status')

  // Opportunities by stage (trimmed labels)
  const oppByStage = groupCount(opportunities, 'stage').map(d => ({
    ...d,
    name: d.name.replace(/^Opportunity\s*[—-]?\s*/, '').slice(0, 22),
  }))

  // Units enrolled by state (only enrolled properties)
  const stateUnitsMap = new Map()
  for (const p of enrolled) {
    stateUnitsMap.set(p.state || '—', (stateUnitsMap.get(p.state || '—') || 0) + (Number(p.units) || 0))
  }
  const unitsByState = Array.from(stateUnitsMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

  // Items to approve — aggregated across objects
  const approvalItems = [
    ...workOrders.filter(w => w.status === 'Work Order To Be Verified').map(w => ({
      id: w.id, type: 'Work Order', name: `${w.id} — ${w.name}`, sub: `${w.property} · ${w.teamLead}`, urgent: true,
    })),
    ...workOrders.filter(w => w.status === 'Work Order Corrections Needed').map(w => ({
      id: w.id, type: 'Work Order', name: `${w.id} — ${w.name}`, sub: `${w.property} · Corrections needed`, urgent: true,
    })),
    ...applications.filter(a => a.status === 'Incentive Application Corrections Needed').map(a => ({
      id: a.id, type: 'Application', name: `${a.id} — ${a.name}`, sub: a.program, urgent: false,
    })),
    ...paymentRequests.filter(r => r.status === 'Payment Request Under Review' || r.status === 'Payment Request Submitted — Awaiting Review').map(r => ({
      id: r.id, type: 'Pmt Request', name: `${r.id} — ${r.name}`, sub: r.property, urgent: false,
    })),
  ].slice(0, 6)

  // Recent records — mix of top records across object types
  const recentRecords = [
    ...properties.slice(0, 2).map(p => ({
      id: p.id, type: 'Property', name: p.name, sub: `${p.address} · ${p.units} units`,
      time: 'Recent', icon: 'P', bg: '#e8f3fb', fg: '#1a5a8a',
    })),
    ...opportunities.slice(0, 2).map(o => ({
      id: o.id, type: 'Opportunity', name: o.name, sub: `${o.program} · ${o.amount}`,
      time: 'Recent', icon: 'O', bg: '#fef3e2', fg: '#8a5a0a',
    })),
    ...workOrders.slice(0, 2).map(w => ({
      id: w.id, type: 'Work Order', name: w.name, sub: `${w.property} · ${w.building}`,
      time: 'Recent', icon: 'W', bg: '#e8f8f2', fg: '#1a7a4e',
    })),
  ]

  if (loading) {
    return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:C.textMuted, fontSize:13 }}>Loading dashboard…</div>
  }
  if (error) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8, padding:24 }}>
        <div style={{ color:'#b03a2e', fontSize:13, fontWeight:600 }}>Could not load dashboard</div>
        <div style={{ color:C.textMuted, fontSize:12, fontFamily:'JetBrains Mono, monospace', maxWidth:560, textAlign:'center' }}>{String(error.message || error)}</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Topbar */}
      <div style={{ height: 54, background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: C.textMuted }}>Home</span>
          <span style={{ color: C.textMuted }}>/</span>
          <span style={{ color: C.textPrimary, fontWeight: 500 }}>Dashboard</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 14px', fontSize: 12.5, color: C.textSecondary, cursor: 'pointer', fontWeight: 500 }}>Refresh</button>
          <button style={{ background: C.emerald, border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12.5, color: '#fff', cursor: 'pointer', fontWeight: 500 }}>+ Add Widget</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Main */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 20px 24px' }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 2 }}>Dashboard</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary, margin: 0 }}>Program Operations Overview</h1>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{greeting}, Nicholas Wood · Admin · {today}</div>
          </div>

          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Active Pipeline',        value: fmt(pipeline),   sub: `${opportunities.length} opportunities`, color: C.emerald, action: () => onNavigate('outreach') },
              { label: 'Properties Enrolled',    value: enrolled.length, sub: `${enrolledUnits} enrolled units`,       color: C.sky,     action: () => onNavigate('outreach') },
              { label: 'Work Orders to Verify',  value: toVerify,        sub: 'Awaiting verification',                 color: C.amber,   action: () => onNavigate('field')    },
              { label: 'Work Orders In Progress',value: inProgress,      sub: 'Active today',                          color: C.purple,  action: () => onNavigate('field')    },
            ].map(s => (
              <div key={s.label} onClick={s.action}
                style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`, borderRadius: 8, padding: '16px 18px', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>{s.value}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Chart widgets row 1 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Widget title="Work Orders by Status" subtitle={`Total: ${woTotal}`} footer="View Work Orders →" onFooter={() => onNavigate('field')}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <ResponsiveContainer width={100} height={100}>
                  <PieChart><Pie data={woByStatus} cx="50%" cy="50%" innerRadius={24} outerRadius={46} dataKey="value" strokeWidth={0}>{woByStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie></PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1 }}>
                  {woByStatus.map((d, i) => (
                    <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                        <span style={{ fontSize: 10, color: C.textSecondary }}>{d.name}</span>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Widget>

            <Widget title="Pipeline by Program ($K)" footer="View Incentives →" onFooter={() => onNavigate('incentives')}>
              <ResponsiveContainer width="100%" height={138}>
                <BarChart data={pipelineByProgram} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: C.textMuted }} tickLine={false} axisLine={false} width={110} />
                  <Tooltip formatter={v => [`$${v}K`, 'Pipeline']} contentStyle={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 5 }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={C.emerald} />
                </BarChart>
              </ResponsiveContainer>
            </Widget>

            <Widget title="Payments Received ($K)" subtitle="Rolling 6 months" footer="View Incentives →" onFooter={() => onNavigate('incentives')}>
              <ResponsiveContainer width="100%" height={138}>
                <LineChart data={receivedByMonth} margin={{ left: 0, right: 14, top: 8, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: C.textSecondary }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={v => [`$${v}K`, 'Received']} contentStyle={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 5 }} />
                  <Line type="monotone" dataKey="value" stroke={C.emerald} strokeWidth={2} dot={{ fill: C.emerald, r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Widget>
          </div>

          {/* Chart widgets row 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            <Widget title="Properties by Status" footer="View Outreach →" onFooter={() => onNavigate('outreach')}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <ResponsiveContainer width={90} height={90}>
                  <PieChart>
                    <Pie data={propByStatus} cx="50%" cy="50%" innerRadius={20} outerRadius={40} dataKey="value" strokeWidth={0}>
                      {propByStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1 }}>
                  {propByStatus.map((d, i) => (
                    <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: C.textSecondary }}>{d.name}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Widget>

            <Widget title="Opportunities by Stage" footer="View Outreach →" onFooter={() => onNavigate('outreach')}>
              <ResponsiveContainer width="100%" height={138}>
                <BarChart data={oppByStage} layout="vertical" margin={{ left: 0, right: 14, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: C.textMuted }} tickLine={false} axisLine={false} width={120} />
                  <Tooltip contentStyle={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 5 }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={C.amber} />
                </BarChart>
              </ResponsiveContainer>
            </Widget>

            <Widget title="Units Enrolled by State" footer="View Report →">
              <ResponsiveContainer width="100%" height={138}>
                <BarChart data={unitsByState} margin={{ left: 0, right: 10, top: 8, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.textSecondary }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 5 }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={C.purple} />
                </BarChart>
              </ResponsiveContainer>
            </Widget>
          </div>
        </div>

        {/* Right utility sidebar */}
        <div style={{ width: 292, flexShrink: 0, background: C.page, borderLeft: `1px solid ${C.border}`, padding: '20px 14px', overflowY: 'auto' }}>
          <SideSection title="Items to Approve" badge={approvalItems.length} onViewAll={() => {}}>
            {approvalItems.length === 0
              ? <div style={{ padding: '20px 14px', textAlign: 'center' }}><div style={{ color: C.textMuted, fontSize: 12 }}>No items waiting on approval.</div></div>
              : approvalItems.map((a, i) => (
                <div key={`${a.type}-${a.id}`} style={{ padding: '10px 14px', borderBottom: i < approvalItems.length - 1 ? `1px solid ${C.border}` : 'none', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f7f9fc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ color: '#1a5a8a', fontSize: 12, fontWeight: 500, marginBottom: 2 }}>{a.name}</div>
                  <div style={{ color: C.textMuted, fontSize: 11 }}>{a.type} · {a.sub}</div>
                </div>
              ))}
          </SideSection>

          <SideSection title="Today's Tasks" badge={0} onViewAll={() => {}}>
            <div style={{ padding: '20px 14px', textAlign: 'center' }}>
              <div style={{ color: C.textMuted, fontSize: 12 }}>No tasks due today. Be a go-getter.</div>
            </div>
          </SideSection>

          <SideSection title="Recent Records" onViewAll={() => {}}>
            {recentRecords.length === 0
              ? <div style={{ padding: '20px 14px', textAlign: 'center' }}><div style={{ color: C.textMuted, fontSize: 12 }}>No recent records.</div></div>
              : recentRecords.map((r, i) => (
                <div key={`${r.type}-${r.id}`} style={{ padding: '10px 14px', borderBottom: i < recentRecords.length - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f7f9fc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: r.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: r.fg, flexShrink: 0 }}>{r.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#1a5a8a', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                    <div style={{ color: C.textMuted, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</div>
                  </div>
                  <div style={{ color: C.textMuted, fontSize: 11, flexShrink: 0 }}>{r.time}</div>
                </div>
              ))}
          </SideSection>
        </div>
      </div>
    </div>
  )
}
