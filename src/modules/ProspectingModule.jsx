import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import {
  fetchProspectingProperties,
  fetchProspectingCounts,
  exportProspectingPropertiesCsv,
} from '../data/prospectingService'

/**
 * Prospecting Module
 *
 * Top-of-funnel surface for properties not yet under active engagement.
 * Data lives in the unified `public.properties` table; this module is a
 * filtered lens — properties with NO active opportunity, plus extension
 * data from `property_source_data` (HUD/LIHTC/DOE LEAD) and
 * `property_disaster_exposure` (FEMA, NC properties only).
 *
 * Reads from the prospecting_properties_v view.
 */

const SECTIONS = [
  { id: 'home',       label: 'Home'       },
  { id: 'properties', label: 'Properties' },
  { id: 'map',        label: 'Map'        },
  { id: 'imports',    label: 'Imports'    },
]

const PROP_COLS = [
  { field:'id',                          label:'Record #',          type:'text',   sortable:true,  filterable:false },
  { field:'name',                        label:'Property',          type:'text',   sortable:true,  filterable:true  },
  { field:'hudPropertyId',               label:'HUD Property ID',   type:'text',   sortable:true,  filterable:true  },
  { field:'lihtcProjectId',              label:'LIHTC Project ID',  type:'text',   sortable:true,  filterable:true  },
  { field:'account',                     label:'Account',           type:'text',   sortable:true,  filterable:true  },
  { field:'accountHudParticipantNumber', label:'HUD Participant #', type:'text',   sortable:true,  filterable:true  },
  { field:'state',                       label:'State',             type:'select', sortable:true,  filterable:true,
    options:['WI','NC','CO','MI','IN','TX','GA'] },
  { field:'units',                       label:'Units',             type:'number', sortable:true,  filterable:true  },
  { field:'buildings',                   label:'Buildings',         type:'number', sortable:true,  filterable:true  },
  { field:'yearBuilt',                   label:'Year Built',        type:'number', sortable:true,  filterable:true  },
  { field:'subsidyType',                 label:'Subsidy Type',      type:'text',   sortable:true,  filterable:true  },
  { field:'hudContractNumber',           label:'HUD Contract #',    type:'text',   sortable:true,  filterable:true  },
  { field:'contractExpiration',          label:'Contract Expiration', type:'date', sortable:true,  filterable:true  },
  { field:'energyBurden',                label:'Energy Burden',     type:'number', sortable:true,  filterable:true  },
  { field:'hasDisasterExposure',         label:'Disaster Exposure', type:'select', sortable:true,  filterable:true,
    options:['Yes','No'] },
]

const PROP_VIEWS = [
  { id:'PV-01', name:'All Prospects',           filters:[], sortField:'name', sortDir:'asc' },
  { id:'PV-02', name:'NC — With Disaster Data', filters:[
      { field:'state',               label:'State',             op:'equals', value:'NC'  },
      { field:'hasDisasterExposure', label:'Disaster Exposure', op:'equals', value:'Yes' },
    ], sortField:'units', sortDir:'desc' },
  { id:'PV-03', name:'Large Properties (>50 units)', filters:[
      { field:'units', label:'Units', op:'greater_than', value:50 },
    ], sortField:'units', sortDir:'desc' },
  { id:'PV-04', name:'Contracts Expiring This Year', filters:[
      { field:'contractExpiration', label:'Contract Expiration', op:'less_than', value:'2026-12-31' },
    ], sortField:'contractExpiration', sortDir:'asc' },
  { id:'PV-05', name:'High Energy Burden (>0.06)', filters:[
      { field:'energyBurden', label:'Energy Burden', op:'greater_than', value:0.06 },
    ], sortField:'energyBurden', sortDir:'desc' },
]

function StatCard({ label, value }) {
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
      <div style={{ fontSize:11, color:C.textMuted, marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:24, fontWeight:700, color:C.textPrimary, fontFamily:'JetBrains Mono, monospace' }}>{value}</div>
    </div>
  )
}

function ProspectingHome({ counts, loading }) {
  const fmt = (n) => loading ? '—' : (n != null ? n.toLocaleString() : '—')
  return (
    <div style={{ flex:1, overflow:'auto', padding:'20px 20px 24px' }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:11, color:C.textMuted, marginBottom:2 }}>Prospecting / Home</div>
        <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>Prospecting Dashboard</h1>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>Top-of-funnel properties — not yet under active engagement.</div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12, marginBottom:20 }}>
        <StatCard label="Properties without active Opportunity" value={fmt(counts?.propertiesWithoutOpportunity)} />
        <StatCard label="Properties with active Opportunity"     value={fmt(counts?.propertiesWithOpportunity)} />
        <StatCard label="Import batches recorded"                 value={fmt(counts?.importBatches)} />
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'20px 22px' }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:6 }}>Module status</div>
        <div style={{ fontSize:12, color:C.textSecondary, lineHeight:1.6 }}>
          Properties list view live. Map view and bulk import flow ship in the next build steps. HUD identifiers
          (<span style={{ fontFamily:'JetBrains Mono, monospace' }}>account_hud_participant_number</span>,
          <span style={{ fontFamily:'JetBrains Mono, monospace' }}> property_hud_property_id</span>,
          <span style={{ fontFamily:'JetBrains Mono, monospace' }}> property_lihtc_project_id</span>) are unique-indexed.
          Source data (HUD / LIHTC / DOE LEAD) lives in <span style={{ fontFamily:'JetBrains Mono, monospace' }}>property_source_data</span>;
          FEMA disaster exposure in <span style={{ fontFamily:'JetBrains Mono, monospace' }}>property_disaster_exposure</span>.
        </div>
      </div>
    </div>
  )
}

function ComingSoon({ title, body }) {
  return (
    <div style={{ flex:1, overflow:'auto', padding:'20px 20px 24px' }}>
      <div style={{ maxWidth:680, margin:'0 auto', padding:'48px 24px', background:C.card, border:`1px solid ${C.border}`, borderRadius:8, textAlign:'center' }}>
        <div style={{ width:48, height:48, margin:'0 auto 14px', borderRadius:24, background:C.page, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Icon path="M9 17v-2a4 4 0 014-4h4M3 7l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" size={22} color={C.textMuted} />
        </div>
        <h2 style={{ fontSize:17, fontWeight:600, color:C.textPrimary, margin:'0 0 8px' }}>{title}</h2>
        <div style={{ fontSize:13, color:C.textSecondary, lineHeight:1.5 }}>{body}</div>
      </div>
    </div>
  )
}

function PropertiesListSection({ loading, error, properties, onRefresh, onRetry, onOpenRecord }) {
  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onRetry} />

  const handleExport = () => {
    const filename = `prospecting-properties-${new Date().toISOString().slice(0,10)}.csv`
    exportProspectingPropertiesCsv(properties, filename)
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', padding:'10px 20px 0', gap:8 }}>
        <button
          onClick={handleExport}
          disabled={!properties.length}
          style={{
            display:'flex', alignItems:'center', gap:6,
            background: properties.length ? C.card : C.page,
            border:`1px solid ${C.border}`, borderRadius:6,
            padding:'6px 12px', fontSize:12.5,
            color: properties.length ? C.textPrimary : C.textMuted,
            cursor: properties.length ? 'pointer' : 'not-allowed',
            fontWeight:500,
          }}>
          <Icon path="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" size={13} color={properties.length ? C.textSecondary : C.textMuted} />
          Export CSV
        </button>
      </div>
      <div style={{ flex:1, overflow:'hidden' }}>
        <ListView
          data={properties}
          columns={PROP_COLS}
          systemViews={PROP_VIEWS}
          defaultViewId="PV-01"
          newLabel={null}
          onNew={null}
          onOpenRecord={onOpenRecord}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  )
}

export default function ProspectingModule({
  selectedRecord: navSelectedRecord,
  sectionFromUrl,
  onNavigateToRecord,
  onCloseRecord,
  onSectionChange,
  onReplaceRecord,
} = {}) {
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
  const closeRecord = () => setSelectedRecord(null)

  const [properties, setProperties] = useState([])
  const [counts, setCounts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadAll = async () => {
    setError(null)
    try {
      const [props, c] = await Promise.all([
        fetchProspectingProperties(),
        fetchProspectingCounts(),
      ])
      setProperties(props)
      setCounts(c)
    } catch (err) {
      setError(err)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([fetchProspectingProperties(), fetchProspectingCounts()])
      .then(([props, c]) => { if (!cancelled) { setProperties(props); setCounts(c) } })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const openProperty = (row) => {
    if (row?._id) setSelectedRecord({ table: 'properties', id: row._id, name: row.name })
  }

  const counts4Tabs = { properties: properties.length }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div data-module-topbar="1" style={{ height: 54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Prospecting</span><span style={{ color:C.textMuted }}>/</span>
          <span style={{ color:C.textPrimary, fontWeight:500 }}>{SECTIONS.find(s => s.id===sec)?.label}</span>
        </div>
      </div>

      <SectionTabs sections={SECTIONS} active={sec} onChange={s => { setSec(s); closeRecord(); }} counts={counts4Tabs} />

      <div style={{ flex:1, overflow:'hidden', display:'flex' }}>
        {selectedRecord ? (
          <RecordDetail
            tableName={selectedRecord.table}
            recordId={selectedRecord.id}
            onBack={closeRecord}
            mode={selectedRecord.mode || 'view'}
            onRecordCreated={(r) => replaceSelectedRecord({ table: r.table, id: r.id, mode: 'view' })}
            prefill={selectedRecord.prefill}
            onNavigateToRecord={(r) => setSelectedRecord({ table: r.table, id: r.id, mode: r.mode, prefill: r.prefill })}
          />
        ) : (
          <>
            {sec === 'home'       && <ProspectingHome counts={counts} loading={loading} />}
            {sec === 'properties' && <PropertiesListSection loading={loading} error={error} properties={properties} onRefresh={loadAll} onRetry={loadAll} onOpenRecord={openProperty} />}
            {sec === 'map'        && <ComingSoon title="Map view — coming next" body="Pins for properties without an active opportunity. Clustered at zoom-out, filterable by state, account, subsidy type, and contract expiration window. Map provider decision (Mapbox GL vs Leaflet) pending." />}
            {sec === 'imports'    && <ComingSoon title="Import batches — coming next" body="HUD Active Portfolio, HUD LIHTC, HUD Multifamily Contracts, and DOE LEAD imports. Each batch tracked with created / updated / skipped / errored counts and a downloadable error report." />}
          </>
        )}
      </div>
    </div>
  )
}
