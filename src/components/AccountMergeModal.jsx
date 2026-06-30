// ===========================================================================
// AccountMergeModal — resolve duplicate accounts (Salesforce "Merge Accounts").
//
// Opened from the Merge action on an Account record (that record is the MASTER).
// The user picks one duplicate to merge in, chooses the surviving value for any
// conflicting field (radio per field, master wins by default), sees how many
// child records will move, and confirms. The actual work is one atomic RPC:
//   merge_accounts(master, loser, field_overrides)
// which reparents every child FK to the master, soft-deletes the loser, and
// writes an audit-log row. preview_account_merge(loser) drives the impact count.
//
// Two accounts at a time (repeatable for triplets). LEAP design system — navy /
// emerald, no red.
// ===========================================================================

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'

// System / non-display columns we never surface as a field choice.
const SKIP_FIELDS = new Set([
  'id', 'created_at', 'created_by', 'updated_at', 'updated_by',
  'account_is_deleted', 'account_record_number',
])

function prettify(col) {
  return col.replace(/^account_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function isScalar(v) {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v)
}
function displayVal(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  return String(v)
}

export default function AccountMergeModal({ masterId, master, onClose, onMerged }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [loser, setLoser] = useState(null)          // { id, account_name }
  const [loserRow, setLoserRow] = useState(null)     // full row
  const [masterRow, setMasterRow] = useState(master || null)
  const [choices, setChoices] = useState({})         // field -> 'master' | 'loser'
  const [counts, setCounts] = useState(null)
  const [loadingStep, setLoadingStep] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // ── Step 1: search for the duplicate ──
  useEffect(() => {
    if (loser) return undefined
    const q = query.trim()
    if (q.length < 2) { setResults([]); return undefined }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, account_name')
        .eq('account_is_deleted', false)
        .neq('id', masterId)
        .ilike('account_name', `%${q}%`)
        .order('account_name')
        .limit(20)
      if (!cancelled) { setResults(data || []); setSearching(false) }
    }, 220)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, loser, masterId])

  // ── Step 2: load both full rows + the impact preview once a loser is picked ──
  async function pickLoser(row) {
    setLoadingStep(true); setError(null)
    try {
      const [{ data: lrow }, { data: mrow }, { data: preview, error: pErr }] = await Promise.all([
        supabase.from('accounts').select('*').eq('id', row.id).maybeSingle(),
        masterRow ? Promise.resolve({ data: masterRow }) : supabase.from('accounts').select('*').eq('id', masterId).maybeSingle(),
        supabase.rpc('preview_account_merge', { p_loser: row.id }),
      ])
      if (pErr) throw pErr
      setLoser(row); setLoserRow(lrow); setMasterRow(mrow || masterRow)
      setCounts(preview || {})
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoadingStep(false)
    }
  }

  // Conflicting scalar fields where master and loser differ — the choices.
  const conflicts = useMemo(() => {
    if (!loserRow || !masterRow) return []
    const keys = new Set([...Object.keys(masterRow), ...Object.keys(loserRow)])
    const out = []
    for (const k of keys) {
      if (SKIP_FIELDS.has(k) || k.endsWith('_id')) continue
      const mv = masterRow[k], lv = loserRow[k]
      if (!isScalar(mv) || !isScalar(lv)) continue
      const norm = x => (x === null || x === undefined ? '' : String(x))
      if (norm(mv) === norm(lv)) continue
      out.push({ field: k, label: prettify(k), master: mv, loser: lv })
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }, [loserRow, masterRow])

  const childTotal = useMemo(
    () => Object.values(counts || {}).reduce((a, n) => a + Number(n || 0), 0),
    [counts])

  function choiceFor(field) { return choices[field] || 'master' }

  async function confirmMerge() {
    setBusy(true); setError(null)
    try {
      const overrides = {}
      for (const c of conflicts) {
        if (choiceFor(c.field) === 'loser') overrides[c.field] = c.loser
      }
      const { data, error: mErr } = await supabase.rpc('merge_accounts', {
        p_master: masterId, p_loser: loser.id, p_field_overrides: overrides,
      })
      if (mErr) throw mErr
      if (data?.status !== 'ok') throw new Error('Merge did not complete.')
      onMerged?.(masterId)
    } catch (e) {
      setError(e.message || String(e))
      setBusy(false)
    }
  }

  const masterName = masterRow?.account_name || master?.account_name || 'this account'

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={card}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>Merge Accounts</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              Keeping <strong style={{ color: C.textSecondary }}>{masterName}</strong> as the master — the other account merges into it.
            </div>
          </div>
          <button onClick={onClose} style={xBtn}>✕</button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {error && (
            <div style={{ background: '#e8f1fb', border: `1px solid ${C.sky}`, color: '#1a5a8a', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 14 }}>{error}</div>
          )}

          {!loser ? (
            <>
              <label style={lbl}>Find the duplicate account to merge in</label>
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search accounts by name…" style={input} />
              <div style={{ marginTop: 10, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', maxHeight: 320, overflowY: 'auto' }}>
                {searching && <div style={rowMuted}>Searching…</div>}
                {!searching && query.trim().length >= 2 && results.length === 0 && <div style={rowMuted}>No matching accounts.</div>}
                {!searching && query.trim().length < 2 && <div style={rowMuted}>Type at least 2 characters.</div>}
                {results.map(r => (
                  <div key={r.id} onClick={() => pickLoser(r)} style={pickRow}
                    onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <span style={{ fontSize: 13, color: C.textPrimary }}>{r.account_name}</span>
                    <span style={{ fontSize: 11.5, color: C.emeraldMid, fontWeight: 600 }}>Select →</span>
                  </div>
                ))}
              </div>
            </>
          ) : loadingStep ? (
            <div style={rowMuted}>Loading merge preview…</div>
          ) : (
            <>
              {/* Header: master vs loser */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={colHead(true)}>
                  <span style={pill(C.emeraldMid)}>MASTER — KEPT</span>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, marginTop: 6 }}>{masterRow?.account_name}</div>
                </div>
                <div style={colHead(false)}>
                  <span style={pill('#1a5a8a')}>MERGING IN — REMOVED</span>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, marginTop: 6 }}>{loserRow?.account_name}</div>
                </div>
              </div>

              {/* Conflicting fields */}
              {conflicts.length > 0 ? (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 8 }}>
                    Choose the value to keep for each differing field (master is selected by default):
                  </div>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                    {conflicts.map((c, i) => (
                      <div key={c.field} style={{ borderTop: i ? `1px solid ${C.border}` : 'none', padding: '10px 12px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>{c.label}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <ValuePick selected={choiceFor(c.field) === 'master'} onSelect={() => setChoices(s => ({ ...s, [c.field]: 'master' }))} value={displayVal(c.master)} accent={C.emerald} />
                          <ValuePick selected={choiceFor(c.field) === 'loser'} onSelect={() => setChoices(s => ({ ...s, [c.field]: 'loser' }))} value={displayVal(c.loser)} accent={C.sky} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 16 }}>No conflicting fields — the master's values are kept.</div>
              )}

              {/* Impact preview */}
              <div style={{ background: C.cardSecondary || '#f7f9fc', border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>
                  {childTotal} record{childTotal === 1 ? '' : 's'} will move to {masterRow?.account_name}
                </div>
                {childTotal === 0 ? (
                  <div style={{ fontSize: 12, color: C.textMuted }}>The duplicate has no linked records — it will simply be removed.</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(counts).map(([k, n]) => (
                      <span key={k} style={{ fontSize: 11, color: C.textSecondary, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 20, padding: '2px 9px' }}>
                        {prettify(k.split('.')[0])}: <strong>{n}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11.5, color: C.textMuted }}>
            {loser ? 'The merged account is soft-deleted (recoverable) and the merge is logged.' : ''}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {loser && !loadingStep && <button onClick={() => { setLoser(null); setLoserRow(null); setCounts(null); setChoices({}); setError(null) }} style={btnGhost} disabled={busy}>Back</button>}
            <button onClick={onClose} style={btnGhost} disabled={busy}>Cancel</button>
            {loser && !loadingStep && (
              <button onClick={confirmMerge} disabled={busy} style={btnPrimary(busy)}>
                {busy ? 'Merging…' : `Merge into ${masterRow?.account_name || 'master'}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ValuePick({ selected, onSelect, value, accent }) {
  return (
    <div onClick={onSelect} style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', cursor: 'pointer',
      border: `1.5px solid ${selected ? accent : C.border}`, borderRadius: 7,
      background: selected ? `${accent}12` : '#fff',
    }}>
      <span style={{
        width: 14, height: 14, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        border: `2px solid ${selected ? accent : C.borderDark}`,
        background: selected ? accent : '#fff',
      }} />
      <span style={{ fontSize: 12.5, color: C.textPrimary, wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(13,26,46,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }
const card = { background: '#fff', borderRadius: 12, width: '100%', maxWidth: 640, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)', fontFamily: 'Inter, system-ui, sans-serif' }
const xBtn = { background: 'transparent', border: 'none', fontSize: 16, color: C.textMuted, cursor: 'pointer', lineHeight: 1 }
const lbl = { display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }
const input = { width: '100%', border: `1px solid ${C.border}`, borderRadius: 7, padding: '9px 11px', fontSize: 13, outline: 'none', fontFamily: 'inherit', color: C.textPrimary }
const rowMuted = { padding: '12px', fontSize: 12.5, color: C.textMuted }
const pickRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', cursor: 'pointer', borderTop: `1px solid ${C.border}`, background: '#fff' }
const btnGhost = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 14px', fontSize: 12.5, color: C.textSecondary, cursor: 'pointer', fontWeight: 500 }
const colHead = (isMaster) => ({ border: `1px solid ${isMaster ? '#a7f3d0' : '#bfdbfe'}`, background: isMaster ? '#ecfdf5' : '#eff6ff', borderRadius: 8, padding: '10px 12px' })
const pill = (color) => ({ fontSize: 9.5, fontWeight: 700, letterSpacing: '.4px', color })
function btnPrimary(busy) {
  return { background: busy ? C.textMuted : C.emerald, border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 12.5, color: '#fff', cursor: busy ? 'default' : 'pointer', fontWeight: 600 }
}
