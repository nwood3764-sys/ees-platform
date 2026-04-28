import { useState, useMemo, useEffect } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { OBJECT_CATALOG, MODULE_ORDER, getObjectsGrouped } from './objectCatalog'
import { fetchRecordCount } from '../../data/adminService'

// ---------------------------------------------------------------------------
// Object Manager — searchable list of every Energy Efficiency Services object, grouped by module.
// Clicking an object opens ObjectDetail for it.
// ---------------------------------------------------------------------------

export default function ObjectManager({ onOpenObject }) {
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState({})   // { tableName: number }
  const [loadingCounts, setLoadingCounts] = useState(true)

  // Load record counts for every table in parallel. RLS filters to what
  // the current user can see, so the counts reflect *their* visibility —
  // which is actually what an admin wants to see in the Object Manager.
  useEffect(() => {
    let cancelled = false
    setLoadingCounts(true)
    Promise.all(
      OBJECT_CATALOG.map(async o => ({
        table: o.table,
        count: await fetchRecordCount(o.table),
      }))
    ).then(results => {
      if (cancelled) return
      const m = {}
      for (const r of results) m[r.table] = r.count
      setCounts(m)
      setLoadingCounts(false)
    })
    return () => { cancelled = true }
  }, [])

  // Filter by search term — matches label, plural, table name, or module
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return OBJECT_CATALOG
    return OBJECT_CATALOG.filter(o =>
      o.label.toLowerCase().includes(q) ||
      o.pluralLabel.toLowerCase().includes(q) ||
      o.table.toLowerCase().includes(q) ||
      o.module.toLowerCase().includes(q)
    )
  }, [search])

  const grouped = useMemo(() => {
    const g = {}
    for (const m of MODULE_ORDER) g[m] = []
    for (const o of filtered) {
      if (!g[o.module]) g[o.module] = []
      g[o.module].push(o)
    }
    for (const m of Object.keys(g)) {
      g[m].sort((a, b) => a.label.localeCompare(b.label))
    }
    return g
  }, [filtered])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header / search bar — classic SF Object Manager top bar */}
      <div style={{
        padding: '14px 24px 12px', background: C.card, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Object Manager</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
            {OBJECT_CATALOG.length} objects across {MODULE_ORDER.length} modules
          </div>
        </div>
        <div style={{ position: 'relative', width: 320 }}>
          <Icon path="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            size={14} color={C.textMuted}
          />
          <input
            type="text"
            placeholder="Quick Find"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 12px 7px 32px',
              border: `1px solid ${C.border}`,
              borderRadius: 5,
              fontSize: 13,
              background: C.page,
              color: C.textPrimary,
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={e => e.currentTarget.style.borderColor = C.emerald}
            onBlur={e => e.currentTarget.style.borderColor = C.border}
          />
          <span style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            pointerEvents: 'none',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
        </div>
      </div>

      {/* Table header */}
      <div style={{
        padding: '9px 24px', background: '#fafbfd', borderBottom: `1px solid ${C.border}`,
        display: 'grid', gridTemplateColumns: '1.6fr 1.6fr 1fr 1fr 100px', gap: 16,
        fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        <div>Label</div>
        <div>API Name (Table)</div>
        <div>Module</div>
        <div>Description</div>
        <div style={{ textAlign: 'right' }}>Records</div>
      </div>

      {/* Grouped rows */}
      <div style={{ flex: 1, overflow: 'auto', background: C.card }}>
        {MODULE_ORDER.map(mod => {
          const items = grouped[mod] || []
          if (items.length === 0) return null
          return (
            <div key={mod}>
              <div style={{
                padding: '8px 24px', background: '#f4f6fa',
                fontSize: 10.5, fontWeight: 700, color: C.textSecondary,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                borderBottom: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}`,
              }}>
                {mod} <span style={{ color: C.textMuted, fontWeight: 500 }}>· {items.length}</span>
              </div>
              {items.map(o => (
                <ObjectRow
                  key={o.table}
                  obj={o}
                  count={counts[o.table]}
                  loading={loadingCounts}
                  onClick={() => onOpenObject(o)}
                />
              ))}
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            No objects match "{search}".
          </div>
        )}
      </div>
    </div>
  )
}

function ObjectRow({ obj, count, loading, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '11px 24px',
        display: 'grid',
        gridTemplateColumns: '1.6fr 1.6fr 1fr 1fr 100px',
        gap: 16,
        alignItems: 'center',
        fontSize: 12.5,
        borderBottom: `1px solid ${C.border}`,
        cursor: 'pointer',
        background: hover ? '#f7f9fc' : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <div style={{ color: C.emerald, fontWeight: 500 }}>{obj.pluralLabel}</div>
      <div style={{ color: C.textSecondary, fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>
        {obj.table}
      </div>
      <div style={{ color: C.textSecondary }}>{obj.module}</div>
      <div style={{ color: C.textMuted, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {obj.description}
      </div>
      <div style={{
        textAlign: 'right',
        color: count == null || loading ? C.textMuted : C.textPrimary,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 12,
      }}>
        {loading && count == null ? '…' : (count != null ? count.toLocaleString() : '—')}
      </div>
    </div>
  )
}
