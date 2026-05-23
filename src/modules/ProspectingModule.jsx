import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import { ProspectingMap } from '../components/ProspectingMap'
import {
  fetchProspectingProperties,
  fetchProspectingCounts,
  fetchImportBatches,
  submitPropertyImport,
  exportProspectingPropertiesCsv,
} from '../data/prospectingService'

/**
 * Prospecting Module
 *
 * Top-of-funnel surface for properties not yet under active engagement.
 * One unified public.properties table — Prospecting is a filtered lens
 * over properties with no active opportunity. HUD/LIHTC/DOE LEAD source
 * fields in property_source_data; FEMA disaster exposure in
 * property_disaster_exposure (conditionally surfaced via hide_when_empty
 * widget config on the Property page layout).
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

const IMPORT_COLS = [
  { field:'id',              label:'Batch #',          type:'text',   sortable:true,  filterable:false },
  { field:'sourceDataset',   label:'Source Dataset',   type:'select', sortable:true,  filterable:true,
    options:['HUD_ACTIVE_PORTFOLIO','HUD_LIHTC','HUD_MULTIFAMILY_CONTRACTS','DOE_LEAD','MANUAL'] },
  { field:'status',          label:'Status',           type:'select', sortable:true,  filterable:true,
    options:['pending','in_progress','completed','completed_with_errors','failed'] },
  { field:'total',           label:'Records',          type:'number', sortable:true,  filterable:true  },
  { field:'created',         label:'Created',          type:'number', sortable:true,  filterable:true  },
  { field:'updated',         label:'Updated',          type:'number', sortable:true,  filterable:true  },
  { field:'skipped',         label:'Skipped',          type:'number', sortable:true,  filterable:true  },
  { field:'errored',         label:'Errored',          type:'number', sortable:true,  filterable:true  },
  { field:'accountsCreated', label:'Accounts Created', type:'number', sortable:true,  filterable:true  },
  { field:'accountsMatched', label:'Accounts Matched', type:'number', sortable:true,  filterable:true  },
  { field:'startedAt',       label:'Started',          type:'date',   sortable:true,  filterable:true  },
  { field:'completedAt',     label:'Completed',        type:'date',   sortable:true,  filterable:true  },
]

const IMPORT_VIEWS = [
  { id:'IMV-01', name:'All Batches',     filters:[], sortField:'startedAt', sortDir:'desc' },
  { id:'IMV-02', name:'With Errors',     filters:[{ field:'errored', label:'Errored', op:'greater_than', value:0 }], sortField:'startedAt', sortDir:'desc' },
  { id:'IMV-03', name:'In Progress',     filters:[{ field:'status', label:'Status', op:'equals', value:'in_progress' }], sortField:'startedAt', sortDir:'desc' },
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
          All four sections live: Properties (filterable, sortable list with CSV export), Map (Leaflet-backed pin view),
          and Imports (batch tracking + manual JSON upload). HUD identifiers
          (<span style={{ fontFamily:'JetBrains Mono, monospace' }}>account_hud_participant_number</span>,
          <span style={{ fontFamily:'JetBrains Mono, monospace' }}> property_hud_property_id</span>,
          <span style={{ fontFamily:'JetBrains Mono, monospace' }}> property_lihtc_project_id</span>) are unique-indexed.
          Disaster exposure surfaces on Property page layouts only when ingested data exists for that property
          (<span style={{ fontFamily:'JetBrains Mono, monospace' }}>widget_config.hide_when_empty=true</span>).
        </div>
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

function MapSection({ loading, error, properties, onRetry, onOpenProperty }) {
  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onRetry} />
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <ProspectingMap properties={properties} onOpenProperty={onOpenProperty} />
    </div>
  )
}

function ImportModal({ onClose, onSubmitted }) {
  const [dataset, setDataset]   = useState('HUD_ACTIVE_PORTFOLIO')
  const [jsonText, setJsonText] = useState('')
  const [working, setWorking]   = useState(false)
  const [error, setError]       = useState(null)
  const [summary, setSummary]   = useState(null)

  const parseRecords = () => {
    let parsed
    try { parsed = JSON.parse(jsonText) }
    catch (e) { throw new Error('Could not parse JSON: ' + e.message) }
    if (!Array.isArray(parsed)) throw new Error('JSON root must be an array of record objects')
    return parsed
  }

  const handleRun = async () => {
    setError(null); setSummary(null)
    let records
    try { records = parseRecords() }
    catch (e) { setError(e.message); return }
    if (records.length === 0) { setError('Records array is empty'); return }
    setWorking(true)
    try {
      const result = await submitPropertyImport(dataset, records)
      setSummary(result.summary || result)
      if (onSubmitted) onSubmitted(result)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, background:'rgba(7,17,31,0.55)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:C.card, borderRadius:10, width:'min(720px, 100%)', maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 12px 40px rgba(7,17,31,0.4)' }}>
        <div style={{ padding:'14px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:15, fontWeight:600, color:C.textPrimary }}>New Property Import</div>
          <button onClick={onClose} style={{ background:'transparent', border:'none', cursor:'pointer', color:C.textMuted, fontSize:18, lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:'14px 18px', overflowY:'auto', flex:1 }}>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, color:C.textMuted, marginBottom:4, display:'block', fontWeight:500 }}>Source Dataset</label>
            <select value={dataset} onChange={e => setDataset(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', fontSize:13, border:`1px solid ${C.border}`, borderRadius:6, background:C.card, color:C.textPrimary }}>
              <option value="HUD_ACTIVE_PORTFOLIO">HUD Active Portfolio</option>
              <option value="HUD_LIHTC">HUD LIHTC Database</option>
              <option value="HUD_MULTIFAMILY_CONTRACTS">HUD Multifamily Contracts</option>
              <option value="DOE_LEAD">DOE LEAD Energy Burden</option>
              <option value="MANUAL">Manual</option>
            </select>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, color:C.textMuted, marginBottom:4, display:'block', fontWeight:500 }}>Records (JSON array)</label>
            <textarea
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              placeholder='[ { "hud_property_id": "...", "owner_name": "...", "owner_hud_participant_number": "...", "property_name": "...", "street": "...", "city": "...", "state": "NC", "zip": "...", "total_units": 50, "year_built": 1985, "latitude": 35.22, "longitude": -80.84, "hud_contract_number": "...", "hud_contract_expiration_date": "2027-12-31" } ]'
              spellCheck={false}
              style={{ width:'100%', minHeight:220, padding:'10px', fontSize:12, fontFamily:'JetBrains Mono, monospace', border:`1px solid ${C.border}`, borderRadius:6, background:C.page, color:C.textPrimary, resize:'vertical' }}
            />
          </div>

          {error && (
            <div style={{ padding:'10px 12px', background:'#fde8e8', color:'#a32626', fontSize:12, borderRadius:6, marginBottom:12, whiteSpace:'pre-wrap' }}>
              {error}
            </div>
          )}

          {summary && (
            <div style={{ padding:'12px 14px', background:'#e8f8f2', color:'#1a7a4e', fontSize:12.5, borderRadius:6, marginBottom:12 }}>
              <div style={{ fontWeight:600, marginBottom:6 }}>Batch {summary.batch_record_no || summary.batch_id} completed.</div>
              <div>Total {summary.records_total} · Created {summary.records_created} · Updated {summary.records_updated} · Skipped {summary.records_skipped} · Errored {summary.records_errored}</div>
              <div style={{ marginTop:4 }}>Accounts created {summary.accounts_created} · Accounts matched {summary.accounts_matched}</div>
              {Array.isArray(summary.errors) && summary.errors.length > 0 && (
                <details style={{ marginTop:8 }}>
                  <summary style={{ cursor:'pointer', fontWeight:600 }}>{summary.errors.length} error{summary.errors.length===1?'':'s'} — show details</summary>
                  <pre style={{ fontSize:10.5, fontFamily:'JetBrains Mono, monospace', marginTop:6, whiteSpace:'pre-wrap', maxHeight:180, overflow:'auto' }}>{JSON.stringify(summary.errors, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
        </div>

        <div style={{ padding:'12px 18px', borderTop:`1px solid ${C.border}`, display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose}
            style={{ padding:'8px 14px', fontSize:12.5, fontWeight:500, background:C.page, border:`1px solid ${C.border}`, borderRadius:6, color:C.textSecondary, cursor:'pointer' }}>
            Close
          </button>
          <button onClick={handleRun} disabled={working || !jsonText.trim()}
            style={{ padding:'8px 16px', fontSize:12.5, fontWeight:600, background: (working || !jsonText.trim()) ? C.border : '#3ecf8e', border:'none', borderRadius:6, color:'#fff', cursor: (working || !jsonText.trim()) ? 'not-allowed' : 'pointer' }}>
            {working ? 'Importing…' : 'Run Import'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ImportsSection({ batches, loading, error, onRefresh, onRetry, onOpenImport, onOpenImportModal }) {
  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onRetry} />
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', padding:'10px 20px 0', gap:8 }}>
        <button onClick={onOpenImportModal}
          style={{
            display:'flex', alignItems:'center', gap:6,
            background:'#3ecf8e', border:`1px solid #2aab72`, borderRadius:6,
            padding:'6px 14px', fontSize:12.5, color:'#fff',
            cursor:'pointer', fontWeight:600,
          }}>
          <Icon path="M12 4v16m8-8H4" size={13} color="#fff" />
          New Import
        </button>
      </div>
      <div style={{ flex:1, overflow:'hidden' }}>
        <ListView
          data={batches}
          columns={IMPORT_COLS}
          systemViews={IMPORT_VIEWS}
          defaultViewId="IMV-01"
          newLabel={null}
          onNew={null}
          onOpenRecord={onOpenImport}
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
  const [batches, setBatches]       = useState([])
  const [counts, setCounts]         = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [showImportModal, setShowImportModal] = useState(false)

  const loadAll = async () => {
    setError(null)
    try {
      const [props, c, b] = await Promise.all([
        fetchProspectingProperties(),
        fetchProspectingCounts(),
        fetchImportBatches(),
      ])
      setProperties(props)
      setCounts(c)
      setBatches(b)
    } catch (err) {
      setError(err)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([fetchProspectingProperties(), fetchProspectingCounts(), fetchImportBatches()])
      .then(([props, c, b]) => { if (!cancelled) { setProperties(props); setCounts(c); setBatches(b) } })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const openProperty = (row) => {
    if (row?._id) setSelectedRecord({ table: 'properties', id: row._id, name: row.name })
  }
  const openImport = (row) => {
    if (row?._id) setSelectedRecord({ table: 'property_import_batches', id: row._id, name: row.name })
  }
  const openPropertyById = (id) => {
    if (id) setSelectedRecord({ table: 'properties', id, name: '' })
  }

  const counts4Tabs = { properties: properties.length, imports: batches.length }

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
            {sec === 'map'        && <MapSection loading={loading} error={error} properties={properties} onRetry={loadAll} onOpenProperty={openPropertyById} />}
            {sec === 'imports'    && <ImportsSection batches={batches} loading={loading} error={error} onRefresh={loadAll} onRetry={loadAll} onOpenImport={openImport} onOpenImportModal={() => setShowImportModal(true)} />}
          </>
        )}
      </div>

      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onSubmitted={async () => { await loadAll() }}
        />
      )}
    </div>
  )
}
