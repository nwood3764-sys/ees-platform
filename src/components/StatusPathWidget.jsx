// =============================================================================
// StatusPathWidget
//
// Salesforce-style "Path" component: a horizontal strip of connected chevrons
// across the top of a record showing the full status lifecycle. Completed
// stages are filled emerald, current stage is bold emerald with a forward
// arrow, future stages are dim outlines. Off-path statuses (Corrections
// Needed, Denied, Withdrawn, etc.) surface as a callout under the strip
// when the record is currently in one of them.
//
// Data sources (no new schema — reads what already exists):
//   - picklist_values        : the universe of status values for the field
//   - status_transitions     : the directed graph of legal moves
//   - <table>.<status_field> : the record's current status (uuid FK to picklist)
//
// Path construction: walk status_transitions for (st_object, st_status_field)
// as a directed graph. Find the start node (no incoming transitions OR the
// first by picklist_sort_order if everything has incoming). From there, walk
// the highest-st_sort_order outgoing edge each step until a terminal node
// (no outgoing). That sequence IS the happy path — exactly what Salesforce
// surfaces as the Path. Any picklist value not on this walk is treated as
// "off-path" (rendered as a callout when current, hidden otherwise).
//
// Click a chevron → calls change_record_status RPC with the target status id.
// Server validates the move against status_transitions and refuses illegal
// jumps (e.g. you can't click two stages forward, can't click backwards on
// a one-way transition).
//
// Configured per page layout via widget_config.status_field. Multiple
// status_path widgets per layout are allowed (e.g. work_orders has both
// work_order_status and work_order_approval_status — a layout could show
// both as separate strips).
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import { useToast } from './Toast'

// ── Helpers ──────────────────────────────────────────────────────────────

function buildHappyPath(picklistValues, transitions) {
  // picklistValues: [{id, picklist_label, picklist_sort_order, picklist_is_active}]
  // transitions:    [{st_from_status_id, st_to_status_id, st_sort_order}]
  //
  // Returns [{id, label}] in order of the happy path.

  if (!picklistValues?.length) return []
  const byId = new Map(picklistValues.map(p => [p.id, p]))

  // Index outgoing edges per source node, sorted by st_sort_order (highest first
  // → "preferred next stage" wins ties).
  const outgoing = new Map()
  for (const t of (transitions || [])) {
    if (!outgoing.has(t.st_from_status_id)) outgoing.set(t.st_from_status_id, [])
    outgoing.get(t.st_from_status_id).push(t)
  }
  for (const arr of outgoing.values()) {
    arr.sort((a, b) => (a.st_sort_order || 0) - (b.st_sort_order || 0))
  }

  // Find start node: a picklist value that appears as a from_status but never
  // as a to_status. If multiple, pick by lowest picklist_sort_order. If none
  // (every node has incoming edges — cycle or all reachable), fall back to
  // the picklist value with the lowest picklist_sort_order.
  const incomingSet = new Set((transitions || []).map(t => t.st_to_status_id))
  const startCandidates = picklistValues
    .filter(p => outgoing.has(p.id) && !incomingSet.has(p.id))
    .sort((a, b) => (a.picklist_sort_order || 0) - (b.picklist_sort_order || 0))
  const startId = startCandidates[0]?.id
    ?? picklistValues
         .filter(p => outgoing.has(p.id))
         .sort((a, b) => (a.picklist_sort_order || 0) - (b.picklist_sort_order || 0))[0]?.id
    ?? picklistValues[0]?.id

  if (!startId) return []

  // Walk forward following the lowest-sort-order outgoing edge each step.
  // Loop guard prevents cycles.
  const path = []
  const seen = new Set()
  let cur = startId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const p = byId.get(cur)
    if (p) path.push({ id: p.id, label: p.picklist_label })
    const next = outgoing.get(cur)?.[0]
    cur = next?.st_to_status_id
  }
  return path
}

// ── Chevron rendering ────────────────────────────────────────────────────

function ChevronSegment({
  label, state /* 'complete'|'current'|'future'|'offpath' */,
  isFirst, isLast, onClick, clickable,
}) {
  const palette = {
    complete: { bg: '#2aab72', text: '#fff',          border: '#2aab72' },
    current:  { bg: '#3ecf8e', text: '#fff',          border: '#3ecf8e' },
    future:   { bg: '#f7f9fc', text: C.textSecondary, border: C.border },
    offpath:  { bg: '#fff4e0', text: '#8a5a1a',       border: '#f0d7a0' },
  }[state]

  // Chevron shape: rectangle with a triangular notch cut out of the left
  // (except first segment) and a triangular point on the right (except last).
  // Implemented with CSS clip-path so the whole segment is one element and
  // we don't have to deal with overlapping z-index.
  const clip = (() => {
    if (isFirst && isLast) return 'none'
    if (isFirst)           return 'polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)'
    if (isLast)            return 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%)'
    return 'polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)'
  })()

  const fontWeight = state === 'current' ? 700 : 500

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
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
        fontWeight,
        fontFamily: 'inherit',
        cursor: clickable ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        marginLeft: isFirst ? 0 : -2,  // tuck the chevrons together
        transition: 'filter 150ms ease',
        textAlign: 'center',
      }}
      onMouseEnter={(e) => { if (clickable) e.currentTarget.style.filter = 'brightness(1.08)' }}
      onMouseLeave={(e) => { if (clickable) e.currentTarget.style.filter = 'none' }}
      title={clickable ? `Advance to: ${label}` : label}
    >
      {label}
    </button>
  )
}

// ── Main widget ──────────────────────────────────────────────────────────

export default function StatusPathWidget({ widget, parentRecordId, tableName, record, onStatusChanged }) {
  const toast = useToast()
  const statusField = widget?.widget_config?.status_field
  const showGuidance = widget?.widget_config?.show_guidance !== false
  const showCounter  = widget?.widget_config?.show_completed_count !== false

  const [picklistValues, setPicklistValues] = useState(null)  // null = loading
  const [transitions, setTransitions]       = useState(null)
  const [submitting, setSubmitting]         = useState(false)

  // Load picklist values + transitions once per (tableName × statusField)
  useEffect(() => {
    if (!tableName || !statusField) return
    let alive = true
    Promise.all([
      supabase.from('picklist_values')
        .select('id, picklist_label, picklist_sort_order, picklist_is_active')
        .eq('picklist_object', tableName)
        .eq('picklist_field', statusField)
        .eq('picklist_is_active', true)
        .order('picklist_sort_order', { ascending: true }),
      supabase.from('status_transitions')
        .select('st_from_status_id, st_to_status_id, st_sort_order, st_transition_label, st_description')
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
      .catch(err => {
        if (alive) {
          setPicklistValues([])
          setTransitions([])
          console.warn('StatusPathWidget load failed:', err)
        }
      })
    return () => { alive = false }
  }, [tableName, statusField])

  const happyPath = useMemo(
    () => buildHappyPath(picklistValues || [], transitions || []),
    [picklistValues, transitions]
  )

  const currentStatusId = statusField ? record?.[statusField] : null
  const currentIdx = happyPath.findIndex(s => s.id === currentStatusId)
  const isOnPath = currentIdx >= 0

  // Off-path status (Corrections Needed, Denied, etc.) — the record's current
  // status isn't in the happy path. Look it up directly.
  const offPathLabel = !isOnPath && currentStatusId && picklistValues
    ? picklistValues.find(p => p.id === currentStatusId)?.picklist_label
    : null

  // Which chevron is clickable? Only the directly-allowed next-stage(s) in
  // the happy path from the current status, per status_transitions.
  const allowedNextIds = useMemo(() => {
    if (!currentStatusId || !transitions) return new Set()
    return new Set(transitions
      .filter(t => t.st_from_status_id === currentStatusId)
      .map(t => t.st_to_status_id))
  }, [currentStatusId, transitions])

  const handleChevronClick = useCallback(async (targetStatusId, targetLabel) => {
    if (submitting) return
    if (!allowedNextIds.has(targetStatusId)) {
      toast.error(`Cannot advance directly to "${targetLabel}" — not a legal transition from the current status.`)
      return
    }
    setSubmitting(true)
    try {
      const { error } = await supabase.rpc('change_record_status', {
        p_object:         tableName,
        p_record_id:      parentRecordId,
        p_status_field:   statusField,
        p_new_status_id:  targetStatusId,
      })
      if (error) throw error
      toast.success(`Status changed to "${targetLabel}"`)
      onStatusChanged?.()
    } catch (e) {
      toast.error(`Status change failed: ${e.message || e}`)
    } finally {
      setSubmitting(false)
    }
  }, [submitting, allowedNextIds, tableName, parentRecordId, statusField, onStatusChanged, toast])

  // Loading or no lifecycle configured for this object/field — render nothing.
  // The widget self-suppresses cleanly so adding it to a layout for an object
  // that hasn't had its lifecycle defined yet is a no-op rather than an error.
  if (picklistValues === null || transitions === null) return null
  if (happyPath.length === 0) return null

  return (
    <div style={{
      marginBottom: 16,
      padding: 12,
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
    }}>
      {/* Optional counter row */}
      {showCounter && isOnPath && (
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: C.textMuted,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}>
          Stage {currentIdx + 1} of {happyPath.length}
        </div>
      )}

      {/* Chevron strip */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        width: '100%',
      }}>
        {happyPath.map((stage, idx) => {
          let state
          if (!isOnPath)          state = 'future'            // off-path: nothing filled
          else if (idx < currentIdx)  state = 'complete'
          else if (idx === currentIdx) state = 'current'
          else                         state = 'future'

          const clickable = allowedNextIds.has(stage.id) && !submitting

          return (
            <ChevronSegment
              key={stage.id}
              label={stage.label}
              state={state}
              isFirst={idx === 0}
              isLast={idx === happyPath.length - 1}
              onClick={() => handleChevronClick(stage.id, stage.label)}
              clickable={clickable}
            />
          )
        })}
      </div>

      {/* Off-path callout — current status isn't in the happy path */}
      {offPathLabel && (
        <div style={{
          marginTop: 10,
          padding: '8px 10px',
          background: '#fff4e0',
          border: '1px solid #f0d7a0',
          borderRadius: 6,
          fontSize: 12,
          color: '#8a5a1a',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            fontSize: 10,
          }}>
            Off path
          </span>
          <span>Currently: <strong>{offPathLabel}</strong></span>
        </div>
      )}

      {/* Optional guidance text from the next transition's description */}
      {showGuidance && isOnPath && (() => {
        const nextTransitions = (transitions || []).filter(t => t.st_from_status_id === currentStatusId)
        if (nextTransitions.length === 0) {
          return (
            <div style={{ marginTop: 10, fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>
              Terminal status — no further transitions.
            </div>
          )
        }
        const primary = nextTransitions[0]
        if (!primary?.st_description) return null
        return (
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
            {primary.st_description}
          </div>
        )
      })()}
    </div>
  )
}
