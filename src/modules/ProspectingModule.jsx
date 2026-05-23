import { useState } from 'react'
import { C } from '../data/constants'
import { Icon, SectionTabs } from '../components/UI'
import RecordDetail from '../components/RecordDetail'

/**
 * Prospecting Module
 *
 * Top-of-funnel surface for properties not yet under active engagement.
 * Data lives in the unified `public.properties` table; this module is a
 * filtered lens — properties with NO active opportunity, plus extension
 * data from `property_source_data` (HUD/LIHTC/DOE LEAD) and
 * `property_disaster_exposure` (FEMA, NC properties only).
 *
 * v0 scaffold: route, sidebar entry, section tabs, empty placeholder home.
 * Next session: bulk-import flow + Properties list view + map view.
 */

const SECTIONS = [
  { id: 'home',       label: 'Home'       },
  { id: 'properties', label: 'Properties' },
  { id: 'map',        label: 'Map'        },
  { id: 'imports',    label: 'Imports'    },
]

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

function ProspectingHome() {
  return (
    <div style={{ flex:1, overflow:'auto', padding:'20px 20px 24px' }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:11, color:C.textMuted, marginBottom:2 }}>Prospecting / Home</div>
        <h1 style={{ fontSize:20, fontWeight:700, color:C.textPrimary, margin:0 }}>Prospecting Dashboard</h1>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>Top-of-funnel properties — not yet under active engagement.</div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12, marginBottom:20 }}>
        {[
          { label: 'Properties without an active Opportunity', value: '—' },
          { label: 'Imported this month',                       value: '—' },
          { label: 'Accounts created from imports',             value: '—' },
          { label: 'Active import batches',                     value: '—' },
        ].map(s => (
          <div key={s.label} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 16px' }}>
            <div style={{ fontSize:11, color:C.textMuted, marginBottom:6 }}>{s.label}</div>
            <div style={{ fontSize:24, fontWeight:700, color:C.textPrimary, fontFamily:'JetBrains Mono, monospace' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'20px 22px' }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:6 }}>Module under construction</div>
        <div style={{ fontSize:12, color:C.textSecondary, lineHeight:1.6 }}>
          Schema is in place. The Properties list view, map view, and bulk-import flow ship in the
          following build steps. HUD identifiers (<span style={{ fontFamily:'JetBrains Mono, monospace' }}>account_hud_participant_number</span>,
          <span style={{ fontFamily:'JetBrains Mono, monospace' }}> property_hud_property_id</span>,
          <span style={{ fontFamily:'JetBrains Mono, monospace' }}> property_lihtc_project_id</span>) are unique and indexed.
          Extension tables <span style={{ fontFamily:'JetBrains Mono, monospace' }}>property_source_data</span> and
          <span style={{ fontFamily:'JetBrains Mono, monospace' }}> property_disaster_exposure</span> are ready to receive ingested rows.
        </div>
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

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div data-module-topbar="1" style={{ height: 54, background:C.card, borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <span style={{ color:C.textMuted }}>Prospecting</span><span style={{ color:C.textMuted }}>/</span>
          <span style={{ color:C.textPrimary, fontWeight:500 }}>{SECTIONS.find(s => s.id===sec)?.label}</span>
        </div>
      </div>

      <SectionTabs sections={SECTIONS} active={sec} onChange={s => { setSec(s); closeRecord(); }} />

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
            {sec === 'home'       && <ProspectingHome />}
            {sec === 'properties' && <ComingSoon title="Properties list — coming next" body="Filterable, sortable table of properties without an active opportunity. Includes HUD identifiers, owner account, unit count, contract expiration, energy burden, and disaster exposure (NC only)." />}
            {sec === 'map'        && <ComingSoon title="Map view — coming next" body="Map of properties without an active opportunity. Pins clustered at zoom-out, filterable by state, owner account, subsidy type, and contract expiration window." />}
            {sec === 'imports'    && <ComingSoon title="Import batches — coming next" body="HUD Active Portfolio, HUD LIHTC, HUD Multifamily Contracts, and DOE LEAD imports. Each batch tracked with created / updated / skipped / errored counts and a downloadable error report." />}
          </>
        )}
      </div>
    </div>
  )
}
