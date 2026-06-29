// =============================================================================
// src/builder/Palette.jsx
//
// The left rail of the LEAP Canvas: draggable component chips, grouped by the
// categories declared in the registry. Two ways to place a component:
//   • DRAG a chip onto the canvas — react-grid-layout catches the native HTML5
//     drag (the chip is draggable; the grid is isDroppable). onDragStart tells
//     the canvas which component is in flight so it can size the drop preview.
//   • CLICK a chip — appends the component (touch / keyboard fallback, since
//     RGL's external drag-in is pointer-only).
//
// The palette is generated entirely from the registry; it never enumerates
// component types itself.
// =============================================================================

import { useState } from 'react'
import { C } from '../data/constants'
import { getPaletteCategories } from './componentRegistry'

export default function Palette({ onDragStart, onDragEnd, onAdd }) {
  const categories = getPaletteCategories()
  const [collapsed, setCollapsed] = useState({})
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const filtered = q
    ? categories
        .map(c => ({ ...c, components: c.components.filter(e => e.label.toLowerCase().includes(q)) }))
        .filter(c => c.components.length)
    : categories

  return (
    <div style={{
      width: 232, flexShrink: 0, borderRight: `1px solid ${C.border}`,
      background: C.card, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, background: C.cardSecondary, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 8 }}>Components</div>
        <input type="text" value={query} placeholder="Search components…"
          onChange={e => setQuery(e.target.value)}
          style={{
            width: '100%', padding: '6px 9px', fontSize: 12, boxSizing: 'border-box',
            background: C.card, color: C.textPrimary, border: `1px solid ${C.border}`, borderRadius: 6, font: 'inherit',
          }} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {filtered.map(({ category, components }) => {
          const isCollapsed = !q && collapsed[category]
          return (
            <div key={category} style={{ marginBottom: 10 }}>
              <button
                onClick={() => setCollapsed(s => ({ ...s, [category]: !s[category] }))}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 2px',
                  fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                <span>{category}</span>
                <span style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 150ms' }}>▾</span>
              </button>
              {!isCollapsed && components.map(entry => (
                <div
                  key={entry.id}
                  draggable
                  onDragStart={(e) => {
                    // RGL reads dataTransfer presence; the payload itself is set
                    // for completeness. The canvas tracks the active component
                    // via onDragStart so it can size the drop preview.
                    e.dataTransfer.setData('text/plain', entry.id)
                    e.dataTransfer.effectAllowed = 'copy'
                    onDragStart?.(entry.id)
                  }}
                  onDragEnd={() => onDragEnd?.()}
                  onClick={() => onAdd?.(entry.id)}
                  title={`Drag onto the canvas, or click to add — ${entry.label}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', marginBottom: 5,
                    background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 7,
                    cursor: 'grab', userSelect: 'none',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.emerald }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border }}
                >
                  <span style={{
                    width: 28, height: 28, flexShrink: 0, borderRadius: 6, background: C.card,
                    border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.emeraldMid} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={entry.icon} />
                    </svg>
                  </span>
                  <span style={{ fontSize: 12.5, color: C.textPrimary }}>{entry.label}</span>
                </div>
              ))}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ fontSize: 12, color: C.textMuted, padding: '8px 2px' }}>No components match “{query}”.</div>
        )}
      </div>
    </div>
  )
}
