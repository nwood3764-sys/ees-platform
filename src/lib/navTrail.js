// ---------------------------------------------------------------------------
// navTrail — the in-page memory of where the user has been.
//
// A record URL is deliberately just "/<table>/<id>" so it can be copied and
// shared. The cost is that it carries no memory of the screen it was opened
// from: which module section was being browsed, or which record was open
// before it. The URL is the source of truth for navigation, so every browser
// Back/Forward re-derived state from the path alone and that context was lost —
// the module chrome behind a record fell back to its Home tab, and "back to the
// list" then had no list and dropped the user on the module's Home page.
//
// This keeps a trail of the entries the page session pushed, indexed the same
// way the browser indexes its own history so a Back/Forward can find its place
// again. In-memory by design: after a reload the trail is empty and callers
// fall back to URL-derived behavior, which is the right answer for a deep link
// — there is genuinely nothing behind it.
//
// Pure module: no window, no history, no React. urlNav owns the History API
// calls and hands this the resulting entries. Fixture-tested by
// scripts/nav-trail-fixture.mjs.
//
//   entry = { path, key, module, section, subsection }
//     key — identifies the SCREEN an entry belongs to: "<table>:<id>" for a
//           record (its ?tab= sub-URLs share the key), null for a list or
//           module page. Leaving a record steps over the entries that share
//           its key, so the user lands on the previous screen rather than on
//           the same record's other tab.
// ---------------------------------------------------------------------------

export function entryKeyFor(navState) {
  const rec = navState?.selectedRecord
  return rec?.table && rec.id ? `${rec.table}:${rec.id}` : null
}

export function entryFor(navState, path) {
  return {
    path,
    key: entryKeyFor(navState),
    module: navState?.activeModule || null,
    section: navState?.section ?? null,
    subsection: navState?.subsection ?? null,
  }
}

export function createNavTrail() {
  let entries = []
  let index = -1

  return {
    get index() { return index },
    get entries() { return entries },

    // A new navigation drops anything ahead of the current position — the same
    // thing the browser does to its forward stack.
    //
    // Pushing the entry that's already current collapses into a replace. The
    // callers only push when the path actually changes, so a repeat means the
    // same navigation ran twice (React invokes state updaters twice under
    // StrictMode) — and a duplicated entry would put the trail out of step with
    // the browser's own history, making "one screen back" land in the wrong
    // place.
    push(navState, path) {
      const entry = entryFor(navState, path)
      const current = index >= 0 ? entries[index] : null
      if (current && current.path === entry.path && current.key === entry.key) {
        entries[index] = entry
        return index
      }
      entries = entries.slice(0, index + 1)
      entries.push(entry)
      index = entries.length - 1
      return index
    },

    replace(navState, path) {
      const entry = entryFor(navState, path)
      if (index < 0) { entries = [entry]; index = 0 }
      else entries[index] = entry
      return index
    },

    // A sub-URL of the CURRENT screen (a record's ?tab=). It gets its own
    // history entry — browser Back steps through tabs, Salesforce-style — but
    // inherits the current entry's key so leaving the record skips it.
    pushSub(path) {
      const current = index >= 0 ? entries[index] : null
      if (current && current.path === path) return index
      const entry = current
        ? { ...current, path }
        : { path, key: null, module: null, section: null, subsection: null }
      entries = entries.slice(0, index + 1)
      entries.push(entry)
      index = entries.length - 1
      return index
    },

    // Restore the context a URL can't carry onto a state just re-derived from
    // the URL by a Back/Forward. Trusted only when the history entry carries an
    // index we recognize AND that entry is for this exact path — anything else
    // (a reload, an entry from a previous page session) keeps the URL-derived
    // state untouched.
    restore(historyIndex, path, navState) {
      if (typeof historyIndex !== 'number' || historyIndex < 0 || historyIndex >= entries.length) {
        return navState
      }
      index = historyIndex
      const entry = entries[historyIndex]
      if (!entry || entry.path !== path) return navState
      return {
        ...navState,
        activeModule: entry.module || navState.activeModule,
        section: entry.section ?? navState.section,
        subsection: entry.subsection ?? navState.subsection,
      }
    },

    // How many entries back the previous SCREEN is, skipping the entries that
    // belong to the screen being left. 0 means this page session has nothing to
    // go back to (a deep link, a fresh tab) and the caller should navigate to a
    // list instead of calling history.back().
    stepsBackToPreviousScreen() {
      if (index < 1) return 0
      const currentKey = entries[index]?.key ?? null
      for (let i = index - 1; i >= 0; i -= 1) {
        if ((entries[i]?.key ?? null) !== currentKey) return index - i
      }
      return 0
    },

    reset() { entries = []; index = -1 },
  }
}
