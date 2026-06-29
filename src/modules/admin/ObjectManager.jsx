import { useState, useMemo } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { OBJECT_CATALOG } from './objectCatalog'

// ---------------------------------------------------------------------------
// Object Manager — searchable flat alphabetical list of every Energy
// Efficiency Services object. Clicking an object opens ObjectDetail for it.
// ---------------------------------------------------------------------------

export default function ObjectManager({ onOpenObject }) {
  const [search, setSearch] = useState('')

  // Filter by search term — matches label, plural, or table name.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return OBJECT_CATALOG
    return OBJECT_CATALOG.filter(o =>
      o.label.toLowerCase().includes(q) ||
      o.pluralLabel.toLowerCase().includes(q) ||
      o.table.toLowerCase().includes(q)
    )
  }, [search])

  // One flat alphabetical list. Modules are Salesforce-style apps over one
  // shared database — every object is accessible from every app — so an object
  // has no single owning module; the Object Manager doesn't show one. Sort by
  // label, like SF's own Object Manager.
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => a.label.localeCompare(b.label)),
    [filtered]
  )

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
            {OBJECT_CATALOG.length} objects
          </div>
        </div>
        <div style={{ position: 'relative', width: 320 }}>
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
        display: 'grid', gridTemplateColumns: '1.6fr 1.6fr 2fr', gap: 16,
        fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        <div>Label</div>
        <div>API Name (Table)</div>
        <div>Description</div>
      </div>

      {/* Flat alphabetical rows */}
      <div style={{ flex: 1, overflow: 'auto', background: C.card }}>
        {sorted.map(o => (
          <ObjectRow
            key={o.table}
            obj={o}
            onClick={() => onOpenObject(o)}
          />
        ))}

        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            No objects match "{search}".
          </div>
        )}
      </div>
    </div>
  )
}

function ObjectRow({ obj, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '11px 24px',
        display: 'grid',
        gridTemplateColumns: '1.6fr 1.6fr 2fr',
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
      <div style={{ color: C.textMuted, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {obj.description}
      </div>
    </div>
  )
}
