import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { C, CHART_COLORS, fmt } from '../data/constants'
import { Badge, Icon, TableRow, ProgramTag, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import { OPPORTUNITIES, PROPERTIES, BUILDINGS, CONTACTS, ENROLLMENTS } from '../data/mockData'
import { fetchProperties, fetchBuildings, fetchUnits, fetchOpportunities, fetchContacts, fetchEnrollments, fetchAccounts } from '../data/outreachService'

const SECTIONS = [
  { id: 'home',       label: 'Home'         },
  { id: 'opps',       label: 'Opportunities' },
  { id: 'accounts',   label: 'Accounts'      },
  { id: 'properties', label: 'Properties'    },
  { id: 'buildings',  label: 'Buildings'     },
  { id: 'units',      label: 'Units'         },
  { id: 'contacts',   label: 'Contacts'      },
  { id: 'enrollment', label: 'Enrollment'    },
]

// Column definitions
const OPP_COLS = [
  { field:'id',        label:'Record #',   type:'text',   sortable:true,  filterable:false },
  { field:'name',      label:'Opportunity',type:'text',   sortable:true,  filterable:true  },
  { field:'property',  label:'Property',   type:'text',   sortable:true,  filterable:true  },
  { field:'stage',     label:'Stage',      type:'select', sortable:true,  filterable:true,  options:['Opportunity — Property Identified','Opportunity — Outreach Active','Opportunity — Decision Maker Identified','Opportunity — Enrollment In Progress','Opportunity — Assessment Scheduled','Opportunity — Application Submitted','Opportunity — Reservation Obtained','Opportunity — Project In Progress','Opportunity Closed Won','Opportunity Closed Lost'] },
  { field:'program',   label:'Program',    type:'select', sortable:true,  filterable:true,  options:['WI-IRA-MF-HOMES','WI-IRA-MF-HEAR','WI-IRA-SF-HOMES','CO - Denver','WI - FOE','MI-IRA-MF-HOMES'] },
  { field:'owner',     label:'Owner',      type:'select', sortable:true,  filterable:true,  options:['Marcus Reid','Priya Nair','Lisa Tanaka'] },
  { field:'amount',    label:'Amount',     type:'text',   sortable:true,  filterable:false  },
  { field:'units',     label:'Units',      type:'text',   sortable:true,  filterable:false  },
  { field:'closeDate', label:'Close Date', type:'date',   sortable:true,  filterable:true   },
  { field:'state',     label:'State',      type:'select', sortable:true,  filterable:true,  options:['WI','NC','CO','MI'] },
]
const ACCOUNT_COLS = [
  { field:'id',         label:'Record #',     type:'text',   sortable:true, filterable:false },
  { field:'name',       label:'Account',      type:'text',   sortable:true, filterable:true  },
  { field:'recordType', label:'Record Type',  type:'select', sortable:true, filterable:true, options:['Property Owner','Property Management Company','Partner Organization','Customer Household','EES-WI Internal','Utility','Program Administrator','Government Agency','Distributor','Standard'] },
  { field:'type',       label:'Type',         type:'select', sortable:true, filterable:true, options:['Customer','Partner','Vendor','Internal','Prospect'] },
  { field:'status',     label:'Status',       type:'select', sortable:true, filterable:true, options:['Active','Prospect','Inactive','Archived'] },
  { field:'phone',      label:'Phone',        type:'text',   sortable:false, filterable:true },
  { field:'email',      label:'Email',        type:'text',   sortable:false, filterable:true },
  { field:'city',       label:'City',         type:'text',   sortable:true, filterable:true  },
  { field:'state',      label:'State',        type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI','IL'] },
]
const PROP_COLS = [
  { field:'id',        label:'Record #', type:'text',   sortable:true, filterable:false },
  { field:'name',      label:'Property', type:'text',   sortable:true, filterable:true  },
  { field:'owner',     label:'Owner',    type:'text',   sortable:true, filterable:true  },
  { field:'address',   label:'Address',  type:'text',   sortable:true, filterable:true  },
  { field:'units',     label:'Units',    type:'text',   sortable:true, filterable:false },
  { field:'buildings', label:'Bldgs',    type:'text',   sortable:true, filterable:false },
  { field:'status',    label:'Status',   type:'select', sortable:true, filterable:true, options:['Prospect','Outreach Active','In Progress','Enrolled'] },
  { field:'subsidy',   label:'Subsidy',  type:'select', sortable:true, filterable:true, options:['Section 8 / HUD','LIHTC','NOAH','DAC','NEST Community'] },
  { field:'state',     label:'State',    type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]
const BLDG_COLS = [
  { field:'id',        label:'Record #',   type:'text',   sortable:true, filterable:false },
  { field:'name',      label:'Building',   type:'text',   sortable:true, filterable:true  },
  { field:'property',  label:'Property',   type:'text',   sortable:true, filterable:true  },
  { field:'units',     label:'Units',      type:'text',   sortable:true, filterable:false },
  { field:'stories',   label:'Stories',    type:'text',   sortable:true, filterable:false },
  { field:'type',      label:'Type',       type:'select', sortable:true, filterable:true, options:['Apartment','Townhome','High Rise','Garden Style'] },
  { field:'status',    label:'Status',     type:'select', sortable:true, filterable:true, options:['Prospect','Outreach Active','In Progress','Enrolled'] },
  { field:'heating',   label:'Heating',    type:'select', sortable:true, filterable:true, options:['Boiler - Hydronic','Boiler - Steam','FAF - Forced Air Furnace','Heat Pump - Air to Air','PTAC'] },
  { field:'cooling',   label:'Cooling',    type:'select', sortable:true, filterable:true, options:['CA - Central Air','PTAC','None','Mini Split'] },
  { field:'yearBuilt', label:'Year Built', type:'text',   sortable:true, filterable:false },
  { field:'state',     label:'State',      type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]
const UNIT_COLS = [
  { field:'id',        label:'Record #',  type:'text',   sortable:true, filterable:false },
  { field:'unit',      label:'Unit',      type:'text',   sortable:true, filterable:true  },
  { field:'building',  label:'Building',  type:'text',   sortable:true, filterable:true  },
  { field:'property',  label:'Property',  type:'text',   sortable:true, filterable:true  },
  { field:'status',    label:'Status',    type:'select', sortable:true, filterable:true, options:['Active','Vacant','Under Renovation'] },
  { field:'bedrooms',  label:'Beds',      type:'text',   sortable:true, filterable:false },
  { field:'bathrooms', label:'Baths',     type:'text',   sortable:true, filterable:false },
  { field:'sqft',      label:'Sq Ft',     type:'text',   sortable:true, filterable:false },
  { field:'state',     label:'State',     type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]
const CONTACT_COLS = [
  { field:'id',     label:'Record #',    type:'text',   sortable:true, filterable:false },
  { field:'name',   label:'Name',        type:'text',   sortable:true, filterable:true  },
  { field:'title',  label:'Title',       type:'text',   sortable:true, filterable:true  },
  { field:'org',    label:'Organization',type:'text',   sortable:true, filterable:true  },
  { field:'role',   label:'Role',        type:'select', sortable:true, filterable:true, options:['Executive Sponsor','Property Owner','Property Manager','Finance Contact','Site Contact','Regional Decision Maker'] },
  { field:'email',  label:'Email',       type:'text',   sortable:true, filterable:true  },
  { field:'phone',  label:'Phone',       type:'text',   sortable:false,filterable:false },
  { field:'status', label:'Status',      type:'select', sortable:true, filterable:true, options:['Active','Inactive'] },
  { field:'state',  label:'State',       type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]
const ENR_COLS = [
  { field:'id',            label:'Record #',    type:'text',   sortable:true, filterable:false },
  { field:'name',          label:'Enrollment',  type:'text',   sortable:true, filterable:true  },
  { field:'property',      label:'Property',    type:'text',   sortable:true, filterable:true  },
  { field:'program',       label:'Program',     type:'select', sortable:true, filterable:true, options:['WI-IRA-MF-HOMES','WI-IRA-MF-HEAR','WI-IRA-SF-HOMES','CO - Denver','WI - FOE','MI-IRA-MF-HOMES'] },
  { field:'status',        label:'Status',      type:'select', sortable:true, filterable:true, options:['Enrollment — Outreach Active','Enrollment — HAF Agreement Pending','Enrollment — HAF Agreement Executed','Enrollment — Income Qualification In Progress','Enrollment — Census Tract Verification Pending','Enrollment — Complete','Enrollment — On Hold'] },
  { field:'owner',         label:'Owner',       type:'select', sortable:true, filterable:true, options:['Marcus Reid','Priya Nair','Lisa Tanaka'] },
  { field:'hafAgreement',  label:'HAF',         type:'select', sortable:true, filterable:true, options:['Not Started','Pending','Executed'] },
  { field:'incomeQual',    label:'Income Qual', type:'select', sortable:true, filterable:true, options:['Not Started','In Progress','In Review','Complete'] },
  { field:'censusTract',   label:'Census Tract',type:'select', sortable:true, filterable:true, options:['Pending','Verified'] },
  { field:'dacDesignation',label:'DAC',         type:'select', sortable:true, filterable:true, options:['Yes','No','Unknown'] },
  { field:'rentRoll',      label:'Rent Roll',   type:'select', sortable:true, filterable:true, options:['Not Received','In Review','Received'] },
  { field:'state',         label:'State',       type:'select', sortable:true, filterable:true, options:['WI','NC','CO','MI'] },
]

// Saved views
const OPP_VIEWS  = [{ id:'OV-01', name:'All Opportunities',    filters:[], sortField:'closeDate', sortDir:'asc' }, { id:'OV-02', name:'Reservation Obtained', filters:[{ field:'stage', label:'Stage', op:'equals', value:'Opportunity — Reservation Obtained' }], sortField:'closeDate', sortDir:'asc' }, { id:'OV-03', name:'Application Submitted', filters:[{ field:'stage', label:'Stage', op:'equals', value:'Opportunity — Application Submitted' }], sortField:'closeDate', sortDir:'asc' }]
const PROP_VIEWS = [{ id:'PV-01', name:'All Properties',  filters:[], sortField:'name', sortDir:'asc' }, { id:'PV-02', name:'Enrolled',        filters:[{ field:'status', label:'Status', op:'equals', value:'Enrolled' }],        sortField:'name', sortDir:'asc' }, { id:'PV-03', name:'Outreach Active', filters:[{ field:'status', label:'Status', op:'equals', value:'Outreach Active' }], sortField:'name', sortDir:'asc' }]
const ACC_VIEWS  = [
  { id:'AV-01', name:'All Accounts',          filters:[], sortField:'name', sortDir:'asc' },
  { id:'AV-02', name:'Property Owners',       filters:[{ field:'recordType', label:'Record Type', op:'equals', value:'Property Owner' }],              sortField:'name', sortDir:'asc' },
  { id:'AV-03', name:'Property Mgmt Cos',     filters:[{ field:'recordType', label:'Record Type', op:'equals', value:'Property Management Company' }], sortField:'name', sortDir:'asc' },
  { id:'AV-04', name:'Partner Organizations', filters:[{ field:'recordType', label:'Record Type', op:'equals', value:'Partner Organization' }],         sortField:'name', sortDir:'asc' },
]
const BLDG_VIEWS = [{ id:'BV-01', name:'All Buildings', filters:[], sortField:'name', sortDir:'asc' }]
const UNIT_VIEWS = [{ id:'UV-01', name:'All Units', filters:[], sortField:'unit', sortDir:'asc' }]
const CONT_VIEWS = [{ id:'CV-01', name:'All Contacts', filters:[], sortField:'name', sortDir:'asc' }]
const ENR_VIEWS  = [{ id:'EV-01', name:'All Enrollments', filters:[], sortField:'status', sortDir:'asc' }, { id:'EV-02', name:'HAF Pending',          filters:[{ field:'hafAgreement', label:'HAF', op:'equals', value:'Pending' }],            sortField:'property', sortDir:'asc' }, { id:'EV-03', name:'Income Qual In Progress', filters:[{ field:'incomeQual', label:'Income Qual', op:'equals', value:'In Progress' }], sortField:'property', sortDir:'asc' }, { id:'EV-04', name:'Enrollment Complete', filters:[{ field:'status', label:'Status', op:'equals', value:'Enrollment — Complete' }], sortField:'property', sortDir:'asc' }]

function StatusDot({ value }) {
  const green = ['Executed', 'Complete', 'Verified', 'Received']
  const amber = ['Pending', 'In Progress', 'In Review']
  const color = green.includes(value) ? '#2aab72' : amber.includes(value) ? '#e8a949' : '#8fa0b8'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {value || '—'}
    </span>
  )
}

function enrollmentCell(col, r) {
  if (['hafAgreement', 'incomeQual', 'censusTract', 'rentRoll'].includes(col.field)) {
    return <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}` }}><StatusDot value={r[col.field]} /></td>
  }
  return undefined
}

function contactCell(col, r) {
  if (col.field === 'name') {
    const initials = r.name.split(' ').map(n => n[0]).join('').slice(0, 2)
    return (
      <td key={col.field} style={{ padding: '11px 12px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#e8f3fb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#1a5a8a', flexShrink: 0 }}>{initials}</div>
          <span style={{ color: C.textPrimary, fontWeight: 500 }}>{r.name}</span>
        </div>
      </td>
    )
  }
  return undefined
}

function OutreachHome({ setSec, properties, opportunities, enrollments, contacts }) {
  const enrolled = properties.filter(p => p.status === 'Enrolled')
  const hafPending = enrollments.filter(e => e.hafAgreement === 'Pending')
  const iqInProgress = enrollments.filter(e => e.incomeQual === 'In Progress')
  const needsAction = enrollments.filter(e => e.status !== 'Enrollment — Complete' && e.status !== 'Enrollment — Outreach Active')
  const pipeline = opportunities.reduce((s, r) => s + (r._amountRaw || 0), 0)

  // Group by count for charts
  const groupCount = (arr, key) => {
    const m = new Map()
    for (const r of arr) m.set(r[key] || '—', (m.get(r[key] || '—') || 0) + 1)
    return Array.from(m, ([name, value]) => ({ name, value }))
  }
  const propByStatus = groupCount(properties, 'status')
  const oppByStage = groupCount(opportunities, 'stage').map(d => ({
    ...d,
    name: d.name.replace(/^Opportunity\s*[—-]?\s*/, '').slice(0, 24)
  }))
  // Pipeline by state from live opportunity amounts (thousands)
  const pipelineByStateMap = new Map()
  for (const o of opportunities) {
    if (!o.state) continue
    pipelineByStateMap.set(o.state, (pipelineByStateMap.get(o.state) || 0) + (o._amountRaw || 0))
  }
  const pipelineByState = Array.from(pipelineByStateMap, ([name, v]) => ({ name, value: Math.round(v / 1000) }))
    .sort((a, b) => b.value - a.value)

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 20px 24px' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 2 }}>Outreach / Home</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary, margin: 0 }}>Outreach & Enrollment Dashboard</h1>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>Nicholas Wood · Program Manager · Sunday, April 12, 2026</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Active Pipeline',        value: fmt(pipeline),      sub: `${opportunities.length} opportunities`, color: C.emerald, action: () => setSec('opps')       },
            { label: 'Properties Enrolled',    value: enrolled.length,    sub: `${enrolled.reduce((s,r)=>s+(Number(r.units)||0),0)} units`, color: C.sky, action: () => setSec('properties') },
            { label: 'Enrollments Need Action',value: needsAction.length, sub: 'Awaiting documents',    color: C.amber,  action: () => setSec('enrollment')  },
            { label: 'HAF Agreements Pending', value: hafPending.length,  sub: 'Signature required',   color: C.danger, urgent: hafPending.length > 0, action: () => setSec('enrollment') },
          ].map(s => (
            <div key={s.label} onClick={s.action}
              style={{ background: C.card, border: `2px solid ${s.urgent ? C.danger : C.border}`, borderTop: `3px solid ${s.color}`, borderRadius: 8, padding: '14px 16px', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
              <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontSize: s.label === 'Active Pipeline' ? 18 : 26, fontWeight: 700, color: s.urgent ? C.danger : s.color, fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: C.textMuted }}>{s.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 14 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}><div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Opportunities by Stage</div></div>
            <div style={{ padding: '10px 14px' }}>
              <ResponsiveContainer width="100%" height={145}>
                <BarChart data={oppByStage} layout="vertical" margin={{ left: 0, right: 14, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: C.textMuted }} tickLine={false} axisLine={false} width={120} />
                  <Tooltip contentStyle={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 5 }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={C.emerald} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.border}` }}><span onClick={() => setSec('opps')} style={{ color: '#1a5a8a', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>View Opportunities →</span></div>
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}><div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Properties by Status</div></div>
            <div style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
              <ResponsiveContainer width={90} height={90}>
                <PieChart><Pie data={propByStatus} cx="50%" cy="50%" innerRadius={20} outerRadius={40} dataKey="value" strokeWidth={0}>{propByStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}</Pie></PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {propByStatus.map((d, i) => (
                  <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: CHART_COLORS[i], flexShrink: 0 }} /><span style={{ fontSize: 11, color: C.textSecondary }}>{d.name}</span></div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.border}` }}><span onClick={() => setSec('properties')} style={{ color: '#1a5a8a', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>View Properties →</span></div>
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}><div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Pipeline by State ($K)</div></div>
            <div style={{ padding: '10px 14px' }}>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={pipelineByState} margin={{ left: 0, right: 10, top: 8, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.textSecondary }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={v => [`$${v}K`, 'Pipeline']} contentStyle={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 5 }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={C.purple} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.border}` }}><span style={{ color: '#1a5a8a', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>View Report →</span></div>
          </div>
        </div>

        {/* Enrollment action table */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Enrollment — Needs Action</div>
            <span style={{ background: needsAction.length > 0 ? C.amber : '#e8f8f2', color: needsAction.length > 0 ? '#8a5a0a' : '#1a7a4e', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>{needsAction.length}</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>{['Record #','Enrollment','Property','Program','Status','HAF','Income Qual','Action'].map(h => <th key={h} style={{ padding: '9px 12px', textAlign: 'left', color: C.textMuted, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>)}</tr></thead>
            <tbody>
              {needsAction.map(e => (
                <TableRow key={e.id}>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>{e.id}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, color: C.textPrimary, fontWeight: 500, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, color: C.textSecondary }}>{e.property}</td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}><ProgramTag value={e.program} /></td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}><Badge s={e.status} /></td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}><StatusDot value={e.hafAgreement} /></td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}><StatusDot value={e.incomeQual} /></td>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
                    {e.hafAgreement === 'Pending' && <button style={{ background: '#fef3e2', color: '#8a5a0a', border: `1px solid #f0d8a0`, borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginRight: 4 }}>Send HAF</button>}
                    {e.incomeQual === 'In Progress' && <button style={{ background: '#e8f3fb', color: '#1a5a8a', border: `1px solid #b8d8f0`, borderRadius: 5, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Upload IQ</button>}
                  </td>
                </TableRow>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '9px 16px', borderTop: `1px solid ${C.border}` }}><span onClick={() => setSec('enrollment')} style={{ color: '#1a5a8a', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>View All Enrollments →</span></div>
        </div>
      </div>

      {/* Right sidebar */}
      <div style={{ width: 280, flexShrink: 0, background: C.page, borderLeft: `1px solid ${C.border}`, padding: '20px 14px', overflowY: 'auto' }}>
        {[
          { title: 'HAF Agreements Pending', items: hafPending,    badge: hafPending.length,   color: C.danger, btnLabel: 'Send HAF Agreement' },
          { title: 'Income Qual In Progress', items: iqInProgress, badge: iqInProgress.length, color: '#1a5a8a', btnLabel: null },
        ].map(sec => (
          <div key={sec.title} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: C.textPrimary }}>{sec.title}</span>
              <span style={{ background: sec.badge > 0 ? C.danger : '#e8f8f2', color: sec.badge > 0 ? '#fff' : '#1a7a4e', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>{sec.badge}</span>
            </div>
            {sec.items.length === 0
              ? <div style={{ padding: '16px 14px', textAlign: 'center', color: C.textMuted, fontSize: 12 }}>All clear.</div>
              : sec.items.map((e, i) => (
                <div key={e.id} style={{ padding: '10px 14px', borderBottom: i < sec.items.length - 1 ? `1px solid ${C.border}` : 'none', cursor: 'pointer' }}
                  onMouseEnter={ev => ev.currentTarget.style.background = '#f7f9fc'}
                  onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                  <div style={{ color: sec.color, fontSize: 12, fontWeight: 500, marginBottom: 2 }}>{e.property}</div>
                  <div style={{ color: C.textMuted, fontSize: 11 }}>{e.program} · {e.units} units</div>
                </div>
              ))}
            <div style={{ padding: '9px 14px', borderTop: `1px solid ${C.border}` }}><span onClick={() => setSec('enrollment')} style={{ color: '#1a5a8a', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>View All</span></div>
          </div>
        ))}

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}><span style={{ fontWeight: 600, fontSize: 13, color: C.textPrimary }}>Recent Contacts</span></div>
          {contacts.slice(0, 5).map((c, i) => {
            const initials = c.name.split(' ').map(n => n[0]).join('').slice(0, 2)
            return (
              <div key={c.id} style={{ padding: '9px 14px', borderBottom: i < 4 ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f7f9fc'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#e8f3fb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#1a5a8a', flexShrink: 0 }}>{initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#1a5a8a', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                  <div style={{ color: C.textMuted, fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.role} · {c.org}</div>
                </div>
              </div>
            )
          })}
          <div style={{ padding: '9px 14px', borderTop: `1px solid ${C.border}` }}><span onClick={() => setSec('contacts')} style={{ color: '#1a5a8a', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>View All</span></div>
        </div>
      </div>
    </div>
  )
}

function LiveListView({ loading, error, data, onRetry, ...rest }) {
  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onRetry} />
  return <ListView data={data} {...rest} />
}

export default function OutreachModule() {
  const [sec, setSec] = useState('home')
  const [selectedRecord, setSelectedRecord] = useState(null) // { table, id }

  // Map section ID → Supabase table name for record detail
  const SEC_TABLE_MAP = {
    opps: 'opportunities',
    accounts: 'accounts',
    properties: 'properties',
    buildings: 'buildings',
    units: 'units',
    contacts: 'contacts',
    enrollment: 'property_programs',
  }

  const openRecord = (row) => {
    if (!row?._id) return
    const table = SEC_TABLE_MAP[sec]
    if (table) setSelectedRecord({ table, id: row._id, name: row.name })
  }

  const closeRecord = () => setSelectedRecord(null)

  // All seven datasets are live from Supabase.
  const [properties, setProperties] = useState([])
  const [buildings, setBuildings] = useState([])
  const [units, setUnits] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [contacts, setContacts] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Extract the fetch logic so pull-to-refresh can call it without reloading
  // the page. The initial mount uses the full loading spinner; pull-to-refresh
  // uses a subtler inline indicator and doesn't flip the main `loading` flag.
  const loadAll = async ({ showLoader = false } = {}) => {
    if (showLoader) { setLoading(true) }
    setError(null)
    try {
      const [p, b, u, o, c, e, a] = await Promise.all([
        fetchProperties(),
        fetchBuildings(),
        fetchUnits(),
        fetchOpportunities(),
        fetchContacts(),
        fetchEnrollments(),
        fetchAccounts(),
      ])
      setProperties(p)
      setBuildings(b)
      setUnits(u)
      setOpportunities(o)
      setContacts(c)
      setEnrollments(e)
      setAccounts(a)
    } catch (err) {
      setError(err)
    } finally {
      if (showLoader) { setLoading(false) }
    }
  }

  useEffect(() => {
    // Initial load shows the full loading spinner. Use a cancellation flag so
    // a fast-navigating user can't leave a setState against an unmounted tree.
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const [p, b, u, o, c, e, a] = await Promise.all([
          fetchProperties(), fetchBuildings(), fetchUnits(),
          fetchOpportunities(), fetchContacts(), fetchEnrollments(),
          fetchAccounts(),
        ])
        if (cancelled) return
        setProperties(p); setBuildings(b); setUnits(u)
        setOpportunities(o); setContacts(c); setEnrollments(e)
        setAccounts(a)
      } catch (err) {
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const hafUrgent = enrollments.filter(e => e.hafAgreement === 'Pending').length
  const counts = {
    opps: opportunities.length,
    accounts: accounts.length,
    properties: properties.length,
    buildings: buildings.length,
    units: units.length,
    contacts: contacts.length,
    enrollment: enrollments.length,
  }
  const urgentSections = { home: hafUrgent }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Topbar */}
      <div data-module-topbar="1" style={{ height: 54, background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: C.textMuted }}>Outreach</span>
          <span style={{ color: C.textMuted }}>/</span>
          <span style={{ color: selectedRecord ? C.textMuted : C.textPrimary, fontWeight: selectedRecord ? 400 : 500, cursor: selectedRecord ? 'pointer' : 'default' }} onClick={() => selectedRecord && closeRecord()}>{SECTIONS.find(s => s.id === sec)?.label}</span>
          {selectedRecord && <><span style={{ color:C.textMuted }}>/</span><span style={{ color:C.textPrimary, fontWeight:500 }}>{selectedRecord.name}</span></>}
        </div>
        <button style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12.5, color: C.textSecondary, cursor: 'pointer', fontWeight: 500 }}>
          <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" size={13} color={C.textSecondary} />
          Reports
        </button>
      </div>

      <SectionTabs sections={SECTIONS} active={sec} onChange={s => { setSec(s); closeRecord(); }} counts={counts} urgentSections={urgentSections} />

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {selectedRecord ? (
          <RecordDetail tableName={selectedRecord.table} recordId={selectedRecord.id} onBack={closeRecord}
            mode={selectedRecord.mode || 'view'}
            onRecordCreated={(r) => setSelectedRecord({ table: r.table, id: r.id })}
            prefill={selectedRecord.prefill}
            onNavigateToRecord={(r) => setSelectedRecord({ table: r.table, id: r.id, mode: r.mode, prefill: r.prefill })} />
        ) : (<>
        {sec === 'home'       && <OutreachHome setSec={setSec} properties={properties} opportunities={opportunities} enrollments={enrollments} contacts={contacts} />}
        {sec === 'opps'       && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={opportunities} columns={OPP_COLS}    systemViews={OPP_VIEWS}  defaultViewId="OV-01" newLabel="Opportunity" onNew={() => setSelectedRecord({ table: 'opportunities', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'accounts'   && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={accounts}      columns={ACCOUNT_COLS} systemViews={ACC_VIEWS}  defaultViewId="AV-01" newLabel="Account"     onNew={() => setSelectedRecord({ table: 'accounts',      id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'properties' && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={properties}   columns={PROP_COLS}   systemViews={PROP_VIEWS} defaultViewId="PV-01" newLabel="Property"    onNew={() => setSelectedRecord({ table: 'properties', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'buildings'  && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={buildings}    columns={BLDG_COLS}   systemViews={BLDG_VIEWS} defaultViewId="BV-01" newLabel="Building"    onNew={() => setSelectedRecord({ table: 'buildings', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'units'      && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={units}        columns={UNIT_COLS}   systemViews={UNIT_VIEWS} defaultViewId="UV-01" newLabel="Unit"        onNew={() => setSelectedRecord({ table: 'units', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'contacts'   && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={contacts}     columns={CONTACT_COLS} systemViews={CONT_VIEWS} defaultViewId="CV-01" newLabel="Contact"    onNew={() => setSelectedRecord({ table: 'contacts', id: null, mode: 'create' })} onOpenRecord={openRecord} renderCell={contactCell} />}
        {sec === 'enrollment' && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={enrollments}  columns={ENR_COLS}    systemViews={ENR_VIEWS}  defaultViewId="EV-01" newLabel="Enrollment"  onNew={() => setSelectedRecord({ table: 'property_programs', id: null, mode: 'create' })} onOpenRecord={openRecord} renderCell={enrollmentCell} />}
        </>)}
      </div>
    </div>
  )
}
