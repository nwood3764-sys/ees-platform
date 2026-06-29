import { createContext, useContext } from 'react'

// Navigation context — exposes the URL-driven navigation handlers from
// useUrlNavigation() (App) to deep components without prop-drilling.
//
// The primary consumer is ObjectListSection: when this context is present it
// opens records by pushing a real record URL (`/<table>/<id>`) via
// navigateToRecord, so every record is shareable/bookmarkable (Salesforce
// parity) and the open record is visible to the topbar gear. When the context
// is absent (a standalone mount with no provider) consumers fall back to their
// own local state, so nothing breaks outside the app shell.
//
// value shape: { selectedRecord, navigateToRecord, closeRecord, replaceRecord }
export const NavContext = createContext(null)

export function useNav() {
  return useContext(NavContext)
}
