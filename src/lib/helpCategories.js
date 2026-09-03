// ---------------------------------------------------------------------------
// helpCategories — one answer to "which heading does this article live under?"
//
// The help centre's table of contents and LEAP Pad's knowledge base both group
// articles by ha_category, and until 2026-09-03 they disagreed: LEAP Pad
// normalised the casing, the help centre grouped by the raw string. So
// `communications` (one article) and `Communications` (twenty) were one
// heading on a phone and two on a desktop, and a reader who opened
// Communications on the desktop saw twenty of the twenty-one.
//
// The stored categories were merged in the same change, so today there is
// nothing to normalise. This exists so that the next stray — an admin typing
// "records" into the category box — cannot split a heading in two on one
// surface and not the other.
//
// Pure module: no React, no network. Pinned by
// scripts/help-categories-fixture.mjs.
// ---------------------------------------------------------------------------

/** The heading an article is filed under. Blank categories go to "Other". */
export const UNCATEGORISED_HELP_HEADING = 'Other'

export function normalizeHelpCategory(category) {
  const trimmed = String(category ?? '').trim()
  if (!trimmed) return UNCATEGORISED_HELP_HEADING
  // Case is presentation, not identity: "admin" and "Admin" are one heading.
  // The first letter is capitalised and the rest is left exactly as typed, so
  // "Reports & Dashboards" and "AI Assistant" keep their own capitals.
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

/**
 * Group articles under their headings, alphabetically, articles by title
 * within each. Returns [[heading, articles], …].
 */
export function groupHelpArticlesByCategory(articles, { titleOf = a => a?.ha_title || '' } = {}) {
  const map = new Map()
  for (const article of articles || []) {
    const heading = normalizeHelpCategory(article?.ha_category)
    if (!map.has(heading)) map.set(heading, [])
    map.get(heading).push(article)
  }
  const groups = [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [, list] of groups) list.sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
  return groups
}
