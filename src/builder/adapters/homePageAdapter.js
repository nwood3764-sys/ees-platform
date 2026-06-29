// =============================================================================
// src/builder/adapters/homePageAdapter.js
//
// Binds the LEAP Canvas to the home_pages tables. Same pattern as the dashboard
// adapter: geometry ({x,y,w,h} on the 12-col grid) rides inside hpc_config under
// `_geometry`, so the free-grid layout persists through the existing
// save_home_page RPC with no schema change. Because the RPC requires a template
// + per-component region, canvas pages are saved as the 'single'/'main' template
// (one region) and positioned purely by geometry — the viewer reads _geometry
// and falls back to the old region flow for pages built in the legacy builder.
// =============================================================================

import { fetchHomePage, saveHomePage } from '../../data/adminService'
import { GRID_COLS, newLayoutItem } from '../geometry'
import { homeRegistry } from '../registries/homeRegistry'

function splitGeometry(rawConfig) {
  const cfg = { ...(rawConfig || {}) }
  const geo = cfg._geometry
  delete cfg._geometry
  return { config: cfg, geo }
}

export async function loadHomePageForCanvas(pageId) {
  if (!pageId || pageId === 'new') {
    return {
      isNew: true,
      meta: { name: '', moduleId: null, roleId: null, isActive: false, isDefault: false },
      components: [], layout: [],
    }
  }

  const page = await fetchHomePage(pageId)
  const components = []
  const layout = []
  ;(page.components || []).forEach((c, idx) => {
    const id = String(c.id ?? `hpc-${idx}`)
    const { config, geo } = splitGeometry(c.config)
    components.push({ id, type: c.type, title: c.title || '', dataSourceId: c.sourceId || null, config })
    // Fallback for legacy (no geometry): a simple 2-up grid in sort order.
    const fallback = { x: (idx % 2) * 6, y: Math.floor(idx / 2) * 4, w: 6, h: 4 }
    const g = geo || fallback
    const entry = homeRegistry.getComponent(c.type)
    layout.push({
      i: id,
      x: clampInt(g.x, 0, GRID_COLS - 1),
      y: Math.max(0, g.y | 0),
      w: clampInt(g.w, entry?.minSize?.w ?? 1, GRID_COLS),
      h: Math.max(entry?.minSize?.h ?? 1, g.h | 0),
    })
  })

  return {
    isNew: false,
    meta: {
      name: page.name || '',
      moduleId: page.moduleId || null,
      roleId: page.roleId || null,
      isActive: !!page.isActive,
      isDefault: !!page.isDefault,
    },
    components, layout,
  }
}

export async function saveHomePageFromCanvas({ id, meta, components, layout }) {
  const layoutById = Object.fromEntries((layout || []).map(l => [l.i, l]))
  const ordered = [...components].sort((a, b) => {
    const ga = layoutById[a.id] || { x: 0, y: 0 }
    const gb = layoutById[b.id] || { x: 0, y: 0 }
    return (ga.y - gb.y) || (ga.x - gb.x)
  })

  const comps = ordered.map(c => {
    const geo = layoutById[c.id] || newLayoutItem(c.id, homeRegistry.getComponent(c.type), [])
    return {
      // Canvas pages collapse to one region; geometry drives placement.
      region: 'main',
      type: c.type,
      sourceId: c.dataSourceId || null,
      title: c.title || null,
      config: { ...(c.config || {}), _geometry: { x: geo.x, y: geo.y, w: geo.w, h: geo.h } },
    }
  })

  return saveHomePage(
    {
      id: id === 'new' ? null : id,
      name: meta.name,
      template: 'single',
      roleId: meta.roleId || null,
      moduleId: meta.moduleId || null,
      isActive: !!meta.isActive,
      isDefault: !!meta.isDefault,
    },
    comps,
  )
}

function clampInt(v, min, max) {
  const n = Number.isFinite(v) ? Math.round(v) : min
  return Math.max(min, Math.min(max, n))
}
