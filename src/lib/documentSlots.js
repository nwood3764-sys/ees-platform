// Document slots — what a file gallery on a page layout is actually FOR.
//
// A documents gallery is one of exactly two things, and the widget's own config
// says which:
//
//   * A SLOT — `document_type` names one specific kind of file the record must
//     carry: "Upload W9", "HPXMLv4 / BuildingSync File", "Signed Assessment
//     Invoice". A slot lists ONLY documents of its own kind, so the card reads
//     as that one thing, and `required: true` means the record is incomplete
//     until something is in it.
//   * A CATCH-ALL — no `document_type`, or the default sentinel 'attachment'.
//     It lists everything on the record that no slot on the same layout claims,
//     so a file is never shown twice on one page.
//
// Why this module exists (2026-08-25): every gallery was a catch-all in
// practice. FileGalleryWidget read `config.document_type` on UPLOAD only — the
// list call was `listDocuments(table, id)` with no type filter — so the seven
// typed slots on the WI-IRA-MF-HOMES Final Project Payment Request layout each
// rendered the IDENTICAL full document list, and `config.required` /
// `config.help_text` were read by nothing at all. A layout could declare a
// required document and the platform would neither show that it was required
// nor notice it was missing.
//
// Pure: no React, no Supabase. Pinned by scripts/document-slots-fixture.mjs.

// The default `document_type` an untyped upload lands under. `documents`
// declares the column NOT NULL, so 'attachment' is the sentinel for "no
// particular kind", not a kind in its own right.
export const CATCH_ALL_DOCUMENT_TYPE = 'attachment'

function cfg(widgetOrConfig) {
  if (!widgetOrConfig) return {}
  // Accepts either a widget row ({widget_config}) or a bare config object.
  return widgetOrConfig.widget_config || widgetOrConfig
}

/**
 * The document type this gallery is a slot for, or null when it is a catch-all.
 * An empty string, a whitespace-only value and the 'attachment' sentinel are
 * all catch-alls — none of them names a kind of file.
 */
export function documentSlotType(widgetOrConfig) {
  const raw = cfg(widgetOrConfig).document_type
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t || t === CATCH_ALL_DOCUMENT_TYPE) return null
  return t
}

/** True when this gallery is a slot for one specific kind of document. */
export function isDocumentSlot(widgetOrConfig) {
  return documentSlotType(widgetOrConfig) !== null
}

/**
 * True when the layout declares this slot required. Only a slot can be
 * required — "required" on a catch-all would mean "attach something, anything",
 * which is not a rule anyone can satisfy deliberately.
 */
export function isRequiredDocumentSlot(widgetOrConfig) {
  return isDocumentSlot(widgetOrConfig) && cfg(widgetOrConfig).required === true
}

/** Guidance the layout author wrote for this gallery, or null. */
export function documentSlotHelpText(widgetOrConfig) {
  const raw = cfg(widgetOrConfig).help_text
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t || null
}

/**
 * Every document type claimed by a slot among these widgets. Used so a
 * catch-all gallery on the same layout can leave those files to their own slot
 * instead of listing them a second time.
 *
 * `widgets` may hold any widget types; non-document galleries are ignored.
 */
export function slotTypesOnLayout(widgets) {
  const out = new Set()
  for (const w of widgets || []) {
    if (!w) continue
    if (w.widget_type && w.widget_type !== 'file_gallery') continue
    const c = cfg(w)
    if (c.target !== 'documents') continue
    const t = documentSlotType(w)
    if (t) out.add(t)
  }
  return out
}

/**
 * Every document type claimed by a slot that renders on ONE SCREEN of a record:
 * the sections on the tab being viewed, plus the right rail, which is visible
 * on every tab.
 *
 * `slotTypesOnLayout` answers a different question — what the whole LAYOUT
 * claims — and using it for a gallery was wrong (2026-08-27). The typed slots
 * on the WI-IRA-MF-HOMES-PR enrollment layout sit on the Details tab, so
 * layout-wide claiming emptied the Documents card on the Related tab, and the
 * only way to reach those files was the one slot card each. "A file is never
 * shown twice" is a rule about a screen, and this is that rule.
 *
 * `sections` is the record's layout sections as the renderer holds them
 * (section_placement / section_tab / widgets).
 */
export function slotTypesOnSurface(sections, tab) {
  const surface = (sections || []).filter(sec => sec
    && ((sec.section_placement || 'main') === 'right'
      || (sec.section_tab || 'Details') === tab))
  return slotTypesOnLayout(surface.flatMap(sec => sec.widgets || []))
}

/**
 * The rows this gallery should show.
 *
 *   * slot      → only its own document type.
 *   * catch-all → everything no sibling slot on the layout claims.
 *
 * `claimedTypes` is optional; with none supplied a catch-all shows everything,
 * which is the behavior every existing catch-all card had before slots existed.
 */
export function filterSlotDocuments(rows, widgetOrConfig, claimedTypes) {
  const list = Array.isArray(rows) ? rows : []
  const slot = documentSlotType(widgetOrConfig)
  if (slot) return list.filter(r => r && r.document_type === slot)
  const claimed = claimedTypes instanceof Set
    ? claimedTypes
    : new Set(Array.isArray(claimedTypes) ? claimedTypes : [])
  if (claimed.size === 0) return list
  return list.filter(r => r && !claimed.has(r.document_type))
}

/**
 * What to render for this gallery given the rows it ended up with.
 *
 *   kind      'slot' | 'catch_all'
 *   type      the slot's document type, or null
 *   required  declared required (slots only)
 *   count     how many documents are in it
 *   satisfied a required slot with at least one document; true for anything
 *             that carries no requirement, so callers can treat it as "nothing
 *             outstanding here".
 */
export function documentSlotState(widgetOrConfig, rows) {
  const type = documentSlotType(widgetOrConfig)
  const count = Array.isArray(rows) ? rows.length : 0
  const required = isRequiredDocumentSlot(widgetOrConfig)
  return {
    kind: type ? 'slot' : 'catch_all',
    type,
    required,
    count,
    satisfied: required ? count > 0 : true,
  }
}

/**
 * The required document slots on a layout that have nothing in them.
 *
 * `documents` is every document on the record. Returns one entry per unfilled
 * slot, in the order the widgets were given, each carrying the label a person
 * reads on the card — which is what Verify Fields reports.
 */
export function missingRequiredDocuments(widgets, documents) {
  const rows = Array.isArray(documents) ? documents : []
  const present = new Set(rows.filter(Boolean).map(r => r.document_type))
  const out = []
  for (const w of widgets || []) {
    if (!w) continue
    if (w.widget_type && w.widget_type !== 'file_gallery') continue
    const c = cfg(w)
    if (c.target !== 'documents') continue
    if (!isRequiredDocumentSlot(w)) continue
    const type = documentSlotType(w)
    if (present.has(type)) continue
    out.push({ type, label: w.widget_title || type })
  }
  return out
}
