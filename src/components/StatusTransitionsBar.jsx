import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import { useToast } from './Toast'

// ---------------------------------------------------------------------------
// StatusTransitionsBar
//
// Renders a horizontal status bar above the record detail page layout:
//   [current status pill]   [→ Transition 1] [→ Transition 2] ...
//
// Reads outgoing transitions from public.status_transitions whose
// (st_object, st_status_field, st_from_status_id) matches the record's
// current status, then renders one button per transition. Clicking a
// button calls the change_record_status RPC, which validates the move
// server-side against the same status_transitions row before applying.
//
// The bar is suppressed entirely when:
//   - No status_transitions rows exist for the table at all (table has
//     no configured lifecycle yet — graceful no-op)
//   - The table has more than one status_field configured (ambiguous;
//     primary-lifecycle declaration is a future v1.1 enhancement)
//   - The record is in edit mode (would let unsaved field changes
//     leak through a status update)
//   - The current status has no outgoing transitions (terminal state)
// ---------------------------------------------------------------------------

export default function StatusTransitionsBar({
  tableName,
  recordId,
  record,
  editing,
  onStatusChanged,
}) {
  const toast = useToast()
  const [statusField,  setStatusField]  = useState(null)
  const [transitions,  setTransitions]  = useState([])
  const [statusLabels, setStatusLabels] = useState(new Map())
  const [loading,      setLoading]      = useState(false)
  const [busy,         setBusy]         = useState(false)
  const [pendingTxn,   setPendingTxn]   = useState(null)

  // ── Resolve which column on this table holds the status ────────────
  // The simplest signal is: ask status_transitions for a distinct
  // st_status_field on this object. If exactly one comes back, that's
  // the lifecycle field. Tables with two status fields (e.g. work_orders
  // has both work_order_status and work_order_approval_status) are
  // suppressed for v1; we'll revisit when there's actual demand.
  useEffect(() => {
    let cancelled = false
    if (!tableName) return
    setLoading(true)
    supabase
      .from('status_transitions')
      .select('st_status_field')
      .eq('st_object',     tableName)
      .eq('st_is_deleted', false)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setLoading(false); return }
        const fields = Array.from(new Set((data || []).map(r => r.st_status_field)))
        if (fields.length === 1) setStatusField(fields[0])
        else                     setStatusField(null)
        if (fields.length === 0) setLoading(false)
      })
    return () => { cancelled = true }
  }, [tableName])

  // ── Load outgoing transitions whenever the record's status changes ─
  const currentStatusId = statusField ? (record?.[statusField] ?? null) : null

  useEffect(() => {
    let cancelled = false
    if (!tableName || !statusField) { setTransitions([]); setLoading(false); return }

    setLoading(true)

    // PostgREST quirk: filtering by NULL via .is() rather than .eq(). The
    // initial-creation transition has st_from_status_id IS NULL, which
    // we never want to surface here — the bar only matters once a record
    // already exists with a status set. So we always filter to non-null
    // from_status when currentStatusId is non-null, and skip entirely
    // when null.
    if (currentStatusId == null) {
      setTransitions([])
      setLoading(false)
      return
    }

    Promise.all([
      supabase
        .from('status_transitions')
        .select(`
          id, st_record_number, st_transition_label, st_description,
          st_from_status_id, st_to_status_id, st_sort_order, st_is_active
        `)
        .eq('st_object',         tableName)
        .eq('st_status_field',   statusField)
        .eq('st_from_status_id', currentStatusId)
        .eq('st_is_active',      true)
        .eq('st_is_deleted',     false)
        .order('st_sort_order',  { ascending: true })
        .order('st_created_at',  { ascending: true }),
      supabase
        .from('picklist_values')
        .select('id, picklist_value, picklist_label')
        .eq('picklist_object', tableName)
        .eq('picklist_field',  statusField),
    ]).then(([txnsRes, plsRes]) => {
      if (cancelled) return
      if (txnsRes.error) { setLoading(false); return }
      setTransitions(txnsRes.data || [])
      const labels = new Map()
      for (const pv of (plsRes.data || [])) {
        labels.set(pv.id, pv.picklist_label || pv.picklist_value)
      }
      setStatusLabels(labels)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [tableName, statusField, currentStatusId])

  // ── Submit a transition via the RPC ─────────────────────────────────
  const applyTransition = useCallback(async (txn) => {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('change_record_status', {
        p_object:        tableName,
        p_status_field:  statusField,
        p_record_id:     recordId,
        p_to_status_id:  txn.st_to_status_id,
      })
      if (error) throw error
      if (!data?.ok) throw new Error('Status change did not complete')
      toast.success(`Status changed: ${txn.st_transition_label}`)
      setPendingTxn(null)
      if (typeof onStatusChanged === 'function') {
        onStatusChanged({
          transitionId: data.transition_id,
          fromStatusId: data.from_status_id,
          toStatusId:   data.to_status_id,
        })
      }
    } catch (e) {
      // Surface PostgREST's structured error message if present
      const msg = e?.message || 'Status change failed'
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }, [tableName, statusField, recordId, toast, onStatusChanged])

  const currentLabel = currentStatusId ? statusLabels.get(currentStatusId) : null

  // ── Render gates ─────────────────────────────────────────────────────
  // Suppress entirely when:
  //   - editing is on (the user is filling out field changes; a status
  //     change here would be confusing and might race the form save)
  //   - statusField is unresolved (table has no lifecycle, or has two)
  //   - no outgoing transitions (terminal state)
  //   - loading (don't flash a stub bar)
  if (editing || loading) return null
  if (!statusField || transitions.length === 0) return null

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '10px 14px', marginBottom: 12,
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      {currentLabel && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 999,
          background: '#f1f5f9', color: C.textPrimary,
          fontSize: 12, fontWeight: 500,
          border: `1px solid ${C.border}`,
        }}>
          <span style={{ fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Status</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>{currentLabel}</span>
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {transitions.map(t => {
          const toLabel = statusLabels.get(t.st_to_status_id) || '—'
          return (
            <button
              key={t.id}
              disabled={busy}
              onClick={() => setPendingTxn(t)}
              title={t.st_description || `Change status: ${currentLabel} → ${toLabel}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px',
                background: C.emerald, color: '#fff',
                border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.55 : 1,
              }}
            >
              <span>{t.st_transition_label}</span>
              <span style={{ fontSize: 10.5, opacity: 0.85 }}>→ {toLabel}</span>
            </button>
          )
        })}
      </div>

      {pendingTxn && (
        <ConfirmTransitionModal
          transition={pendingTxn}
          currentLabel={currentLabel}
          toLabel={statusLabels.get(pendingTxn.st_to_status_id) || '—'}
          onConfirm={() => applyTransition(pendingTxn)}
          onCancel={() => setPendingTxn(null)}
          busy={busy}
        />
      )}
    </div>
  )
}

function ConfirmTransitionModal({ transition, currentLabel, toLabel, onConfirm, onCancel, busy }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, borderRadius: 10, width: 440,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <header style={{ padding: '16px 22px 8px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>{transition.st_transition_label}</div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
            {transition.st_record_number}
          </div>
        </header>
        <div style={{ padding: '4px 22px 14px', fontSize: 13, color: C.textSecondary, lineHeight: 1.55 }}>
          Change status from <b style={{ color: C.textPrimary }}>{currentLabel}</b> to <b style={{ color: C.textPrimary }}>{toLabel}</b>?
          {transition.st_description && (
            <div style={{ marginTop: 10, padding: 10, background: '#f8fafc', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12.5 }}>
              {transition.st_description}
            </div>
          )}
        </div>
        <footer style={{
          padding: '10px 22px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.textSecondary, padding: '7px 14px',
              fontSize: 12.5, fontWeight: 600, borderRadius: 6,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >Cancel</button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              background: C.emerald, border: 'none', color: '#fff',
              padding: '7px 14px',
              fontSize: 12.5, fontWeight: 600, borderRadius: 6,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.55 : 1,
            }}
          >
            {busy ? 'Applying…' : 'Confirm Change'}
          </button>
        </footer>
      </div>
    </div>
  )
}
