// =============================================================================
// ManageSharedRecordsModal — choose exactly which records a Program Manager
// Portal user may see.
//
// Nicholas, 2026-08-25: "It's very specific which ones are exposed and when."
// So this lists EVERY assessment and project and shares nothing by default:
// each row is ticked deliberately, one at a time. There is no "share all", no
// program-level rule, and no default selection.
//
// Revoking soft-deletes the grant rather than removing it, so it stays
// auditable that access once existed.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { C } from '../data/constants'
import {
  searchShareableRecords, fetchRecordGrants, grantRecord, revokeRecordGrant,
} from '../data/programPortalService'
import { getCurrentUserId } from '../data/layoutService'

const OBJECTS = [
  { id: 'assessments', label: 'Assessments' },
  { id: 'projects',    label: 'Projects' },
]

export default function ManageSharedRecordsModal({ portalUserId, portalUserName, onClose }) {
  const [objectName, setObjectName] = useState('assessments')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState([])
  const [grants, setGrants] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [userId, setUserId] = useState(null)

  useEffect(() => { getCurrentUserId().then(setUserId).catch(() => {}) }, [])

  const reloadGrants = useCallback(async () => {
    const g = await fetchRecordGrants(portalUserId)
    setGrants(g)
  }, [portalUserId])

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    Promise.all([searchShareableRecords(objectName, query), fetchRecordGrants(portalUserId)])
      .then(([r, g]) => { if (alive) { setRows(r); setGrants(g) } })
      .catch((e) => { if (alive) setError(e?.message || 'Could not load records') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [objectName, query, portalUserId])

  const grantedIds = useMemo(() => {
    const m = new Map()
    for (const g of grants) if (g.object === objectName) m.set(g.recordId, g)
    return m
  }, [grants, objectName])

  const totalShared = grants.length

  async function toggle(row) {
    setBusyId(row.id); setError(null)
    try {
      const existing = grantedIds.get(row.id)
      if (existing) await revokeRecordGrant(existing.id, userId)
      else await grantRecord(portalUserId, objectName, row.id, userId)
      await reloadGrants()
    } catch (e) {
      setError(e?.message || 'Could not change sharing')
    } finally { setBusyId(null) }
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(7,17,31,.55)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }
  const panel = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, width: 720, maxWidth: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
  const tab = (active) => ({ padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', borderRadius: 6, border: `1px solid ${active ? C.emerald : C.border}`, background: active ? '#e8f8f2' : C.card, color: active ? C.emeraldMid : C.textSecondary })

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>Manage Shared Records</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
            {portalUserName} sees only what is ticked here — {totalShared} record{totalShared === 1 ? '' : 's'} shared.
          </div>
        </div>

        <div style={{ padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: `1px solid ${C.border}` }}>
          {OBJECTS.map((o) => (
            <div key={o.id} style={tab(objectName === o.id)} onClick={() => setObjectName(o.id)}>{o.label}</div>
          ))}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by record number or name…"
            style={{ flex: 1, padding: '7px 11px', fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 6, outline: 'none' }} />
        </div>

        {error && <div style={{ padding: '10px 20px', fontSize: 12.5, color: '#1a5a8a', background: '#e8f3fb' }}>{error}</div>}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 20, fontSize: 12.5, color: C.textMuted }}>Loading…</div>}
          {!loading && rows.length === 0 && <div style={{ padding: 20, fontSize: 12.5, color: C.textMuted }}>No records found.</div>}
          {!loading && rows.map((r) => {
            const shared = grantedIds.has(r.id)
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', color: C.textSecondary, marginRight: 8 }}>{r.recordNumber}</span>
                    {r.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
                    {r.context || '—'}
                    {objectName === 'assessments' && !r.hasProject && ' · no project, nothing to show'}
                  </div>
                </div>
                <button onClick={() => toggle(r)} disabled={busyId === r.id}
                  style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                           border: `1px solid ${shared ? C.emerald : C.border}`,
                           background: shared ? '#e8f8f2' : C.card,
                           color: shared ? C.emeraldMid : C.textSecondary }}>
                  {busyId === r.id ? '…' : shared ? 'Shared' : 'Share'}
                </button>
              </div>
            )
          })}
        </div>

        <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 16px', borderRadius: 6, border: 'none', background: C.emerald, color: '#07111f', cursor: 'pointer' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
