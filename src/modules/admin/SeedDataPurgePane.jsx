// =============================================================================
// SeedDataPurgePane — Setup → Data → Seed Data Purge
//
// Wipes every row currently flagged is_seed_data=true across every tenant-data
// table. Backed by the seed_purge_tenant_data(text) RPC; that function is
// SECURITY DEFINER, role-gated to Admin, and takes a confirm token so a
// misclick can't trigger a purge.
//
// Two-phase UX:
//   1) Dry-run: shows per-table row counts so the user can sanity-check the
//      blast radius before pulling the trigger.
//   2) Confirm: requires typing the literal phrase PURGE ALL SEED DATA, then
//      clicking Confirm to issue the RPC with the validated token.
//
// System config (picklists, roles, page layouts, templates, programs, work
// types, lifecycle rules, etc.) is deliberately NOT covered by the flag —
// the purge never touches them. The platform survives intact; only customer
// data flagged seed is removed.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { C } from '../../data/constants'
import { Icon, LoadingState } from '../../components/UI'
import HelpIcon from '../../components/help/HelpIcon'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'

const CONFIRM_PHRASE = 'PURGE ALL SEED DATA'
const RPC_TOKEN      = 'PURGE_ALL_SEED_DATA'

export default function SeedDataPurgePane() {
  const toast = useToast()
  const [dryRun, setDryRun] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [confirmInput, setConfirmInput] = useState('')
  const [purging, setPurging] = useState(false)
  const [purgeResult, setPurgeResult] = useState(null)

  const loadDryRun = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcErr } = await supabase.rpc('seed_purge_tenant_data', { confirm_token: null })
      if (rpcErr) throw rpcErr
      setDryRun(data)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadDryRun() }, [loadDryRun])

  const nonZeroTables = useMemo(() => {
    if (!dryRun?.per_table) return []
    return Object.entries(dryRun.per_table)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
  }, [dryRun])

  const handlePurge = useCallback(async () => {
    if (confirmInput.trim() !== CONFIRM_PHRASE) {
      toast.error(`Type "${CONFIRM_PHRASE}" exactly to confirm.`)
      return
    }
    setPurging(true)
    setPurgeResult(null)
    try {
      const { data, error: rpcErr } = await supabase.rpc('seed_purge_tenant_data', { confirm_token: RPC_TOKEN })
      if (rpcErr) throw rpcErr
      setPurgeResult(data)
      setConfirmInput('')
      toast.success(`Purged ${data?.total_rows ?? 0} seed rows across ${Object.keys(data?.per_table ?? {}).length} tables.`)
      // Refresh dry-run to show new state (should be all zeros)
      await loadDryRun()
    } catch (e) {
      toast.error(e.message || String(e))
      setError(e.message || String(e))
    } finally {
      setPurging(false)
    }
  }, [confirmInput, loadDryRun, toast])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Seed Data Purge</div>
          <HelpIcon
            anchors={[
              { type: 'route', route: '/admin/seed_data_purge' },
              { type: 'concept', concept: 'seed-data' },
              { type: 'concept', concept: 'seed-purge' },
            ]}
            title="Seed Data Purge"
          />
        </div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          Permanently deletes every row currently flagged <code>is_seed_data=true</code>. System configuration (picklists, roles, layouts, templates, programs, work types, lifecycle rules) is never touched.
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: '#f7f9fc' }}>
        {loading && <LoadingState />}

        {error && !loading && (
          <div style={{
            padding: 16, marginBottom: 16,
            background: '#fce8e8', border: '1px solid #f3b4b4', borderRadius: 6,
            color: '#8a1a1a', fontSize: 12.5, lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Could not load seed-data summary</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>{error}</div>
            <div style={{ marginTop: 8 }}>
              <button
                onClick={loadDryRun}
                style={{
                  background: '#fff', border: '1px solid #f3b4b4', borderRadius: 5,
                  padding: '5px 12px', fontSize: 12, fontWeight: 600,
                  color: '#8a1a1a', cursor: 'pointer',
                }}
              >Retry</button>
            </div>
          </div>
        )}

        {!loading && !error && dryRun && (
          <>
            {/* Summary card */}
            <div style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: 20, marginBottom: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: dryRun.total_rows > 0 ? '#8a5a1a' : '#1a7a4e', fontFamily: 'JetBrains Mono, monospace' }}>
                  {dryRun.total_rows.toLocaleString()}
                </div>
                <div style={{ fontSize: 14, color: C.textSecondary }}>
                  rows currently flagged seed across {Object.keys(dryRun.per_table).length} tenant-data tables
                </div>
              </div>
              {dryRun.total_rows === 0 && (
                <div style={{ fontSize: 12.5, color: '#1a7a4e', marginTop: 4 }}>
                  Nothing to purge — the tenant-data tables are clean.
                </div>
              )}
            </div>

            {/* Per-table breakdown */}
            {nonZeroTables.length > 0 && (
              <div style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                marginBottom: 16, overflow: 'hidden',
              }}>
                <div style={{
                  padding: '10px 16px',
                  borderBottom: `1px solid ${C.border}`,
                  background: '#fafbfd',
                  fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3,
                  textTransform: 'uppercase', color: C.textSecondary,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>Tables with seed rows</span>
                  <button
                    onClick={loadDryRun}
                    style={{
                      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 5,
                      padding: '4px 10px', fontSize: 11, fontWeight: 600,
                      color: C.textSecondary, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      textTransform: 'none', letterSpacing: 0,
                    }}
                  >
                    <Icon path="M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10 M20.49 15A9 9 0 015.64 18.36L1 14" size={11} color="currentColor" />
                    Refresh
                  </button>
                </div>
                <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                  {nonZeroTables.map(([table, count]) => (
                    <div key={table} style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '8px 16px', borderBottom: `1px solid ${C.border}`,
                      fontSize: 12.5,
                    }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', color: C.textPrimary }}>{table}</span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', color: C.textSecondary, fontWeight: 600 }}>
                        {count.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Danger zone */}
            {dryRun.total_rows > 0 && (
              <div style={{
                background: '#fff', border: '2px solid #e85c5c', borderRadius: 8,
                padding: 20,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Icon path="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01" size={16} color="#e85c5c" />
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#8a1a1a' }}>Danger zone</div>
                </div>
                <div style={{ fontSize: 12.5, color: C.textPrimary, lineHeight: 1.6, marginBottom: 12 }}>
                  This permanently deletes every row above. It cannot be undone. Run this when you're ready to start using LEAP for real production data and no longer need any of the seed records.
                  <br /><br />
                  Type the phrase below exactly, then click Confirm to execute. Foreign-key constraints are deferred inside the transaction; if any production row references a seed row the entire purge rolls back automatically.
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, letterSpacing: 0.3, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    Confirmation phrase
                  </label>
                  <input
                    type="text"
                    value={confirmInput}
                    onChange={e => setConfirmInput(e.target.value)}
                    placeholder={CONFIRM_PHRASE}
                    disabled={purging}
                    autoComplete="off"
                    spellCheck={false}
                    style={{
                      width: '100%', maxWidth: 400, padding: '8px 12px',
                      fontSize: 13, fontFamily: 'JetBrains Mono, monospace',
                      border: `1px solid ${confirmInput === CONFIRM_PHRASE ? '#e85c5c' : C.border}`,
                      borderRadius: 5, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>

                <button
                  onClick={handlePurge}
                  disabled={purging || confirmInput.trim() !== CONFIRM_PHRASE}
                  style={{
                    background: confirmInput.trim() === CONFIRM_PHRASE ? '#e85c5c' : '#f0f3f8',
                    color: confirmInput.trim() === CONFIRM_PHRASE ? '#fff' : C.textMuted,
                    border: 'none', borderRadius: 5,
                    padding: '9px 18px', fontSize: 13, fontWeight: 700,
                    cursor: (purging || confirmInput.trim() !== CONFIRM_PHRASE) ? 'not-allowed' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <Icon path="M3 6h18 M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2 M10 11v6 M14 11v6" size={13} color="currentColor" />
                  {purging ? 'Purging…' : `Permanently delete ${dryRun.total_rows.toLocaleString()} rows`}
                </button>
              </div>
            )}

            {purgeResult && purgeResult.mode === 'purged' && (
              <div style={{
                marginTop: 16,
                background: '#e8f8f2', border: '1px solid #bfe7d3', borderRadius: 8,
                padding: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a7a4e', marginBottom: 6 }}>
                  Purge complete — {purgeResult.total_rows.toLocaleString()} rows deleted
                </div>
                <div style={{ fontSize: 11.5, color: C.textSecondary, fontFamily: 'JetBrains Mono, monospace' }}>
                  Executed at {purgeResult.executed_at}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
