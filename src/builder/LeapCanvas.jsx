// =============================================================================
// src/builder/LeapCanvas.jsx
//
// The unified WYSIWYG builder shell — the single three-pane editor that every
// surface (dashboards, home pages, reports, record page layouts) will reuse:
//
//     ┌───────────┬──────────────────────────────┬───────────────┐
//     │  Palette  │        Live canvas            │   Inspector   │
//     │ (registry)│  (react-grid-layout, WYSIWYG) │ (configSchema)│
//     └───────────┴──────────────────────────────┴───────────────┘
//
// It owns the editing state (placed components + their grid geometry +
// selection) and is surface-agnostic: a surface configures it by passing an
// initial set of components/layout and an onSave handler. The palette, canvas
// tiles, and inspector form are all driven by the component registry — the
// shell knows nothing about specific widget types.
//
// Phase 0 deliberately stops at the shell + registry + geometry. It does not
// touch the runners or the legacy builders (they keep working untouched); a
// surface adapter that reads/writes the real dashboards tables is Phase 1.
// =============================================================================

import { useState, useRef } from 'react'
import { C } from '../data/constants'
import Palette from './Palette'
import CanvasGrid from './CanvasGrid'
import Inspector from './Inspector'
import { getComponent, defaultConfigFor } from './componentRegistry'
import { newLayoutItem } from './geometry'

export default function LeapCanvas({
  title = 'LEAP Canvas',
  subtitle,
  initialComponents = [],
  initialLayout = [],
  onSave,
  onClose,
}) {
  const [components, setComponents] = useState(initialComponents)
  const [layout, setLayout]         = useState(initialLayout)
  const [selectedId, setSelectedId] = useState(null)
  const [activeDrag, setActiveDrag] = useState(null)   // registry id of chip being dragged
  const [savedAt, setSavedAt]       = useState(null)
  const idRef = useRef(initialComponents.length + 1)

  const nextId = () => `c-${idRef.current++}`

  // Add a component, optionally at an explicit grid position (from a drop).
  const addComponent = (typeId, at) => {
    const entry = getComponent(typeId)
    if (!entry) return
    const id = nextId()
    const item = newLayoutItem(id, entry, layout)
    if (at) { item.x = at.x; item.y = at.y }
    setComponents(prev => [...prev, { id, type: typeId, title: '', dataSourceId: null, config: defaultConfigFor(typeId) }])
    setLayout(prev => [...prev, item])
    setSelectedId(id)
  }

  // Inspector change router. The reserved id '__reorder__' carries a reordered
  // components array from the layer list (dnd-kit); everything else is a patch
  // to one component.
  const handleInspectorChange = (id, patchOrArray) => {
    if (id === '__reorder__') { setComponents(patchOrArray); return }
    setComponents(prev => prev.map(c => c.id === id ? { ...c, ...patchOrArray } : c))
  }

  const removeComponent = (id) => {
    setComponents(prev => prev.filter(c => c.id !== id))
    setLayout(prev => prev.filter(l => l.i !== id))
    setSelectedId(sel => sel === id ? null : sel)
  }

  const handleSave = () => {
    onSave?.({ components, layout })
    setSavedAt(new Date())
  }

  const droppingSize = activeDrag ? (getComponent(activeDrag)?.defaultSize) : null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.page }}>
      {/* Header */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: C.textPrimary }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: C.textMuted }}>{subtitle}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {savedAt && <span style={{ fontSize: 11, color: C.textMuted }}>Saved {savedAt.toLocaleTimeString()}</span>}
          {onClose && <button onClick={onClose} style={btnSecondary()}>Close</button>}
          {onSave && <button onClick={handleSave} style={btnPrimary()}>Save</button>}
        </div>
      </div>

      {/* Three panes */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Palette
          onAdd={(id) => addComponent(id)}
          onDragStart={(id) => setActiveDrag(id)}
          onDragEnd={() => setActiveDrag(null)}
        />
        <CanvasGrid
          components={components}
          layout={layout}
          selectedId={selectedId}
          droppingSize={droppingSize}
          onLayoutChange={setLayout}
          onSelect={setSelectedId}
          onDrop={(item) => { if (activeDrag) { addComponent(activeDrag, item); setActiveDrag(null) } }}
        />
        <Inspector
          components={components}
          selectedId={selectedId}
          onChange={handleInspectorChange}
          onSelect={setSelectedId}
          onRemove={removeComponent}
        />
      </div>
    </div>
  )
}

function btnPrimary() {
  return {
    padding: '8px 16px', fontSize: 13, fontWeight: 500,
    background: C.emerald, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
  }
}
function btnSecondary() {
  return {
    padding: '8px 14px', fontSize: 13, fontWeight: 500,
    background: C.card, color: C.textPrimary, border: `1px solid ${C.borderDark}`, borderRadius: 6, cursor: 'pointer',
  }
}
