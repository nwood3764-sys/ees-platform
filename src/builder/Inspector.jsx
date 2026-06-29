// =============================================================================
// src/builder/Inspector.jsx
//
// The right rail of the LEAP Canvas — now fully surface-agnostic. Two modes:
//   • a component is selected → the registry's ComponentInspector renders the
//     config form (dashboards bind to reports + measures; home pages bind to a
//     dashboard/report/list-view source — the shell doesn't care which).
//   • nothing selected → the surface's settings panel (if any) + a reorderable
//     "Layers" list (dnd-kit) of every placed component.
// =============================================================================

import { C } from '../data/constants'
import SortableList from './SortableList'

export default function Inspector({ registry, components, selectedId, settingsPanel, sources, onChange, onSelect, onRemove }) {
  const selected = components.find(c => c.id === selectedId) || null
  const ComponentInspector = registry.ComponentInspector
  return (
    <div style={{
      width: 300, flexShrink: 0, borderLeft: `1px solid ${C.border}`,
      background: C.card, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={paneHeader()}>{selected ? 'Component' : 'Page'}</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {selected
          ? <ComponentInspector key={selected.id} component={selected} sources={sources}
              onChange={(patch) => onChange(selected.id, patch)} onRemove={() => onRemove(selected.id)} />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {settingsPanel}
              <LayersPanel registry={registry} components={components} onSelect={onSelect}
                onReorder={(next) => onChange('__reorder__', next)} />
            </div>
          )}
      </div>
    </div>
  )
}

function LayersPanel({ registry, components, onSelect, onReorder }) {
  if (components.length === 0) {
    return (
      <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
        Drag a component from the left palette onto the canvas to begin. Select
        a placed component to configure it here.
      </div>
    )
  }
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Components on this page
      </div>
      <SortableList
        items={components}
        onReorder={onReorder}
        renderItem={(item, { setNodeRef, style, dragHandleProps }) => {
          const entry = registry.getComponent(item.type)
          return (
            <div ref={setNodeRef} style={{ ...style, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span {...dragHandleProps} title="Drag to reorder" style={{
                cursor: 'grab', color: C.textMuted, fontSize: 14, lineHeight: 1, padding: '0 2px', touchAction: 'none',
              }}>⠿</span>
              <button onClick={() => onSelect(item.id)} style={{
                flex: 1, textAlign: 'left', padding: '7px 10px', fontSize: 13,
                background: C.cardSecondary, color: C.textPrimary,
                border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {item.title || entry?.label || item.type}
              </button>
            </div>
          )
        }}
      />
    </div>
  )
}

function paneHeader() {
  return {
    padding: '12px 14px', fontSize: 13, fontWeight: 600, color: C.textPrimary,
    borderBottom: `1px solid ${C.border}`, background: C.cardSecondary, flexShrink: 0,
  }
}
