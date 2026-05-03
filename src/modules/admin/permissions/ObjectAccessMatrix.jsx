import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../../../data/constants'
import { OBJECT_CATALOG } from '../objectCatalog'
import { LoadingState } from '../../../components/UI'
import {
  buttonPrimaryStyle, buttonSecondaryStyle, hintBoxStyle,
} from '../adminStyles'

// ---------------------------------------------------------------------------
// ObjectAccessMatrix
//
// Renders a Salesforce-style profile object permissions table:
// every object catalog entry is a row, with four checkbox columns
// (Read / Create / Update / Delete) and a per-module group header.
//
// The component is used twice — once with `mode="role"` for the Role
// baseline, once with `mode="pset"` for a Permission Set's additive grants.
// The mode just changes the header copy, hint banner, and the call signature
// of `onSave`; the matrix shape is identical.
//
// State model:
//   - `accessMap` is the saved server state (object_name → {r,c,u,d})
//   - `pending`   is the unsaved diff laid on top while the admin is editing
// On Save, we walk only the entries that exist in `pending` and call
// `onSave(objectName, finalPerms)` for each so the parent can persist one
// row at a time. Errors are surfaced inline; rows that succeed are merged
// into `accessMap` and dropped from `pending`.
// ---------------------------------------------------------------------------

const ACTIONS = [
  { key: 'read',   label: 'Read'   },
  { key: 'create', label: 'Create' },
  { key: 'update', label: 'Update' },
  { key: 'delete', label: 'Delete' },
]

export default function ObjectAccessMatrix({
  mode,        // 'role' | 'pset'
  loading,
  accessMap,   // { [object_name]: { read, create, update, delete } }
  onSave,      // async (objectName, perms) => persistedRow
  onAfterSave, // optional callback when the full save batch completes
}) {
  const [pending, setPending] = useState({})    // { [object_name]: { r,c,u,d } }
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)
  // Keep a ref so the keyboard-shortcut Save handler (added once) can reach
  // the current pending state without re-binding listeners on every keystroke.
  const pendingRef = useRef(pending)
  useEffect(() => { pendingRef.current = pending }, [pending])

  // Group object catalog by module for the rendered table.
  const grouped = useMemo(() => {
    const map = new Map()
    for (const obj of OBJECT_CATALOG) {
      if (!map.has(obj.module)) map.set(obj.module, [])
      map.get(obj.module).push(obj)
    }
    return Array.from(map.entries())
  }, [])

  // Resolve the effective value for a cell: pending override → saved → false.
  const getEffective = (objectName, action) => {
    const p = pending[objectName]
    if (p && Object.prototype.hasOwnProperty.call(p, action)) return !!p[action]
    return !!accessMap?.[objectName]?.[action]
  }

  const isDirty = Object.keys(pending).length > 0

  const toggle = (objectName, action) => {
    setError(null)
    setPending(prev => {
      const current = getEffective(objectName, action)
      const existing = prev[objectName] ? { ...prev[objectName] } : {}
      existing[action] = !current
      // Compare against saved baseline; if the row would resolve to identical,
      // drop it from pending so we don't pretend there's a change.
      const baseline = accessMap?.[objectName] || {}
      const merged = { ...baseline, ...existing }
      const same = ACTIONS.every(a => !!merged[a.key] === !!baseline[a.key])
      const next = { ...prev }
      if (same) delete next[objectName]
      else next[objectName] = existing
      return next
    })
  }

  // Bulk-toggle a whole row to all-on or all-off.
  const setRowAll = (objectName, value) => {
    setError(null)
    setPending(prev => {
      const baseline = accessMap?.[objectName] || {}
      const next = { ...prev }
      const all = { read: value, create: value, update: value, delete: value }
      const same = ACTIONS.every(a => !!all[a.key] === !!baseline[a.key])
      if (same) delete next[objectName]
      else next[objectName] = all
      return next
    })
  }

  // Bulk-toggle every object in a module.
  const setModuleAll = (moduleName, value) => {
    setError(null)
    const objs = OBJECT_CATALOG.filter(o => o.module === moduleName)
    setPending(prev => {
      const next = { ...prev }
      for (const obj of objs) {
        const baseline = accessMap?.[obj.table] || {}
        const all = { read: value, create: value, update: value, delete: value }
        const same = ACTIONS.every(a => !!all[a.key] === !!baseline[a.key])
        if (same) delete next[obj.table]
        else next[obj.table] = all
      }
      return next
    })
  }

  const discard = () => { setPending({}); setError(null) }

  const save = async () => {
    if (!isDirty || saving) return
    setSaving(true)
    setError(null)
    try {
      // Sequential save — keeps the failure point obvious if anything goes
      // wrong, and 89 rows × four flags is small enough that throughput
      // isn't a concern here.
      for (const [objectName, partial] of Object.entries(pendingRef.current)) {
        const baseline = accessMap?.[objectName] || {}
        const final = {
          read:   Object.prototype.hasOwnProperty.call(partial, 'read')   ? !!partial.read   : !!baseline.read,
          create: Object.prototype.hasOwnProperty.call(partial, 'create') ? !!partial.create : !!baseline.create,
          update: Object.prototype.hasOwnProperty.call(partial, 'update') ? !!partial.update : !!baseline.update,
          delete: Object.prototype.hasOwnProperty.call(partial, 'delete') ? !!partial.delete : !!baseline.delete,
        }
        await onSave(objectName, final)
      }
      setPending({})
      if (onAfterSave) await onAfterSave()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState />

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Hint banner — rules of resolution, kept short */}
      <div style={{ padding: '14px 24px 0' }}>
        <div style={hintBoxStyle}>
          {mode === 'role' ? (
            <>
              <strong>Role baseline.</strong> A user with this role gets the access checked
              below by default. Any permission sets assigned to that user can grant
              additional access on top — they cannot take role access away here.
            </>
          ) : (
            <>
              <strong>Permission set grant.</strong> Object access checked here is added
              on top of whatever the user&rsquo;s base role already grants. To revoke role
              access, edit the role.
            </>
          )}
        </div>
      </div>

      {/* Sticky save bar — only shows when there are unsaved changes */}
      <div style={{
        padding: '0 24px 10px', display: 'flex', alignItems: 'center', gap: 10,
        minHeight: isDirty || error ? 38 : 0,
        transition: 'min-height 120ms ease',
      }}>
        {isDirty && (
          <>
            <span style={{ fontSize: 12, color: C.textSecondary }}>
              {Object.keys(pending).length} unsaved change{Object.keys(pending).length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              style={{ ...buttonPrimaryStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              style={buttonSecondaryStyle}
            >
              Discard
            </button>
          </>
        )}
        {error && (
          <span style={{ fontSize: 12, color: '#b03a2e' }}>
            Save failed — {error}
          </span>
        )}
      </div>

      {/* Scrollable matrix */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'separate',
          borderSpacing: 0,
          fontSize: 12.5,
        }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: '40%', textAlign: 'left' }}>Object</th>
              {ACTIONS.map(a => (
                <th key={a.key} style={{ ...thStyle, width: '13%' }}>{a.label}</th>
              ))}
              <th style={{ ...thStyle, width: '8%' }}></th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([moduleName, objs]) => (
              <ModuleRows
                key={moduleName}
                moduleName={moduleName}
                objs={objs}
                getEffective={getEffective}
                onToggle={toggle}
                onRowAll={setRowAll}
                onModuleAll={setModuleAll}
                pending={pending}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// One module: a sticky-style group header followed by all its object rows.
function ModuleRows({ moduleName, objs, getEffective, onToggle, onRowAll, onModuleAll, pending }) {
  return (
    <>
      <tr>
        <td colSpan={6} style={{
          padding: '14px 8px 6px',
          fontSize: 11.5, fontWeight: 700, color: C.textSecondary,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          borderBottom: `1px solid ${C.border}`,
          background: C.page,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{moduleName}</span>
            <span style={{ display: 'flex', gap: 8, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
              <button type="button" onClick={() => onModuleAll(moduleName, true)}
                style={miniLinkStyle}>Grant all</button>
              <span style={{ color: C.textMuted }}>·</span>
              <button type="button" onClick={() => onModuleAll(moduleName, false)}
                style={miniLinkStyle}>Clear all</button>
            </span>
          </div>
        </td>
      </tr>
      {objs.map(obj => {
        const dirty = !!pending[obj.table]
        return (
          <tr key={obj.table}
            style={{ background: dirty ? '#fff8e6' : 'transparent' }}
          >
            <td style={{ ...tdStyle, textAlign: 'left' }}>
              <div style={{ fontWeight: 500, color: C.textPrimary }}>{obj.label}</div>
              <div style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{obj.table}</div>
            </td>
            {ACTIONS.map(a => (
              <td key={a.key} style={{ ...tdStyle, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={getEffective(obj.table, a.key)}
                  onChange={() => onToggle(obj.table, a.key)}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: C.emerald }}
                  aria-label={`${a.label} ${obj.label}`}
                />
              </td>
            ))}
            <td style={{ ...tdStyle, textAlign: 'right' }}>
              <button type="button" onClick={() => onRowAll(obj.table, true)}
                style={miniLinkStyle} title="Grant all four">All</button>
              <span style={{ color: C.textMuted, margin: '0 4px' }}>·</span>
              <button type="button" onClick={() => onRowAll(obj.table, false)}
                style={miniLinkStyle} title="Clear all four">None</button>
            </td>
          </tr>
        )
      })}
    </>
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

const miniLinkStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 11.5,
  color: C.emerald,
  cursor: 'pointer',
  fontWeight: 500,
}
