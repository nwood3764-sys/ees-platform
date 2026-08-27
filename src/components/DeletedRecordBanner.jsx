// =============================================================================
// DeletedRecordBanner — a record in the recycle bin SAYS it is in the recycle
// bin, on every object.
//
// Why this exists: a soft-deleted record still resolves at its own URL and,
// until now, rendered exactly like a live one — same header, same fields, same
// tabs, no notice of any kind. Only `accounts` said anything (the merged-away
// notice), because merging was the only place anyone had looked at a deleted
// record on purpose.
//
// The cost of that silence was a user deleting a record, landing back on it,
// seeing it unchanged, and concluding the delete had failed — which is exactly
// what happened to OPP-00154 (Nicholas, 2026-08-27). The delete had worked
// both times. The platform simply never told him.
//
// Deliberately a BANNER and not a wall: a deleted record is still readable —
// that is the point of a recycle bin, and an auditor following a link to a
// deleted record needs to see what was on it. What changes is that its state
// is unmistakable and there is one click back out of it.
// =============================================================================

import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { supabase } from '../lib/supabase'
import { getCurrentUserProfile } from '../data/layoutService'
import { useToast } from './Toast'

/**
 * The record's own soft-delete columns, read off the loaded row.
 *
 * Every table carries the flag under its own prefix (`opportunity_is_deleted`,
 * `project_is_deleted`, a bare `is_deleted` on a dozen older tables), so the
 * column is discovered from the row rather than looked up — the row already
 * holds every column, and this must work on all 103 objects with a record
 * page, including any added tomorrow.
 *
 * Returns null when the record is live, which is the overwhelmingly common
 * case and renders nothing.
 */
export function readDeletedState(record) {
  if (!record || typeof record !== 'object') return null
  for (const key of Object.keys(record)) {
    // Dotted keys are cross-object RELATED fields merged onto the row
    // ('property_id.property_is_deleted'); a deleted PARENT says nothing about
    // this record's own state and must never trip the banner.
    if (key.includes('.')) continue
    if (key !== 'is_deleted' && !key.endsWith('_is_deleted')) continue
    if (record[key] !== true) continue
    const prefix = key.replace(/is_deleted$/, '')
    return {
      column:   key,
      deletedAt:     record[`${prefix}deleted_at`] || null,
      deletedById:   record[`${prefix}deleted_by`] || null,
      deletionReason: record[`${prefix}deletion_reason`] || null,
    }
  }
  return null
}

function formatWhen(iso) {
  if (!iso) return null
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return null
  return when.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function DeletedRecordBanner({
  tableName, recordId, record, objectLabel, onRestored,
}) {
  const toast = useToast()
  const state = readDeletedState(record)
  const [deletedByName, setDeletedByName] = useState(null)
  const [canRestore, setCanRestore] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const deletedById = state?.deletedById || null

  // Who deleted it is the first thing asked when a record goes missing, so it
  // is resolved rather than shown as a uuid. A failed lookup simply omits the
  // name — it never blocks the notice, which is the part that matters.
  useEffect(() => {
    let cancelled = false
    if (!deletedById) { setDeletedByName(null); return () => {} }
    supabase
      .from('users')
      .select('user_first_name, user_last_name')
      .eq('id', deletedById)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return
        const name = [data.user_first_name, data.user_last_name].filter(Boolean).join(' ').trim()
        setDeletedByName(name || null)
      }, () => { /* name is a nicety */ })
    return () => { cancelled = true }
  }, [deletedById])

  // Restore is Admin's call — the same gate the Recycle Bin pane applies. A
  // non-admin still sees the notice (which is the actionable half: the record
  // is deleted, that is why it is missing from lists) without a button that
  // would only fail.
  useEffect(() => {
    let cancelled = false
    getCurrentUserProfile()
      .then(p => { if (!cancelled) setCanRestore(p?.roleName === 'Admin') })
      .catch(() => { /* unresolved profile — no restore button */ })
    return () => { cancelled = true }
  }, [])

  if (!state) return null

  const handleRestore = async () => {
    setRestoring(true)
    try {
      const { data, error } = await supabase.rpc('restore_record', {
        p_table: tableName, p_record_id: recordId,
      })
      if (error) throw error
      if (!data) throw new Error('the record was not restored')
      toast.success('Restored from the recycle bin')
      onRestored?.()
    } catch (err) {
      toast.error(`Restore failed — ${err.message || String(err)}`)
    } finally {
      setRestoring(false)
    }
  }

  const when = formatWhen(state.deletedAt)
  const label = (objectLabel || 'record').toLowerCase()

  return (
    <div
      role="status"
      style={{
        flexShrink: 0,
        background: '#0d1a2e',
        color: 'rgba(255,255,255,0.96)',
        borderBottom: `1px solid ${C.borderDark}`,
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        fontSize: 12.5,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
      </svg>
      <div style={{ flex: 1, minWidth: 220, lineHeight: 1.5 }}>
        <strong style={{ fontWeight: 700 }}>This {label} is in the recycle bin.</strong>
        {' '}It was deleted
        {when ? <> on <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{when}</span></> : null}
        {deletedByName ? <> by {deletedByName}</> : null}
        , so it no longer appears in list views, related lists, reports or search.
        {state.deletionReason ? <> Reason: “{state.deletionReason}”.</> : null}
      </div>
      {canRestore && (
        <button
          onClick={handleRestore}
          disabled={restoring}
          style={{
            background: C.emerald, border: 'none', borderRadius: 6,
            padding: '7px 14px', fontSize: 12, fontWeight: 600,
            color: '#07111f', cursor: restoring ? 'default' : 'pointer',
            opacity: restoring ? 0.6 : 1, fontFamily: 'inherit', flexShrink: 0,
          }}
        >
          {restoring ? 'Restoring…' : 'Restore'}
        </button>
      )}
    </div>
  )
}
