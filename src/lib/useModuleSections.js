import { useState, useEffect } from 'react'
import { fetchModuleSections } from '../data/adminService'
import { mergeModuleTabs } from './moduleTabs'

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
        setSections(mergeModuleTabs(codeSections, cfg))
      })
      .catch(() => { if (!cancelled) setSections(codeSections) })
    return () => { cancelled = true }
  }, [moduleId])

  return sections
}
