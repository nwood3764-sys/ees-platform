import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { audienceForRoleName } from '../../data/helpService'
import { supabase } from '../../lib/supabase'

// ---------------------------------------------------------------------------
// HelpContext
//
// Holds:
//   • the user's current help audience (admin / internal / portal / all)
//   • the open/closed state of the help side panel
//   • the anchors currently driving the panel
//
// Components anywhere in the tree can:
//   • call useHelp() to read state and open the panel
//   • render <HelpIcon anchors=[…] /> as a `?` next to a control to surface
//     relevant articles when clicked
//   • render <HelpPanel /> once near the app root to display the slide-out
//
// The audience is derived from the logged-in user's role. We resolve it once
// per session by reading public.users → roles. Until it resolves, audience
// is null and articles flagged 'all' will still show.
// ---------------------------------------------------------------------------

const HelpContext = createContext(null)

export function useHelp() {
  const ctx = useContext(HelpContext)
  if (!ctx) {
    // The provider should wrap the app — falling back to a no-op keeps the
    // UI from blowing up if someone forgets to mount it (e.g. in isolated
    // signing-portal pages).
    return {
      audience: null,
      open: () => {},
      close: () => {},
      isOpen: false,
      anchors: [],
      title: null,
    }
  }
  return ctx
}

export function HelpProvider({ children }) {
  const [audience, setAudience] = useState(null)
  const [isOpen,   setIsOpen]   = useState(false)
  const [anchors,  setAnchors]  = useState([])
  const [title,    setTitle]    = useState(null)

  // Resolve the current user's audience by reading their role once at mount
  // and on auth state change.
  const resolveAudience = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setAudience(null); return }
      const { data, error } = await supabase
        .from('users')
        .select('role:roles!users_role_id_fkey(role_name)')
        .eq('auth_user_id', user.id)
        .maybeSingle()
      if (error) { setAudience(null); return }
      setAudience(audienceForRoleName(data?.role?.role_name))
    } catch {
      setAudience(null)
    }
  }, [])

  useEffect(() => {
    resolveAudience()
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      resolveAudience()
    })
    return () => { sub?.subscription?.unsubscribe?.() }
  }, [resolveAudience])

  const open = useCallback((nextAnchors, nextTitle = null) => {
    setAnchors(nextAnchors || [])
    setTitle(nextTitle)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => setIsOpen(false), [])

  const value = useMemo(() => ({
    audience, isOpen, anchors, title,
    open, close,
  }), [audience, isOpen, anchors, title, open, close])

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>
}
