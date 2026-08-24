// ---------------------------------------------------------------------------
// documentDownloads — pure rules for downloading documents out of a record's
// Documents card, one file or a whole selection at a time.
//
// Nicholas (2026-08-24), from the Documents card on a Rocky Mount assessment:
// "I need to be able to select multiple and then click the actions, like
// download, not one at a time only."
//
// A document keeps the filename it was uploaded under — unlike a photo, whose
// download name is composed from its record number and work-step tag — so the
// rules here are about making that name safe to write to disk and unique
// inside a zip, never about renaming the file.
//
// No React, no network: everything here is a value in / value out so
// scripts/document-downloads-fixture.mjs can pin it.
// ---------------------------------------------------------------------------

// Long enough to keep a real program filename readable
// ("101 - 111 Queens Court - Rocky Mount - Improved - Asset Score Report"),
// short enough to stay under the path limits of Windows and macOS once a
// download folder is prefixed.
const MAX_BASE_LENGTH = 90

// An extension is the tail after the LAST dot, and only when it is short
// enough to actually be one. "…Baseline and Improved.pdf" splits; a name like
// "1837 Alden Rd. Janesville" does not — its trailing segment is words, so
// splitting there would put " Janesville" where the extension belongs.
const MAX_EXTENSION_LENGTH = 10

/**
 * Split a filename into `{ base, ext }`, where `ext` includes its dot and is
 * '' when the name carries no usable extension.
 */
export function splitFileName(name) {
  const s = String(name ?? '')
  const dot = s.lastIndexOf('.')
  if (dot <= 0 || dot === s.length - 1) return { base: s, ext: '' }
  const ext = s.slice(dot)
  if (ext.length - 1 > MAX_EXTENSION_LENGTH) return { base: s, ext: '' }
  if (!/^\.[A-Za-z0-9]+$/.test(ext)) return { base: s, ext: '' }
  return { base: s.slice(0, dot), ext }
}

/**
 * The filename a document downloads as. Strips path separators and characters
 * a filesystem would reject, collapses runs of whitespace, and truncates the
 * base while KEEPING the extension — a .pdf that lost its suffix opens in
 * nothing.
 */
export function documentFileName(doc) {
  const raw = String(doc?.name ?? '').trim()
  const cleaned = raw
    .replace(/[\\/]+/g, '-')          // never write into a subdirectory
    .replace(/[^\w \-().]/g, '')      // filesystem-safe set, same as photos
    .replace(/\s+/g, ' ')
    .trim()
  const source = cleaned || (doc?.id ? `document-${doc.id}` : 'document')
  const { base, ext } = splitFileName(source)
  const trimmed = base.slice(0, MAX_BASE_LENGTH).trim() || 'document'
  return `${trimmed}${ext}`
}

/**
 * A name that does not collide with anything already in `used`, disambiguated
 * BEFORE the extension so " (2)" never lands after ".pdf". Pure — the caller
 * records the returned name in `used` itself.
 */
export function uniqueEntryName(name, used) {
  const taken = used instanceof Set ? used : new Set(used || [])
  if (!taken.has(name)) return name
  const { base, ext } = splitFileName(name)
  let i = 2
  while (taken.has(`${base} (${i})${ext}`)) i += 1
  return `${base} (${i})${ext}`
}

/**
 * Name for the zip a multi-document download produces, derived from the
 * card's own title so a record with several document cards ("Documents",
 * "Program Applications") yields files you can tell apart.
 */
export function documentsZipName(title) {
  const base = String(title ?? '')
    .replace(/[^\w \-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return `${base || 'documents'}.zip`
}

/**
 * Drop selected ids that are no longer on screen — a row deleted, a filter
 * narrowed, or a different record loaded into the same card — so the count in
 * the toolbar always matches what a bulk action would actually touch.
 * Preserves the caller's ordering.
 */
export function pruneSelectedIds(selected, available) {
  const live = new Set(available || [])
  return (selected || []).filter(id => live.has(id))
}
