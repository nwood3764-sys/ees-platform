// DispatchFilterRail — left-side resource picker for the Dispatch Console.
//
// Filters the list of Team Lead lanes by:
//   - free-text name search
//   - crew (multi-select from parsed crew labels)
//   - service territory (multi-select from service_territories)
//   - certifications held (multi-select from active certifications;
//     a lead matches when they hold ALL selected certifications, unexpired)
//   - "Available only" toggle — hides leads with a resource absence that
//     spans the entire visible board range (start..end), so the dispatcher
//     can ignore people who are out the whole window
//
// Filters are purely client-side over the lead list that DispatchModule
// already fetched + absence list. Returns the filter state + a derived
// `filterLane(lane)` predicate the parent applies when rendering lanes.

import { useMemo, useState } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../UI'

// ─── Multi-select pill picker (small, no library) ────────────────────────
function MultiPick({ label, options, selectedIds, onChange, emptyHint }) {
  const [open, setOpen] = useState(false)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const summary = selectedIds.length === 0
    ? 'Any'
    : selectedIds.length === 1
      ? options.find(o => o.id === selectedIds[0])?.name || '1 selected'
      : `${selectedIds.length} selected`

  const toggle = (id) => {
    const next = selectedSet.has(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id]
    onChange(next)
  }
  const clear = () => onChange([])

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={fieldLabelRow}>
        <span style={fieldLabelStyle}>{label}</span>
        {selectedIds.length > 0 && (
          <button onClick={clear} style={clearBtn} title="Clear filter">clear</button>
        )}
      </div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          ...pickerToggle,
          color: selectedIds.length > 0 ? C.textPrimary : C.textSecondary,
          borderColor: open ? C.emerald : C.border,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        <Icon path={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} size={13} color={C.textMuted} />
      </button>
      {open && (
        <div style={pickerPanel}>
          {options.length === 0 ? (
            <div style={{ padding: 8, fontSize: 11.5, color: C.textMuted, fontStyle: 'italic' }}>
              {emptyHint || 'No options'}
            </div>
          ) : (
            options.map(o => (
              <label key={o.id} style={pickerRow}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(o.id)}
                  onChange={() => toggle(o.id)}
                  style={{ margin: 0 }}
                />
                <span style={{ fontSize: 12.5, color: C.textPrimary }}>{o.name}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function DispatchFilterRail({
  // State
  search, onSearchChange,
  selectedCrews, onCrewsChange,
  selectedTerritoryIds, onTerritoryIdsChange,
  selectedCertIds, onCertIdsChange,
  availableOnly, onAvailableOnlyChange,
  // Reference data
  crewOptions,          // [{id, name}]
  territoryOptions,     // [{id, name}]
  certificationOptions, // [{id, name}]
  // Display
  visibleLaneCount,
  totalLaneCount,
  collapsed,
  onToggleCollapsed,
}) {
  if (collapsed) {
    return (
      <div style={collapsedRail}>
        <button
          onClick={onToggleCollapsed}
          aria-label="Show filters"
          title="Show resource filters"
          style={collapseToggleBtn}
        >
          {/* lucide: filter */}
          <Icon path="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" size={15} color={C.textSecondary} />
        </button>
      </div>
    )
  }

  const activeFilterCount =
    (search ? 1 : 0) +
    selectedCrews.length +
    selectedTerritoryIds.length +
    selectedCertIds.length +
    (availableOnly ? 1 : 0)

  return (
    <div style={rail}>
      {/* Header */}
      <div style={railHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon path="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" size={14} color={C.textSecondary} />
          <span style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Resources
          </span>
          {activeFilterCount > 0 && (
            <span style={{
              fontSize: 10.5, fontWeight: 600, color: C.emerald,
              background: '#ecfdf5', border: `1px solid #a7f3d0`,
              padding: '1px 6px', borderRadius: 8,
            }}>
              {activeFilterCount}
            </span>
          )}
        </div>
        <button
          onClick={onToggleCollapsed}
          aria-label="Collapse filters"
          title="Collapse filter rail"
          style={collapseToggleBtn}
        >
          <Icon path="M15 18l-6-6 6-6" size={13} color={C.textMuted} />
        </button>
      </div>

      {/* Body */}
      <div style={railBody}>
        <div style={{ marginBottom: 10 }}>
          <div style={fieldLabelRow}>
            <span style={fieldLabelStyle}>Name</span>
            {search && (
              <button onClick={() => onSearchChange('')} style={clearBtn} title="Clear search">clear</button>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="Search Team Leads…"
              style={searchInput}
            />
            <div style={{ position: 'absolute', top: 7, left: 8, pointerEvents: 'none' }}>
              <Icon path="M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" size={13} color={C.textMuted} />
            </div>
          </div>
        </div>

        <MultiPick
          label="Crew"
          options={crewOptions}
          selectedIds={selectedCrews}
          onChange={onCrewsChange}
          emptyHint="No crew labels found"
        />
        <MultiPick
          label="Service Territory"
          options={territoryOptions}
          selectedIds={selectedTerritoryIds}
          onChange={onTerritoryIdsChange}
          emptyHint="No active territories"
        />
        <MultiPick
          label="Certifications held"
          options={certificationOptions}
          selectedIds={selectedCertIds}
          onChange={onCertIdsChange}
          emptyHint="No active certifications"
        />

        <label style={toggleRow}>
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={e => onAvailableOnlyChange(e.target.checked)}
            style={{ margin: 0 }}
          />
          <span style={{ fontSize: 12.5, color: C.textPrimary }}>
            Available only
            <span style={{ display: 'block', fontSize: 10.5, color: C.textMuted, marginTop: 1 }}>
              Hide leads out of office the entire visible window
            </span>
          </span>
        </label>

        <div style={{
          marginTop: 12, padding: '8px 10px',
          background: C.page, border: `1px solid ${C.border}`, borderRadius: 5,
          fontSize: 11.5, color: C.textSecondary,
        }}>
          Showing <strong style={{ color: C.textPrimary }}>{visibleLaneCount}</strong> of{' '}
          <strong style={{ color: C.textPrimary }}>{totalLaneCount}</strong> Team Leads
        </div>
      </div>
    </div>
  )
}

// ─── Pure-function predicate the parent applies to lanes ────────────────
// laneInScope({ lane, search, crews, territoryIds, certIds, availableOnly, leadAbsences, viewStart, viewEnd })
//   → boolean. Exported so DispatchModule can derive the filtered lane list.
export function laneInScope({
  lane,
  search,
  selectedCrews,
  selectedTerritoryIds,
  selectedCertIds,
  availableOnly,
  leadAbsences,
  viewStart, viewEnd,
}) {
  if (search) {
    const q = search.toLowerCase()
    const hay = `${lane.full_name || ''} ${lane.crew_label || ''}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  if (selectedCrews.length > 0) {
    if (!lane.crew_label || !selectedCrews.includes(lane.crew_label)) return false
  }
  if (selectedTerritoryIds.length > 0) {
    if (!lane.service_territory_id || !selectedTerritoryIds.includes(lane.service_territory_id)) return false
  }
  if (selectedCertIds.length > 0) {
    const held = new Set(lane.certification_ids || [])
    for (const id of selectedCertIds) if (!held.has(id)) return false
  }
  if (availableOnly) {
    // Hide leads whose absences cover the entire [viewStart, viewEnd] range.
    // Coalesce overlapping absences to see if they fully cover the window.
    const myAbs = (leadAbsences || [])
      .filter(a => a.contact_id === lane.id)
      .map(a => ({ s: new Date(a.start_at), e: new Date(a.end_at) }))
      .sort((a, b) => a.s - b.s)
    if (myAbs.length > 0) {
      const vS = new Date(viewStart); vS.setHours(0,0,0,0)
      const vE = new Date(viewEnd);   vE.setHours(23,59,59,999)
      // Merge overlapping intervals
      const merged = []
      for (const a of myAbs) {
        const last = merged[merged.length - 1]
        if (last && a.s <= last.e) last.e = a.e > last.e ? a.e : last.e
        else merged.push({ s: a.s, e: a.e })
      }
      // Does a single merged interval cover [vS, vE]?
      const covers = merged.some(m => m.s <= vS && m.e >= vE)
      if (covers) return false
    }
  }
  return true
}

// ─── Styles ─────────────────────────────────────────────────────────────
const rail = {
  width: 240, flexShrink: 0,
  borderRight: `1px solid ${C.border}`, background: C.surface,
  display: 'flex', flexDirection: 'column',
  maxHeight: '100%',
}
const collapsedRail = {
  width: 36, flexShrink: 0,
  borderRight: `1px solid ${C.border}`, background: C.surface,
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  paddingTop: 8,
}
const railHeader = {
  padding: '10px 12px', borderBottom: `1px solid ${C.border}`,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}
const railBody = { padding: 12, overflowY: 'auto', flex: 1 }
const collapseToggleBtn = {
  background: 'transparent', border: 'none', padding: 4, borderRadius: 4,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const fieldLabelRow = {
  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4,
}
const fieldLabelStyle = {
  fontSize: 11, fontWeight: 600, color: C.textSecondary,
  textTransform: 'uppercase', letterSpacing: 0.4,
}
const clearBtn = {
  background: 'transparent', border: 'none', color: C.textMuted,
  fontSize: 10.5, cursor: 'pointer', padding: 0, textDecoration: 'underline',
}
const searchInput = {
  width: '100%', padding: '6px 8px 6px 26px', fontSize: 12.5,
  color: C.textPrimary, background: C.surface,
  border: `1px solid ${C.border}`, borderRadius: 5,
}
const pickerToggle = {
  width: '100%', padding: '6px 8px', fontSize: 12.5,
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
  cursor: 'pointer', textAlign: 'left',
}
const pickerPanel = {
  marginTop: 4, padding: '4px 0', border: `1px solid ${C.border}`, borderRadius: 5,
  background: C.surface, boxShadow: '0 4px 10px -4px rgba(15,23,42,0.10)',
  maxHeight: 180, overflowY: 'auto',
}
const pickerRow = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
  cursor: 'pointer',
}
const toggleRow = {
  display: 'flex', gap: 8, alignItems: 'flex-start',
  padding: '6px 8px', background: C.page, border: `1px solid ${C.border}`, borderRadius: 5,
  marginTop: 8, cursor: 'pointer',
}
