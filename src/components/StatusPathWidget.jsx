// =============================================================================
// StatusPathWidget — Salesforce-style Path component
//
// Renders a horizontal chevron strip showing the FULL status lifecycle for
// a record. Every active picklist value for (object, status_field) appears
// as a chevron in picklist_sort_order. The strip is a visual representation
// of the entire lifecycle, not a curated subset.
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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import { useToast } from './Toast'

function ChevronSegment({
  label, state /* 'complete' | 'current' | 'future' */,
  isFirst, isLast, onClick, disabled,
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
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        flex: 1,
        minWidth: 0,
        height: 36,
        padding: `0 ${isLast ? 14 : 18}px 0 ${isFirst ? 14 : 22}px`,
        background: palette.bg,
        color: palette.text,
        border: 'none',
        clipPath: clip,
        fontSize: 12,
        fontWeight: state === 'current' ? 700 : 500,
        fontFamily: 'inherit',
        cursor: disabled ? 'wait' : 'pointer',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        marginLeft: isFirst ? 0 : -2,
        transition: 'filter 150ms ease',
        textAlign: 'center',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.filter = 'brightness(1.08)' }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.filter = 'none' }}
      title={state === 'current' ? `Current status: ${label}` : `Change status to: ${label}`}
    >
      {label}
    </button>
  )
}

export default function StatusPathWidget({ widget, parentRecordId, tableName, record, onStatusChanged }) {
  const toast = useToast()
  const statusField  = widget?.widget_config?.status_field
  const showGuidance = widget?.widget_config?.show_guidance !== false
  const showCounter  = widget?.widget_config?.show_completed_count !== false

  const [picklistValues, setPicklistValues] = useState(null)
  const [transitions, setTransitions]       = useState(null)
  const [submitting, setSubmitting]         = useState(false)

  useEffect(() => {
    if (!tableName || !statusField) return
    let alive = true
    Promise.all([
      supabase.from('picklist_values')
        .select('id, picklist_label, picklist_sort_order')
        .eq('picklist_object', tableName)
        .eq('picklist_field', statusField)
        .eq('picklist_is_active', true)
        .order('picklist_sort_order', { ascending: true }),
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
  }, [tableName, statusField])

  const currentStatusId = statusField ? record?.[statusField] : null
  const currentIdx = useMemo(
    () => (picklistValues || []).findIndex(p => p.id === currentStatusId),
    [picklistValues, currentStatusId]
  )

  const handleChevronClick = useCallback(async (targetStatusId, targetLabel) => {
    if (submitting) return
    if (targetStatusId === currentStatusId) return  // no-op clicking current
    setSubmitting(true)
    try {
      const { error } = await supabase.rpc('change_record_status', {
        p_object:        tableName,
        p_record_id:     parentRecordId,
        p_status_field:  statusField,
        p_new_status_id: targetStatusId,
      })
      if (error) throw error
      toast.success(`Status changed to "${targetLabel}"`)
      onStatusChanged?.()
    } catch (e) {
      toast.error(`Cannot change status to "${targetLabel}": ${e.message || e}`)
    } finally {
      setSubmitting(false)
    }
  }, [submitting, currentStatusId, tableName, parentRecordId, statusField, onStatusChanged, toast])

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
              onClick={() => handleChevronClick(stage.id, stage.picklist_label)}
              disabled={submitting}
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
