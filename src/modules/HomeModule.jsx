import { useState } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { C, CHART_COLORS, fmt } from '../data/constants'
import { Badge, Icon, TableRow } from '../components/UI'
import { WORK_ORDERS, PROJECTS, OPPORTUNITIES, PROPERTIES } from '../data/mockData'

const woByStatus = [
  { name: 'In Progress',        value: 3 },
  { name: 'Scheduled',          value: 3 },
  { name: 'To Be Verified',     value: 2 },
  { name: 'Corrections Needed', value: 1 },
  { name: 'Complete',           value: 2 },
  { name: 'To Be Scheduled',    value: 3 },
]

const pipelineByProgram = [
  { name: 'WI-IRA-MF-HOMES', value: 352 },
  { name: 'CO - Denver',      value: 320 },
  { name: 'WI-IRA-SF-HOMES',  value: 175 },
  { name: 'WI-IRA-MF-HEAR',   value: 89  },
  { name: 'WI - FOE',         value: 55  },
]

const receivedByMonth = [
  { month: 'Nov', value: 0   },
  { month: 'Dec', value: 88  },
  { month: 'Jan', value: 128 },
  { month: 'Feb', value: 44  },
  { month: 'Mar', value: 0   },
  { month: 'Apr', value: 175 },
]

const approvalItems = [
  { id: 'WO-00142', type: 'Work Order',   name: 'WO-00142 — North Willow Bldg A Heat Pump Install', sub: 'Submitted by Marcus Reid',  urgent: true  },
  { id: 'WO-00138', type: 'Work Order',   name: 'WO-00138 — River Bluff Boiler Tune-Up',            sub: 'Submitted by Priya Nair',   urgent: true  },
  { id: 'IA-00023', type: 'Application',  name: 'IA-00023 — Capitol View HEAR Application',          sub: 'Submitted by Priya Nair',   urgent: false },
  { id: 'PR-00003', type: 'Pmt Request',  name: 'PR-00003 — River Bluff HOMES Payment Request',     sub: 'Submitted by Marcus Reid',  urgent: false },
  { id: 'WO-00155', type: 'Work Order',   name: 'WO-00155 — Aspen Court Unit 204 Air Sealing',      sub: 'Submitted by K. Chen',      urgent: false },
]

const recentRecords = [
  { id: 'PROP-00001', type: 'Property',    name: 'North Willow Apartments',         sub: 'Madison, WI · 120 units',       time: '2m ago',    icon: 'P', bg: '#e8f3fb', fg: '#1a5a8a' },
  { id: 'OPP-00003',  type: 'Opportunity', name: 'MF-HOMES-River Bluff Senior',     sub: 'WI-IRA-MF-HOMES · $210,000',   time: '18m ago',   icon: 'O', bg: '#fef3e2', fg: '#8a5a0a' },
  { id: 'WO-00142',   type: 'Work Order',  name: 'WO-00142 — HP Install Unit 102',  sub: 'North Willow Bldg A · Unit 102',time: '1hr ago',   icon: 'W', bg: '#e8f8f2', fg: '#1a7a4e' },
  { id: 'BLD-00004',  type: 'Building',    name: 'River Bluff Senior Living-Main',   sub: '60 units · 4 stories · 1965',   time: '2hr ago',   icon: 'B', bg: '#f0eeff', fg: '#6d5ae0' },
  { id: 'PROP-00007', type: 'Property',    name: 'Aspen Court Residences',           sub: 'Denver, CO · 108 units',        time: 'Yesterday', icon: 'P', bg: '#e8f3fb', fg: '#1a5a8a' },
]

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
        <span style={{ color: C.textMuted, fontSize: 10 }}>As of Apr 12, 2026</span>
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

export default function HomeModule({ onNavigate }) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const pipeline = OPPORTUNITIES.reduce((s, r) => s + (r.amount || 0), 0)
  const enrolled = PROPERTIES.filter(p => p.status === 'Enrolled').length
  const toVerify = WORK_ORDERS.filter(w => w.status === 'Work Order To Be Verified').length
  const inProgress = WORK_ORDERS.filter(w => w.status === 'Work Order In Progress').length

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
            <h1 style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary, margin: 0 }}>WI — Project Coordinator</h1>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{greeting}, Nicholas Wood · Admin · Sunday, April 12, 2026</div>
          </div>

          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Active Pipeline',       value: fmt(pipeline), sub: `${OPPORTUNITIES.length} opportunities`, color: C.emerald,  action: () => onNavigate('outreach')    },
              { label: 'Properties Enrolled',   value: enrolled,      sub: '276 enrolled units',                   color: C.sky,     action: () => onNavigate('outreach')    },
              { label: 'Work Orders to Verify', value: toVerify,      sub: 'Awaiting verification',                color: C.amber,   action: () => onNavigate('field')       },
              { label: 'Work Orders In Progress',value: inProgress,   sub: 'Active today',                         color: C.purple,  action: () => onNavigate('field')       },
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
            <Widget title="Work Orders by Status" subtitle={`Total: ${woByStatus.reduce((s, r) => s + r.value, 0)}`} footer="View Work Orders →" onFooter={() => onNavigate('field')}>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <Widget title="Properties by Status" footer="View Outreach →" onFooter={() => onNavigate('outreach')}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <ResponsiveContainer width={90} height={90}>
                  <PieChart>
                    <Pie data={[{name:'Enrolled',value:3},{name:'In Progress',value:2},{name:'Outreach Active',value:2},{name:'Prospect',value:1}]} cx="50%" cy="50%" innerRadius={20} outerRadius={40} dataKey="value" strokeWidth={0}>
                      {[0,1,2,3].map(i => <Cell key={i} fill={CHART_COLORS[i]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1 }}>
                  {[{name:'Enrolled',v:3},{name:'In Progress',v:2},{name:'Outreach Active',v:2},{name:'Prospect',v:1}].map((d, i) => (
                    <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: CHART_COLORS[i], flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: C.textSecondary }}>{d.name}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{d.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Widget>

            <Widget title="Opportunities by Stage" footer="View Outreach →" onFooter={() => onNavigate('outreach')}>
              <ResponsiveContainer width="100%" height={138}>
                <BarChart data={[{name:'Reservation Obtained',value:2},{name:'Application Submitted',value:2},{name:'Enrollment In Progress',value:1},{name:'Assessment Scheduled',value:1},{name:'Decision Maker ID\'d',value:1},{name:'Outreach Active',value:1}]} layout="vertical" margin={{ left: 0, right: 14, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: C.textMuted }} tickLine={false} axisLine={false} width={120} />
                  <Tooltip contentStyle={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 5 }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={C.amber} />
                </BarChart>
              </ResponsiveContainer>
            </Widget>

            <Widget title="Units Enrolled by State" footer="View Report →">
              <ResponsiveContainer width="100%" height={138}>
                <BarChart data={[{name:'WI',value:324},{name:'CO',value:108},{name:'NC',value:72},{name:'MI',value:55}]} margin={{ left: 0, right: 10, top: 8, bottom: 0 }}>
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
            {approvalItems.map((a, i) => (
              <div key={a.id} style={{ padding: '10px 14px', borderBottom: i < approvalItems.length - 1 ? `1px solid ${C.border}` : 'none', cursor: 'pointer' }}
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
            {recentRecords.map((r, i) => (
              <div key={r.id} style={{ padding: '10px 14px', borderBottom: i < recentRecords.length - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
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
