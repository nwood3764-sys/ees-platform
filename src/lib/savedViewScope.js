// ---------------------------------------------------------------------------
// Which saved list views belong on which module.
//
// saved_list_views.list_view_module has existed since the baseline and nothing
// ever read it, so every view on an object appeared on every module that lists
// that object. That was harmless while every tab showed the whole object, and
// wrong the moment one did not: Field > Technicians is SCOPED to the field
// technicians, so its views ("Crew Leads") are meaningless in Setup > Users,
// which lists everyone.
//
// The rule is deliberately one-directional — a view claims a module, a module
// never claims a view:
//   - a view naming a module shows ONLY on that module
//   - a view naming no module is object-wide and shows everywhere
// so no view that exists today moves, and a caller that does not say which
// module it is (moduleId null) still sees everything, exactly as before.
// ---------------------------------------------------------------------------

export function viewVisibleOnModule(view, moduleId) {
  const viewModule = view?.list_view_module
  if (!viewModule) return true    // object-wide view: shows everywhere
  if (!moduleId) return true      // caller did not scope: unchanged behaviour
  return viewModule === moduleId
}

export function filterViewsForModule(views, moduleId) {
  if (!Array.isArray(views)) return []
  return views.filter(v => viewVisibleOnModule(v, moduleId))
}
