// =============================================================================
// src/modules/admin/BuilderStudio.jsx
//
// Phase 0 PREVIEW surface for the builder rearchitecture. Mounts the shared
// LEAP Canvas (palette / live canvas / inspector) with the dashboard component
// family so Nicholas can feel the new WYSIWYG model — drag a component in,
// reposition, resize, select, configure from the schema-driven inspector,
// reorder via the layer list — WITHOUT any of it touching production data.
//
// This is intentionally a sandbox: edits live in memory only. The existing
// DashboardEditor / DashboardRunner and every shipped dashboard are untouched
// (the "additive, never break" rule). Phase 1 replaces DashboardEditor with
// this canvas wired to the real dashboards tables via a persistence adapter.
//
// Lives under Setup → User Interface → "Builder Studio (Preview)".
// =============================================================================

import { lazy, Suspense, useState } from 'react'
import { C } from '../../data/constants'

const LeapCanvas = lazy(() => import('../../builder/LeapCanvas'))

// A small seeded layout so the canvas isn't empty on first open — shows a
// heading, a metric, and a bar chart already placed. Geometry is in 12-col
// grid units (see builder/geometry.js).
const SEED_COMPONENTS = [
  { id: 'c-seed-1', type: 'heading', title: '', dataSourceId: null, config: { text: 'Outreach Overview', align: 'left' } },
  { id: 'c-seed-2', type: 'metric',  title: 'Total Properties', dataSourceId: null, config: { measure_type: 'count', label: 'properties' } },
  { id: 'c-seed-3', type: 'bar',     title: 'By County', dataSourceId: null, config: { measure_type: 'count', orientation: 'horizontal', sort_by: 'value_desc', limit: 20 } },
]
const SEED_LAYOUT = [
  { i: 'c-seed-1', x: 0, y: 0, w: 12, h: 1 },
  { i: 'c-seed-2', x: 0, y: 1, w: 3,  h: 2 },
  { i: 'c-seed-3', x: 3, y: 1, w: 6,  h: 4 },
]

export default function BuilderStudio() {
  const [lastSaved, setLastSaved] = useState(null)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.page }}>
      <div style={{
        flexShrink: 0, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
        background: '#e8f1fb', borderBottom: `1px solid ${C.border}`, color: C.textSecondary, fontSize: 12.5,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sky} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>
          <strong>Phase 0 preview.</strong> This is the new unified builder canvas. Edits here are a sandbox —
          nothing is saved to any dashboard. {lastSaved && <em>Last in-memory save {lastSaved.toLocaleTimeString()}.</em>}
        </span>
      </div>
      <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textMuted, fontSize: 13 }}>Loading builder…</div>}>
        <LeapCanvas
          title="Builder Studio"
          subtitle="Unified WYSIWYG canvas — dashboards (preview). Drag from the palette, drop, resize, configure."
          initialComponents={SEED_COMPONENTS}
          initialLayout={SEED_LAYOUT}
          onSave={() => setLastSaved(new Date())}
        />
      </Suspense>
    </div>
  )
}
