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
// Save is bulk (soft-delete the layout's sections/widgets, then recreate from
// the canvas state in order) — mirrors the dashboard/home adapters. Widget
// config is passed through unchanged, so the DB validation trigger
// (trg_validate_page_layout_widget_config) still guards field/column refs.
// =============================================================================

import { supabase } from '../../lib/supabase'
import { fetchLayoutForEdit, createSection, createWidget } from '../../data/pageLayoutBuilderService'
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

// ─── Save (bulk: soft-delete + recreate) ─────────────────────────────────────
export async function saveLayoutFromCanvas({ layoutId, sections }) {
  // Soft-delete the layout's current sections + widgets. The block_hard_delete
  // trigger means everything is a soft-delete; we recreate fresh below.
  const stamp = new Date().toISOString()
  await Promise.all([
    supabase.from('page_layout_widgets').update({ is_deleted: true, updated_at: stamp }).eq('page_layout_id', layoutId).eq('is_deleted', false),
    supabase.from('page_layout_sections').update({ is_deleted: true, updated_at: stamp }).eq('page_layout_id', layoutId).eq('is_deleted', false),
  ])

  // Recreate sections (in array order) and their widgets.
  for (const s of sections) {
    const created = await createSection(layoutId, {
      label: s.label || 'Untitled Section',
      columns: s.columns || 2,
      isCollapsible: !!s.isCollapsible,
      isCollapsedByDefault: !!s.isCollapsedByDefault,
      tab: s.tab || 'Details',
      placement: s.placement || 'main',
    })
    for (const w of (s.widgets || [])) {
      await createWidget(created.id, {
        type: w.type || 'field_group',
        // createWidget requires a non-empty title; fall back to the section label.
        title: w.title || s.label || 'Section',
        config: w.config || {},
        column: w.column || 1,
        size: w.size || 'medium',
        isRequired: !!w.isRequired,
      })
    }
  }

  return layoutId
}
