// DispatchUnscheduledPalette — right-side rail listing every Work Order in
// 'To Be Scheduled' status across all projects. Each row is HTML5-draggable
// onto a (lane × day) cell in the board to commit a schedule.
//
// Filters (client-side over the list DispatchModule fetched once):
//   - free-text search (matches WO #, work type, building, unit, property, project)
//   - service territory (multi-select; matches WO's territory or its building's)
//   - work type (multi-select)
//   - "Show duration-set only" toggle — hides WOs whose work type has no duration,
//     since the engine refuses to place them anyway

import { useMemo, useState } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../UI'

// Stable color (subset of DispatchModule.SA_COLORS) so the palette block
// previews the color the SA will use after scheduling.
const PALETTE_COLORS = [
  { bg: '#dbeafe', border: '#2563eb', text: '#1e40af' },
  { bg: '#d1fae5', border: '#059669', text: '#065f46' },
  { bg: '#ccfbf1', border: '#0d9488', text: '#115e59' },
  { bg: '#e0e7ff', border: '#4338ca', text: '#3730a3' },
  { bg: '#ede9fe', border: '#7c3aed', text: '#5b21b6' },
  { bg: '#cffafe', border: '#0891b2', text: '#155e75' },
  { bg: '#fae8ff', border: '#a21caf', text: '#86198f' },
  { bg: '#e0f2fe', border: '#0284c7', text: '#075985' },
]
function hashString(s) {
  let h = 0
  if (!s) return 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0 }
  return Math.abs(h)
}
function colorForWorkType(id) {
  return PALETTE_COLORS[hashString(String(id || '')) % PALETTE_COLORS.length]
}

export default function DispatchUnscheduledPalette({
  workOrders,           // [{id, record_number, name, duration_minutes, work_type, building, unit, project, service_territory_id, project_id}]
  territoryNamesById,   // Map<uuid, name>
  loading,
  onDragStartWO,        // (wo) => void — DispatchModule uses to track active drag
  onDragEndWO,          // () => void
  onClickWO,            // (wo) => void — open the WO record
  collapsed,
  onToggleCollapsed,
}) {
  const [search, setSearch] = useState('')
  const [territoryIds, setTerritoryIds] = useState([])
  const [workTypeIds, setWorkTypeIds] = useState([])
  const [durationSetOnly, setDurationSetOnly] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Derive distinct work_type and territory options from the loaded WO list
  const workTypeOptions = useMemo(() => {
    const map = new Map()
    for (const wo of workOrders) {
      if (wo.work_type?.id) map.set(wo.work_type.id, wo.work_type.name || '(unnamed)')
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [workOrders])

  const territoryOptions = useMemo(() => {
    const ids = new Set()
    for (const wo of workOrders) if (wo.service_territory_id) ids.add(wo.service_territory_id)
    return Array.from(ids)
      .map(id => ({ id, name: territoryNamesById.get(id) || '(territory)' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [workOrders, territoryNamesById])

  // Apply filters
  const filtered = useMemo(() => {
    return workOrders.filter(wo => {
      if (durationSetOnly && (!wo.duration_minutes || wo.duration_minutes <= 0)) return false
      if (territoryIds.length > 0) {
        if (!wo.service_territory_id || !territoryIds.includes(wo.service_territory_id)) return false
      }
      if (workTypeIds.length > 0) {
        if (!wo.work_type?.id || !workTypeIds.includes(wo.work_type.id)) return false
      }
      if (search) {
        const q = search.toLowerCase()
        const hay = [
          wo.record_number, wo.work_type?.name,
          wo.building?.name, wo.unit?.name, wo.building?.property_name,
          wo.project?.record_number, wo.project?.name,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [workOrders, search, territoryIds, workTypeIds, durationSetOnly])

  const activeFilterCount =
    (search ? 1 : 0) +
    territoryIds.length +
    workTypeIds.length +
    (durationSetOnly ? 0 : 1)  // default-on, only counts when off

  if (collapsed) {
    return (
      <div style={collapsedRail}>
        <button
          onClick={onToggleCollapsed}
          aria-label="Show unscheduled work orders"
          title={`Show unscheduled work orders (${workOrders.length})`}
          style={collapseToggleBtn}
        >
          {/* lucide: list-todo */}
          <Icon path="M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01" size={15} color={C.textSecondary} />
        </button>
        {workOrders.length > 0 && (
          <div style={{
            marginTop: 4, fontSize: 10, fontWeight: 600, color: C.emerald,
            background: '#ecfdf5', border: `1px solid #a7f3d0`,
            padding: '1px 5px', borderRadius: 8,
          }}>
            {workOrders.length}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={rail}>
      {/* Header */}
      <div style={railHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon path="M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01" size={14} color={C.textSecondary} />
          <span style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Unscheduled
          </span>
          <span style={{
            fontSize: 10.5, fontWeight: 600, color: C.emerald,
            background: '#ecfdf5', border: `1px solid #a7f3d0`,
            padding: '1px 6px', borderRadius: 8,
          }}>
            {filtered.length}{filtered.length !== workOrders.length ? `/${workOrders.length}` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setFiltersOpen(o => !o)}
            aria-label="Toggle filters"
            title="Toggle filters"
            style={{
              ...collapseToggleBtn,
              background: filtersOpen ? '#eff6ff' : 'transparent',
            }}
          >
            <Icon path="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" size={13} color={filtersOpen ? '#2563eb' : C.textMuted} />
            {activeFilterCount > 0 && (
              <span style={{
                marginLeft: 3, fontSize: 9.5, fontWeight: 700, color: '#2563eb',
              }}>
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            onClick={onToggleCollapsed}
            aria-label="Collapse palette"
            title="Collapse"
            style={collapseToggleBtn}
          >
            <Icon path="M9 18l6-6-6-6" size={13} color={C.textMuted} />
          </button>
        </div>
      </div>

      {/* Filters (collapsible) */}
      {filtersOpen && (
        <div style={{ padding: 10, borderBottom: `1px solid ${C.border}`, background: C.page }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search WO #, work type, property…"
            style={{ ...searchInput, marginBottom: 8 }}
          />
          <MiniPick label="Service Territory" options={territoryOptions} selectedIds={territoryIds} onChange={setTerritoryIds} />
          <MiniPick label="Work Type" options={workTypeOptions} selectedIds={workTypeIds} onChange={setWorkTypeIds} />
          <label style={toggleRow}>
            <input
              type="checkbox"
              checked={durationSetOnly}
              onChange={e => setDurationSetOnly(e.target.checked)}
              style={{ margin: 0 }}
            />
            <span style={{ fontSize: 11.5, color: C.textPrimary }}>Hide WOs without duration</span>
          </label>
        </div>
      )}

      {/* Body */}
      <div style={railBody}>
        {loading && (
          <div style={{ padding: 10, color: C.textSecondary, fontSize: 12 }}>Loading…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 14, fontSize: 12, color: C.textSecondary, textAlign: 'center' }}>
            {workOrders.length === 0
              ? 'No unscheduled work orders.'
              : 'No work orders match the current filters.'}
          </div>
        )}
        {!loading && filtered.map(wo => {
          const color = colorForWorkType(wo.work_type?.id)
          const cantSchedule = !wo.duration_minutes || wo.duration_minutes <= 0
          const subtitle = [
            wo.building?.name,
            wo.unit?.name,
          ].filter(Boolean).join(' / ')
          return (
            <div
              key={wo.id}
              draggable={!cantSchedule}
              onDragStart={cantSchedule ? undefined : (e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('application/x-ees-dispatch-payload', JSON.stringify({
                  type: 'unscheduled_wo',
                  wo_id: wo.id,
                  project_id: wo.project_id,
                  duration_minutes: wo.duration_minutes,
                }))
                onDragStartWO?.(wo)
              }}
              onDragEnd={() => onDragEndWO?.()}
              onClick={() => onClickWO?.(wo)}
              title={cantSchedule
                ? `${wo.record_number} — cannot schedule: duration not set on work type`
                : `${wo.record_number} — drag onto a lane to schedule`}
              style={{
                display: 'block', marginBottom: 6,
                padding: '7px 9px',
                background: color.bg,
                border: `1px solid ${color.border}`,
                borderLeft: `4px solid ${color.border}`,
                borderRadius: 5,
                color: color.text,
                cursor: cantSchedule ? 'not-allowed' : 'grab',
                opacity: cantSchedule ? 0.55 : 1,
                fontSize: 11.5, lineHeight: 1.3,
              }}
              onMouseDown={(e) => { if (!cantSchedule) e.currentTarget.style.cursor = 'grabbing' }}
              onMouseUp={(e) => { if (!cantSchedule) e.currentTarget.style.cursor = 'grab' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 11 }}>
                  {wo.record_number}
                </span>
                <span style={{ fontSize: 10, color: color.text, opacity: 0.75 }}>
                  {wo.duration_minutes ? `${wo.duration_minutes} min` : 'no dur.'}
                </span>
              </div>
              <div style={{ fontWeight: 600, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {wo.work_type?.name || '(unknown work type)'}
              </div>
              {subtitle && (
                <div style={{ marginTop: 1, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {subtitle}
                </div>
              )}
              {wo.building?.property_name && (
                <div style={{ marginTop: 1, opacity: 0.75, fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {wo.building.property_name}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Mini multi-pick (no popover — inline checkbox list) ─────────────────
function MiniPick({ label, options, selectedIds, onChange }) {
  const [open, setOpen] = useState(false)
  if (options.length === 0) return null
  const summary = selectedIds.length === 0
    ? 'Any'
    : selectedIds.length === 1
      ? options.find(o => o.id === selectedIds[0])?.name || '1 selected'
      : `${selectedIds.length} selected`
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 3 }}>
        {label}
      </div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ ...pickerToggle, padding: '5px 8px' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        <Icon path={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} size={12} color={C.textMuted} />
      </button>
      {open && (
        <div style={{ marginTop: 4, padding: '4px 0', border: `1px solid ${C.border}`, borderRadius: 5, background: C.surface, maxHeight: 140, overflowY: 'auto' }}>
          {options.map(o => (
            <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selectedIds.includes(o.id)}
                onChange={() => onChange(selectedIds.includes(o.id)
                  ? selectedIds.filter(x => x !== o.id)
                  : [...selectedIds, o.id])}
                style={{ margin: 0 }}
              />
              <span style={{ fontSize: 12, color: C.textPrimary }}>{o.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────
const rail = {
  width: 260, flexShrink: 0,
  borderLeft: `1px solid ${C.border}`, background: C.surface,
  display: 'flex', flexDirection: 'column',
  maxHeight: '100%',
}
const collapsedRail = {
  width: 36, flexShrink: 0,
  borderLeft: `1px solid ${C.border}`, background: C.surface,
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  paddingTop: 8,
}
const railHeader = {
  padding: '10px 12px', borderBottom: `1px solid ${C.border}`,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}
const railBody = { padding: 10, overflowY: 'auto', flex: 1 }
const collapseToggleBtn = {
  background: 'transparent', border: 'none', padding: 4, borderRadius: 4,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const searchInput = {
  width: '100%', padding: '6px 8px', fontSize: 12.5,
  color: C.textPrimary, background: C.surface,
  border: `1px solid ${C.border}`, borderRadius: 5,
}
const pickerToggle = {
  width: '100%', padding: '6px 8px', fontSize: 12.5,
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
  cursor: 'pointer', textAlign: 'left', color: C.textPrimary,
}
const toggleRow = {
  display: 'flex', gap: 8, alignItems: 'center',
  padding: '5px 8px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5,
  cursor: 'pointer',
}
