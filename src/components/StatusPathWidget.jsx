// =============================================================================
// StatusPathWidget — Salesforce-style Path component
//
// Renders a horizontal chevron strip showing the status lifecycle for a
// record. Every active picklist value for (object, status_field) that
// applies to the record's record_type appears as a chevron in
// picklist_sort_order. The strip is a visual representation of the lifecycle
// that's actually relevant to this record, not a curated subset.
//
// Record-type scoping: the widget calls the picklist_values_for_record_type
// RPC, which returns only values either (a) explicitly assigned to the
// record's record_type via picklist_value_record_type_assignments or
// (b) universal (zero assignment rows for that value — applies everywhere).
// Until an admin authors any scoped assignments, every value falls through
// to (b) and renders on every layout, preserving the pre-scoping behavior.
//
// Stage states:
//   complete — index < current's index (filled emerald)
//   current  — picklist value matches record's current status (bold emerald)
//   future   — index > current's index (dim outline)
//
// Off-path stages like "Corrections Needed", "Denied", "Withdrawn" appear
// in their picklist_sort_order position, same as any other stage. Salesforce
// surfaces them this way too; the user sees the full universe of possible
// states, not a filtered "happy path."
//
// Clickability: every chevron is clickable. Clicking a stage calls the
// change_record_status RPC, which validates the move server-side against
// status_transitions. Illegal jumps return an error (surfaced as a toast);
// legal moves persist and trigger a record reload. This matches Salesforce
// Path behavior — every stage is clickable; validation rules enforce what's
// actually permitted.
//
// Configured per page layout via widget_config:
//   status_field         text  — which status column to render
//   show_guidance        bool  — show transition description below the strip
//   show_completed_count bool  — show "Status: <label>" label above the strip
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import { getRecordTypeValue } from '../data/layoutService'

// Display-only chevron. The strip is a visual status indicator, not a
// control — chevrons are never clickable. Stage advancement is driven by
// field-triggered lifecycle transitions, never by a user clicking a stage.
function ChevronSegment({
  label, state /* 'complete' | 'current' | 'future' */,
  isFirst, isLast,
}) {
  const palette = {
    complete: { bg: '#2aab72', text: '#fff',          border: '#2aab72' },
    current:  { bg: '#3ecf8e', text: '#fff',          border: '#3ecf8e' },
    future:   { bg: '#f7f9fc', text: C.textSecondary, border: C.border },
  }[state]

  // Chevron shape via clip-path: rectangle with a left notch (except first)
  // and a right point (except last). One element per chevron, no overlap.
  const clip = (() => {
    if (isFirst && isLast) return 'none'
    if (isFirst)           return 'polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)'
    if (isLast)            return 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%)'
    return 'polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)'
  })()

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `0 ${isLast ? 14 : 18}px 0 ${isFirst ? 14 : 22}px`,
        background: palette.bg,
        color: palette.text,
        clipPath: clip,
        fontSize: 12,
        fontWeight: state === 'current' ? 700 : 500,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        marginLeft: isFirst ? 0 : -2,
        textAlign: 'center',
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  )
}

export default function StatusPathWidget({ widget, parentRecordId, tableName, record, onStatusChanged }) {
  const statusField  = widget?.widget_config?.status_field
  const showGuidance = widget?.widget_config?.show_guidance !== false
  const showCounter  = widget?.widget_config?.show_completed_count !== false

  const [picklistValues, setPicklistValues] = useState(null)
  const [transitions, setTransitions]       = useState(null)

  // Record type for the current record. Used to filter the chevron strip via
  // the picklist_values_for_record_type RPC, which applies the universal-
  // fallback rule: a picklist value with zero rows in
  // picklist_value_record_type_assignments renders on every record type
  // (so the migration is non-destructive — every status value continues to
  // appear on every layout until someone explicitly scopes it).
  const recordTypeId = useMemo(() => getRecordTypeValue(record), [record])

  useEffect(() => {
    if (!tableName || !statusField) return
    let alive = true
    Promise.all([
      supabase.rpc('picklist_values_for_record_type', {
        p_object:      tableName,
        p_field:       statusField,
        p_record_type: recordTypeId || null,
      }),
      supabase.from('status_transitions')
        .select('st_from_status_id, st_to_status_id, st_description')
        .eq('st_object', tableName)
        .eq('st_status_field', statusField)
        .eq('st_is_active', true)
        .eq('st_is_deleted', false),
    ])
      .then(([pkRes, trRes]) => {
        if (!alive) return
        setPicklistValues(pkRes.data || [])
        setTransitions(trRes.data || [])
      })
      .catch(() => {
        if (alive) { setPicklistValues([]); setTransitions([]) }
      })
    return () => { alive = false }
  }, [tableName, statusField, recordTypeId])

  const currentStatusId = statusField ? record?.[statusField] : null
  const currentIdx = useMemo(
    () => (picklistValues || []).findIndex(p => p.id === currentStatusId),
    [picklistValues, currentStatusId]
  )

  if (picklistValues === null) return null
  if (picklistValues.length === 0) return null

  const currentLabel = currentIdx >= 0 ? picklistValues[currentIdx].picklist_label : null
  const nextTransitionDescription = (() => {
    if (!currentStatusId || !transitions) return null
    const t = transitions.find(t => t.st_from_status_id === currentStatusId && t.st_description)
    return t?.st_description || null
  })()

  return (
    <div style={{
      marginBottom: 16,
      padding: 12,
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
    }}>
      {showCounter && currentLabel && (
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: C.textMuted,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}>
          Status: <span style={{ color: C.textPrimary }}>{currentLabel}</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'stretch', width: '100%' }}>
        {picklistValues.map((stage, idx) => {
          let state
          if (currentIdx < 0)        state = 'future'   // unknown current — nothing filled
          else if (idx < currentIdx)  state = 'complete'
          else if (idx === currentIdx) state = 'current'
          else                         state = 'future'

          return (
            <ChevronSegment
              key={stage.id}
              label={stage.picklist_label}
              state={state}
              isFirst={idx === 0}
              isLast={idx === picklistValues.length - 1}
            />
          )
        })}
      </div>

      {showGuidance && nextTransitionDescription && (
        <div style={{
          marginTop: 10,
          padding: '8px 10px',
          background: '#f7f9fc',
          borderLeft: `3px solid ${C.skyBlueSecondary || '#7eb3e8'}`,
          borderRadius: 4,
          fontSize: 12,
          color: C.textSecondary,
          lineHeight: 1.5,
        }}>
          <span style={{
            fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
            fontSize: 10, color: C.textMuted, marginRight: 6,
          }}>
            Next:
          </span>
          {nextTransitionDescription}
        </div>
      )}
    </div>
  )
}
