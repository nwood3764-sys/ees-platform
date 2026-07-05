import React from 'react'
import { isUrlAddressableTable } from '../lib/urlNav'

/**
 * RecordLink — a record name/reference rendered as a REAL anchor so the
 * browser's native "Open link in new tab", "Open in new window", "Copy link
 * address", middle-click, and Ctrl/Cmd-click all work, exactly like a
 * Salesforce record link.
 *
 * Why this exists: clickable record names used to be <span onClick> elements.
 * The browser only offers the link context menu (and modified-click new-tab
 * behavior) for actual <a href> anchors, so right-clicking a record showed
 * Chrome's generic page menu instead. The records already have stable,
 * shareable URLs (/<table>/<id>) — this component just renders that URL as a
 * proper anchor while preserving the fast in-app navigation on a plain click.
 *
 * Plain left-click → preventDefault + onActivate (SPA navigate, no reload).
 * Modified click (Ctrl/Cmd/Shift/Alt, middle, or right) → browser handles it
 * natively (new tab / new window / copy link).
 */

// Canonical record-detail URL. Mirrors buildPath()'s record case in urlNav.js
// so a left-click lands on exactly the URL a deep link would resolve.
export function recordHref(table, id) {
  if (!table || !id) return null
  return `/${table}/${id}`
}

// A click the browser should handle natively rather than intercepting for SPA
// navigation (new tab/window, etc.). Middle-click and right-click open the
// native menu on an anchor without firing a left onClick, so we only need to
// guard modified left-clicks here.
function isModifiedClick(e) {
  return e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
}

export default function RecordLink({ table, id, onActivate, children, style, className, title }) {
  const href = recordHref(table, id)

  // No real URL for this table (or no id) → keep the prior plain-span behavior
  // so non-addressable rows are unchanged.
  if (!href || !isUrlAddressableTable(table)) {
    return (
      <span
        role="link"
        tabIndex={0}
        className={className}
        title={title}
        style={{ cursor: 'pointer', ...style }}
        onClick={(e) => { e.stopPropagation(); onActivate?.(e) }}
      >
        {children}
      </span>
    )
  }

  return (
    <a
      href={href}
      className={className}
      title={title}
      style={{ textDecoration: 'none', cursor: 'pointer', ...style }}
      onClick={(e) => {
        // Don't let the row's own onClick (select/open) also fire.
        e.stopPropagation()
        // Let the browser open a new tab/window for modified clicks.
        if (isModifiedClick(e)) return
        // Plain left-click → fast in-app navigation, no full page reload.
        e.preventDefault()
        onActivate?.(e)
      }}
    >
      {children}
    </a>
  )
}
