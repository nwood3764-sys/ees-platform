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
// RPC, which returns the values selected for the record's record type — and,
// for a LIFECYCLE field, nothing at all when nobody has selected any. A strip
// of every status the object owns is not this record type's path; it is the
// absence of one, and it now says so rather than painting 36 chevrons.
// The record's own status is always returned, wherever the selection stands.
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
// Clickability: the chevrons are a read-out, not a control. Advancing the
// record is done with the transition buttons the widget renders underneath,
// which are the moves status_transitions actually permits from where the
// record stands — a chevron you can click but that the server will refuse is
// not a control, it is a trap.
//
// Labels: a stage carries only what distinguishes it from its siblings. LEAP
// names statuses "[Object] [State]", so the object half is dropped when every
// stage on the strip shares it (src/lib/statusPathLabels.js). The full label
// is the hover title and the line under the strip.
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
import { sharedStatusLabelPrefix, shortStatusLabel } from '../lib/statusPathLabels'
import StatusTransitionsBar from './StatusTransitionsBar'

// Display-only chevron. The strip is a visual status indicator, not a
// control — chevrons are never clickable. Stage advancement goes through the
// transition buttons below the strip, which are validated server-side.
function ChevronSegment({
  label, fullLabel, state /* 'complete' | 'current' | 'future' */,
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

  const isCurrent = state === 'current'

  // Every stage is sized to its own label and the strip WRAPS when the row is
  // full, so a nine-stage lifecycle is nine readable stages rather than nine
  // 89px slivers sharing the leftovers of whichever one is current. Stages do
  // not grow into the spare width: a wrapped row holding two stages would
  // stretch them to half the card each, which reads as two enormous stages
  // rather than the tail of a path. `minWidth: max-content` is what holds the
  // label intact — without it flexbox shrinks the item below its text and the
  // label is clipped at BOTH ends (a centered flex child does not take
  // `text-overflow`, so there is not even an ellipsis to say something was
  // cut).
  return (
    <div
      data-chevron
      title={fullLabel}
      style={{
        flexGrow: 0,
        flexShrink: 1,
        flexBasis: 'auto',
        minWidth: 'max-content',
        maxWidth: '100%',
        boxSizing: 'content-box',
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `0 ${isLast ? 14 : 20}px 0 ${isFirst ? 14 : 24}px`,
        background: palette.bg,
        color: palette.text,
        clipPath: clip,
        fontSize: 12,
        fontWeight: isCurrent ? 700 : 500,
        marginLeft: isFirst ? 0 : -2,
        textAlign: 'center',
        userSelect: 'none',
      }}
    >
      {/* The label is its own box so that, in the one case the chevron still
          cannot hold it (a long stage on a phone), it truncates at the END
          with an ellipsis instead of losing both ends. */}
      <span style={{
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
    </div>
  )
}

export default function StatusPathWidget({ widget, parentRecordId, tableName, record, onStatusChanged }) {
  const statusField  = widget?.widget_config?.status_field
  const showGuidance = widget?.widget_config?.show_guidance !== false
  const showCounter  = widget?.widget_config?.show_completed_count !== false

  const [picklistValues, setPicklistValues] = useState(null)
  const [transitions, setTransitions]       = useState(null)

  // Record type for the current record — what the chevron strip is filtered by.
  const recordTypeId = useMemo(() => getRecordTypeValue(record), [record])

  useEffect(() => {
    if (!tableName || !statusField) return
    let alive = true
    Promise.all([
      supabase.rpc('picklist_values_for_record_type', {
        p_object:       tableName,
        p_field:        statusField,
        p_record_type:  recordTypeId || null,
        // Where the record already stands is always a stage on its own path,
        // even if that value is not in the record type's configured set.
        p_current_value: (statusField ? record?.[statusField] : null) || null,
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
  }, [tableName, statusField, recordTypeId, statusField ? record?.[statusField] : null])

  const currentStatusId = statusField ? record?.[statusField] : null
  const currentIdx = useMemo(
    () => (picklistValues || []).findIndex(p => p.id === currentStatusId),
    [picklistValues, currentStatusId]
  )

  // The words every stage on THIS strip shares — dropped from the chevrons so
  // each one shows what makes it different. Derived from the stage set that
  // actually rendered, so a record type with a narrower stage list gets the
  // prefix its own stages share, not the object's whole picklist.
  const sharedPrefix = useMemo(
    () => sharedStatusLabelPrefix((picklistValues || []).map(p => p.picklist_label)),
    [picklistValues]
  )

  if (picklistValues === null) return null
  // No stages configured for this record type. The strip used to vanish, which
  // looks identical to a layout with no path on it; say what is missing instead,
  // because the answer is a configuration a person has to author.
  if (picklistValues.length === 0) {
    return (
      <div style={{
        border: `1px dashed ${C.borderDark || C.border}`, borderRadius: 8,
        background: C.cardSecondary, padding: '14px 16px',
        fontSize: 12.5, color: C.textSecondary, lineHeight: 1.45,
      }}>
        <strong style={{ color: C.textPrimary, fontWeight: 600 }}>
          No statuses are set up for this record type.
        </strong>
        {' '}Choose the statuses that make up its lifecycle in Object Manager →
        this object → Fields &amp; Relationships → {statusField} → Record Types.
      </div>
    )
  }

  const currentStage = currentIdx >= 0 ? picklistValues[currentIdx] : null
  const currentLabel = currentStage ? currentStage.picklist_label : null
  const currentDescription = currentStage ? currentStage.picklist_description : null
  const stagePosition = currentIdx >= 0
    ? `Stage ${currentIdx + 1} of ${picklistValues.length}`
    : null
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
      {showCounter && stagePosition && (
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: C.textMuted,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}>
          {stagePosition}
        </div>
      )}

      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        flexWrap: 'wrap',
        rowGap: 4,
        width: '100%',
      }}>
        {picklistValues.map((stage, idx) => {
          let state
          if (currentIdx < 0)        state = 'future'   // unknown current — nothing filled
          else if (idx < currentIdx)  state = 'complete'
          else if (idx === currentIdx) state = 'current'
          else                         state = 'future'

          return (
            <ChevronSegment
              key={stage.id}
              label={shortStatusLabel(stage.picklist_label, sharedPrefix)}
              fullLabel={stage.picklist_label}
              state={state}
              isFirst={idx === 0}
              isLast={idx === picklistValues.length - 1}
            />
          )
        })}
      </div>

      {currentLabel && (
        <div style={{
          marginTop: 12,
          fontSize: 15,
          fontWeight: 700,
          color: C.textPrimary,
        }}>
          {currentLabel}
        </div>
      )}

      {currentDescription && (
        <div style={{
          marginTop: 6,
          fontSize: 13,
          color: C.textSecondary,
          lineHeight: 1.5,
        }}>
          {currentDescription}
        </div>
      )}

      {showGuidance && nextTransitionDescription && (
        <div style={{
          marginTop: 10,
          padding: '8px 10px',
          background: '#f7f9fc',
          borderLeft: `3px solid ${C.sky}`,
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

      {/* The moves permitted from here. They live INSIDE the path card because
          the path is where a user reads the lifecycle — a second card
          announcing the same status next to this one is what made the control
          unrecognisable. Renders nothing when the stage is terminal. */}
      <StatusTransitionsBar
        embedded
        statusField={statusField}
        tableName={tableName}
        recordId={parentRecordId}
        record={record}
        editing={false}
        onStatusChanged={onStatusChanged}
      />
    </div>
  )
}
