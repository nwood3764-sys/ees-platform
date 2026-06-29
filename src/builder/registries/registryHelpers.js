// =============================================================================
// src/builder/registries/registryHelpers.js
//
// Small factory shared by every surface registry (dashboards, home pages, …).
// Given a flat array of component-entry descriptors it derives the lookups the
// LEAP Canvas shell needs: by-id lookup, palette grouping by category, default
// config cloning, and dependsOn visibility. This is what lets a new surface be
// "a registry + an adapter" rather than new shell code.
// =============================================================================

export function makeHelpers(entries) {
  const byId = Object.fromEntries(entries.map(e => [e.id, e]))

  const getComponent = (id) => byId[id] || null

  const getPaletteCategories = () => {
    const order = []
    const map = new Map()
    for (const e of entries) {
      if (!map.has(e.category)) { map.set(e.category, []); order.push(e.category) }
      map.get(e.category).push(e)
    }
    return order.map(cat => ({ category: cat, components: map.get(cat) }))
  }

  const defaultConfigFor = (id) => {
    const e = byId[id]
    return e ? JSON.parse(JSON.stringify(e.defaultConfig || {})) : {}
  }

  return { getComponent, getPaletteCategories, defaultConfigFor }
}

// Whether a config field descriptor should render given the current config.
// Honors `dependsOn: { key, equals | notEquals }`. Shared by every inspector.
export function fieldVisible(descriptor, config) {
  const dep = descriptor.dependsOn
  if (!dep) return true
  const v = config?.[dep.key]
  if ('equals' in dep)    return v === dep.equals
  if ('notEquals' in dep) return v !== dep.notEquals
  return !!v
}
