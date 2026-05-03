import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../../../data/constants'
import { OBJECT_CATALOG } from '../objectCatalog'
import { LoadingState } from '../../../components/UI'
import HelpIcon from '../../../components/help/HelpIcon'
import { fetchObjectFields } from '../../../data/permissionsService'
import {
  buttonPrimaryStyle, buttonSecondaryStyle, hintBoxStyle, inputStyle,
} from '../adminStyles'

// ---------------------------------------------------------------------------
// FieldVisibilityMatrix
//
// Two-pane editor: pick an object on the left, edit per-field permissions
// (Visible, Editable, Financial Tier) on the right. Used for both the role
// baseline (mode='role') and permission set overrides (mode='pset').
//
// The parent owns the load/save callbacks. This component only knows how
// to render a matrix for one object at a time and dispatch save calls per
// changed row. Object catalog provides the navigable list; field discovery
// is per-object via describe_object_columns.
// ---------------------------------------------------------------------------

const TIER_OPTIONS = [
  { value: '',  label: '— None —' },
  { value: '1', label: 'Tier 1 — All staff' },
  { value: '2', label: 'Tier 2 — PM and above' },
  { value: '3', label: 'Tier 3 — Admin only' },
]

export default function FieldVisibilityMatrix({
  mode,             // 'role' | 'pset'
  permsForObject,   // (objectName) => Promise<map>: fp_field -> {visible, editable, financial_tier}
  saveFieldPerm,    // (objectName, fieldName, perms) => Promise
}) {
  const [selectedObject, setSelectedObject] = useState(null)
  const [fields,    setFields]    = useState([])
  const [permsMap,  setPermsMap]  = useState({})  // saved server state
  const [pending,   setPending]   = useState({})  // unsaved overrides keyed by field name
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState(null)
  const [search,    setSearch]    = useState('')

  // Re-fetch when the user selects a different object — invalidate any
  // pending edits along with it (the admin can't carry edits across objects).
  useEffect(() => {
    if (!selectedObject) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPending({})

    Promise.all([
      fetchObjectFields(selectedObject.table),
      permsForObject(selectedObject.table),
    ])
      .then(([cols, map]) => {
        if (cancelled) return
        setFields(cols)
        setPermsMap(map || {})
      })
      .catch(e => { if (!cancelled) setError(e?.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [selectedObject, permsForObject])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const obj of OBJECT_CATALOG) {
      if (!map.has(obj.module)) map.set(obj.module, [])
      map.get(obj.module).push(obj)
    }
    return Array.from(map.entries())
  }, [])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return grouped
    return grouped
      .map(([module, objs]) => [module, objs.filter(o =>
        o.label.toLowerCase().includes(q) || o.table.toLowerCase().includes(q)
      )])
      .filter(([, objs]) => objs.length > 0)
  }, [grouped, search])

  // For role mode the baseline default is visible+editable+no tier; for psets
  // the default is also "no override row" but we treat it the same in UI.
  const getEffective = (fieldName) => {
    const p = pending[fieldName]
    const saved = permsMap[fieldName]
    return {
      visible:        p?.hasOwnProperty('visible')        ? !!p.visible        : (saved ? !!saved.visible        : true),
      editable:       p?.hasOwnProperty('editable')       ? !!p.editable       : (saved ? !!saved.editable       : true),
      financial_tier: p?.hasOwnProperty('financial_tier') ? p.financial_tier   : (saved ? saved.financial_tier   : null),
    }
  }

  const setField = (fieldName, key, value) => {
    setError(null)
    const saved = permsMap[fieldName] || { visible: true, editable: true, financial_tier: null }
    setPending(prev => {
      const existing = prev[fieldName] ? { ...prev[fieldName] } : {}
      existing[key] = value
      // If the merged row matches saved exactly, drop pending entry.
      const merged = {
        visible:        existing.hasOwnProperty('visible')        ? !!existing.visible        : !!saved.visible,
        editable:       existing.hasOwnProperty('editable')       ? !!existing.editable       : !!saved.editable,
        financial_tier: existing.hasOwnProperty('financial_tier') ? existing.financial_tier   : saved.financial_tier,
      }
      const same = !!merged.visible === !!saved.visible &&
                   !!merged.editable === !!saved.editable &&
                   (merged.financial_tier ?? null) === (saved.financial_tier ?? null)
      const next = { ...prev }
      if (same) delete next[fieldName]
      else next[fieldName] = existing
      return next
    })
  }

  const isDirty = Object.keys(pending).length > 0
  const pendingRef = useRef(pending)
  useEffect(() => { pendingRef.current = pending }, [pending])

  const discard = () => { setPending({}); setError(null) }

  const save = async () => {
    if (!selectedObject || !isDirty || saving) return
    setSaving(true)
    setError(null)
    try {
      for (const fieldName of Object.keys(pendingRef.current)) {
        const eff = (() => {
          const p = pendingRef.current[fieldName]
          const saved = permsMap[fieldName] || { visible: true, editable: true, financial_tier: null }
          return {
            visible:        p?.hasOwnProperty('visible')        ? !!p.visible        : !!saved.visible,
            editable:       p?.hasOwnProperty('editable')       ? !!p.editable       : !!saved.editable,
            financial_tier: p?.hasOwnProperty('financial_tier') ? p.financial_tier   : saved.financial_tier,
          }
        })()
        await saveFieldPerm(selectedObject.table, fieldName, eff)
      }
      // Refresh saved state from the server to stay consistent.
      const fresh = await permsForObject(selectedObject.table)
      setPermsMap(fresh || {})
      setPending({})
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Object picker */}
      <div style={{
        width: 280, flexShrink: 0,
        background: C.card,
        borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}>
          <input
            type="text"
            placeholder="Filter objects…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, padding: '7px 10px', fontSize: 12.5 }}
          />
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
          {filteredGroups.map(([moduleName, objs]) => (
            <div key={moduleName}>
              <div style={{
                padding: '10px 14px 4px',
                fontSize: 11, fontWeight: 700, color: C.textMuted,
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>{moduleName}</div>
              {objs.map(o => {
                const active = selectedObject?.table === o.table
                return (
                  <div
                    key={o.table}
                    onClick={() => setSelectedObject(o)}
                    style={{
                      padding: '7px 14px 7px 22px',
                      fontSize: 12.5,
                      color: active ? C.textPrimary : C.textSecondary,
                      fontWeight: active ? 500 : 400,
                      background: active ? '#f0f9f5' : 'transparent',
                      borderLeft: active ? `3px solid ${C.emerald}` : '3px solid transparent',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f7f9fc' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                  >
                    {o.label}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Field matrix */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedObject ? (
          <div style={{ padding: '40px 32px', flex: 1 }}>
            <div style={hintBoxStyle}>
              {mode === 'role'
                ? 'Select an object on the left to set the per-field visibility, editability, and financial tier baseline for this role.'
                : 'Select an object on the left to add per-field overrides for this permission set. Override rows take precedence over the role baseline; when multiple permission sets disagree on the same field, the most restrictive wins.'}
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: '14px 24px 0' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>
                {selectedObject.label}
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 400, color: C.textMuted, fontSize: 12, marginLeft: 8 }}>
                  {selectedObject.table}
                </span>
              </div>
              <div style={hintBoxStyle}>
                {mode === 'role' ? (
                  <>
                    <strong>Default is visible + editable.</strong> Uncheck Visible to hide the
                    field from any user with this role. Uncheck Editable to render the field
                    read-only. Set a Financial Tier to gate the field behind the tiered
                    visibility model — Tier 2 = PM and above, Tier 3 = Admin only.
                  </>
                ) : (
                  <>
                    <strong>Override.</strong> Adding a row here overrides the role baseline
                    for users with this permission set. Most restrictive wins when multiple
                    permission sets disagree.
                  </>
                )}
              </div>
            </div>

            <div style={{
              padding: '0 24px 10px', display: 'flex', alignItems: 'center', gap: 10,
              minHeight: isDirty || error ? 38 : 0,
            }}>
              {isDirty && (
                <>
                  <span style={{ fontSize: 12, color: C.textSecondary }}>
                    {Object.keys(pending).length} unsaved change{Object.keys(pending).length === 1 ? '' : 's'}
                  </span>
                  <button type="button" onClick={save} disabled={saving}
                    style={{ ...buttonPrimaryStyle, opacity: saving ? 0.6 : 1 }}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button type="button" onClick={discard} disabled={saving}
                    style={buttonSecondaryStyle}>Discard</button>
                </>
              )}
              {error && <span style={{ fontSize: 12, color: '#b03a2e' }}>Save failed — {error}</span>}
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
              {loading ? <LoadingState /> : (
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, width: '46%', textAlign: 'left' }}>Field</th>
                      <th style={{ ...thStyle, width: '14%' }}>Visible</th>
                      <th style={{ ...thStyle, width: '14%' }}>Editable</th>
                      <th style={{ ...thStyle, width: '26%', textAlign: 'left' }}>
                        Financial Tier
                        <HelpIcon concept="financial-tier" title="Financial Tiers" size={12} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map(f => {
                      const eff = getEffective(f.name)
                      const dirty = !!pending[f.name]
                      return (
                        <tr key={f.name} style={{ background: dirty ? '#fff8e6' : 'transparent' }}>
                          <td style={{ ...tdStyle, textAlign: 'left' }}>
                            <div style={{ fontWeight: 500, color: C.textPrimary }}>{f.label}</div>
                            <div style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
                              {f.name} <span style={{ marginLeft: 6, color: C.textMuted }}>· {f.dataType}</span>
                            </div>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={!!eff.visible}
                              onChange={e => setField(f.name, 'visible', e.target.checked)}
                              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: C.emerald }}
                            />
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={!!eff.editable}
                              disabled={!eff.visible}
                              onChange={e => setField(f.name, 'editable', e.target.checked)}
                              style={{
                                width: 16, height: 16,
                                cursor: !eff.visible ? 'not-allowed' : 'pointer',
                                accentColor: C.emerald,
                                opacity: eff.visible ? 1 : 0.4,
                              }}
                              title={!eff.visible ? 'A hidden field cannot be editable.' : undefined}
                            />
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'left' }}>
                            <select
                              value={eff.financial_tier == null ? '' : String(eff.financial_tier)}
                              onChange={e => {
                                const v = e.target.value
                                setField(f.name, 'financial_tier', v === '' ? null : Number(v))
                              }}
                              style={{ ...inputStyle, padding: '5px 8px', fontSize: 12.5, width: '100%' }}
                            >
                              {TIER_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                    {fields.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ padding: 24, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>
                          No editable fields detected for this object.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const thStyle = {
  padding: '8px 8px',
  fontSize: 11,
  fontWeight: 600,
  color: C.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  textAlign: 'center',
  background: C.card,
  borderBottom: `2px solid ${C.borderDark}`,
  position: 'sticky',
  top: 0,
  zIndex: 1,
}

const tdStyle = {
  padding: '7px 8px',
  borderBottom: `1px solid ${C.border}`,
  fontSize: 12.5,
  color: C.textPrimary,
  verticalAlign: 'middle',
}
