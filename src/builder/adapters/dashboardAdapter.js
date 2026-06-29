// =============================================================================
// src/builder/adapters/dashboardAdapter.js
//
// The persistence adapter that binds the surface-agnostic LEAP Canvas to the
// real dashboards tables. It maps between:
//
//   canvas model  { components:[{id,type,title,subtitle,footer,dataSourceId,config}],
//                   layout:[{i,x,y,w,h}] }
//        ⇕
//   DB model      dashboards + dashboard_widgets (+ dashboard_filters)
//
// Geometry and the Salesforce title/subtitle/footer chrome are stored INSIDE
// each widget's dw_widget_config under namespaced keys (_geometry, _subtitle,
// _footer). This is deliberate: saveDashboard deletes and re-inserts every
// widget on each save (new UUIDs), so anything keyed by widget id would break —
// but config travels with the widget. dashboard_widgets has no validation
// trigger and dw_widget_config is free jsonb, so the extra keys are safe, and
// the runner falls back cleanly to the legacy row/col layout when they're
// absent (existing dashboards are untouched).
//
// reuses loadDashboard / saveDashboard from reportsService — no new SQL.
// =============================================================================

import { loadDashboard, saveDashboard } from '../../data/reportsService'
import { GRID_COLS, newLayoutItem, legacyWidgetsToLayout } from '../geometry'
import { getComponent } from '../componentRegistry'

// Keys we tuck into dw_widget_config that are NOT part of a widget's own config.
const META_KEYS = ['_geometry', '_subtitle', '_footer']

function splitConfig(rawConfig) {
  const cfg = { ...(rawConfig || {}) }
  const meta = {}
  for (const k of META_KEYS) { meta[k] = cfg[k]; delete cfg[k] }
  return { config: cfg, meta }
}

// ─── Load: dashboard row → canvas model ──────────────────────────────────────
export async function loadDashboardForCanvas(dashboardId) {
  if (!dashboardId || dashboardId === 'new') {
    return {
      isNew: true,
      meta: { dash_name: '', dash_description: '', dash_folder_id: null },
      components: [],
      layout: [],
      filters: [],
    }
  }

  const loaded = await loadDashboard(dashboardId)
  if (!loaded) return null

  const widgets = loaded.widgets || []
  // Fallback geometry for widgets saved before the canvas existed (no
  // _geometry): scale their legacy row/col onto the 12-col grid.
  const fallback = legacyWidgetsToLayout(widgets, loaded.dashboard.dash_columns || 3)
  const fallbackById = Object.fromEntries(fallback.map(f => [f.i, f]))

  const components = []
  const layout = []
  widgets.forEach((w, idx) => {
    const id = String(w.id ?? `w-${idx}`)
    const { config, meta } = splitConfig(w.dw_widget_config)
    components.push({
      id,
      type: w.dw_widget_type || 'table',
      title: w.dw_title || '',
      subtitle: meta._subtitle || '',
      footer: meta._footer || '',
      dataSourceId: w.dw_report_id || null,
      config,
    })
    const geo = meta._geometry || fallbackById[id] || { x: 0, y: idx * 3, w: 4, h: 3 }
    const entry = getComponent(w.dw_widget_type)
    layout.push({
      i: id,
      x: clampInt(geo.x, 0, GRID_COLS - 1),
      y: Math.max(0, geo.y | 0),
      w: clampInt(geo.w, entry?.minSize?.w ?? 1, GRID_COLS),
      h: Math.max(entry?.minSize?.h ?? 1, geo.h | 0),
    })
  })

  return {
    isNew: false,
    dashboard: loaded.dashboard,
    meta: {
      dash_name:        loaded.dashboard.dash_name || '',
      dash_description: loaded.dashboard.dash_description || '',
      dash_folder_id:   loaded.dashboard.dash_folder_id || null,
    },
    components,
    layout,
    filters: (loaded.filters || []).map(f => ({
      id:            String(f.id),
      label:         f.dfilt_label || '',
      field_name:    f.dfilt_field_name || '',
      operator:      f.dfilt_operator || 'equals',
      default_value: f.dfilt_default_value ?? '',
      options:       f.dfilt_options || [],
    })),
  }
}

// ─── Save: canvas model → dashboard row ───────────────────────────────────────
export async function saveDashboardFromCanvas({ id, meta, components, layout, filters }) {
  const layoutById = Object.fromEntries((layout || []).map(l => [l.i, l]))

  // Order widgets top-to-bottom, left-to-right so the legacy index-derived
  // position (saveDashboard recomputes row/col from array order) roughly
  // mirrors the visual layout for any consumer that ignores _geometry.
  const ordered = [...components].sort((a, b) => {
    const ga = layoutById[a.id] || { x: 0, y: 0 }
    const gb = layoutById[b.id] || { x: 0, y: 0 }
    return (ga.y - gb.y) || (ga.x - gb.x)
  })

  const widgets = ordered.map(c => {
    const geo = layoutById[c.id] || newLayoutItem(c.id, getComponent(c.type), [])
    const widget_config = {
      ...(c.config || {}),
      _geometry: { x: geo.x, y: geo.y, w: geo.w, h: geo.h },
      _subtitle: c.subtitle || '',
      _footer:   c.footer || '',
    }
    return {
      report_id:     c.dataSourceId || null,
      title:         c.title || null,
      widget_type:   c.type,
      width:         geo.w,           // legacy span (dash_columns is 12 below)
      height:        geo.h,
      widget_config,
    }
  })

  const dashFilters = (filters || [])
    .filter(f => f.field_name)        // a filter with no column is meaningless
    .map(f => ({
      label:         f.label || f.field_name,
      field_name:    f.field_name,
      operator:      f.operator || 'equals',
      default_value: f.default_value ?? null,
      options:       f.options || [],
    }))

  // Authoritative geometry also mirrored into dash_layout for convenience.
  const dash_layout = ordered.map(c => {
    const geo = layoutById[c.id] || { x: 0, y: 0, w: 4, h: 3 }
    return { x: geo.x, y: geo.y, w: geo.w, h: geo.h }
  })

  return saveDashboard({
    id,
    dashboard: {
      dash_name:        meta.dash_name,
      dash_description: meta.dash_description || null,
      dash_folder_id:   meta.dash_folder_id || null,
      dash_columns:     GRID_COLS,   // canvas dashboards are a 12-col free grid
      dash_layout,
    },
    widgets,
    filters: dashFilters,
  })
}

function clampInt(v, min, max) {
  const n = Number.isFinite(v) ? Math.round(v) : min
  return Math.max(min, Math.min(max, n))
}
