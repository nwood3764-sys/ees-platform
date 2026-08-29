// =============================================================================
// ModuleHomeByline — who is looking at this module home, and when.
//
// Four module home screens carried this line as a hardcoded string naming
// Nicholas Wood and a role he does not hold in that module — the Incentives one
// also froze the date at "Sunday, April 12, 2026" and had read that way ever
// since (Nicholas, 2026-08-29: the dashboard was dated months in the past). A
// byline that names the wrong person to every other user is worse than none.
//
// One definition, read from the signed-in user's own record and the real clock.
// While the profile loads the line renders the date alone rather than a
// placeholder name.
// =============================================================================

import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { getCurrentUserProfile } from '../data/layoutService'

export default function ModuleHomeByline({ note = null }) {
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    let cancelled = false
    getCurrentUserProfile()
      .then(p => { if (!cancelled) setProfile(p) })
      .catch(() => { /* the date alone is still true */ })
    return () => { cancelled = true }
  }, [])

  // The user's own record type of day — long form, matching what the hardcoded
  // strings showed, but for today rather than for one day in April.
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  const parts = [profile?.displayName, profile?.roleName, note || today].filter(Boolean)

  return (
    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
      {parts.join(' · ')}
    </div>
  )
}
