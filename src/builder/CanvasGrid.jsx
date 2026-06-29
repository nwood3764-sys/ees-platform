// =============================================================================
// src/builder/CanvasGrid.jsx
//
// The center pane of the LEAP Canvas: the LIVE, WYSIWYG canvas. This is the
// piece that replaces the old "weird list view" — instead of numbered rows
// with up/down buttons, components sit on a real grid you can drag to
// reposition and drag-handle to resize, exactly where they'll render.
//
// Built on react-grid-layout (Responsive + WidthProvider):
//   • free positioning + resize on a 12-col grid (see geometry.js),
//   • responsive reflow at the registry's breakpoints,
//   • palette drag-in via isDroppable / onDrop (the chip is the drag source).
//
// Each grid cell is a tile: a header (title + grip drag-handle + selection
// affordance) over the component's registry `Preview`. Clicking the body
// selects (for the inspector); only the grip drags (draggableHandle), so a
// click never gets swallowed by a drag.
// =============================================================================

import GridLayout, { WidthProvider } from 'react-grid-layout'
import { C } from '../data/constants'
import { getComponent } from './componentRegistry'
import LiveWidgetPreview from './LiveWidgetPreview'
import { GRID_COLS, ROW_HEIGHT, GRID_MARGIN, GRID_CONTAINER_PADDING } from './geometry'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

// Fixed 12-column grid (Salesforce dashboard BUILDER behavior — the editor is
// a fixed 12-col grid; responsive reflow is a view-time concern handled later
// via the per-breakpoint overrides the geometry model already allows). A fixed
// grid keeps proportions stable while editing instead of reflowing the canvas
// out from under the user when the pane is narrow.
const Grid = WidthProvider(GridLayout)

export default function CanvasGrid({
  components, layout, selectedId, droppingSize,
  onLayoutChange, onSelect, onDrop,
}) {
  return (
    <div style={{ flex: 1, overflow: 'auto', background: C.page, position: 'relative' }}>
      {components.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none',
          color: C.textMuted, textAlign: 'center', padding: 24,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textSecondary }}>Empty canvas</div>
          <div style={{ fontSize: 13, maxWidth: 320 }}>
            Drag a component from the palette onto this area, or click one to add it.
            Drag the grip to move, drag an edge to resize.
          </div>
        </div>
      )}
      <Grid
        className="leap-canvas-grid"
        style={{ minHeight: '100%' }}
        layout={layout}
        cols={GRID_COLS}
        rowHeight={ROW_HEIGHT}
        margin={GRID_MARGIN}
        containerPadding={GRID_CONTAINER_PADDING}
        isDroppable
        droppingItem={{ i: '__dropping__', w: droppingSize?.w ?? 4, h: droppingSize?.h ?? 3 }}
        onDrop={(_layout, item) => onDrop?.(item)}
        draggableHandle=".leap-drag-handle"
        compactType="vertical"
        onLayoutChange={(current) => {
          // RGL leaves a transient '__dropping__' placeholder in the layout
          // during/after an external drag-in; the real item is added by onDrop
          // with a stable id. Strip the placeholder so it never persists as an
          // orphan layout entry with no matching component.
          onLayoutChange?.((current || []).filter(l => l.i !== '__dropping__'))
        }}
      >
        {components.map(c => {
          const entry = getComponent(c.type)
          const isSelected = c.id === selectedId
          const unbound = entry?.dataSource === 'report' && !c.dataSourceId
          return (
            <div key={c.id} style={{
              background: C.card,
              border: `1px solid ${isSelected ? C.emerald : C.border}`,
              boxShadow: isSelected ? `0 0 0 1px ${C.emerald}` : '0 1px 2px rgba(13,26,46,0.04)',
              borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}>
              {/* Title + subtitle header (Salesforce dashboard-component
                  chrome). The whole header is the drag handle. Subtitle only
                  renders when set, so chrome-less tiles stay compact. */}
              <div className="leap-drag-handle" style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6,
                padding: '6px 9px', borderBottom: `1px solid ${C.border}`,
                background: C.cardSecondary, cursor: 'move',
              }}>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.title || entry?.label || c.type}
                  </span>
                  {c.subtitle && (
                    <span style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.subtitle}
                    </span>
                  )}
                </div>
                <span style={{ color: C.textMuted, fontSize: 13, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>⠿</span>
              </div>
              <div
                onMouseDown={() => onSelect?.(c.id)}
                style={{ flex: 1, padding: 10, overflow: 'hidden', cursor: 'pointer', position: 'relative' }}
              >
                {(entry?.dataSource === 'report' && c.dataSourceId)
                  ? <LiveWidgetPreview component={c} />
                  : entry?.Preview ? <entry.Preview config={c.config || {}} /> : <span style={{ fontSize: 12, color: C.textMuted }}>{c.type}</span>}
                {unbound && (
                  <div style={{
                    position: 'absolute', left: 10, right: 10, bottom: 8,
                    fontSize: 11, color: C.sky, background: '#e8f1fb',
                    border: `1px solid ${C.border}`, borderRadius: 5, padding: '4px 8px', textAlign: 'center',
                  }}>Pick a report in the inspector →</div>
                )}
              </div>
              {c.footer && (
                <div style={{
                  padding: '5px 9px', borderTop: `1px solid ${C.border}`, background: C.cardSecondary,
                  fontSize: 10.5, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{c.footer}</div>
              )}
            </div>
          )
        })}
      </Grid>
    </div>
  )
}

// Re-export the grid contract so the parent doesn't re-import from geometry
// just to size things consistently with this component.
export { GRID_COLS }
