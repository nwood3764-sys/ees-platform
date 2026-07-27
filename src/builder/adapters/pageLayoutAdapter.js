// =============================================================================
// src/builder/adapters/pageLayoutAdapter.js
//
// Persistence adapter for the new page-layout builder. Page layouts are
// SECTION-based (Sections → Columns → Fields + related lists / reports / …) —
// the model the live record renderer (RecordDetail.jsx) already understands —
// so this adapter loads/saves that model verbatim. No geometry, no renderer
// change: the new builder is a better authoring UX over the SAME data, which is
// why it's safe to ship without touching the 6k-line record renderer.
//
// Save is ATOMIC: the whole layout (soft-delete of the current generation +
// recreate from canvas state) runs inside a single DB function,
// save_page_layout_from_canvas, so it is one transaction. If any widget fails
// validation (or anything else errors), the entire save rolls back and the
// existing layout is left untouched. This replaced an earlier client-side
// "delete all, then re-insert one row at a time" sequence whose delete
// committed before a failing re-insert — which could wipe a layout. Widget
// config is still passed through unchanged, so the DB validation trigger
// (trg_validate_page_layout_widget_config) continues to guard field/column
// refs; it just can no longer cause data loss.
// =============================================================================

import { supabase } from '../../lib/supabase'
import { fetchLayoutForEdit } from '../../data/pageLayoutBuilderService'
import { listObjectColumns } from '../../data/reportsService'

let _key = 0
const nextKey = (p) => `${p}-${++_key}`

// ─── Load ──────────────────────────────────────────────────────────────────
export async function loadLayoutForCanvas(layoutId) {
  const loaded = await fetchLayoutForEdit(layoutId)
  if (!loaded) return null

  const columns = await listObjectColumns(loaded.layout.object).catch(() => [])

  const sections = (loaded.sections || []).map(s => ({
    key: nextKey('sec'),
    id: s.id,
    label: s.label || 'Untitled Section',
    columns: s.columns || 2,
    tab: s.tab || 'Details',
    isCollapsible: !!s.isCollapsible,
    isCollapsedByDefault: !!s.isCollapsedByDefault,
    placement: s.placement || 'main',
    widgets: (s.widgets || []).map(w => ({
      key: nextKey('w'),
      id: w.id,
      type: w.widget_type,
      title: w.widget_title || '',
      column: w.widget_column || 1,
      size: w.widget_size || 'medium',
      isRequired: !!w.widget_is_required,
      config: w.widget_config || {},
    })),
  }))

  return { layout: loaded.layout, sections, columns }
}

// ─── Save (atomic: delete + recreate in one DB transaction) ──────────────────
export async function saveLayoutFromCanvas({ layoutId, sections }) {
  // Shape the canvas state into the ordered payload the RPC expects. Array
  // order IS the persisted order (section_order / widget_position), matching
  // how the canvas renders.
  const payload = (sections || []).map(s => ({
    label: s.label || 'Untitled Section',
    columns: s.columns || 2,
    isCollapsible: !!s.isCollapsible,
    isCollapsedByDefault: !!s.isCollapsedByDefault,
    tab: s.tab || 'Details',
    placement: s.placement || 'main',
    widgets: (s.widgets || []).map(w => ({
      type: w.type || 'field_group',
      // A non-empty title is required; fall back to the section label.
      title: w.title || s.label || 'Section',
      config: w.config || {},
      column: w.column || 1,
      size: w.size || 'medium',
      isRequired: !!w.isRequired,
    })),
  }))

  // One transaction: if the DB rejects any widget, the existing layout is
  // preserved (the delete rolls back with the failed insert). The rejection
  // message (SQLSTATE 22023) surfaces verbatim to the caller's catch block.
  const { data, error } = await supabase.rpc('save_page_layout_from_canvas', {
    p_layout_id: layoutId,
    p_sections: payload,
  })
  if (error) throw error

  return data || layoutId
}
