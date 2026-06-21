import { useState, useEffect } from 'react'
import { useModuleSections } from '../lib/useModuleSections'
import ConfiguredHome from '../components/ConfiguredHome'
import { C, CHART_COLORS, fmt } from '../data/constants'
import { Badge, Icon, TableRow, ProgramTag, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import { OPPORTUNITIES, PROPERTIES, BUILDINGS, CONTACTS, ENROLLMENTS } from '../data/mockData'
import { fetchProperties, fetchBuildings, fetchUnits, fetchOpportunities, fetchContacts, fetchEnrollments, fetchAccounts } from '../data/outreachService'
import { useCachedFetch, invalidatePrefix } from '../lib/useCachedFetch'

const CODE_SECTIONS = [
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
  { field:'hudId',       label:'HUD Property ID', type:'text',   sortable:true, filterable:true  },
  { field:'hudCategory', label:'HUD Category',    type:'text',   sortable:true, filterable:true  },
  { field:'hudProgram',  label:'HUD Program',     type:'text',   sortable:true, filterable:true  },
  { field:'hudContract', label:'Contract #',      type:'text',   sortable:true, filterable:true  },
  { field:'hudTracs',    label:'TRACS Status',    type:'text',   sortable:true, filterable:true  },
  { field:'hud202811',   label:'202/811',         type:'select', sortable:true, filterable:true, options:['Yes','No'] },
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
  { field:'id',               label:'Record #',     type:'text',   sortable:true, filterable:false },
  { field:'name',             label:'Enrollment',   type:'text',   sortable:true, filterable:true  },
  { field:'property',         label:'Property',     type:'text',   sortable:true, filterable:true  },
  { field:'recordType',       label:'Record Type',  type:'select', sortable:true, filterable:true, options:['WI-IRA-SF','WI-IRA-MF','NC-IRA-SF','NC-IRA-MF','MI-IRA-SF','MI-IRA-MF'] },
  { field:'status',           label:'Status',       type:'select', sortable:true, filterable:true, options:['Enrollment To Be Prepared','Enrollment To Be Verified','Enrollment Verified','Enrollment Submitted — Awaiting Program Response','Enrollment Approved','Enrollment Corrections Needed','Enrollment Denied','Enrollment Withdrawn'] },
  { field:'qualifyingMode',   label:'Income Qual',  type:'select', sortable:true, filterable:true, options:['Not Run','Entire Building','Individual Tenants'] },
  { field:'determinationDate',label:'Determined',   type:'date',   sortable:true, filterable:true  },
  { field:'owner',            label:'Owner',        type:'select', sortable:true, filterable:true, options:['Nicholas Wood'] },
  { field:'state',            label:'State',        type:'select', sortable:true, filterable:true, options:['WI','NC','MI'] },
]

// Saved views
const OPP_VIEWS  = [{ id:'OV-01', name:'All Opportunities',    filters:[], sortField:'id', sortDir:'asc' }, { id:'OV-02', name:'Reservation Obtained', filters:[{ field:'stage', label:'Stage', op:'equals', value:'Opportunity — Reservation Obtained' }], sortField:'id', sortDir:'asc' }, { id:'OV-03', name:'Application Submitted', filters:[{ field:'stage', label:'Stage', op:'equals', value:'Opportunity — Application Submitted' }], sortField:'id', sortDir:'asc' }]
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
const ENR_VIEWS  = [{ id:'EV-01', name:'All Enrollments', filters:[], sortField:'status', sortDir:'asc' }, { id:'EV-02', name:'To Be Verified', filters:[{ field:'status', label:'Status', op:'equals', value:'Enrollment To Be Verified' }], sortField:'property', sortDir:'asc' }, { id:'EV-03', name:'Income Qual Not Run', filters:[{ field:'qualifyingMode', label:'Income Qual', op:'equals', value:'Not Run' }], sortField:'property', sortDir:'asc' }, { id:'EV-04', name:'Approved', filters:[{ field:'status', label:'Status', op:'equals', value:'Enrollment Approved' }], sortField:'property', sortDir:'asc' }]

function StatusDot({ value }) {
  const green = ['Executed', 'Complete', 'Verified', 'Received']
  const amber = ['Pending', 'In Progress', 'In Review']
  const color = green.includes(value) ? '#2aab72' : amber.includes(value) ? '#7eb3e8' : '#8fa0b8'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {value || '—'}
    </span>
  )
}

function enrollmentCell(col, r) {
  if (col.field === 'qualifyingMode') {
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

function LiveListView({ loading, error, data, onRetry, ...rest }) {
  if (loading) return <LoadingState />
  // Full error screen only when we have nothing to show. If a background
  // refresh failed but we still hold previously-loaded rows, show the rows
  // with a small non-blocking banner rather than blanking the list — a
  // transient refresh error must never hide records the user already had.
  const hasData = Array.isArray(data) && data.length > 0
  if (error && !hasData) return <ErrorState error={error} onRetry={onRetry} />
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {error && hasData && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '8px 12px', margin: '0 0 10px', borderRadius: 6,
          background: '#fdf3e7', border: '1px solid #7eb3e8', color: '#7a5b1e', fontSize: 12.5 }}>
          <span>Couldn’t refresh just now — showing the last loaded data.</span>
          {onRetry && (
            <button onClick={onRetry} style={{ background: 'transparent', border: '1px solid #7eb3e8',
              color: '#7a5b1e', borderRadius: 5, padding: '3px 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
              Retry
            </button>
          )}
        </div>
      )}
      <ListView data={data} {...rest} />
    </div>
  )
}

export default function OutreachModule({ selectedRecord: navSelectedRecord, sectionFromUrl, onNavigateToRecord, onCloseRecord, onSectionChange, onReplaceRecord, onOpenSetup } = {}) {
  // Navigation is URL-driven when App passes nav props (the default in the
  // shipping app). The local-state fallback path remains so this module can
  // still mount in isolation (tests, future embeds).
  const urlDriven = !!onNavigateToRecord
  const SECTIONS = useModuleSections('enrollment', CODE_SECTIONS)
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


  // Map section ID → Supabase table name for record detail
  const SEC_TABLE_MAP = {
    opps: 'opportunities',
    accounts: 'accounts',
    properties: 'properties',
    buildings: 'buildings',
    units: 'units',
    contacts: 'contacts',
    enrollment: 'enrollments',
  }

  const openRecord = (row) => {
    if (!row?._id) return
    const table = SEC_TABLE_MAP[sec]
    if (table) setSelectedRecord({ table, id: row._id, name: row.name })
  }

  const closeRecord = () => setSelectedRecord(null)

  // ─── Data layer ────────────────────────────────────────────────────────
  // Each section fetches ONLY its dataset, and only when the section is
  // active. Cache survives unmounts, so navigating away and back returns
  // instantly. The 5-min SWR window means a user who lingers gets a
  // background refresh on every revisit.
  //
  // Home reads counts and small slices from several datasets. We treat
  // those as eager — they're what the user sees first and they should
  // all be loading the moment the module mounts. The big lists
  // (properties, accounts) stay lazy: they don't load unless the user
  // actually opens that tab.
  //
  // What used to happen on every mount: Promise.all of 7 fetchers,
  // including the ~3s parallel-paginated 6,781-row properties query and
  // the ~3s 2,030-row accounts query. ~6s of network before Home painted.
  // What happens now: Home's small datasets fire immediately, big ones
  // wait for the user to ask for them. Repeat visits to a section are
  // ~0ms instead of refetching.
  const onHome = sec === 'home'

  // Eager (Home reads from these): opportunities, enrollments, contacts.
  // Buildings/units are small and used by Home counts too — keep eager.
  const opportunitiesQ = useCachedFetch('enrollment:opportunities', fetchOpportunities)
  const enrollmentsQ   = useCachedFetch('enrollment:enrollments',   fetchEnrollments)
  const contactsQ      = useCachedFetch('enrollment:contacts',      fetchContacts)
  const buildingsQ     = useCachedFetch('enrollment:buildings',     fetchBuildings)
  const unitsQ         = useCachedFetch('enrollment:units',         fetchUnits)

  // Lazy (big tables). Fetched only when the user opens that section.
  // Home shows a count card from these too; once warmed by a visit
  // the count appears on Home from cache. Until first visit the
  // count card shows '—'. Acceptable trade — we save 6s on first load.
  const propertiesQ = useCachedFetch('enrollment:properties', fetchProperties, {
    enabled: sec === 'properties' || sec === 'home',
  })
  const accountsQ = useCachedFetch('enrollment:accounts', fetchAccounts, {
    enabled: sec === 'accounts' || sec === 'home',
  })

  // Convenience destructure so the rest of the file reads the same as
  // before. `loading` is per-section — Home shows the combined loading
  // state of the datasets Home actually needs.
  const properties    = propertiesQ.data    || []
  const buildings     = buildingsQ.data     || []
  const units         = unitsQ.data         || []
  const opportunities = opportunitiesQ.data || []
  const contacts      = contactsQ.data      || []
  const enrollments   = enrollmentsQ.data   || []
  const accounts      = accountsQ.data      || []

  // Per-section loading flag — only true when THIS section's primary
  // dataset is on a cold load. SWR refreshes don't flip it.
  const loading =
    sec === 'properties' ? propertiesQ.loading :
    sec === 'accounts'   ? accountsQ.loading   :
    sec === 'opps'       ? opportunitiesQ.loading :
    sec === 'buildings'  ? buildingsQ.loading  :
    sec === 'units'      ? unitsQ.loading      :
    sec === 'contacts'   ? contactsQ.loading   :
    sec === 'enrollment' ? enrollmentsQ.loading :
    // Home: loading only on the very first cold mount when nothing is cached yet.
    (opportunitiesQ.loading && enrollmentsQ.loading && contactsQ.loading)

  // First non-null error from any active section's query. Same gating
  // as `loading` — Home only surfaces errors from the Home datasets.
  const error =
    sec === 'properties' ? propertiesQ.error :
    sec === 'accounts'   ? accountsQ.error   :
    sec === 'opps'       ? opportunitiesQ.error :
    sec === 'buildings'  ? buildingsQ.error  :
    sec === 'units'      ? unitsQ.error      :
    sec === 'contacts'   ? contactsQ.error   :
    sec === 'enrollment' ? enrollmentsQ.error :
    (opportunitiesQ.error || enrollmentsQ.error || contactsQ.error)

  // Pull-to-refresh / explicit retry. Invalidates EVERY outreach cache
  // entry so the next render of any section refetches. This is what the
  // user expects when they hit refresh — the whole module starts fresh,
  // not just the current section.
  const loadAll = () => {
    invalidatePrefix('enrollment:')
  }

  const hafUrgent = enrollments.filter(e => e.qualifyingMode === 'Not Run').length
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
          <span
            onClick={() => { setSec('home'); closeRecord() }}
            style={{ color: C.textMuted, cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.color = C.textSecondary }}
            onMouseLeave={e => { e.currentTarget.style.color = C.textMuted }}
          >Enrollment</span>
          <span style={{ color: C.textMuted }}>/</span>
          <span
            onClick={() => { if (selectedRecord) closeRecord(); else if (sec !== 'home') setSec('home') }}
            style={{ color: (selectedRecord || sec !== 'home') ? C.textMuted : C.textPrimary, fontWeight: (selectedRecord || sec !== 'home') ? 400 : 500, cursor: (selectedRecord || sec !== 'home') ? 'pointer' : 'default' }}
            onMouseEnter={e => { if (selectedRecord || sec !== 'home') e.currentTarget.style.color = C.textSecondary }}
            onMouseLeave={e => { if (selectedRecord || sec !== 'home') e.currentTarget.style.color = C.textMuted }}
          >{SECTIONS.find(s => s.id === sec)?.label}</span>
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
            onRecordCreated={(r) => { invalidatePrefix('enrollment:'); replaceSelectedRecord({ table: r.table, id: r.id, mode: 'view' }) }}
            prefill={selectedRecord.prefill}
            onNavigateToRecord={(r) => setSelectedRecord({ table: r.table, id: r.id, mode: r.mode, prefill: r.prefill })} />
        ) : (<>
        {sec === 'home'       && <ConfiguredHome crumb="Enrollment" moduleId="enrollment" onOpenSetup={onOpenSetup} onOpenRecord={(r) => setSelectedRecord(r)} />}
        {sec === 'opps'       && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={opportunities} listObject="opportunities" listModule="enrollment" columns={OPP_COLS}    systemViews={OPP_VIEWS}  defaultViewId="OV-01" newLabel="Opportunity" onNew={() => setSelectedRecord({ table: 'opportunities', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'accounts'   && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={accounts}      listObject="accounts" listModule="enrollment" columns={ACCOUNT_COLS} systemViews={ACC_VIEWS}  defaultViewId="AV-01" newLabel="Account"     onNew={() => setSelectedRecord({ table: 'accounts',      id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'properties' && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={properties}   listObject="properties" listModule="enrollment" columns={PROP_COLS}   systemViews={PROP_VIEWS} defaultViewId="PV-01" newLabel="Property"    onNew={() => setSelectedRecord({ table: 'properties', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'buildings'  && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={buildings}    listObject="buildings" listModule="enrollment" columns={BLDG_COLS}   systemViews={BLDG_VIEWS} defaultViewId="BV-01" newLabel="Building"    onNew={() => setSelectedRecord({ table: 'buildings', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'units'      && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={units}        listObject="units" listModule="enrollment" columns={UNIT_COLS}   systemViews={UNIT_VIEWS} defaultViewId="UV-01" newLabel="Unit"        onNew={() => setSelectedRecord({ table: 'units', id: null, mode: 'create' })} onOpenRecord={openRecord} />}
        {sec === 'contacts'   && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={contacts}     listObject="contacts" listModule="enrollment" columns={CONTACT_COLS} systemViews={CONT_VIEWS} defaultViewId="CV-01" newLabel="Contact"    onNew={() => setSelectedRecord({ table: 'contacts', id: null, mode: 'create' })} onOpenRecord={openRecord} renderCell={contactCell} />}
        {sec === 'enrollment' && <LiveListView loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} data={enrollments}  listObject="enrollments" listModule="enrollment" columns={ENR_COLS}    systemViews={ENR_VIEWS}  defaultViewId="EV-01" newLabel="Enrollment"  onNew={() => setSelectedRecord({ table: 'enrollments', id: null, mode: 'create' })} onOpenRecord={openRecord} renderCell={enrollmentCell} />}
        </>)}
      </div>
    </div>
  )
}
