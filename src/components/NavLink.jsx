import React from 'react'
import { buildPath } from '../lib/urlNav'

/**
 * NavLink — the universal navigation anchor for LEAP.
 *
 * Every navigable thing in the app (a module, a module section, a record, a
 * search, a help article, a Setup node) has a real URL via buildPath(). But
 * historically almost all navigation was wired as onClick handlers on
 * <div>/<button>/<span> elements, so the browser never offered "Open link in
 * new tab", "Open in new window", or "Copy link address", and middle-click /
 * Cmd-click did nothing. That behavior only exists on real <a href> anchors.
 *
 * NavLink renders that anchor. Give it a `to` descriptor (the same shape
 * buildPath accepts — { activeModule, section, subsection, selectedRecord,
 * searchQuery, searchType, helpSlug, adminTab, ... }) or an explicit `href`,
 * plus an `onActivate` callback that performs the existing fast in-app SPA
 * navigation:
 *
 *   - Plain left-click  → preventDefault + onActivate (no full page reload).
 *   - Modified click    → the browser handles it natively:
 *       Ctrl/Cmd-click / middle-click → new tab
 *       Shift-click                   → new window
 *       right-click                   → the link context menu (new tab/window,
 *                                       copy link address, …)
 *
 * This is the generalization of RecordLink to any navigation target. Prefer it
 * anywhere a click currently changes the active module/section/record/search so
 * that right-click-to-new-window works uniformly across the platform.
 */

// A click the browser should handle natively rather than intercepting for SPA
// navigation. Middle-click fires 'auxclick' and right-click fires 'contextmenu'
// (neither fires a plain 'click'), so on the 'click' handler we only need to
// guard modified LEFT clicks and any non-primary button that still reached us.
function isModifiedClick(e) {
  return e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
}

export default function NavLink({
  to,
  href: hrefProp,
  onActivate,
  children,
  style,
  className,
  title,
  role,
  ariaLabel,
  stopPropagation = false,
  onClick,           // optional extra handler (runs before navigation logic)
  onMouseEnter,
  onMouseLeave,
}) {
  let href = hrefProp
  if (!href && to) {
    try { href = buildPath(to) } catch { href = null }
  }

  // No resolvable URL → fall back to a plain clickable span so behavior is
  // never worse than before (still navigates on click, just no native menu).
  if (!href) {
    return (
      <span
        role={role || 'link'}
        tabIndex={0}
        className={className}
        title={title}
        aria-label={ariaLabel}
        style={{ cursor: 'pointer', ...style }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={(e) => { if (stopPropagation) e.stopPropagation(); onClick?.(e); onActivate?.(e) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate?.(e) } }}
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
      aria-label={ariaLabel}
      style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer', ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation()
        onClick?.(e)
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
