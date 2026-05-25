// =============================================================================
// SeedDataPurgePane — Setup → Data → Purge Training Data
//
// Wipes every row that was inserted as part of the initial training/seed data
// set, tracked in the seed_data_records audit table. Backed by:
//   - count_seed_data() — per-table counts (read-only)
//   - purge_seed_data() — hard-deletes via block_hard_delete bypass flag
//
// UX:
//   1. Header summary: total seed records grouped by table.
//   2. Big red "Remove all training data" button.
//   3. Confirmation modal requires typing PURGE to enable.
//   4. After purge, summary surface: tables touched, records deleted, errors.
//
// The pane never touches real production data — the seed_data_records table
// is the only source of "what is seed". Real data has no entries in that
// table and is invisible to the purge RPC.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { C } from '../../data/constants'
import { Icon, LoadingState } from '../../components/UI'
import HelpIcon from '../../components/help/HelpIcon'
import { supabase } from '../../lib/supabase'

const CONFIRM_PHRASE = 'PURGE'

export default function SeedDataPurgePane() {
  const [counts, setCounts]       = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmInput, setConfirmInput] = useState('')
  const [purging, setPurging]     = useState(false)
  const [purgeResult, setPurgeResult] = useState(null)

  const loadCounts = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data, error: rpcErr } = await supabase.rpc('count_seed_data')
      if (rpcErr) throw rpcErr
      setCounts(data || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadCounts() }, [loadCounts])

  const totalRecords = (counts || []).reduce((s, r) => s + Number(r.record_count || 0), 0)

  const handlePurge = async () => {
    setPurging(true); setPurgeResult(null)
    try {
      const { data, error: rpcErr } = await supabase.rpc('purge_seed_data')
      if (rpcErr) throw rpcErr
      setPurgeResult(data)
      await loadCounts()
    } catch (e) {
      setPurgeResult({ error: e.message || String(e) })
    } finally {
      setPurging(false)
      setConfirmInput('')
    }
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: C.textPrimary }}>
          Purge Training Data
        </h2>
        <HelpIcon
          anchors={[
            { type: 'route', route: '/admin/seed_data_purge' },
            { type: 'concept', concept: 'seed-data-purge' },
          ]}
          title="Purge Training Data"
        />
      </div>
      <p style={{ marginTop: 0, fontSize: 13, color: C.textSecondary, maxWidth: 720, lineHeight: 1.55 }}>
        Removes every record that was inserted as initial training/seed data.
        This action is permanent. Real production data (the 6,781 prospecting properties,
        the 2,030 imported accounts, anything created by users in the normal
        course of using LEAP) is <b>not</b> touched — only records explicitly
        marked in the seed_data_records audit table will be deleted.
      </p>

      {loading && <LoadingState />}
      {error && (
        <div style={{ padding: '12px 14px', background: '#fde8e8', color: '#a32626', fontSize: 13, borderRadius: 6, marginBottom: 16 }}>
          Failed to load seed-data counts: {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Per-table count summary */}
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
            padding: '16px 18px', marginTop: 18, marginBottom: 18,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>
                {totalRecords.toLocaleString()}
              </div>
              <div style={{ fontSize: 13, color: C.textSecondary }}>
                training records across {counts?.length || 0} table{counts?.length === 1 ? '' : 's'}
              </div>
            </div>

            {totalRecords === 0 ? (
              <div style={{ padding: '14px 16px', background: C.page, borderRadius: 6, fontSize: 13, color: C.textMuted, textAlign: 'center' }}>
                No training data currently loaded.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}`, color: C.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    <th style={{ textAlign: 'left',  padding: '6px 0', fontWeight: 600 }}>Object</th>
                    <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 600 }}>Seed records</th>
                  </tr>
                </thead>
                <tbody>
                  {(counts || []).map(row => (
                    <tr key={row.table_name} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '7px 0', color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{row.table_name}</td>
                      <td style={{ padding: '7px 0', textAlign: 'right', color: C.textPrimary, fontWeight: 500 }}>{Number(row.record_count).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Purge button */}
          {totalRecords > 0 && (
            <button onClick={() => { setConfirmInput(''); setPurgeResult(null); setModalOpen(true) }}
              style={{
                padding: '12px 22px', fontSize: 14, fontWeight: 600,
                background: '#d44545', color: '#fff',
                border: '1px solid #b03030', borderRadius: 6,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                boxShadow: '0 1px 3px rgba(176, 48, 48, 0.3)',
              }}>
              <Icon path="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" size={14} color="#fff" />
              Remove all training data
            </button>
          )}

          {/* Purge result summary (after a purge runs) */}
          {purgeResult && !purgeResult.error && (
            <div style={{
              marginTop: 18, padding: '14px 18px',
              background: '#e8f8f2', border: '1px solid #2aab72', borderRadius: 8,
              color: '#1a7a4e', fontSize: 13,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Training data purged.
              </div>
              <div>
                {purgeResult.records_deleted?.toLocaleString() || 0} records deleted across {purgeResult.tables_touched || 0} tables.
              </div>
              {Array.isArray(purgeResult.errors) && purgeResult.errors.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#a35a18' }}>
                    {purgeResult.errors.length} error{purgeResult.errors.length === 1 ? '' : 's'}
                  </summary>
                  <pre style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', marginTop: 6, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                    {JSON.stringify(purgeResult.errors, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
          {purgeResult?.error && (
            <div style={{
              marginTop: 18, padding: '14px 18px',
              background: '#fde8e8', border: '1px solid #a32626', borderRadius: 8,
              color: '#a32626', fontSize: 13,
            }}>
              <b>Purge failed:</b> {purgeResult.error}
            </div>
          )}
        </>
      )}

      {/* Confirmation modal */}
      {modalOpen && (
        <div onClick={() => !purging && setModalOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(7,17,31,0.6)', zIndex: 9000,
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: C.card, borderRadius: 10, width: 'min(520px, 100%)',
                     padding: '22px 24px',
                     boxShadow: '0 12px 40px rgba(7,17,31,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Icon path="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" size={20} color="#d44545" />
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: C.textPrimary }}>
                Confirm: remove all training data
              </h3>
            </div>
            <p style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.55 }}>
              This will permanently delete <b>{totalRecords.toLocaleString()}</b> seed records
              across <b>{counts?.length || 0}</b> tables. Real production data is not affected.
              This action cannot be undone.
            </p>
            <p style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 16, marginBottom: 6 }}>
              Type <b style={{ fontFamily: 'JetBrains Mono, monospace', color: '#a32626' }}>PURGE</b> to confirm:
            </p>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              autoFocus
              disabled={purging}
              style={{
                width: '100%', padding: '9px 12px', fontSize: 14,
                fontFamily: 'JetBrains Mono, monospace',
                border: `1px solid ${C.border}`, borderRadius: 6,
                background: C.page, color: C.textPrimary, outline: 'none',
              }}
            />
            <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalOpen(false)} disabled={purging}
                style={{
                  padding: '9px 14px', fontSize: 13, fontWeight: 500,
                  background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
                  color: C.textSecondary, cursor: purging ? 'not-allowed' : 'pointer',
                }}>
                Cancel
              </button>
              <button
                onClick={handlePurge}
                disabled={confirmInput !== CONFIRM_PHRASE || purging}
                style={{
                  padding: '9px 16px', fontSize: 13, fontWeight: 600,
                  background: (confirmInput === CONFIRM_PHRASE && !purging) ? '#d44545' : C.border,
                  color: '#fff', border: 'none', borderRadius: 6,
                  cursor: (confirmInput === CONFIRM_PHRASE && !purging) ? 'pointer' : 'not-allowed',
                }}>
                {purging ? 'Purging…' : 'Permanently delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
