import { useState, useEffect, useMemo } from 'react'
import { C } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import HelpIcon from '../components/help/HelpIcon'
import { ProspectingMap } from '../components/ProspectingMap'
import ProspectingFilterPanel, {
  EMPTY_FILTERS,
  applyFilters,
} from '../components/ProspectingFilterPanel'
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

// Display columns for the Prospecting Properties list.
// `columnName` indicates the DB column on the `properties` table that
// the EditableListView should write to when the cell is edited. Cells
// where `columnName` is omitted (or points to a column on a joined
// table like property_source_data) are read-only — the editor service
// only writes to columns on `tableName`, which is `properties` here.
const PROP_COLS = [
  { field:'id',                          label:'Record #',            type:'text',   sortable:true,  filterable:false, editable:false },
  { field:'name',                        label:'Property',            type:'text',   sortable:true,  filterable:true,  columnName:'property_name'         },
  { field:'hudPropertyId',               label:'HUD Property ID',     type:'text',   sortable:true,  filterable:true,  columnName:'property_hud_property_id' },
  { field:'lihtcProjectId',              label:'LIHTC Project ID',    type:'text',   sortable:true,  filterable:true,  columnName:'property_lihtc_project_id' },
  { field:'account',                     label:'Account',             type:'text',   sortable:true,  filterable:true,  columnName:'property_account_id'   },
  { field:'accountHudParticipantNumber', label:'HUD Participant #',   type:'text',   sortable:true,  filterable:true,  editable:false },  // lives on accounts, not properties
  { field:'state',                       label:'State',               type:'select', sortable:true,  filterable:true,  columnName:'property_state',
    options:['WI','NC','CO','MI','IN','TX','GA'] },
  { field:'units',                       label:'Units',               type:'number', sortable:true,  filterable:true,  columnName:'property_total_units' },
  { field:'buildings',                   label:'Buildings',           type:'number', sortable:true,  filterable:true,  columnName:'property_total_buildings' },
  { field:'yearBuilt',                   label:'Year Built',          type:'number', sortable:true,  filterable:true,  columnName:'property_year_built'  },
  { field:'subsidyType',                 label:'Subsidy Type',        type:'text',   sortable:true,  filterable:true,  editable:false },  // on property_source_data
  { field:'hudContractNumber',           label:'HUD Contract #',      type:'text',   sortable:true,  filterable:true,  editable:false },
  { field:'contractExpiration',          label:'Contract Expiration', type:'date',   sortable:true,  filterable:true,  editable:false },
  { field:'energyBurden',                label:'Energy Burden',       type:'number', sortable:true,  filterable:true,  editable:false },
  { field:'hasDisasterExposure',         label:'Disaster Exposure',   type:'select', sortable:true,  filterable:true,  editable:false,
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
          tableName="properties"
          data={properties}
          columns={PROP_COLS}
          systemViews={PROP_VIEWS}
          defaultViewId="PV-01"
          newLabel={null}
          onNew={null}
          onOpenRecord={onOpenRecord}
          onRefresh={onRefresh}
          onRecordsUpdated={onRefresh}
        />
      </div>
    </div>
  )
}

function MapSection({ loading, error, properties, onRetry, onOpenProperty }) {
  // Filter state lives at the MapSection level so it can drive the
  // filter panel, the map markers, and the viewport list in lockstep.
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, states: new Set() }))
  const updateFilter = (key, value) => setFilters(f => ({ ...f, [key]: value }))
  const resetFilters = () => setFilters({ ...EMPTY_FILTERS, states: new Set() })

  // Bounds of the current map viewport. Null until the first
  // moveend fires (or the map auto-fits on first render).
  const [bounds, setBounds] = useState(null)

  // Filter rail visibility — on desktop the rail is always shown,
  // on tablet/mobile (≤900px) it's hidden by default and toggled
  // via the floating Filters button.
  const isNarrow = useIsTabletOrSmaller()
  const [railOpen, setRailOpen] = useState(false)
  const railVisible = !isNarrow || railOpen

  // Pipeline:
  //   allProperties  → applyFilters → filteredByCriteria
  //                                  → restrict to map bounds → viewport list
  // The map gets `filteredByCriteria` so panning doesn't lose pins
  // that just slid off-screen; the list gets the bounds-restricted
  // subset so it shows only what the user is actually looking at.
  const filteredByCriteria = useMemo(
    () => applyFilters(properties || [], filters),
    [properties, filters]
  )

  const visibleInViewport = useMemo(() => {
    if (!bounds) return filteredByCriteria
    return filteredByCriteria.filter(p => {
      if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return false
      return p.latitude  >= bounds.south && p.latitude  <= bounds.north
          && p.longitude >= bounds.west  && p.longitude <= bounds.east
    })
  }, [filteredByCriteria, bounds])

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onRetry} />

  const activeCount = countActiveFiltersLocal(filters)

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'row', overflow:'hidden', position:'relative' }}>
      {/* Filter rail */}
      {railVisible && (
        <div style={{
          width: isNarrow ? '100%' : 280,
          maxWidth: isNarrow ? 320 : 280,
          minWidth: isNarrow ? undefined : 280,
          height: '100%', overflow:'hidden',
          display:'flex', flexDirection:'column',
          background: C.card, borderRight:`1px solid ${C.border}`,
          position: isNarrow ? 'absolute' : 'relative',
          left: 0, top: 0, bottom: 0, zIndex: isNarrow ? 100 : 1,
          boxShadow: isNarrow ? '0 6px 24px rgba(7,17,31,0.18)' : 'none',
        }}>
          {isNarrow && (
            <div style={{
              padding:'10px 14px', borderBottom:`1px solid ${C.border}`,
              display:'flex', alignItems:'center', justifyContent:'space-between',
              background: C.cardSecondary || '#f7f9fc',
            }}>
              <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Filters</div>
              <button onClick={() => setRailOpen(false)}
                style={{ background:'transparent', border:'none', cursor:'pointer', padding:4 }}>
                <Icon path="M18 6L6 18M6 6l12 12" size={15} color={C.textSecondary} />
              </button>
            </div>
          )}
          <ProspectingFilterPanel
            allProperties={properties || []}
            filters={filters}
            updateFilter={updateFilter}
            resetFilters={resetFilters}
            visibleCount={filteredByCriteria.length}
            totalCount={(properties || []).length}
          />
        </div>
      )}

      {/* Backdrop for mobile rail */}
      {isNarrow && railOpen && (
        <div onClick={() => setRailOpen(false)}
          style={{ position:'absolute', inset:0, background:'rgba(7,17,31,0.4)', zIndex:90 }} />
      )}

      {/* Map + viewport-list right pane */}
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', overflow:'hidden', position:'relative' }}>
        {isNarrow && (
          <button onClick={() => setRailOpen(true)}
            style={{
              position:'absolute', top:10, left:10, zIndex:80,
              display:'flex', alignItems:'center', gap:6,
              padding:'7px 12px', fontSize:12, fontWeight:600,
              background:C.card, color:C.textPrimary,
              border:`1px solid ${C.border}`, borderRadius:6,
              boxShadow:'0 2px 6px rgba(7,17,31,0.12)', cursor:'pointer',
            }}>
            <Icon path="M3 4h18M6 12h12M10 20h4" size={13} color={C.textPrimary} />
            Filters
            {activeCount > 0 && (
              <span style={{ background:'#3ecf8e', color:'#fff', borderRadius:10, padding:'1px 7px', fontSize:10, fontWeight:700 }}>{activeCount}</span>
            )}
          </button>
        )}
        <div style={{ flex:'1 1 60%', minHeight:240, display:'flex', flexDirection:'column' }}>
          <ProspectingMap
            properties={filteredByCriteria}
            onOpenProperty={onOpenProperty}
            onBoundsChange={setBounds}
          />
        </div>

        {/* Viewport list — bottom 40% of the right pane */}
        <div style={{
          flex:'1 1 40%', minHeight:160,
          borderTop:`1px solid ${C.border}`,
          background:C.card,
          display:'flex', flexDirection:'column',
        }}>
          <div style={{
            padding:'8px 14px',
            borderBottom:`1px solid ${C.border}`,
            display:'flex', alignItems:'center', justifyContent:'space-between',
            background:C.cardSecondary || '#f7f9fc',
          }}>
            <div style={{ fontSize:12, color:C.textSecondary }}>
              <span style={{ fontWeight:700, color:C.textPrimary }}>
                {visibleInViewport.length.toLocaleString()}
              </span>
              {' in current view'}
              {bounds && filteredByCriteria.length !== visibleInViewport.length && (
                <span style={{ color:C.textMuted, marginLeft:8 }}>
                  ({filteredByCriteria.length.toLocaleString()} match filters total)
                </span>
              )}
            </div>
          </div>
          <ViewportPropertyList
            rows={visibleInViewport}
            onOpenProperty={onOpenProperty}
          />
        </div>
      </div>
    </div>
  )
}

// Local helper: tablet+phone breakpoint reuse from useMediaQuery.
function useIsTabletOrSmaller() {
  const [match, setMatch] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 900px)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 900px)')
    const handler = (e) => setMatch(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return match
}

// Avoid pulling countActiveFilters as a circular import via the panel;
// recompute it here for the toggle-button badge. (Same logic — kept
// in sync manually since both copies are short.)
function countActiveFiltersLocal(f) {
  let n = 0
  if (f.search && f.search.trim()) n++
  if (f.states?.size > 0) n++
  if (f.county !== 'all') n++
  if (f.account !== 'all') n++
  if (f.subsidyType !== 'all') n++
  if (f.unitsMin != null) n++
  if (f.unitsMax != null) n++
  if (f.hasDisaster !== 'all') n++
  if (f.contractExpiringWithin !== 'all') n++
  if (f.energyBurdenMin != null) n++
  if (f.showEngaged) n++
  return n
}

function ViewportPropertyList({ rows, onOpenProperty }) {
  if (rows.length === 0) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:C.textMuted, fontSize:12.5 }}>
        No properties in the current view. Pan or zoom out to see more.
      </div>
    )
  }
  // Cap rendering at 500 rows for performance — at zoom levels that
  // would show more than 500 markers, the user shouldn't be reading
  // a flat list anyway.
  const shown = rows.slice(0, 500)
  return (
    <div style={{ flex:1, overflowY:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead style={{ position:'sticky', top:0, background:C.card, zIndex:1 }}>
          <tr style={{ borderBottom:`1px solid ${C.border}`, color:C.textMuted, fontSize:10.5, textTransform:'uppercase', letterSpacing:0.5 }}>
            <th style={{ textAlign:'left', padding:'8px 14px', fontWeight:600 }}>Property</th>
            <th style={{ textAlign:'left', padding:'8px 8px',  fontWeight:600 }}>City</th>
            <th style={{ textAlign:'left', padding:'8px 8px',  fontWeight:600 }}>State</th>
            <th style={{ textAlign:'right',padding:'8px 8px',  fontWeight:600 }}>Units</th>
            <th style={{ textAlign:'left', padding:'8px 14px', fontWeight:600 }}>Account</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(r => (
            <tr key={r._id}
                onClick={() => onOpenProperty?.(r._id)}
                style={{ cursor:'pointer', borderBottom:`1px solid ${C.border}`, transition:'background 80ms' }}
                onMouseEnter={(e) => e.currentTarget.style.background = C.cardSecondary || '#f7f9fc'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <td style={{ padding:'7px 14px', color:C.textPrimary, fontWeight:500 }}>{r.name || '—'}</td>
              <td style={{ padding:'7px 8px',  color:C.textSecondary }}>{(r.address || '').split(',')[1]?.trim() || (r.address || '').split(',')[0] || '—'}</td>
              <td style={{ padding:'7px 8px',  color:C.textSecondary }}>{r.state || '—'}</td>
              <td style={{ padding:'7px 8px',  color:C.textSecondary, textAlign:'right', fontFamily:'JetBrains Mono, monospace' }}>{r.units ?? '—'}</td>
              <td style={{ padding:'7px 14px', color:C.textSecondary, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:240 }}>{r.account || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 500 && (
        <div style={{ padding:'8px 14px', fontSize:11, color:C.textMuted, fontStyle:'italic', borderTop:`1px solid ${C.border}` }}>
          Showing the first 500 of {rows.length.toLocaleString()}. Zoom in or refine filters to narrow.
        </div>
      )}
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
  // Per-dataset loading flags. Before this change all three lived under a
  // single `loading` boolean wired to Promise.all([...]), which meant the
  // fast HEAD count query (~30ms) and the fast batches fetch (~200ms) both
  // stayed gated behind the slow paginated property load (~40s for 6,800
  // rows over 7 sequential PostgREST round-trips). Decoupling means counts
  // and batches paint immediately — the Home dashboard and tab badges are
  // accurate the moment auth resolves rather than 40 seconds later.
  const [loadingCounts,     setLoadingCounts]     = useState(true)
  const [loadingProperties, setLoadingProperties] = useState(true)
  const [loadingBatches,    setLoadingBatches]    = useState(true)
  // Aggregate flag is true while ANY fetch is still in flight — used only
  // by sections that render a single combined spinner (Map). Granular
  // flags are preferred where the section knows which dataset it needs.
  const loading = loadingCounts || loadingProperties || loadingBatches
  const [error, setError]           = useState(null)
  const [showImportModal, setShowImportModal] = useState(false)

  // Independent loader. Each dataset writes its own state slice as soon
  // as its fetch resolves; the slow one no longer holds the fast ones.
  // A single `cancelled` ref guards all three against late writes after
  // the component unmounts.
  const loadAll = async () => {
    setError(null)
    setLoadingCounts(true); setLoadingProperties(true); setLoadingBatches(true)

    // Counts: a pair of HEAD queries, ~30ms each. Lights up the Home
    // dashboard and the section-tab badges immediately.
    fetchProspectingCounts()
      .then(setCounts)
      .catch(err => setError(prev => prev || err))
      .finally(() => setLoadingCounts(false))

    // Import batches: single paginated read, currently 40 rows. Fast.
    fetchImportBatches()
      .then(setBatches)
      .catch(err => setError(prev => prev || err))
      .finally(() => setLoadingBatches(false))

    // Properties: 6,800+ rows paginated 1,000 at a time. Slow today;
    // a separate change will fetch this lazily on Properties/Map open
    // and / or widen the page size. Until then it runs in the
    // background while counts + batches are already visible.
    fetchProspectingProperties()
      .then(setProperties)
      .catch(err => setError(prev => prev || err))
      .finally(() => setLoadingProperties(false))
  }

  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoadingCounts(true); setLoadingProperties(true); setLoadingBatches(true)

    fetchProspectingCounts()
      .then(c    => { if (!cancelled) setCounts(c) })
      .catch(err => { if (!cancelled) setError(prev => prev || err) })
      .finally(() => { if (!cancelled) setLoadingCounts(false) })

    fetchImportBatches()
      .then(b    => { if (!cancelled) setBatches(b) })
      .catch(err => { if (!cancelled) setError(prev => prev || err) })
      .finally(() => { if (!cancelled) setLoadingBatches(false) })

    fetchProspectingProperties()
      .then(p    => { if (!cancelled) setProperties(p) })
      .catch(err => { if (!cancelled) setError(prev => prev || err) })
      .finally(() => { if (!cancelled) setLoadingProperties(false) })

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

  // Tab-badge counts: prefer the HEAD-query counts (instant on load)
  // over the paginated list lengths (which stay at 0 for ~40 seconds
  // while properties paginate). Once the lists arrive they take over
  // as the source of truth — they're filtered identically to the
  // HEAD query so the numbers always match.
  const propertiesBadge = loadingProperties
    ? (counts?.propertiesWithoutOpportunity ?? null)
    : properties.length
  const importsBadge = loadingBatches
    ? (counts?.importBatches ?? null)
    : batches.length
  const counts4Tabs = { properties: propertiesBadge, imports: importsBadge }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div data-module-topbar="1" style={{ height: 54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Prospecting</span><span style={{ color:C.textMuted }}>/</span>
          <span style={{ color:C.textPrimary, fontWeight:500 }}>{SECTIONS.find(s => s.id===sec)?.label}</span>
          {/* Per-section help: anchored to the route the current section
             lives at. Falls back to the module overview when the user is
             on home. */}
          <HelpIcon
            anchors={[
              { type:'route', route:`/m/prospecting/${sec}` },
              { type:'route', route:'/m/prospecting' },
              { type:'concept', concept:'prospecting' },
            ]}
            title={`Prospecting — ${SECTIONS.find(s => s.id===sec)?.label || ''}`}
          />
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
            {sec === 'home'       && <ProspectingHome counts={counts} loading={loadingCounts} />}
            {sec === 'properties' && <PropertiesListSection loading={loadingProperties} error={error} properties={properties} onRefresh={loadAll} onRetry={loadAll} onOpenRecord={openProperty} />}
            {sec === 'map'        && <MapSection loading={loadingProperties} error={error} properties={properties} onRetry={loadAll} onOpenProperty={openPropertyById} />}
            {sec === 'imports'    && <ImportsSection batches={batches} loading={loadingBatches} error={error} onRefresh={loadAll} onRetry={loadAll} onOpenImport={openImport} onOpenImportModal={() => setShowImportModal(true)} />}
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
