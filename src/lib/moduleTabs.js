// ---------------------------------------------------------------------------
// moduleTabs — merging a module's CODE-declared tabs with its saved config.
//
// A module declares its tabs in code; an admin reorders, renames, hides, adds
// object tabs and removes tabs in Setup → Module Tabs. Deciding what the tab
// strip actually shows is a merge of the two, and it has one non-obvious rule:
//
//   A tab the admin REMOVED must stay removed.
//
// The merge appends code tabs that the config does not mention, so that a tab
// newly added in code appears without anyone seeding a row. A removed tab is
// also "not mentioned" once its row is soft-deleted — so without knowing which
// ids were removed, the merge hands the tab straight back and Remove appears to
// do nothing at all (Nicholas, 2026-08-29, removing EFR Reports from
// Qualification, which is code-backed).
//
// Pure module: no React, no network. Fixture-tested by
// scripts/module-tabs-fixture.mjs.
// ---------------------------------------------------------------------------

/**
 * The tab strip for a module.
 *
 * @param codeSections  [{ id, label, ... }] the module's own declaration.
 * @param config        rows from module_sections, each
 *                      { sectionId, label, sortOrder, visible, objectTable,
 *                        removed }. Removed rows MUST be included — they are
 *                      how this function knows not to re-add them.
 * @returns the ordered tabs to render.
 */
export function mergeModuleTabs(codeSections, config) {
  const code = Array.isArray(codeSections) ? codeSections : []
  const cfg = Array.isArray(config) ? config : []
  if (cfg.length === 0) return code

  const removedIds = new Set(cfg.filter(c => c && c.removed).map(c => c.sectionId))
  const live = cfg.filter(c => c && !c.removed)
  const byId = new Map(live.map(c => [c.sectionId, c]))
  const codeById = new Map(code.map(s => [s.id, s]))

  // Config order first. A configured tab renders when it is visible AND either
  // the code still declares it or it is object-backed (rendered generically).
  const ordered = live
    .filter(c => c.visible && (codeById.has(c.sectionId) || c.objectTable))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map(c => codeById.has(c.sectionId)
      ? { ...codeById.get(c.sectionId), label: c.label, objectTable: c.objectTable || null }
      : { id: c.sectionId, label: c.label, objectTable: c.objectTable })

  // Then code tabs the config has never heard of — but never one that was
  // deliberately removed.
  for (const s of code) {
    if (!byId.has(s.id) && !removedIds.has(s.id)) ordered.push(s)
  }

  // A module with no tabs at all has no navigation; fall back to its code
  // declaration rather than rendering an empty strip.
  return ordered.length > 0 ? ordered : code
}
