import { useState, useEffect } from 'react'
import { fetchModuleSections } from '../data/adminService'

// Module section-tab config consumer.
//
// Each module declares a hardcoded SECTIONS array (its code-backed tabs, in
// natural order). This hook overlays the admin's saved configuration from
// module_sections: it filters out hidden tabs, applies custom labels, and
// reorders to the admin's sort order. Tabs present in code but not yet in the
// config are kept (appended) so nothing silently vanishes; tabs in the config
// but no longer in code are dropped (the code is the source of truth for what
// can render).
//
// Falls back to the raw code SECTIONS on any error or while loading, so the
// module never renders an empty tab strip.
export function useModuleSections(moduleId, codeSections) {
  const [sections, setSections] = useState(codeSections)

  useEffect(() => {
    let cancelled = false
    if (!moduleId) { setSections(codeSections); return }
    fetchModuleSections(moduleId)
      .then(cfg => {
        if (cancelled) return
        if (!cfg || cfg.length === 0) { setSections(codeSections); return }
        const byId = new Map(cfg.map(c => [c.sectionId, c]))
        // Start from config order. Keep tabs that still exist in code (visible),
        // PLUS object-backed tabs (those with an objectTable) which render via
        // the generic ObjectListSection and need no code section. Apply the
        // config label, and carry objectTable through for the generic renderer.
        const codeById = new Map(codeSections.map(s => [s.id, s]))
        const ordered = cfg
          .filter(c => c.visible && (codeById.has(c.sectionId) || c.objectTable))
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(c => codeById.has(c.sectionId)
            ? { ...codeById.get(c.sectionId), label: c.label, objectTable: c.objectTable || null }
            : { id: c.sectionId, label: c.label, objectTable: c.objectTable })
        // Append any code tabs not present in config at all (new in code,
        // not yet seeded) so they remain reachable.
        for (const s of codeSections) {
          if (!byId.has(s.id)) ordered.push(s)
        }
        setSections(ordered.length > 0 ? ordered : codeSections)
      })
      .catch(() => { if (!cancelled) setSections(codeSections) })
    return () => { cancelled = true }
  }, [moduleId])

  return sections
}
